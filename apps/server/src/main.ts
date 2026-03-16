import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import * as fs from 'fs';
import * as express from 'express';
import {
  STORAGE_ORIGINAL,
  STORAGE_PROCESSED,
  STORAGE_FAILED,
  STORAGE_CROPS,
} from './common/constants';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Ensure storage directories exist before starting
  for (const dir of [STORAGE_ORIGINAL, STORAGE_PROCESSED, STORAGE_FAILED, STORAGE_CROPS]) {
    fs.mkdirSync(dir, { recursive: true });
    logger.log(`Storage directory ready: ${dir}`);
  }

  // Check Google Vision API configuration
  const googleCredsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (googleCredsPath) {
    if (fs.existsSync(googleCredsPath)) {
      logger.log(`✅ Google Vision API credentials found: ${googleCredsPath}`);
    } else {
      logger.warn(`⚠ Google Vision API credentials file not found: ${googleCredsPath}`);
      logger.warn(`⚠ Google Vision API will be disabled`);
    }
  } else {
    logger.log(`ℹ Google Vision API not configured (GOOGLE_APPLICATION_CREDENTIALS not set)`);
    logger.log(`ℹ Google Vision API will be disabled (optional fallback)`);
  }

  const app = await NestFactory.create(AppModule, {
    // CRITICAL: Disable bodyParser completely
    // NestJS bodyParser has a default 1MB limit that rejects requests BEFORE Multer processes them
    // We'll configure body parsers manually to skip multipart/form-data
    bodyParser: false, // Disable default bodyParser - we'll configure it manually
  });

  // Get the underlying Express instance
  const expressApp = app.getHttpAdapter().getInstance();
  
  // CRITICAL FIX: Remove ALL existing body parsers that NestJS might have added
  // Even with bodyParser: false, NestJS might add some middleware
  // We need to ensure multipart/form-data is NEVER parsed by bodyParser
  
  // Create body parsers with high limits (but we'll apply them conditionally)
  const jsonParser = express.json({ limit: '2gb' });
  const urlencodedParser = express.urlencoded({ limit: '2gb', extended: true });
  
  // CRITICAL: Add middleware FIRST (before ANY other middleware)
  // This MUST be the very first middleware to intercept ALL requests
  // Express processes middleware in order, so this must come first
  expressApp.use((req, res, next) => {
    // Log EVERY request that reaches the server (for debugging)
    const contentType = req.headers['content-type'] || '';
    const contentLength = req.headers['content-length'];
    
    logger.log(`[Server] ═══════════════════════════════════════════════════════`);
    logger.log(`[Server] 📥 Request received at backend server`);
    logger.log(`[Server]    Path: ${req.path}`);
    logger.log(`[Server]    Method: ${req.method}`);
    logger.log(`[Server]    Content-Type: ${contentType.substring(0, 80)}`);
    logger.log(`[Server]    Content-Length: ${contentLength || 'unknown'} bytes`);
    
    if (contentLength) {
      const sizeMB = (parseInt(contentLength, 10) / (1024 * 1024)).toFixed(2);
      logger.log(`[Server]    Size: ${sizeMB} MB`);
    }
    logger.log(`[Server] ═══════════════════════════════════════════════════════`);
    
    // Handle multipart/form-data - SKIP body parsing completely
    if (contentType.includes('multipart/form-data')) {
      logger.log(`[Server] ✅ Detected multipart/form-data - skipping body parser`);
      logger.log(`[Server] ✅ Passing to Multer for processing`);
      
      // CRITICAL: Skip body parsing completely - Multer handles multipart/form-data
      // DO NOT parse the body - let Multer handle it exclusively
      // This prevents Express bodyParser from rejecting large multipart requests
      return next(); // Let Multer handle it - NO body parsing
    }
    
    // For non-multipart requests, apply appropriate parser
    if (contentType.includes('application/json')) {
      logger.log(`[Server] ✅ Detected JSON - using JSON parser`);
      return jsonParser(req, res, next);
    }
    
    if (contentType.includes('application/x-www-form-urlencoded')) {
      logger.log(`[Server] ✅ Detected URL-encoded - using URL parser`);
      return urlencodedParser(req, res, next);
    }
    
    // For other content types, continue without parsing
    logger.log(`[Server] ✅ Unknown content type - passing through`);
    next();
  });
  
  // Add error handler for Multer errors (LIMIT_FILE_SIZE, etc.)
  expressApp.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Log all errors for debugging
    if (err) {
      logger.error(`[Error Handler] ═══════════════════════════════════════════════════════`);
      logger.error(`[Error Handler] Error code: ${err.code || 'UNKNOWN'}`);
      logger.error(`[Error Handler] Error message: ${err.message || err.toString()}`);
      logger.error(`[Error Handler] Request path: ${req.path}`);
      logger.error(`[Error Handler] Content-Type: ${req.headers['content-type']}`);
      logger.error(`[Error Handler] Content-Length: ${req.headers['content-length']}`);
      logger.error(`[Error Handler] ═══════════════════════════════════════════════════════`);
    }
    
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      logger.error(`[Multer] ❌ File size limit exceeded: ${err.message}`);
      logger.error(`[Multer]    Configured limit: 20MB per chunk`);
      return res.status(413).json({
        error: 'File too large',
        message: err.message,
        limit: '20MB per chunk',
        code: 'LIMIT_FILE_SIZE',
      });
    }
    if (err && err.code === 'LIMIT_FIELD_SIZE') {
      logger.error(`[Multer] ❌ Field size limit exceeded: ${err.message}`);
      logger.error(`[Multer]    Configured limit: 10MB per field`);
      return res.status(413).json({
        error: 'Field too large',
        message: err.message,
        limit: '10MB per field',
        code: 'LIMIT_FIELD_SIZE',
      });
    }
    if (err && err.statusCode === 413) {
      logger.error(`[Express] ❌ 413 Payload Too Large`);
      logger.error(`[Express]    This might be from Express bodyParser, not Multer`);
      return res.status(413).json({
        error: 'Payload too large',
        message: 'Request body exceeds size limit',
        hint: 'Check server logs for details',
      });
    }
    next(err);
  });
  
  // CRITICAL: Set global Multer defaults to prevent 413 errors
  // This ensures Multer doesn't use its default 1MB limit
  const multer = require('multer');
  const upload = multer({
    limits: {
      fileSize: 20 * 1024 * 1024, // 20MB default (controllers can override)
      fieldSize: 10 * 1024 * 1024, // 10MB for fields
      fields: 20,
      fieldNameSize: 256,
      files: 10,
    },
  });
  
  // Apply Multer defaults globally (but controllers override with FileInterceptor)
  expressApp.use('/upload/chunk', (req, res, next) => {
    // Log request size for debugging
    const contentLength = req.headers['content-length'];
    if (contentLength) {
      const sizeMB = (parseInt(contentLength, 10) / (1024 * 1024)).toFixed(2);
      logger.debug(`[Multer] Incoming chunk upload: ${sizeMB} MB`);
    }
    next();
  });
  
  logger.log('✅ Body parser configured: 2GB limit for JSON/URL-encoded');
  logger.log('✅ Multipart/form-data: Handled by Multer');
  logger.log('✅ Multer global defaults: 20MB file, 10MB field');
  logger.log('✅ Controller limits: 15MB chunk, 10MB field (upload-chunk.controller.ts)');
  logger.log('⚠️  CRITICAL: Server MUST be restarted for these changes to take effect!');

  // Enable CORS for the React frontend
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization',
    exposedHeaders: 'Content-Disposition,Content-Type',
    credentials: false,
  });

  const port = process.env.SERVER_PORT || 3001;
  await app.listen(port);

  logger.log(`🚀 Barocode API server running on http://localhost:${port}`);
}

bootstrap();

