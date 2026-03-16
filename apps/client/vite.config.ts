import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
        // CRITICAL: Configure proxy to handle large uploads without buffering
        // Vite uses http-proxy-middleware - we need to disable buffering for large files
        configure: (proxy, _options) => {
          // Set proxy middleware options directly
          // These options are passed to http-proxy-middleware
          const proxyOptions = {
            // CRITICAL: Disable request buffering - stream directly to backend
            // This prevents the proxy from loading the entire request into memory
            buffer: false,
            // Increase proxy timeout
            timeout: 1800000, // 30 minutes
            // Don't modify request headers unnecessarily
            preserveHeaderKeyCase: true,
            // Handle response ourselves if needed
            selfHandleResponse: false,
          };
          
          // Apply options to proxy instance
          // Use type assertion because http-proxy Server type doesn't expose .options directly
          const proxyAny = proxy as any;
          Object.assign(proxyAny.options || {}, proxyOptions);
          // CRITICAL: Configure http-proxy-middleware to handle large uploads
          // Set proxy options to disable buffering and handle large bodies
          proxyAny.options = {
            ...proxyAny.options,
            // Disable request buffering - stream directly to backend
            buffer: false,
            // Increase limits
            limit: '50mb', // This is for the proxy's internal buffer, not the actual request
            // Preserve headers
            preserveHeaderKeyCase: true,
            // Don't modify the request body
            selfHandleResponse: false,
          };
          
          // Log ALL incoming requests to see if they reach the proxy
          proxy.on('proxyReq', (proxyReq, req) => {
            const contentType = req.headers['content-type'] || '';
            const contentLength = req.headers['content-length'];
            
            console.log(`[Vite Proxy] ═══════════════════════════════════════════════════════`);
            console.log(`[Vite Proxy] 📤 Request received at proxy`);
            console.log(`[Vite Proxy]    Path: ${req.url}`);
            console.log(`[Vite Proxy]    Method: ${req.method}`);
            console.log(`[Vite Proxy]    Content-Type: ${contentType.substring(0, 50)}...`);
            console.log(`[Vite Proxy]    Content-Length: ${contentLength || 'unknown'} bytes`);
            
            if (contentLength) {
              const sizeMB = (parseInt(contentLength, 10) / (1024 * 1024)).toFixed(2);
              console.log(`[Vite Proxy]    Size: ${sizeMB} MB`);
            }
            console.log(`[Vite Proxy] ═══════════════════════════════════════════════════════`);
            
            // Ensure Content-Length header is preserved
            if (contentLength) {
              proxyReq.setHeader('Content-Length', contentLength);
            }
            
            // Preserve multipart/form-data headers exactly
            if (contentType.includes('multipart/form-data')) {
              proxyReq.setHeader('Content-Type', contentType);
              console.log(`[Vite Proxy] ✅ Preserving multipart/form-data headers`);
            }
          });
          
          // Log when request starts streaming
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            console.log(`[Vite Proxy] WebSocket proxy request`);
          });
          
          // Handle errors - this will catch 413 errors BEFORE they reach backend
          proxy.on('error', (err, req, res) => {
            console.error(`[Vite Proxy] ❌ Proxy error occurred`);
            console.error(`[Vite Proxy]    Error: ${err.message}`);
            console.error(`[Vite Proxy]    Path: ${req.url}`);
            console.error(`[Vite Proxy]    Content-Length: ${req.headers['content-length']}`);
            
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Proxy error', 
                message: err.message,
                hint: 'Check Vite proxy configuration'
              }));
            }
          });
          
          // Log backend responses
          proxy.on('proxyRes', (proxyRes, req, res) => {
            const contentLength = req.headers['content-length'] || 'unknown';
            
            console.log(`[Vite Proxy] 📥 Backend response received`);
            console.log(`[Vite Proxy]    Status: ${proxyRes.statusCode}`);
            console.log(`[Vite Proxy]    Request size: ${contentLength} bytes`);
            
            // Log 413 errors for debugging
            if (proxyRes.statusCode === 413) {
              console.error(`[Vite Proxy] ⚠️ ⚠️ ⚠️ BACKEND RETURNED 413 ⚠️ ⚠️ ⚠️`);
              console.error(`[Vite Proxy]    Request size: ${contentLength} bytes`);
              console.error(`[Vite Proxy]    Path: ${req.url}`);
              console.error(`[Vite Proxy]    Check backend Multer limits in upload-chunk.controller.ts`);
            }
          });
        },
        // Increase timeout for large uploads
        timeout: 1800000, // 30 minutes
      },
    },
  },
});

