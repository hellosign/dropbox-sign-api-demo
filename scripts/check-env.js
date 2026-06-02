#!/usr/bin/env node
// scripts/check-env.js
// First-time setup wizard for Dropbox Sign API Demo Portal

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const envPath = path.join(ROOT, '.env');
const envExamplePath = path.join(ROOT, '.env.example');

// Skip wizard if running in Docker (env vars set externally)
if (process.env.REDIS_URL?.includes('redis:') || process.env.DOCKER_ENV === 'true') {
  process.exit(0);
}

// Skip wizard if .env already exists
if (fs.existsSync(envPath)) {
  process.exit(0);
}

// Interactive setup
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║        Welcome to Dropbox Sign API Demo Portal!       ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('⚠️  No .env file detected - first-time setup required');
  console.log('');
  console.log('This setup will:');
  console.log('  1. Create your .env configuration file');
  console.log('  2. Generate secure session and encryption keys');
  console.log('  3. Configure your admin email for login access');
  console.log('');

  const answer = await ask('Run automatic setup? (yes/no): ');

  if (!answer.toLowerCase().startsWith('y')) {
    console.log('');
    console.log('Manual setup: Copy .env.example to .env and fill in your values.');
    console.log('  cp .env.example .env');
    console.log('');
    rl.close();
    process.exit(1);
  }

  console.log('');

  // Step 1: Load template
  console.log('📋 Step 1: Creating .env file...');
  let envContent;
  if (fs.existsSync(envExamplePath)) {
    envContent = fs.readFileSync(envExamplePath, 'utf-8');
    console.log('  ✓ Template loaded');
  } else {
    envContent = [
      '# Environment Configuration',
      'NODE_ENV=development',
      '',
      '# Server Configuration',
      'PORT=3001',
      '',
      '# Security Configuration',
      'SESSION_SECRET=',
      'ENCRYPTION_KEY=',
      'CSRF_SECRET=',
      '',
      '# Access Control',
      'ADMIN_EMAILS=',
      'ALLOWED_DOMAINS=',
      'ALLOWED_EMAILS=',
      '',
      '# Logging',
      'VERBOSE_LOGGING=false',
    ].join('\n');
    console.log('  ✓ Default template created');
  }

  console.log('');

  // Step 2: Generate security keys
  console.log('🔐 Step 2: Generating security keys...');

  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const encryptionKey = crypto.randomBytes(16).toString('hex'); // 32 chars
  const csrfSecret = crypto.randomBytes(32).toString('hex');

  envContent = envContent.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${sessionSecret}`);
  console.log('  ✓ SESSION_SECRET generated');

  envContent = envContent.replace(/^ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY=${encryptionKey}`);
  console.log('  ✓ ENCRYPTION_KEY generated');

  envContent = envContent.replace(/^CSRF_SECRET=.*$/m, `CSRF_SECRET=${csrfSecret}`);
  console.log('  ✓ CSRF_SECRET generated');

  console.log('');

  // Step 3: Admin email
  console.log('👤 Step 3: Configure admin access...');
  console.log('');
  console.log('ℹ️  Enter the email address that will have admin access.');
  console.log('   This should match your Dropbox Sign account email.');
  console.log('');

  const email = await ask('Admin email address: ');
  const trimmedEmail = email.trim();

  if (trimmedEmail) {
    envContent = envContent.replace(/^ADMIN_EMAILS=.*$/m, `ADMIN_EMAILS=${trimmedEmail}`);
    console.log(`  ✓ Admin email set: ${trimmedEmail}`);
  } else {
    console.log('  ⚠ No email entered - you can set ADMIN_EMAILS in .env later');
  }

  console.log('');

  // Step 4: Redis (optional)
  console.log('💾 Step 4: Redis configuration (optional)...');
  console.log('');
  console.log('   Redis enables session persistence across restarts,');
  console.log('   API log history, and theme-to-template mappings.');
  console.log('   Without Redis, the app uses in-memory storage (data lost on restart).');
  console.log('');

  const redisAnswer = await ask('Do you have Redis installed? (yes/no): ');

  if (redisAnswer.toLowerCase().startsWith('y')) {
    const redisUrl = await ask('Redis URL (press Enter for redis://localhost:6379): ');
    const finalRedisUrl = redisUrl.trim() || 'redis://localhost:6379';
    envContent = envContent.replace(/^REDIS_URL=.*$/m, `REDIS_URL=${finalRedisUrl}`);
    console.log(`  ✓ Redis configured: ${finalRedisUrl}`);
  } else {
    console.log('  ✓ Using in-memory storage (you can add Redis later in .env)');
  }

  console.log('');

  // Write .env file
  fs.writeFileSync(envPath, envContent, 'utf-8');

  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║            ✅ Setup Complete!                          ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Starting the application...');
  console.log('');

  rl.close();
}

main().catch(err => {
  console.error('Setup failed:', err.message);
  rl.close();
  process.exit(1);
});
