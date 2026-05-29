// src/middleware/rate-limit.js
import rateLimit from 'express-rate-limit';
import { IS_DEVELOPMENT } from '../config/constants.js';

/**
 * Rate limiter for authentication endpoints (login)
 * More restrictive in production to prevent brute force
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: IS_DEVELOPMENT ? 100 : 5, // 100 in dev, 5 in production
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: async (req, res) => {
    // Log rate limit exceeded event
    const { logSecurityEvent } = req.app.locals.securityLogger || {};
    if (logSecurityEvent) {
      const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || 'unknown';
      await logSecurityEvent({
        eventType: 'rate_limit_exceeded',
        ip: clientIP,
        userAgent: req.headers['user-agent'] || '',
        suspicionScore: 60,
        reasons: ['Rate limit exceeded (5 attempts in 15 minutes)']
      });
    }
    res.redirect('/login?error=' + encodeURIComponent('Too many login attempts, please try again later'));
  }
});

/**
 * Rate limiter for API endpoints
 * General rate limiting for API calls
 */
export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests, please slow down',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Strict rate limiter for expensive operations
 * Used for operations like template creation, bulk operations
 */
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per 15 minutes for expensive operations
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});
