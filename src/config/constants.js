// src/config/constants.js
import { config } from 'dotenv';
import fs from 'fs';

// ⚠️ CRITICAL: Load .env before reading process.env
// ES6 imports are hoisted, so we must load .env HERE before using process.env
const _NODE_ENV = process.env.NODE_ENV || 'development';
const _IS_PRODUCTION = _NODE_ENV === 'production';
const envFile = _IS_PRODUCTION ? '.env.production' : '.env.development';

if (fs.existsSync(envFile)) {
  config({ path: envFile });
} else {
  config(); // Fallback to .env
}

// OAuth Client ID
export const CLIENT_ID = process.env.CLIENT_ID || null;

// Template IDs for signature requests
export const TEMPLATE_IDS = (process.env.TEMPLATE_IDS || "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

// API Key (used for callback validation)
export const API_KEY = process.env.API_KEY;

// Access Control Configuration (baseline from .env)
export const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || 'dropbox.com')
  .split(',')
  .map(d => d.trim().toLowerCase())
  .filter(Boolean);

export const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * Get allowed domains from Redis (runtime) or .env (fallback)
 */
export async function getAllowedDomains(redisClient) {
  if (redisClient) {
    try {
      const redisDomains = await redisClient.get('system:allowed_domains');
      if (redisDomains) {
        return JSON.parse(redisDomains);
      }
    } catch (err) {
      console.error('[ACCESS CONTROL] Redis read error, falling back to .env:', err.message);
    }
  }
  return ALLOWED_DOMAINS;
}

/**
 * Get allowed emails from Redis (runtime) or .env (fallback)
 */
export async function getAllowedEmails(redisClient) {
  if (redisClient) {
    try {
      const redisEmails = await redisClient.get('system:allowed_emails');
      if (redisEmails) {
        return JSON.parse(redisEmails);
      }
    } catch (err) {
      console.error('[ACCESS CONTROL] Redis read error, falling back to .env:', err.message);
    }
  }
  return ALLOWED_EMAILS;
}

/**
 * Check if email is allowed based on domains and specific emails
 */
export function isEmailAllowed(email, allowedDomains, allowedEmails) {
  if (!email) return false;

  const emailLower = email.toLowerCase();
  const domain = emailLower.split('@')[1];

  // Check specific emails first (overrides domain check)
  if (allowedEmails && allowedEmails.length > 0) {
    if (allowedEmails.includes(emailLower)) {
      return true;
    }
    // If specific emails are configured but this isn't one, deny
    // (unless domain is also allowed)
  }

  // Check domain
  return allowedDomains && allowedDomains.includes(domain);
}

/**
 * Get admin emails from Redis (runtime) or .env (fallback)
 */
export async function getAdminEmails(redisClient) {
  if (redisClient) {
    try {
      const redisAdmins = await redisClient.get('system:admin_emails');
      if (redisAdmins) {
        return JSON.parse(redisAdmins);
      }
    } catch (err) {
      console.error('[ADMIN] Redis read error, falling back to .env:', err.message);
    }
  }
  return ADMIN_EMAILS;
}

/**
 * Check if email is an admin
 */
export function isAdmin(email, adminEmails) {
  if (!email || !adminEmails) return false;
  return adminEmails.includes(email.toLowerCase());
}

// Admin access control
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

// Environment flags
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const IS_DEVELOPMENT = !IS_PRODUCTION;

// Server configuration
export const PORT = parseInt(process.env.PORT, 10) || 3001;

// Log startup configuration
console.log('[ACCESS CONTROL] Allowed domains:', ALLOWED_DOMAINS);
if (ALLOWED_EMAILS.length > 0) {
  console.log('[ACCESS CONTROL] Allowed emails:', ALLOWED_EMAILS.length, 'specific emails');
}
if (ADMIN_EMAILS.length > 0) {
  console.log('[ADMIN] Admin emails configured:', ADMIN_EMAILS.length, 'admins');
} else {
  console.log('[ADMIN] No admin emails configured - admin panel disabled');
}
