// src/middleware/security.js
import helmet from 'helmet';
import { doubleCsrf } from 'csrf-csrf';
import { CSRF_SECRET } from '../config/security.js';
import { IS_PRODUCTION } from '../config/constants.js';

/**
 * Helmet security middleware configuration
 * Sets various HTTP security headers
 */
export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdn.hellosign.com", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.hellosign.com", "https://api.dropboxsign.com"],
      frameSrc: ["'self'", "https://app.hellosign.com", "https://app.dropboxsign.com", "https://*.hellosign.com", "https://*.dropboxsign.com"],
      childSrc: ["'self'", "https://app.hellosign.com", "https://app.dropboxsign.com"],
    },
  },
  hsts: IS_PRODUCTION,
  crossOriginEmbedderPolicy: false, // Allow embedded signing iframe
});

/**
 * HTTPS enforcement middleware (production only)
 * Redirects HTTP to HTTPS
 */
export function httpsRedirect(req, res, next) {
  if (req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
}

/**
 * CSRF protection configuration
 * Uses double-submit cookie pattern
 */
const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  // Use __Host- prefix only in production (requires HTTPS)
  cookieName: IS_PRODUCTION ? '__Host-psifi.x-csrf-token' : 'psifi.x-csrf-token',
  cookieOptions: {
    sameSite: 'lax',
    path: '/',
    secure: IS_PRODUCTION,
    httpOnly: false  // Must be false so JavaScript can read the cookie for double-submit pattern
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getTokenFromRequest: (req) => req.headers['x-csrf-token'] || req.body?._csrf,
  getSessionIdentifier: (req) => req.session?.id || req.sessionID || ''
});

export { generateCsrfToken };
export const csrfProtection = doubleCsrfProtection;
