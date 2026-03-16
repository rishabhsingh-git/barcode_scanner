#!/usr/bin/env tsx
/**
 * Integration Verification Script
 * Checks if all components are properly integrated:
 * - Dynamsoft Python SDK
 * - Google Vision API
 * - Image preprocessing
 */

import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import { promisify } from 'util';
const execFile = promisify(childProcess.execFile);

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  🔍 Integration Verification');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

async function runChecks() {
let allChecksPassed = true;

// Check 1: Python and Dynamsoft
console.log('  [Check 1] Python & Dynamsoft SDK');
console.log('  ────────────────────────────────────────────────────────');
try {
  const pythonVersion = await execFile('python3', ['--version']);
  console.log(`  ✓ Python3 installed: ${pythonVersion.stdout.trim()}`);
  
  const pipList = await execFile('pip3', ['list', '--format=json']);
  const packages = JSON.parse(pipList.stdout);
  const dbrInstalled = packages.some((p: any) => p.name === 'dbr');
  const opencvInstalled = packages.some((p: any) => p.name === 'opencv-python');
  const pillowInstalled = packages.some((p: any) => p.name === 'Pillow');
  
  if (dbrInstalled) {
    console.log(`  ✓ Dynamsoft Barcode Reader (dbr) installed`);
  } else {
    console.log(`  ❌ Dynamsoft Barcode Reader (dbr) NOT installed`);
    allChecksPassed = false;
  }
  
  if (opencvInstalled) {
    console.log(`  ✓ OpenCV (opencv-python) installed`);
  } else {
    console.log(`  ❌ OpenCV (opencv-python) NOT installed`);
    allChecksPassed = false;
  }
  
  if (pillowInstalled) {
    console.log(`  ✓ Pillow installed`);
  } else {
    console.log(`  ❌ Pillow NOT installed`);
    allChecksPassed = false;
  }
  
  // Check if detect_barcode.py exists
  const scriptPath = path.join(__dirname, 'detect_barcode.py');
  if (fs.existsSync(scriptPath)) {
    console.log(`  ✓ detect_barcode.py script exists`);
  } else {
    console.log(`  ❌ detect_barcode.py script NOT found: ${scriptPath}`);
    allChecksPassed = false;
  }
} catch (error: any) {
  console.log(`  ❌ Error checking Python: ${error.message}`);
  allChecksPassed = false;
}
console.log('');

// Check 2: Google Vision API
console.log('  [Check 2] Google Vision API');
console.log('  ────────────────────────────────────────────────────────');
const googleCredsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './vision-key.json';
console.log(`  Credentials path: ${googleCredsPath}`);

if (fs.existsSync(googleCredsPath)) {
  console.log(`  ✓ Credentials file exists`);
  
  try {
    const credsContent = fs.readFileSync(googleCredsPath, 'utf8');
    const creds = JSON.parse(credsContent);
    
    if (creds.project_id) {
      console.log(`  ✓ Valid JSON credentials`);
      console.log(`    Project ID: ${creds.project_id}`);
      console.log(`    Client Email: ${creds.client_email || 'N/A'}`);
    } else {
      console.log(`  ⚠ Credentials file exists but missing project_id`);
    }
  } catch (error: any) {
    console.log(`  ❌ Invalid JSON in credentials file: ${error.message}`);
    allChecksPassed = false;
  }
} else {
  console.log(`  ⚠ Credentials file NOT found (Google Vision will be disabled)`);
  console.log(`    This is optional - system will work without it`);
}
console.log('');

// Check 3: Node.js packages
console.log('  [Check 3] Node.js Dependencies');
console.log('  ────────────────────────────────────────────────────────');
try {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  const requiredPackages = [
    '@google-cloud/vision',
    '@nestjs/common',
    '@nestjs/core',
    'sharp',
  ];
  
  for (const pkg of requiredPackages) {
    if (packageJson.dependencies?.[pkg] || packageJson.devDependencies?.[pkg]) {
      console.log(`  ✓ ${pkg} in package.json`);
    } else {
      console.log(`  ❌ ${pkg} NOT in package.json`);
      allChecksPassed = false;
    }
  }
} catch (error: any) {
  console.log(`  ❌ Error checking package.json: ${error.message}`);
  allChecksPassed = false;
}
console.log('');

// Check 4: TypeScript compilation
console.log('  [Check 4] TypeScript Compilation');
console.log('  ────────────────────────────────────────────────────────');
try {
  const distPath = path.join(__dirname, '..', 'dist');
  const googleVisionClientPath = path.join(distPath, 'common', 'google-vision-client.js');
  
  if (fs.existsSync(googleVisionClientPath)) {
    console.log(`  ✓ Google Vision client compiled`);
  } else {
    console.log(`  ⚠ Google Vision client not compiled (run: npm run build)`);
  }
  
  const barcodeServicePath = path.join(distPath, 'modules', 'barcode', 'barcode.service.js');
  if (fs.existsSync(barcodeServicePath)) {
    console.log(`  ✓ Barcode service compiled`);
  } else {
    console.log(`  ⚠ Barcode service not compiled (run: npm run build)`);
  }
} catch (error: any) {
  console.log(`  ⚠ Error checking dist: ${error.message}`);
}
console.log('');

// Summary
console.log('═══════════════════════════════════════════════════════════');
if (allChecksPassed) {
  console.log('  ✅ All critical checks passed!');
} else {
  console.log('  ⚠ Some checks failed - see above for details');
}
console.log('═══════════════════════════════════════════════════════════');
console.log('');

process.exit(allChecksPassed ? 0 : 1);
}

runChecks().catch((error) => {
  console.error('Verification script error:', error);
  process.exit(1);
});

