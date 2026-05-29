// src/config/security.js
import crypto from 'crypto';
import path from 'path';
import { config } from 'dotenv';
import fs from 'fs';

// ⚠️ CRITICAL: Load .env before reading process.env
const _NODE_ENV = process.env.NODE_ENV || 'development';
const _IS_PRODUCTION = _NODE_ENV === 'production';
const envFile = _IS_PRODUCTION ? '.env.production' : '.env.development';

if (fs.existsSync(envFile)) {
  config({ path: envFile });
} else {
  config();
}

// Logo Configuration for Text Tags Documents
export const LOGO_CONFIG = {
  logoPath: path.join(process.cwd(), 'public', 'main_logo.png'),
  logoWidth: 120,
  logoHeight: 40,
  headerHeight: 80,
  headerPaddingBottom: 10,
  separatorLineWidth: 1,
  separatorLineColor: '#cccccc'
};

// Encryption configuration for API keys (AES-256-CBC)
export const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex').slice(0, 32);
export const ENCRYPTION_IV_LENGTH = 16;

// CSRF Secret
export const CSRF_SECRET = process.env.CSRF_SECRET || crypto.randomBytes(32).toString('hex');

// Debug logging flag
export const VERBOSE_LOGGING = process.env.VERBOSE_LOGGING === 'true';
