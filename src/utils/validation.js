// src/utils/validation.js

const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';
const VERBOSE_LOGGING = process.env.VERBOSE_LOGGING === 'true';

/**
 * Redact sensitive fields from objects (for logging)
 * Handles circular references to prevent stack overflow
 */
export function redactSensitiveData(obj, seen = new WeakSet()) {
  if (!obj || typeof obj !== 'object') return obj;

  // Prevent circular reference infinite recursion
  if (seen.has(obj)) return '[Circular]';
  seen.add(obj);

  const sensitive = ['email_address', 'phone_number', 'ssn', 'social_security', 'api_key', 'password', 'token'];
  const redacted = Array.isArray(obj) ? [...obj] : { ...obj };

  for (const key in redacted) {
    if (sensitive.some(s => key.toLowerCase().includes(s))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      redacted[key] = redactSensitiveData(redacted[key], seen);
    }
  }

  return redacted;
}

/**
 * Helper to sanitize error messages for production
 */
export function sanitizeError(err, context = 'operation') {
  if (IS_DEVELOPMENT || VERBOSE_LOGGING) {
    return err.message || 'Unknown error';
  }
  // Generic message in production to avoid info leakage
  console.error(`[ERROR] ${context}:`, err);
  return `An error occurred during ${context}. Please try again later.`;
}

/**
 * Validate API key format before making external API calls
 * Returns validation result with suspicion scoring
 */
export function validateApiKeyFormat(apiKey, userAgent = '', honeypotValue = '') {
  const reasons = [];
  let suspicionScore = 0;

  // Handle null/undefined
  if (!apiKey || typeof apiKey !== 'string') {
    return {
      valid: false,
      suspicionScore: 50,
      reasons: ['Invalid API key (null or undefined)']
    };
  }

  // Honeypot check (instant reject)
  if (honeypotValue && honeypotValue.trim() !== '') {
    return {
      valid: false,
      suspicionScore: 100,
      reasons: ['Honeypot triggered (bot detected)']
    };
  }

  // Length check (must be exactly 64 characters)
  if (apiKey.length !== 64) {
    return {
      valid: false,
      suspicionScore: 50,
      reasons: ['Invalid length (expected 64 characters)']
    };
  }

  // Format check (lowercase alphanumeric only)
  if (!/^[a-z0-9]+$/.test(apiKey)) {
    return {
      valid: false,
      suspicionScore: 60,
      reasons: ['Invalid format (must be lowercase alphanumeric only)']
    };
  }

  // Low entropy check (repeating patterns)
  const charCounts = {};
  for (const char of apiKey) {
    charCounts[char] = (charCounts[char] || 0) + 1;
  }
  const maxRepeats = Math.max(...Object.values(charCounts));
  const repeatRatio = maxRepeats / apiKey.length;

  if (repeatRatio > 0.4) {
    suspicionScore += 40;
    reasons.push('Low entropy (repeating characters)');
  }

  // Spam pattern check
  const spamPatterns = [
    'test', 'password', 'admin', '123456', 'null', 'undefined',
    'example', 'sample', 'demo', 'fake', 'invalid'
  ];
  const lowerKey = apiKey.toLowerCase();
  for (const pattern of spamPatterns) {
    if (lowerKey.includes(pattern)) {
      suspicionScore += 50;
      reasons.push(`Spam pattern detected: ${pattern}`);
      break;
    }
  }

  // User-agent bot detection
  const botPatterns = ['bot', 'crawler', 'spider', 'curl', 'wget', 'python', 'requests'];
  const lowerUA = userAgent.toLowerCase();
  for (const pattern of botPatterns) {
    if (lowerUA.includes(pattern)) {
      suspicionScore += 30;
      reasons.push('Bot user-agent detected');
      break;
    }
  }

  // Decision: Reject if score > 80
  const valid = suspicionScore <= 80;

  return { valid, suspicionScore, reasons };
}

/**
 * Replace field placeholders in markdown content
 */
export function replaceFieldPlaceholders(md, fields) {
  const formatDate = (d) => {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
  };
  const vals = {
    signerName1: fields.name || '',
    signerEmail1: fields.email || '',
    field1: fields.field1 || '',
    field2: fields.field2 || '',
    field3: fields.field3 || '',
    date: formatDate(new Date()),
  };
  return md.replace(/\{\{(\w+)\}\}/g, (_, key) => vals[key] || `{{${key}}}`);
}
