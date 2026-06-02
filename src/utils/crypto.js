// src/utils/crypto.js
import crypto from 'crypto';
import { ENCRYPTION_IV_LENGTH, VERBOSE_LOGGING } from '../config/security.js';

function getKey() {
  return process.env.ENCRYPTION_KEY;
}

/**
 * Encrypt sensitive data (API keys) before storing in Redis
 */
export function encryptApiKey(apiKey) {
  if (!apiKey) return null;
  const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(getKey()), iv);
  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt API keys from Redis
 * Handles backward compatibility with plain-text API keys from before encryption was implemented
 */
export function decryptApiKey(data) {
  if (!data) return null;

  // Check if this is an encrypted key (format: "iv:encrypted")
  if (data.includes(':') && data.split(':').length === 2) {
    try {
      const parts = data.split(':');
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(getKey()), iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      if (VERBOSE_LOGGING) {
        console.error('[CRYPTO] Decryption failed:', err.message);
        console.warn('[CRYPTO] Treating as plain-text API key (migration)');
      }
      return data;
    }
  }

  if (VERBOSE_LOGGING) console.warn('[CRYPTO] Plain-text API key detected (legacy session)');
  return data;
}

/**
 * Hash API key for rotation detection
 */
export function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Verify Dropbox Sign webhook signature
 * @param {string} apiKey - The API key used for HMAC
 * @param {object} body - The webhook request body
 * @param {string} signature - The x-hellosign-signature header
 * @returns {boolean} - True if signature is valid
 */
export function verifyWebhookSignature(apiKey, body, signature) {
  if (!apiKey || !body || !signature) return false;
  try {
    const payload = JSON.stringify(body);
    const hmac = crypto.createHmac('sha256', apiKey);
    hmac.update(payload);
    const calculatedSignature = hmac.digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(calculatedSignature)
    );
  } catch (err) {
    console.error('[WEBHOOK] Signature verification failed:', err.message);
    return false;
  }
}
