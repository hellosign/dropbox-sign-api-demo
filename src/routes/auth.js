// src/routes/auth.js
import { Router } from 'express';
import express from 'express';
import crypto from 'crypto';
import { body, validationResult } from 'express-validator';
import { authLimiter } from '../middleware/rate-limit.js';
import { initSessionData } from '../middleware/auth.js';
import { hashApiKey } from '../utils/crypto.js';
import { getAllowedDomains, getAllowedEmails, isEmailAllowed, getAdminEmails, isAdmin } from '../config/constants.js';
import { VERBOSE_LOGGING } from '../config/security.js';
import { validateApiKeyFormat } from '../utils/validation.js';
import { logSecurityEvent, isIPBlocked } from '../services/security-logger.js';

const router = Router();

/**
 * Extract client IP from request
 */
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || 'unknown';
}

/**
 * Build partial API key info for logging (no full key stored)
 */
function buildKeyInfo(apiKey) {
  if (!apiKey || apiKey.length < 6) {
    return {
      length: apiKey?.length || 0,
      firstChars: '',
      lastChars: '',
      hash: ''
    };
  }

  return {
    length: apiKey.length,
    firstChars: apiKey.slice(0, 3),
    lastChars: apiKey.slice(-3),
    hash: crypto.createHash('sha256').update(apiKey).digest('hex')
  };
}

/**
 * GET /login - Login page
 * Displays login form or redirects if already authenticated
 */
router.get('/login', (req, res) => {
  const generateCsrfToken = req.app.locals.generateCsrfToken;
  const csrfToken = generateCsrfToken(req, res);
  res.render('login', {
    error: req.query.error || null,
    csrfToken
  });
});

/**
 * POST /login - API key submission with validation
 * Note: No CSRF protection on login since there's no existing session to protect
 * Rate limiting provides protection against brute force attacks
 */
