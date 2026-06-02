// src/middleware/auth.js
import { getAdminEmails, isAdmin } from '../config/constants.js';
import { VERBOSE_LOGGING } from '../config/security.js';

/**
 * Require authentication middleware
 * Checks for API key in session
 */
export function requireAuth(req, res, next) {
  if (VERBOSE_LOGGING) console.log('[AUTH] Path:', req.path, '| Has session:', !!req.session, '| Has API key:', !!req.session?.apiKey);

  if (!req.session.apiKey) {
    // Use originalUrl for path checks (req.path is relative to router mount point)
    const fullPath = req.originalUrl || req.path;
    const isAjax = req.xhr || req.headers.accept?.includes('application/json');
    if (VERBOSE_LOGGING) console.log('[AUTH] No API key found, fullPath:', fullPath, '| isAjax:', isAjax);
    // For API requests (AJAX), fetch calls, and SSE streams, return 401 instead of redirect
    if (isAjax || fullPath.startsWith('/api') || fullPath.startsWith('/events/') || fullPath.startsWith('/themes') || fullPath.startsWith('/signatures') || fullPath.startsWith('/settings')) {
      if (VERBOSE_LOGGING) console.log('[AUTH] Returning 401 JSON');
      return res.status(401).json({ error: 'Not authenticated. Please provide API key.' });
    }
    if (VERBOSE_LOGGING) console.log('[AUTH] Redirecting to /login');
    return res.redirect('/login');
  }
  if (VERBOSE_LOGGING) console.log('[AUTH] Authenticated as:', req.session.accountInfo?.email_address);
  initSessionData(req.session);
  // Update last activity timestamp on each authenticated request
  req.session.lastActivity = new Date().toISOString();
  next();
}

/**
 * Require admin access middleware
 * Checks if user email is in admin list (Redis or .env fallback)
 */
export async function requireAdmin(req, res, next) {
  const userEmail = req.session?.accountInfo?.email_address?.toLowerCase();
  const redisClient = req.app.locals?.redisClient;

  // Get admin emails dynamically (from Redis or .env)
  const adminEmails = await getAdminEmails(redisClient);

  if (!isAdmin(userEmail, adminEmails)) {
    if (VERBOSE_LOGGING) console.warn(`[ADMIN] Access denied for ${userEmail}`);
    return res.status(403).json({
      error: 'Admin access required',
      message: 'You do not have permission to access this page.'
    });
  }

  next();
}

/**
 * Initialize session data structure
 * Creates default keys if they don't exist
 */
export function initSessionData(session) {
  if (!session.signatureRequests) session.signatureRequests = [];
  if (!session.webhookEvents) session.webhookEvents = {};
  if (!session.preferences) session.preferences = {};
  if (!session.appTestMode) session.appTestMode = {}; // Initialize test mode settings
}
