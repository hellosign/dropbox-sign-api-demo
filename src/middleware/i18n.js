// src/middleware/i18n.js
// Internationalization middleware for language detection and translation support

import i18n from 'i18n';
import path from 'path';
import { fileURLToPath } from 'url';
import { VERBOSE_LOGGING } from '../config/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure i18n
i18n.configure({
  locales: ['en', 'es', 'ja'],
  defaultLocale: 'en',
  directory: path.join(__dirname, '../../locales'),
  cookie: 'locale',
  queryParameter: 'locale',
  autoReload: process.env.NODE_ENV !== 'production', // Reload translations in dev
  updateFiles: false,  // Don't auto-update JSON files
  syncFiles: false,    // Don't sync missing keys across locales
  indent: '  ',
  objectNotation: false, // DISABLE: Our JSON uses flat structure with dot-notation keys
  register: global,    // Make __ available globally
});

// Log available locales on startup
if (VERBOSE_LOGGING) console.log('[I18N] Configured locales:', i18n.getLocales());
if (VERBOSE_LOGGING) console.log('[I18N] Default locale:', i18n.getLocale());
if (VERBOSE_LOGGING) console.log('[I18N] Locales directory:', path.join(__dirname, '../../locales'));

/**
 * Parse Accept-Language header to extract preferred language
 * @param {string} header - Accept-Language header value
 * @returns {string} - Preferred language code (e.g., 'en', 'fr', 'ja')
 */
function parseAcceptLanguage(header) {
  if (!header) return 'en';

  const languages = header
    .split(',')
    .map(lang => {
      const [code, qStr] = lang.trim().split(';q=');
      const q = qStr ? parseFloat(qStr) : 1.0;
      // Extract base language (e.g., 'en' from 'en-US')
      return { code: code.split('-')[0].toLowerCase(), q };
    })
    .sort((a, b) => b.q - a.q); // Sort by quality value (highest first)

  return languages[0]?.code || 'en';
}

/**
 * Language detection middleware
 * Detects user's preferred language from multiple sources and sets it in session
 */
export function i18nMiddleware(req, res, next) {
  // 1. Initialize i18n for this request
  i18n.init(req, res);

  // 2. Detect language (priority: query → session → cookie → header → default)
  let locale = req.query.locale; // Query param override (e.g., ?locale=fr)

  if (!locale && req.session?.preferences?.locale) {
    locale = req.session.preferences.locale; // User's saved preference
  }

  if (!locale) {
    locale = req.cookies.locale; // Cookie fallback
  }

  if (!locale && req.headers['accept-language']) {
    // Parse Accept-Language header
    locale = parseAcceptLanguage(req.headers['accept-language']);
  }

  // 3. Validate and set locale
  const availableLocales = i18n.getLocales();
  if (!availableLocales.includes(locale)) {
    locale = i18n.getLocale(); // Use default if invalid
  }

  i18n.setLocale(req, locale);

  // 4. Save to session for persistence
  if (req.session) {
    if (!req.session.preferences) req.session.preferences = {};
    req.session.preferences.locale = locale;
  }

  // 5. Make translation functions available to views
  // i18n.init sets res.__ and res.__n, which we expose via res.locals
  res.locals.__ = function() {
    return res.__.apply(res, arguments);
  };
  res.locals.__n = function() {
    return res.__n.apply(res, arguments);
  };
  res.locals.locale = locale;     // Current locale

  next();
}

export default i18nMiddleware;