router.post('/login',
  authLimiter,
  express.urlencoded({ extended: false }),
  [
    body('apiKey')
      .trim()
      .notEmpty().withMessage('API key is required')
      .isLength({ min: 20, max: 200 }).withMessage('Invalid API key format')
  ],
  async (req, res) => {
  // Get Redis client and helpers from app locals
  const redisClient = req.app.locals.redisClient;
  const { getCurrentApiKeyHash, setApiKeyHash, invalidateAllSessionsForAccount, setOnboardingStatus } = req.app.locals.redisHelpers;
  const validateApiKeyAndGetAccount = req.app.locals.validateApiKeyAndGetAccount;

  const clientIP = getClientIP(req);
  const userAgent = req.headers['user-agent'] || '';

  // Check if IP is blocked
  if (await isIPBlocked(clientIP)) {
    await logSecurityEvent({
      eventType: 'login_blocked_ip',
      ip: clientIP,
      userAgent,
      suspicionScore: 100,
      reasons: ['IP address is blocked']
    });
    return res.status(403).json({ error: 'Access denied' });
  }

  // Check validation results
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const firstError = errors.array()[0].msg;

    await logSecurityEvent({
      eventType: 'login_validation_failed',
      ip: clientIP,
      userAgent,
      attemptedKey: buildKeyInfo(req.body.apiKey),
      suspicionScore: 30,
      reasons: [firstError]
    });

    return res.status(400).json({ error: firstError });
  }

  const { apiKey } = req.body;
  const honeypot = req.body.email_check || '';

  // Format validation before expensive API call
  const formatCheck = validateApiKeyFormat(
    apiKey.trim(),
    userAgent,
    honeypot
  );

  if (!formatCheck.valid || formatCheck.suspicionScore > 80) {
    await logSecurityEvent({
      eventType: formatCheck.suspicionScore === 100 ? 'honeypot_triggered' : 'login_format_rejected',
      ip: clientIP,
      userAgent,
      attemptedKey: buildKeyInfo(apiKey),
      suspicionScore: formatCheck.suspicionScore,
      reasons: formatCheck.reasons,
      honeypotTriggered: formatCheck.suspicionScore === 100
    });

    return res.status(400).json({ error: 'Invalid API key' });
  }

  // Log if suspicious but allowed (score 50-80)
  if (formatCheck.suspicionScore >= 50) {
    await logSecurityEvent({
      eventType: 'login_suspicious',
      ip: clientIP,
      userAgent,
      attemptedKey: buildKeyInfo(apiKey),
      suspicionScore: formatCheck.suspicionScore,
      reasons: formatCheck.reasons
    });
  }

  try {
    // Validate API key and fetch account info
    const accountInfo = await validateApiKeyAndGetAccount(apiKey.trim());

    // Check if account is locked
    if (accountInfo.is_locked) {
      return res.status(403).json({ error: 'Account is locked' });
    }

    // Access Control: Check if email is allowed (dynamic from Redis or .env)
    const allowedDomains = await getAllowedDomains(redisClient);
    const allowedEmails = await getAllowedEmails(redisClient);
    const emailLower = accountInfo.email_address.toLowerCase();
    const emailDomain = emailLower.split('@')[1];

    // Check if user is an admin (admins bypass domain/email restrictions)
    const adminEmails = await getAdminEmails(redisClient);
    const isUserAdmin = isAdmin(emailLower, adminEmails);

    if (!isUserAdmin && !isEmailAllowed(emailLower, allowedDomains, allowedEmails)) {
      if (VERBOSE_LOGGING) console.warn(`[ACCESS CONTROL] Access denied for ${accountInfo.email_address} (domain: ${emailDomain})`);

      await logSecurityEvent({
        eventType: 'login_access_denied',
        ip: clientIP,
        userAgent,
        attemptedKey: buildKeyInfo(apiKey),
        accountId: accountInfo.account_id,
        emailDomain: emailDomain,
        suspicionScore: 10,
        reasons: ['Valid key but domain/email not whitelisted']
      });

      return res.status(403).json({ error: 'You do not have permission to access this application. Please contact your administrator.' });
    }

    if (isUserAdmin) {
      if (VERBOSE_LOGGING) console.log(`[ACCESS CONTROL] Admin access granted for ${accountInfo.email_address}`);
    }

    // Access granted - no need to log on every login (only log denials)

    // Check if API key has been rotated (only if Redis is available)
    let apiKeyChanged = false;
    let sessionCount = 0;

    if (redisClient) {
      try {
        const newApiKeyHash = hashApiKey(apiKey.trim());
        const currentApiKeyHash = await getCurrentApiKeyHash(accountInfo.account_id);

        if (VERBOSE_LOGGING) console.log(`[API KEY CHECK] Account: ${accountInfo.account_id}, Current hash: ${currentApiKeyHash ? 'exists' : 'null'}, New hash: ${newApiKeyHash.substring(0, 8)}...`);

        if (currentApiKeyHash && currentApiKeyHash !== newApiKeyHash) {
          // API key has changed - this is a rotation
          if (VERBOSE_LOGGING) console.log(`[API KEY ROTATION] Detected for account ${accountInfo.account_id}`);

          // Invalidate all other sessions for security
          sessionCount = await invalidateAllSessionsForAccount(accountInfo.account_id, req.sessionID);
          apiKeyChanged = true;

          // Set onboarding status to pending to offer "Start Fresh" or "Continue" choice
          await setOnboardingStatus(accountInfo.account_id, 'pending', req.session);
          if (VERBOSE_LOGGING) console.log(`[ONBOARDING] API key rotation detected, showing onboarding options`);
        } else if (!currentApiKeyHash) {
          if (VERBOSE_LOGGING) console.log(`[FIRST LOGIN] Setting initial API key hash for account ${accountInfo.account_id}`);
          // Set onboarding status to pending for first-time users
          await setOnboardingStatus(accountInfo.account_id, 'pending', req.session);
          if (VERBOSE_LOGGING) console.log(`[ONBOARDING] New user detected: ${accountInfo.account_id}`);
        }

        // Store new API key hash
        await setApiKeyHash(accountInfo.account_id, newApiKeyHash);
      } catch (err) {
        console.error('[API KEY ROTATION] Error checking/storing key hash:', err);
        // Continue with login even if rotation detection fails
      }
    }

    // Regenerate session to prevent session fixation attacks
    const oldSession = { ...req.session };
    req.session.regenerate(async (err) => {
      if (err) {
        console.error('[LOGIN] Failed to regenerate session:', err);
        return res.status(500).json({ error: 'Login failed' });
      }

      // Store account info in session (NOT the API key — that stays browser-side only)
      req.session.accountInfo = {
        account_id: accountInfo.account_id,
        email_address: accountInfo.email_address,
        role_code: accountInfo.role_code
      };

      // Add notification flag if key changed
      if (apiKeyChanged) {
        req.session.apiKeyRotationNotice = {
          timestamp: Date.now(),
          sessionsInvalidated: sessionCount
        };
      }

      // Initialize session data
      initSessionData(req.session);

      // Store user profile persistently in Redis for admin panel
      if (redisClient) {
        try {
          const userProfileKey = `user:${accountInfo.account_id}:profile`;
          const userProfile = {
            account_id: accountInfo.account_id,
            email_address: accountInfo.email_address,
            role_code: accountInfo.role_code,
            last_login: Date.now()
          };
          await redisClient.set(userProfileKey, JSON.stringify(userProfile));
        } catch (err) {
          console.error('[AUTH] Failed to store user profile:', err);
        }
      }

      // Save session then return API key to browser for client-side storage
      req.session.save((err) => {
        if (err) {
          console.error('[AUTH] Session save error:', err);
          return res.status(500).json({ error: 'Session error' });
        }
        // Return API key to browser (stored in sessionStorage, never on server)
        res.json({
          success: true,
          apiKey: apiKey.trim(),
          email: accountInfo.email_address
        });
      });
    });
  } catch (err) {
    console.error('[AUTH] Login failed:', err.message);

    await logSecurityEvent({
      eventType: 'login_failed',
      ip: clientIP,
      userAgent,
      attemptedKey: buildKeyInfo(apiKey),
      suspicionScore: 20,
      reasons: ['Dropbox Sign API rejected key']
    });

    return res.status(401).json({ error: 'Invalid API key or you are not authorized to access this application' });
  }
});

/**
 * POST /logout - Clear session
 * Destroys the user session and redirects to login
 */
router.post('/logout', async (req, res) => {
  const redisClient = req.app.locals.redisClient;
  const accountId = req.session?.accountInfo?.account_id;

  // Update user profile with logout timestamp before destroying session
  if (accountId && redisClient) {
    try {
      const profileKey = `user:${accountId}:profile`;
      const profileData = await redisClient.get(profileKey);

      if (profileData) {
        const profile = JSON.parse(profileData);
        profile.last_logout = Date.now();
        await redisClient.set(profileKey, JSON.stringify(profile));
        if (VERBOSE_LOGGING) console.log(`[AUTH] User ${accountId} logged out`);
      }
    } catch (err) {
      console.error('[AUTH] Failed to update logout timestamp:', err);
    }
  }

  req.session.destroy((err) => {
    if (err) {
      console.error('[AUTH] Logout error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
    res.redirect('/login');
  });
});

/**
 * GET /auth/status - Check authentication status
 * Returns JSON with auth status and user info
 */
router.get('/auth/status', (req, res) => {
  if (!req.session.accountInfo) {
    return res.json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    email: req.session.accountInfo?.email_address,
    account_id: req.session.accountInfo?.account_id
  });
});

export default router;
