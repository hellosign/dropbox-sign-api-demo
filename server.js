// server.js
// ⚠️ CRITICAL: Load .env BEFORE any imports that use environment variables
import { config } from "dotenv";
import fs from "fs";

// Load environment-specific .env file based on NODE_ENV
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const envFile = IS_PRODUCTION ? '.env.production' : '.env.development';

// Try to load environment-specific file, fallback to .env if it doesn't exist
if (fs.existsSync(envFile)) {
  config({ path: envFile });
} else {
  config();
}

// NOW import everything else (after env is loaded)
import express from "express";
import session from "express-session";
import { RedisStore } from "connect-redis";
import { createClient } from "redis";
import multer from "multer";
import path from "path";
import * as DropboxSign from "@dropbox/sign";
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { engine } from "express-handlebars";
import { marked } from 'marked';
import i18n from 'i18n';
import PDFDocumentKit from 'pdfkit';
import os from 'os';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import https from 'https';
import { doubleCsrf } from 'csrf-csrf';
import cookieParser from 'cookie-parser';
import { body, query, param, validationResult } from 'express-validator';
// Utility imports
import { hashApiKey, verifyWebhookSignature } from './src/utils/crypto.js';
import { redactSensitiveData, sanitizeError } from './src/utils/validation.js';
import { buildRequestDetail } from './src/utils/logging.js';
// API abstraction service
import { initDropboxSignService, apiCall, getUserApiClient } from './src/services/dropbox-sign.js';
// Configuration imports (NOW they will read the loaded environment variables)
import { ENCRYPTION_KEY, ENCRYPTION_IV_LENGTH, CSRF_SECRET, VERBOSE_LOGGING } from './src/config/security.js';
import { CLIENT_ID, TEMPLATE_IDS, API_KEY, ALLOWED_DOMAINS, ALLOWED_EMAILS, ADMIN_EMAILS } from './src/config/constants.js';
// Re-export for consistency (already defined above)
export { NODE_ENV, IS_PRODUCTION };
const IS_DEVELOPMENT = !IS_PRODUCTION;
const PORT = process.env.PORT || 3001;
// Service imports
import { loadWebhookEvents, saveWebhookEvents, recordEvent, loadWarnings, saveWarnings } from './src/services/events.js';
import { generatePdfFromMarkdown } from './src/services/pdf-generator.js';
import { initSecurityLogger, logSecurityEvent, getSecurityEvents, getSecurityStats, blockIP, isIPBlocked } from './src/services/security-logger.js';
// Middleware imports
import { requireAuth, requireSession, requireAdmin, initSessionData } from './src/middleware/auth.js';
import { authLimiter, apiLimiter, strictLimiter } from './src/middleware/rate-limit.js';
import { helmetMiddleware, httpsRedirect, generateCsrfToken, csrfProtection as doubleCsrfProtection } from './src/middleware/security.js';
import { i18nMiddleware } from './src/middleware/i18n.js';
// Route imports
import authRoutes from './src/routes/auth.js';
import onboardingRoutes from './src/routes/onboarding.js';
import apiLogsRoutes from './src/routes/api-logs.js';
import themesRoutes from './src/routes/themes.js';
import settingsRoutes from './src/routes/settings.js';
import teamRoutes from './src/routes/team.js';
import templatesRoutes from './src/routes/templates.js';
import apiAppsRoutes from './src/routes/api-apps.js';
import signaturesRoutes from './src/routes/signatures.js';
import adminRoutes from './src/routes/admin.js';
import adminTranslationsRoutes from './src/routes/admin-translations.js';
import signingRoutes from './src/routes/signing.js';
import webhooksRoutes from './src/routes/webhooks.js';
import indexRoutes from './src/routes/index.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);


// ✅ Add this line to define publicDir:
const publicDir = path.join(process.cwd(), 'public');

// Data directory for file-based persistence
const EVENTS_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(EVENTS_DIR)) fs.mkdirSync(EVENTS_DIR);

// API logs storage (in-memory fallback when Redis unavailable)
const API_LOGS_FILE = path.join(EVENTS_DIR, 'api-logs.json');
function loadApiLogs() {
  try {
    return JSON.parse(fs.readFileSync(API_LOGS_FILE, 'utf8'));
  } catch {
    return [];
  }
}
let apiLogs = loadApiLogs();

// Event functions imported from /src/services/events.js
// loadWebhookEvents, saveWebhookEvents, recordEvent, loadWarnings, saveWarnings

// .env file already loaded at top of file (before imports)

const app = express();

// Trust proxy for ngrok/reverse proxy support (needed for proper cookie handling)
app.set('trust proxy', 1);

// Configuration constants imported from /src/config/
// ENCRYPTION_KEY, CSRF_SECRET, VERBOSE_LOGGING
// CLIENT_ID, TEMPLATE_IDS, API_KEY, ALLOWED_DOMAINS, ALLOWED_EMAILS, ADMIN_EMAILS
// NODE_ENV, IS_PRODUCTION, IS_DEVELOPMENT, PORT

// API keys stored browser-side only (sessionStorage) - sent per-request via X-Api-Key header
// getUserApiClient is now imported from /src/services/dropbox-sign.js

/**
 * Validates API key and fetches account information
 * Returns: { account_id, email_address, is_locked, is_paid_hs, is_paid_hf, role_code }
 * Throws: Error if API key is invalid
 */
async function validateApiKeyAndGetAccount(apiKey) {
  const accountApi = new DropboxSign.AccountApi();
  accountApi.username = apiKey;

  try {
    const response = await accountApi.accountGet(null);  // null = get own account
    const account = response.body.account;

    return {
      account_id: account.accountId,
      email_address: account.emailAddress,
      is_locked: account.isLocked,
      is_paid_hs: account.isPaidHs,
      is_paid_hf: account.isPaidHf,
      role_code: account.roleCode || null
    };
  } catch (err) {
    if (err.response?.status === 401 || err.response?.status === 403) {
      throw new Error('Invalid API key');
    }
    throw new Error(`Failed to validate API key: ${err.message}`);
  }
}


/**
 * Get the current API key hash for an account from Redis
 * @param {string} accountId
 * @returns {Promise<string|null>} API key hash or null if not found
 */
async function getCurrentApiKeyHash(accountId) {
  if (!redisClient || !accountId) return null;
  const key = `user:${accountId}:api_key_hash`;
  return await redisClient.get(key);
}

/**
 * Store the API key hash for an account in Redis
 * @param {string} accountId
 * @param {string} apiKeyHash
 */
async function setApiKeyHash(accountId, apiKeyHash) {
  if (!redisClient || !accountId) return;
  const key = `user:${accountId}:api_key_hash`;
  await redisClient.set(key, apiKeyHash);
}

/**
 * Get onboarding status for an account
 * @param {string} accountId
 * @param {object} session - Express session object (optional, used as fallback when Redis unavailable)
 * @returns {Promise<string>} "pending" | "dismissed" | "completed"
 */
async function getOnboardingStatus(accountId, session = null) {
  if (redisClient && accountId) {
    const key = `user:${accountId}:onboarding_status`;
    const status = await redisClient.get(key);
    return status || 'pending';
  }
  // Fallback to session storage when Redis is unavailable
  if (session && session.onboardingStatus) {
    return session.onboardingStatus;
  }
  return 'pending'; // Default to pending for first-time users
}

/**
 * Set onboarding status for an account
 * @param {string} accountId
 * @param {string} status - "pending" | "dismissed" | "completed"
 * @param {object} session - Express session object (optional, used as fallback when Redis unavailable)
 */
async function setOnboardingStatus(accountId, status, session = null) {
  if (redisClient && accountId) {
    const key = `user:${accountId}:onboarding_status`;
    await redisClient.set(key, status);
  }
  // Store in session only when Redis unavailable (for persistence during browser session)
  if (!redisClient && session) {
    session.onboardingStatus = status;
  }
}

/**
 * Check if user has existing data in Redis
 * @param {string} accountId
 * @returns {Promise<boolean>}
 */
async function hasExistingData(accountId) {
  if (!redisClient || !accountId) return false;

  // Check if any user-specific keys exist
  const keysToCheck = [
    `user:${accountId}:themes`,
    `user:${accountId}:settings`,
    `user:${accountId}:api_logs`,
    `user:${accountId}:app_test_mode`
  ];

  for (const key of keysToCheck) {
    const exists = await redisClient.exists(key);
    if (exists) return true;
  }

  return false;
}

// Security middleware
// Security middleware (imported from src/middleware/security.js)
app.use(helmetMiddleware);

// HTTPS enforcement in production
if (IS_PRODUCTION) {
  app.use(httpsRedirect);
}

// Request size limits (prevent large payload attacks)
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Cookie parser (required for CSRF)
app.use(cookieParser());

// CSRF protection (imported from src/middleware/security.js)
// generateCsrfToken and doubleCsrfProtection are imported at top

// Rate limiters imported from middleware/rate-limit.js

// Redis client setup (REQUIRED for proper session and data persistence)
let redisClient;
const redisUrl = process.env.REDIS_URL || process.env.REDIS_HOST;

// Check Redis requirement
if (!redisUrl && !process.env.ALLOW_NO_REDIS) {
  console.error('\n❌ ERROR: Redis is required for this application to function properly.\n');
  console.error('Sessions, themes, settings, and other data require Redis for persistence.\n');
  console.error('Setup instructions:');
  console.error('  1. Install Redis:');
  console.error('     - macOS: brew install redis && brew services start redis');
  console.error('     - Ubuntu: sudo apt install redis-server');
  console.error('     - Docker: docker run -d -p 6379:6379 redis:alpine\n');
  console.error('  2. Add to your .env file:');
  console.error('     REDIS_URL=redis://127.0.0.1:6379\n');
  console.error('  3. Restart the application\n');
  console.error('To run without Redis (NOT RECOMMENDED - data will not persist):');
  console.error('  Set ALLOW_NO_REDIS=true in your .env file\n');
  process.exit(1);
}

if (redisUrl) {
  try {
    // Use separate Redis databases per environment for session isolation
    // Development: DB 0 (default), Production: DB 1
    const redisDb = IS_PRODUCTION ? (process.env.REDIS_DB || '1') : '0';
    const baseUrl = redisUrl.startsWith('redis://') ? redisUrl : `redis://${redisUrl}:6379`;
    const urlWithDb = `${baseUrl}/${redisDb}`;

    redisClient = createClient({
      url: urlWithDb,
      socket: {
        connectTimeout: 2000, // Fail fast if Redis isn't available (2 seconds)
        reconnectStrategy: false // Don't retry - just fail
      }
    });
    // Suppress Redis connection errors (app works fine without Redis)
    redisClient.on('error', () => {});
    await redisClient.connect();
    console.log(`✓ Redis connected for session persistence (database ${redisDb})`);

    // Initialize API abstraction service with Redis dependencies
    initDropboxSignService({
      redisClient,
      getApiLogs,
      broadcastLogUpdate,
      inMemoryApiLogs: apiLogs
    });
    console.log('✓ API abstraction service initialized');

    // Initialize security logger
    initSecurityLogger(redisClient);
    console.log('✓ Security logger initialized');

    // Make Redis client and helpers available to routes via app.locals
    app.locals.redisClient = redisClient;
    app.locals.securityLogger = {
      logSecurityEvent,
      getSecurityEvents,
      getSecurityStats,
      blockIP,
      isIPBlocked
    };
    app.locals.redisHelpers = {
      // Event and logging functions
      recordEvent,
      saveWarnings,
      addApiLog,
      getApiLogs,
      // Signature request tracking
      registerSignatureRequest,
      lookupSignatureRequestOwner,
      // Webhook functions
      addWebhookEvent,
      getWebhookEvents,
      isAppWebhookEnabled,
      getAppWebhookSettings,
      // API key management
      getCurrentApiKeyHash,
      setApiKeyHash,
      invalidateAllSessionsForAccount,
      // Onboarding
      setOnboardingStatus,
      getOnboardingStatus,
      hasExistingData,
      // Settings and preferences
      getSettings,
      setSettings,
      getThemes,
      setTheme,
      deleteTheme,
      getTemplateLabels,
      setTemplateLabels,
      setTemplateLabel,
      getTemplateMergeFields,
      setTemplateMergeFields,
      getFormFieldsDefaults,
      setFormFieldsDefaults,
      deleteFormFieldsDefaults,
      // Test mode
      getAppTestModeSettings,
      setAppTestModeSettings,
      // Admin functions
      getAllUsers,
      getUserDataKeys,
      getAllActiveSessions,
      deleteUserCompletely,
      // Admin theme management
      getAllUserThemes,
      publishThemeToAllUsers,
      removeThemeFromAllUsers
    };
  } catch (err) {
    console.warn('⚠ Redis connection failed, falling back to memory store:', err.message);
    redisClient = null;
  }
}

// If Redis not available, provide stub functions (ALLOW_NO_REDIS mode - data will not persist)
if (!redisClient) {
  console.warn('\n⚠️  WARNING: Running without Redis (ALLOW_NO_REDIS=true)');
  console.warn('⚠️  Sessions, themes, settings will NOT persist across:');
  console.warn('⚠️    - Server restarts');
  console.warn('⚠️    - Browser hard refreshes');
  console.warn('⚠️    - Cookie expiration');
  console.warn('⚠️  This mode is for testing only. Install Redis for production use.\n');
  // Load default themes from config
  let defaultThemes = {};
  try {
    const themesPath = path.join(__dirname, 'config', 'themes.json');
    defaultThemes = JSON.parse(fs.readFileSync(themesPath, 'utf8'));
    console.log(`✓ Loaded ${Object.keys(defaultThemes).length} default themes from config`);
  } catch (err) {
    console.warn('⚠ Could not load default themes:', err.message);
  }

  // Initialize services with null Redis
  initDropboxSignService({
    redisClient: null,
    getApiLogs,
    broadcastLogUpdate,
    inMemoryApiLogs: apiLogs
  });
  initSecurityLogger(null);

  // Provide stub helpers that work without Redis
  app.locals.redisClient = null;
  app.locals.securityLogger = {
    logSecurityEvent: () => {},
    getSecurityEvents: () => [],
    getSecurityStats: () => ({ totalEvents: 0 }),
    blockIP: () => {},
    isIPBlocked: () => false
  };
  app.locals.redisHelpers = {
    recordEvent: () => {},
    saveWarnings: () => {},
    addApiLog: () => {},
    getApiLogs: () => apiLogs,
    clearApiLogs: () => { apiLogs.length = 0; },
    registerSignatureRequest: () => {},
    lookupSignatureRequestOwner: () => null,
    addWebhookEvent: () => {},
    getWebhookEvents: () => [],
    isAppWebhookEnabled: () => false,
    getAppWebhookSettings: () => ({}), // Return empty object, not null
    getCurrentApiKeyHash: () => null,
    setApiKeyHash: () => {},
    invalidateAllSessionsForAccount: () => {},
    setOnboardingStatus: (accountId, status, session) => {
      if (session) session.onboardingStatus = status;
    },
    getOnboardingStatus: (accountId, session) => {
      return session?.onboardingStatus || 'pending';
    },
    hasExistingData: () => false,
    getSettings: (accountId, session) => {
      return session?.settings || portalSettings;
    },
    setSettings: (accountId, newSettings, session) => {
      if (session) {
        const currentSettings = session.settings || portalSettings;
        session.settings = { ...currentSettings, ...newSettings };
      }
    },
    getThemes: (accountId, session) => {
      return session?.themes || themes;
    },
    setTheme: (accountId, themeId, themeData, session) => {
      if (session) {
        if (!session.themes) session.themes = { ...themes };
        session.themes[themeId] = themeData;
      }
    },
    deleteTheme: (accountId, themeId, session) => {
      if (session && session.themes) {
        delete session.themes[themeId];
      }
    },
    getTemplateLabels: () => ({}),
    setTemplateLabels: () => {},
    setTemplateLabel: () => {},
    getTemplateMergeFields: () => ({}),
    setTemplateMergeFields: () => {},
    getFormFieldsDefaults: () => ({}),
    setFormFieldsDefaults: () => {},
    deleteFormFieldsDefaults: () => {},
    getAppTestModeSettings: () => ({}),
    setAppTestModeSettings: () => {},
    getAllUsers: () => [],
    getUserDataKeys: () => [],
    getAllActiveSessions: () => [],
    deleteUserCompletely: () => {},
    getAllUserThemes: () => ({}),
    publishThemeToAllUsers: () => {},
    removeThemeFromAllUsers: () => {}
  };
  console.log('✓ Stub helpers initialized (in-memory mode)');
}

// Session middleware for API key-based authentication
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false, // False is correct - explicit save() calls handle persistence
  saveUninitialized: false,
  rolling: true, // Extends session on each activity
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true, // No client-side JS access
    sameSite: 'strict', // Strong CSRF protection
    // Only set domain if COOKIE_DOMAIN is explicitly configured (for DNS-based access)
    // If undefined, cookie will be set for current domain (works for load balancer access)
    ...(process.env.COOKIE_DOMAIN && { domain: process.env.COOKIE_DOMAIN })
  },
  name: IS_PRODUCTION ? 'sessionId_prod' : 'sessionId_dev', // Different names per environment
  proxy: true // Trust reverse proxy (for secure cookies behind load balancer)
};

// Use Redis store if available
if (redisClient) {
  sessionConfig.store = new RedisStore({
    client: redisClient,
    prefix: 'sess:',
    ttl: 30 * 24 * 60 * 60 // 30 days in seconds
  });
}

/**
 * Invalidate all active sessions for an account (used during API key rotation)
 * @param {string} accountId
 * @param {string} exceptSessionId - Session ID to keep (current session)
 * @returns {Promise<number>} Count of invalidated sessions
 */
async function invalidateAllSessionsForAccount(accountId, exceptSessionId = null) {
  if (!redisClient || !accountId) return 0;

  let cursor = '0';
  let deletedCount = 0;
  const sessionPrefix = 'sess:';

  do {
    const result = await redisClient.scan(cursor, {
      MATCH: `${sessionPrefix}*`,
      COUNT: 100
    });
    cursor = result.cursor;
    const keys = result.keys;

    // Check each session to see if it belongs to this account
    for (const key of keys) {
      const sessionId = key.substring(sessionPrefix.length);
      if (exceptSessionId && sessionId === exceptSessionId) {
        continue; // Don't delete the current session
      }

      const sessionData = await redisClient.get(key);
      if (sessionData) {
        try {
          const parsed = JSON.parse(sessionData);
          if (parsed.accountInfo?.account_id === accountId) {
            await redisClient.del(key);
            deletedCount++;
          }
        } catch (err) {
          // Skip malformed session data
        }
      }
    }
  } while (cursor !== '0');

  if (VERBOSE_LOGGING) console.log(`[SESSION CLEANUP] Invalidated ${deletedCount} sessions for account ${accountId}`);
  return deletedCount;
}

app.use(session(sessionConfig));

// i18n middleware (after session, before routes)
app.use(i18nMiddleware);

// Admin Helper Functions for Redis Session Management
/**
 * Get all active sessions from Redis
 * Uses SCAN to avoid blocking
 */
async function getAllActiveSessions() {
  if (!redisClient) {
    throw new Error('Redis not available');
  }

  const sessions = [];
  let cursor = '0';

  do {
    const reply = await redisClient.scan(cursor, {
      MATCH: 'sess:*',
      COUNT: 100
    });

    cursor = reply.cursor.toString();
    const keys = reply.keys;

    for (const key of keys) {
      try {
        const sessionData = await redisClient.get(key);
        if (sessionData) {
          const parsed = JSON.parse(sessionData);
          // Only include authenticated sessions
          if (parsed.apiKey && parsed.accountInfo) {
            sessions.push({
              sessionId: key.replace('sess:', ''),
              data: parsed
            });
          }
        }
      } catch (err) {
        console.error(`[ADMIN] Failed to parse session ${key}:`, err.message);
      }
    }
  } while (cursor !== '0');

  return sessions;
}

/**
 * Get ALL users (active + inactive) from Redis
 * Scans for user data keys to find all accounts that have ever logged in
 */
async function getAllUsers() {
  if (!redisClient) {
    throw new Error('Redis not available');
  }

  const sessions = await getAllActiveSessions();
  const accountMap = new Map();

  // Step 1: Get all users with active sessions
  for (const session of sessions) {
    const accountId = session.data.accountInfo.account_id;
    const email = session.data.accountInfo.email_address;

    if (!accountMap.has(accountId)) {
      accountMap.set(accountId, {
        accountId,
        email,
        roleCode: session.data.accountInfo.role_code || 'user',
        isPortalAdmin: ADMIN_EMAILS.includes(email.toLowerCase()),
        isActive: true,
        sessions: [],
        lastActivity: null,
        signatureRequestsCount: 0,
        webhookEventsCount: 0
      });
    }

    const user = accountMap.get(accountId);
    user.sessions.push({
      sessionId: session.sessionId,
      lastActivity: session.data.lastActivity || null,
      signatureRequestsCount: session.data.signatureRequests?.length || 0,
      webhookEventsCount: Object.keys(session.data.webhookEvents || {}).length
    });

    // Update aggregated counts
    user.signatureRequestsCount += session.data.signatureRequests?.length || 0;
    user.webhookEventsCount += Object.keys(session.data.webhookEvents || {}).length;
  }

  // Step 2: Find all user profile keys to discover inactive users
  let cursor = '0';
  const inactiveAccounts = new Set();

  do {
    const reply = await redisClient.scan(cursor, {
      MATCH: 'user:*:profile',
      COUNT: 100
    });

    cursor = reply.cursor.toString();
    const keys = reply.keys;

    for (const key of keys) {
      // Extract account_id from key: user:{account_id}:profile
      const accountId = key.split(':')[1];

      if (!accountMap.has(accountId)) {
        // Found a user without active session
        inactiveAccounts.add(accountId);
      }
    }
  } while (cursor !== '0');

  // Step 3: Get profile for inactive users
  for (const accountId of inactiveAccounts) {
    try {
      // Try to get email from persistent user profile
      let email = 'unknown@example.com';
      let roleCode = 'user';
      let lastLogin = null;
      let lastLogout = null;

      const profileKey = `user:${accountId}:profile`;
      const profileData = await redisClient.get(profileKey);

      if (profileData) {
        const profile = JSON.parse(profileData);
        email = profile.email_address || email;
        roleCode = profile.role_code || roleCode;
        lastLogin = profile.last_login ? new Date(profile.last_login) : null;
        lastLogout = profile.last_logout ? new Date(profile.last_logout) : null;
      }

      // Use logout time as lastActivity if available, otherwise fall back to login time
      const lastActivity = lastLogout || lastLogin;

      accountMap.set(accountId, {
        accountId,
        email,
        roleCode,
        isPortalAdmin: ADMIN_EMAILS.includes(email.toLowerCase()),
        isActive: false,
        sessions: [],
        lastActivity: lastActivity,
        lastLogin: lastLogin,
        lastLogout: lastLogout,
        signatureRequestsCount: 0,
        webhookEventsCount: 0
      });
    } catch (err) {
      console.error(`[ADMIN] Failed to get data for inactive user ${accountId}:`, err.message);
    }
  }

  // Step 4: Calculate most recent activity for active users
  for (const user of accountMap.values()) {
    if (user.sessions.length > 0) {
      user.lastActivity = user.sessions
        .map(s => s.lastActivity)
        .filter(Boolean)
        .sort((a, b) => b - a)[0];
    }
  }

  // Convert to array and sort
  const users = Array.from(accountMap.values());
  return users.sort((a, b) => {
    // Active users first, then by email
    if (a.isActive !== b.isActive) return b.isActive ? 1 : -1;
    return a.email.localeCompare(b.email);
  });
}

/**
 * Get active users with session info (legacy - for backward compatibility)
 */
async function getActiveUsers() {
  const allUsers = await getAllUsers();
  return allUsers.filter(u => u.isActive);
}

/**
 * Get per-user Redis data keys
 */
async function getUserDataKeys(accountId) {
  if (!redisClient) {
    throw new Error('Redis not available');
  }

  const keys = await redisClient.keys(`user:${accountId}:*`);
  const userData = {};

  for (const key of keys) {
    try {
      const value = await redisClient.get(key);
      const resourceType = key.split(':').slice(2).join(':');
      userData[resourceType] = value ? JSON.parse(value) : null;
    } catch (err) {
      console.error(`[ADMIN] Failed to get data for ${key}:`, err.message);
      userData[key] = { error: err.message };
    }
  }

  return userData;
}

/**
 * Delete all data for a user from Redis
 * Removes: all sessions + all user data keys
 * Returns: { sessionsDeleted, dataKeysDeleted, keys: [...] }
 */
async function deleteUserCompletely(accountId) {
  if (!redisClient) {
    throw new Error('Redis not available');
  }

  const deletedKeys = [];
  let sessionsDeleted = 0;
  let dataKeysDeleted = 0;

  // Step 1: Find and delete all sessions for this user
  const sessions = await getAllActiveSessions();
  for (const session of sessions) {
    if (session.data.accountInfo.account_id === accountId) {
      const sessionKey = `sess:${session.sessionId}`;
      await redisClient.del(sessionKey);
      deletedKeys.push(sessionKey);
      sessionsDeleted++;
    }
  }

  // Step 2: Find and delete all user data keys
  const userDataKeys = await redisClient.keys(`user:${accountId}:*`);
  if (userDataKeys.length > 0) {
    await redisClient.del(userDataKeys);
    deletedKeys.push(...userDataKeys);
    dataKeysDeleted = userDataKeys.length;
  }

  return {
    accountId,
    sessionsDeleted,
    dataKeysDeleted,
    totalKeysDeleted: sessionsDeleted + dataKeysDeleted,
    keys: deletedKeys
  };
}

// Auth middleware functions imported from middleware/auth.js

// Document Templates: READ-ONLY seed file for new users (Phase 3)
// Changes are stored per-user in Redis (user:{account_id}:document_templates)
const documentTemplates = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/document-templates.json'), 'utf8'));

// Handlebars setup
app.engine("hbs", engine({
  extname: ".hbs",
  helpers: {
    // i18n translation helpers
    // Handlebars passes an options object as the last argument
    __: function() {
      // Get all arguments except the last (Handlebars options object)
      const args = Array.prototype.slice.call(arguments, 0, -1);
      const options = arguments[arguments.length - 1];

      // Access res.locals.__ via options.data.root (Handlebars data context)
      const translateFn = options.data.root.__;

      if (typeof translateFn === 'function') {
        return translateFn.apply(options.data.root, args);
      }

      // Fallback: return key if translation not available
      return args[0] || '';
    },
    __n: function() {
      const args = Array.prototype.slice.call(arguments, 0, -1);
      const options = arguments[arguments.length - 1];

      const translateFn = options.data.root.__n;

      if (typeof translateFn === 'function') {
        return translateFn.apply(options.data.root, args);
      }

      // Fallback: return singular form
      return args[1] || args[0] || '';
    },
    // Helper for comparing values (e.g., checking if locale matches)
    eq: (a, b) => a === b,
    // JSON helper for serializing objects to JSON strings
    json: (context) => JSON.stringify(context)
  }
}));
app.set("view engine", "hbs");
app.set("views", path.join(process.cwd(), "views"));
app.set("etag", false);

// Make CSRF token available to all views (after session is initialized)
app.use((req, res, next) => {
  try {
    const token = generateCsrfToken(req, res);
    res.locals.csrfToken = token;
  } catch (err) {
    // Token generation may fail during session initialization, use empty string as fallback
    res.locals.csrfToken = '';
  }
  next();
});

// Serve static assets (no-cache for development)
app.use(express.static(publicDir, { etag: false, lastModified: false, setHeaders: (res) => res.set('Cache-Control', 'no-store') }));

// console.log('Env:', { API_KEY, CLIENT_ID, TEMPLATE_IDS });

// Dropbox Sign clients - will be initialized after API_KEY is determined
// API key mode - API clients created per-request via getUserApiClient()

//
// 2. Setup multer for webhook parsing
//
const upload = multer();

//
// 2b. Persistent API log storage (survives restarts)
//
const MAX_LOGS = 200;

// apiLogs and loadApiLogs() moved to top of file (after EVENTS_DIR)
// OLD addApiLog - removed, now in DAL section below

function saveApiLogsSync() {
  try {
    fs.writeFileSync(API_LOGS_FILE, JSON.stringify(apiLogs));
  } catch (err) {
    console.error('Error saving API logs:', err.message);
  }
}


//
// 3. Startup checks — guide new users on missing config
//
(function startupChecks() {
  const warnings = [];
  const envPath = path.join(process.cwd(), ".env");
  const envExamplePath = path.join(process.cwd(), ".env.example");

  // Skip .env warning if running in Docker (configured via environment variables)
  const isDockerEnvironment = process.env.REDIS_URL?.includes('redis:') || process.env.SESSION_SECRET;

  if (!fs.existsSync(envPath) && !isDockerEnvironment) {
    if (fs.existsSync(envExamplePath)) {
      warnings.push("  - .env file not found. Copy the example and fill in your values:\n      cp .env.example .env");
    } else {
      warnings.push("  - .env file not found. Create one with at least:\n      API_KEY=your_dropbox_sign_api_key");
    }
  }

  // API key authentication

  const optionalFiles = [
    { file: "config/themes.json", desc: "Theme definitions (a default theme is used if missing)" },
    { file: "templates.json", desc: "Legacy template map (optional — templates are managed via the Templates tab)" },
    { file: "template-labels.json", desc: "Template-to-theme labels (auto-created when you assign labels in the Templates tab)" },
    { file: "app-visibility.json", desc: "API app visibility settings (auto-created when you save in the API Apps tab)" },
  ];
  const missing = optionalFiles.filter(f => !fs.existsSync(path.join(process.cwd(), f.file)));
  if (missing.length > 0) {
    warnings.push("  - Optional files not yet created (will be auto-generated on first use):");
    missing.forEach(f => warnings.push(`      ${f.file} — ${f.desc}`));
  }

  if (warnings.length > 0) {
    console.log("\n========================================");
    console.log(" Sign Portal Demo — Setup Guide");
    console.log("========================================");
    warnings.forEach(w => console.log(w));
    console.log("========================================\n");
  }
})();

//
// 3b. Load static templateMap (templates.json) and themes
//
let templateMap = {};
try {
  templateMap = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "templates.json"), "utf-8")
  );
} catch {
  // templates.json is optional — templates are managed dynamically via the API
}
// Themes: READ-ONLY seed file for new users (Phase 3)
// Changes are stored per-user in Redis (user:{account_id}:themes)
// This file is no longer modified by the application
const themesPath = path.join(process.cwd(), "config/themes.json");
let themes = {};
try {
  themes = JSON.parse(fs.readFileSync(themesPath, "utf-8"));
} catch {
  // Provide a sensible default so the app can start without config/themes.json
  themes = {
    default: {
      id: "default",
      name: "Default",
      pageTitle: "Sign Portal Demo",
      tabLabel: "New Request",
      sections: {
        left: {
          title: "Signer Details",
          fields: [
            { id: "signerName1", label: "Name", type: "text", defaultValue: "" },
            { id: "signerEmail1", label: "Email", type: "email", defaultValue: "" }
          ]
        },
        right: {
          title: "Details",
          fields: []
        }
      },
      buttons: {
        send: "Send for Signature (Template)",
        preview: "Preview Document",
        embed: "View & Sign (Embedded Template)"
      },
      email: {
        subject: "Please sign this document",
        message: "Please review and sign the attached document."
      }
    }
  };
  console.warn("⚠ config/themes.json not found — using default theme. Create config/themes.json to customise.");
}

// Onboarding App Presets: Configuration for demo apps created during first-time user onboarding
const ONBOARDING_APPS_FILE = path.join(process.cwd(), 'config', 'onboarding-apps.json');
let onboardingAppPresets = [];
try {
  const data = fs.readFileSync(ONBOARDING_APPS_FILE, 'utf8');
  onboardingAppPresets = JSON.parse(data);
  console.log(`✓ Loaded ${onboardingAppPresets.length} onboarding app presets`);
} catch (err) {
  console.warn('⚠ Could not load config/onboarding-apps.json, using defaults');
  onboardingAppPresets = [
    { namePrefix: 'acme-app', domains: ['localhost', '127.0.0.1'], description: 'General app', callbackUrl: null, testMode: true },
    { namePrefix: 'hanford-app', domains: ['localhost', '127.0.0.1'], description: 'Webhooks app', callbackUrl: '${CALLBACK_URL}', testMode: true }
  ];
}

// Template Labels: READ-ONLY seed file for new users (Phase 3)
// Changes are stored per-user in Redis (user:{account_id}:template_labels)
const templateLabelsPath = path.join(process.cwd(), "config", "template-labels.json");
let templateLabels = {};
try {
  templateLabels = JSON.parse(fs.readFileSync(templateLabelsPath, "utf-8"));
} catch {
  templateLabels = {};
}
function saveTemplateLabels() {
  fs.writeFileSync(templateLabelsPath, JSON.stringify(templateLabels, null, 2));
}

// App visibility stored locally (persisted to app-visibility.json)
const appVisibilityPath = path.join(process.cwd(), "app-visibility.json");
let appVisibility = {}; // { clientId: true/false }
try {
  appVisibility = JSON.parse(fs.readFileSync(appVisibilityPath, "utf-8"));
} catch {
  appVisibility = {};
}
function saveAppVisibility() {
  fs.writeFileSync(appVisibilityPath, JSON.stringify(appVisibility, null, 2));
}

// App test mode stored locally (persisted to app-test-mode.json)
const appTestModePath = path.join(process.cwd(), "app-test-mode.json");
let appTestMode = {}; // { clientId: true/false }
try {
  appTestMode = JSON.parse(fs.readFileSync(appTestModePath, "utf-8"));
} catch {
  appTestMode = {};
}
function saveAppTestMode() {
  fs.writeFileSync(appTestModePath, JSON.stringify(appTestMode, null, 2));
}
// Helper: get test mode for a given client_id (defaults to false)
function getTestMode(clientId, req = null) {
  // Priority 1: Check session (per-user setting)
  if (req?.session?.appTestMode?.[clientId] !== undefined) {
    return req.session.appTestMode[clientId];
  }

  // Priority 2: Check global appTestMode (legacy/fallback)
  if (clientId && appTestMode[clientId] !== undefined) {
    return appTestMode[clientId];
  }

  // Default: true (test mode) - allows skipDomainVerification for demos
  return true;
}

// Portal settings (persisted to settings.json)
// Portal Settings: READ-ONLY seed file for new users (Phase 3)
// Changes are stored per-user in Redis (user:{account_id}:settings)
const settingsPath = path.join(process.cwd(), "config", "settings.json");
function saveSettings() {
  // Phase 3: Deprecated - settings now saved via setSettings() DAL function
  if (VERBOSE_LOGGING) console.warn('[DEPRECATED] saveSettings() called - use setSettings(accountId, settings) instead');
}
let portalSettings = {
  fullscreenSigning: false,
  smsDeliveryEnabled: false,  // Show SMS Delivery option (disabled by default, not available in test mode)
  currentApiKeyUser: null,  // Stores selected API user ID for multi-user support
  logoOnTextTags: true  // Show Portal logo on text tags documents (enabled by default)
};
try {
  portalSettings = { ...portalSettings, ...JSON.parse(fs.readFileSync(settingsPath, "utf-8")) };
} catch {}

// Determine which API key to use (now that portalSettings is loaded)
// API clients created per-request via getUserApiClient()

// Form Fields Defaults: READ-ONLY seed file (Phase 3)
// Changes are stored per-user in Redis (user:{account_id}:form_fields)
const formFieldsDefaultsPath = path.join(process.cwd(), "config", "form-fields-defaults.json");
let formFieldsDefaults = null;
try {
  formFieldsDefaults = JSON.parse(fs.readFileSync(formFieldsDefaultsPath, 'utf-8'));
} catch {
  formFieldsDefaults = null;
}
function saveFormFieldsDefaults(fields) {
  // Phase 3: Deprecated - use setFormFieldsDefaults() DAL function
  if (VERBOSE_LOGGING) console.warn('[DEPRECATED] saveFormFieldsDefaults() called - use setFormFieldsDefaults(accountId, fields) instead');
}

//
// === DATA ACCESS LAYER (DAL) - Phase 1 ===
// All global data reads/writes go through these functions.
// Phase 1: Functions still use global variables (no Redis yet)
// Phase 2: Will replace implementations to use Redis
//

// 1. Themes
async function getThemes(accountId, session = null) {
  // Use Redis if available (persistent storage)
  if (redisClient && accountId) {
    const key = `user:${accountId}:themes`;
    const cached = await redisClient.get(key);

    if (cached) {
      return JSON.parse(cached);
    }

    // First-time: seed from global themes file
    if (VERBOSE_LOGGING) console.log(`[REDIS] Seeding themes for user ${accountId}`);
    await redisClient.set(key, JSON.stringify(themes));
    return themes;
  }

  // Fallback to session when Redis unavailable (only persists during browser session)
  if (session?.themes) {
    return session.themes;
  }

  return themes; // Default themes
}

async function setTheme(accountId, themeId, themeData, session = null) {
  // Phase 3: Redis-only, no global file writes
  if (redisClient && accountId) {
    const userThemes = await getThemes(accountId);
    userThemes[themeId] = themeData;
    const key = `user:${accountId}:themes`;
    await redisClient.set(key, JSON.stringify(userThemes));
    if (VERBOSE_LOGGING) console.log(`[REDIS] Updated theme ${themeId} for user ${accountId}`);
  } else if (!redisClient && !session) {
    console.error('[DAL] Redis unavailable and no session, cannot save theme');
    throw new Error('Database unavailable');
  }

  // Store in session only when Redis unavailable (for persistence during browser session)
  if (!redisClient && session) {
    if (!session.themes) {
      session.themes = { ...themes }; // Initialize with defaults
    }
    session.themes[themeId] = themeData;
    if (VERBOSE_LOGGING) console.log(`[SESSION] Updated theme ${themeId} in session`);
  }
}

async function deleteTheme(accountId, themeId, session = null) {
  // Phase 3: Redis-only, no global file writes
  if (redisClient && accountId) {
    const userThemes = await getThemes(accountId);
    delete userThemes[themeId];
    const key = `user:${accountId}:themes`;
    await redisClient.set(key, JSON.stringify(userThemes));
    if (VERBOSE_LOGGING) console.log(`[REDIS] Deleted theme ${themeId} for user ${accountId}`);
  } else if (!redisClient && !session) {
    console.error('[DAL] Redis unavailable and no session, cannot delete theme');
    throw new Error('Database unavailable');
  }

  // Update session only when Redis unavailable
  if (!redisClient && session && session.themes) {
    delete session.themes[themeId];
    if (VERBOSE_LOGGING) console.log(`[SESSION] Deleted theme ${themeId} from session`);
  }
}

// Admin bulk theme operations
async function getAllUserThemes() {
  const users = await getAllUsers();
  const userThemeMap = {};

  for (const user of users) {
    const userThemes = await getThemes(user.accountId);
    userThemeMap[user.accountId] = {
      email: user.email,
      themes: Object.keys(userThemes)
    };
  }

  return userThemeMap;
}

async function publishThemeToAllUsers(themeId, themeData, overwriteExisting = false) {
  const users = await getAllUsers();
  let publishedCount = 0;
  let skippedCount = 0;

  for (const user of users) {
    const userThemes = await getThemes(user.accountId);

    if (!userThemes[themeId] || overwriteExisting) {
      await setTheme(user.accountId, themeId, themeData);
      publishedCount++;
    } else {
      skippedCount++;
    }
  }

  if (VERBOSE_LOGGING) console.log(`[ADMIN] Published theme ${themeId} to ${publishedCount} users, skipped ${skippedCount}`);
  return { publishedCount, skippedCount, totalUsers: users.length };
}

async function removeThemeFromAllUsers(themeId) {
  const users = await getAllUsers();
  let removedCount = 0;

  for (const user of users) {
    const userThemes = await getThemes(user.accountId);

    if (userThemes[themeId]) {
      await deleteTheme(user.accountId, themeId);
      removedCount++;

      // If this was the selected theme, reset to first available
      const settings = await getSettings(user.accountId);
      if (settings.selectedTheme === themeId) {
        const remainingThemes = await getThemes(user.accountId);
        const firstTheme = Object.keys(remainingThemes)[0];
        settings.selectedTheme = firstTheme || 'default';
        await setSettings(user.accountId, settings);
        if (VERBOSE_LOGGING) console.log(`[ADMIN] Reset selected theme for user ${user.accountId} from ${themeId} to ${settings.selectedTheme}`);
      }
    }
  }

  if (VERBOSE_LOGGING) console.log(`[ADMIN] Removed theme ${themeId} from ${removedCount} users`);
  return { removedCount, totalUsers: users.length };
}

// 2. Template Labels
async function getTemplateLabels(accountId) {
  // Phase 2: Use Redis for per-user template labels
  if (!redisClient) {
    return templateLabels; // Fallback
  }

  const key = `user:${accountId}:template_labels`;
  const cached = await redisClient.get(key);

  if (cached) {
    return JSON.parse(cached);
  }

  // First-time: seed from global template labels file
  if (VERBOSE_LOGGING) console.log(`[REDIS] Seeding template labels for user ${accountId}`);
  await redisClient.set(key, JSON.stringify(templateLabels));
  return templateLabels;
}

async function setTemplateLabels(accountId, labels) {
  // Phase 3: Redis-only, no global file writes
  if (!redisClient) {
    console.error('[DAL] Redis unavailable, cannot save template labels');
    throw new Error('Database unavailable');
  }

  const key = `user:${accountId}:template_labels`;
  await redisClient.set(key, JSON.stringify(labels));
  if (VERBOSE_LOGGING) console.log(`[REDIS] Updated template labels for user ${accountId}`);
}

async function setTemplateLabel(accountId, templateId, themeIds) {
  // Phase 3: Redis-only, no global file writes
  if (!redisClient) {
    console.error('[DAL] Redis unavailable, cannot save template label');
    throw new Error('Database unavailable');
  }

  const userLabels = await getTemplateLabels(accountId);
  userLabels[templateId] = themeIds;
  const key = `user:${accountId}:template_labels`;
  await redisClient.set(key, JSON.stringify(userLabels));
  if (VERBOSE_LOGGING) console.log(`[REDIS] Updated label for template ${templateId}, user ${accountId}`);
}

async function getTemplateMergeFields(accountId) {
  // Get merge field metadata stored in Redis
  if (!redisClient) {
    return {};
  }

  const key = `user:${accountId}:template_merge_fields`;
  const cached = await redisClient.get(key);

  if (cached) {
    return JSON.parse(cached);
  }

  return {};
}

async function setTemplateMergeFields(accountId, templateId, hasMergeFields, mergeFieldNames) {
  // Store merge field metadata in Redis
  if (!redisClient) {
    console.error('[DAL] Redis unavailable, cannot save merge field metadata');
    return;
  }

  const allMergeFields = await getTemplateMergeFields(accountId);
  allMergeFields[templateId] = { hasMergeFields, mergeFieldNames };
  const key = `user:${accountId}:template_merge_fields`;
  await redisClient.set(key, JSON.stringify(allMergeFields));
  if (VERBOSE_LOGGING) console.log(`[REDIS] Updated merge fields for template ${templateId}`);
}

// 3. Settings
async function getSettings(accountId, session = null) {
  // Use Redis if available (persistent storage)
  if (redisClient && accountId) {
    const key = `user:${accountId}:settings`;
    const cached = await redisClient.get(key);

    if (cached) {
      return JSON.parse(cached);
    }

    // First-time: seed from global settings file
    if (VERBOSE_LOGGING) console.log(`[REDIS] Seeding settings for user ${accountId}`);
    await redisClient.set(key, JSON.stringify(portalSettings));
    return portalSettings;
  }

  // Fallback to session when Redis unavailable (only persists during browser session)
  if (session?.settings) {
    return session.settings;
  }

  return portalSettings; // Default settings
}

async function setSettings(accountId, newSettings, session = null) {
  // Phase 3: Redis-only, no global file writes
  if (redisClient && accountId) {
    const key = `user:${accountId}:settings`;
    const currentSettings = await getSettings(accountId);
    const updatedSettings = { ...currentSettings, ...newSettings };
    await redisClient.set(key, JSON.stringify(updatedSettings));
    if (VERBOSE_LOGGING) console.log(`[REDIS] Updated settings for user ${accountId}`);
  } else if (!redisClient && !session) {
    console.error('[DAL] Redis unavailable and no session, cannot save settings');
    throw new Error('Database unavailable');
  }

  // Store in session only when Redis unavailable (for persistence during browser session)
  if (!redisClient && session) {
    const currentSettings = await getSettings(accountId, session);
    session.settings = { ...currentSettings, ...newSettings };
    if (VERBOSE_LOGGING) console.log(`[SESSION] Updated settings in session`);
  }
}

// 4. Form Fields Defaults
async function getFormFieldsDefaults(accountId) {
  // Phase 2: Use Redis for per-user form fields
  if (!redisClient) {
    return formFieldsDefaults; // Fallback
  }

  const key = `user:${accountId}:form_fields`;
  const cached = await redisClient.get(key);

  if (cached) {
    const parsed = JSON.parse(cached);
    if (VERBOSE_LOGGING) console.log(`[FORM_FIELDS] Loaded for ${accountId}:`, JSON.stringify(parsed, null, 2));
    return parsed;
  }

  // First-time: seed from global (may be null if never saved)
  if (VERBOSE_LOGGING) console.log(`[REDIS] Seeding form fields for user ${accountId}`);
  const seedData = formFieldsDefaults || null;
  if (seedData !== null) {
    await redisClient.set(key, JSON.stringify(seedData));
  }
  return seedData;
}

async function setFormFieldsDefaults(accountId, fields) {
  // Phase 3: Redis-only, no global file writes
  if (!redisClient) {
    console.error('[DAL] Redis unavailable, cannot save form fields');
    throw new Error('Database unavailable');
  }

  const key = `user:${accountId}:form_fields`;
  if (VERBOSE_LOGGING) console.log(`[FORM_FIELDS] Saving for ${accountId}:`, JSON.stringify(fields, null, 2));
  await redisClient.set(key, JSON.stringify(fields));
  if (VERBOSE_LOGGING) console.log(`[REDIS] Updated form fields for user ${accountId}`);
}

async function deleteFormFieldsDefaults(accountId) {
  // Delete user's form fields from Redis, causing reload from global defaults
  if (!redisClient) {
    console.error('[DAL] Redis unavailable, cannot delete form fields');
    throw new Error('Database unavailable');
  }

  const key = `user:${accountId}:form_fields`;
  await redisClient.del(key);
  if (VERBOSE_LOGGING) console.log(`[REDIS] Deleted form fields for user ${accountId} (will reload from global defaults)`);
}

// 5. Document Templates
async function getDocumentTemplates(accountId) {
  // Phase 2: Use Redis for per-user document templates
  if (!redisClient) {
    return documentTemplates; // Fallback
  }

  const key = `user:${accountId}:document_templates`;
  const cached = await redisClient.get(key);

  if (cached) {
    return JSON.parse(cached);
  }

  // First-time: seed from global document templates file
  if (VERBOSE_LOGGING) console.log(`[REDIS] Seeding document templates for user ${accountId}`);
  await redisClient.set(key, JSON.stringify(documentTemplates));
  return documentTemplates;
}

async function setDocumentTemplates(accountId, templates) {
  // Phase 3: Redis-only, no global writes
  if (!redisClient) {
    console.error('[DAL] Redis unavailable, cannot save document templates');
    throw new Error('Database unavailable');
  }

  const key = `user:${accountId}:document_templates`;
  await redisClient.set(key, JSON.stringify(templates));
  if (VERBOSE_LOGGING) console.log(`[REDIS] Updated document templates for user ${accountId}`);
}

// 6. Signature Warnings
async function getSignatureWarnings(accountId) {
  // Phase 2: Use Redis for per-user warnings
  if (!redisClient) {
    return loadWarnings(); // Fallback
  }

  const key = `user:${accountId}:sig_warnings`;
  const cached = await redisClient.get(key);

  if (cached) {
    return JSON.parse(cached);
  }

  // First-time: start with empty object (warnings are generated, not seeded)
  if (VERBOSE_LOGGING) console.log(`[REDIS] Initializing signature warnings for user ${accountId}`);
  const emptyWarnings = {};
  await redisClient.set(key, JSON.stringify(emptyWarnings));
  return emptyWarnings;
}

async function addSignatureWarning(accountId, signatureRequestId, warnings) {
  // Phase 2: Store in Redis (per-user)
  if (!redisClient) {
    saveWarning(signatureRequestId, warnings);
    return;
  }

  const userWarnings = await getSignatureWarnings(accountId);
  userWarnings[signatureRequestId] = warnings;

  // Apply limit: max 100 signature warnings
  const keys = Object.keys(userWarnings);
  if (keys.length > 100) {
    delete userWarnings[keys[0]]; // Remove oldest
  }

  const key = `user:${accountId}:sig_warnings`;
  await redisClient.set(key, JSON.stringify(userWarnings));
  if (VERBOSE_LOGGING) console.log(`[REDIS] Added signature warning for ${signatureRequestId}, user ${accountId}`);
}

// 7. API Logs
async function getApiLogs(accountId) {
  // Phase 2: Use Redis for per-user API logs
  if (!redisClient) {
    // Return in-memory logs when Redis unavailable (all users share same logs)
    return apiLogs;
  }

  const key = `user:${accountId}:api_logs`;
  const cached = await redisClient.get(key);

  if (cached) {
    return JSON.parse(cached);
  }

  // First-time: start with empty array (logs are generated, not seeded)
  if (VERBOSE_LOGGING) console.log(`[REDIS] Initializing API logs for user ${accountId}`);
  const emptyLogs = [];
  await redisClient.set(key, JSON.stringify(emptyLogs));
  return emptyLogs;
}

function addApiLog(entry, accountId = 'global', req = null) {
  // Phase 3: Store in Redis (per-user) but keep synchronous for backward compatibility
  // If req is provided, extract accountId from session (overrides accountId param)
  // Usage: addApiLog({ ... }, null, req) OR addApiLog({ ... }, accountId)

  if (req && req.session?.accountInfo?.account_id) {
    accountId = req.session.accountInfo.account_id;
  }

  // Redact sensitive data before storing
  const redactedEntry = redactSensitiveData(entry);

  const logEntry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    timestamp: new Date().toISOString(),
    ...redactedEntry,
  };

  if (!redisClient) {
    // Use in-memory storage when Redis unavailable
    apiLogs.unshift(logEntry);
    const MAX_LOGS = 50;
    if (apiLogs.length > MAX_LOGS) {
      apiLogs.length = MAX_LOGS;
    }
    // No broadcast needed for in-memory (page refresh will show logs)
    return;
  }

  // Async Redis update (non-blocking)
  (async () => {
    try {
      const key = `user:${accountId}:api_logs`;
      const userLogs = await getApiLogs(accountId);
      userLogs.unshift(logEntry);

      // Apply FIFO limit per user
      const MAX_LOGS = 50;
      if (userLogs.length > MAX_LOGS) {
        userLogs.length = MAX_LOGS;
      }

      await redisClient.set(key, JSON.stringify(userLogs));
      broadcastLogUpdate(accountId);  // Only broadcast to this user
    } catch (err) {
      console.error('[REDIS] Error adding API log:', err.message);
    }
  })();
}

// 8. Test Mode Settings (per-user, per-app)
async function getAppTestModeSettings(accountId) {
  if (!redisClient) {
    if (VERBOSE_LOGGING) console.log('[REDIS] getAppTestModeSettings: Redis client not available');
    return {};
  }

  const key = `user:${accountId}:app_test_mode`;
  const cached = await redisClient.get(key);

  if (cached) {
    const parsed = JSON.parse(cached);
    if (VERBOSE_LOGGING) console.log(`[REDIS] getAppTestModeSettings for ${accountId}:`, parsed);
    return parsed;
  }

  if (VERBOSE_LOGGING) console.log(`[REDIS] getAppTestModeSettings: No data found for ${accountId}`);
  return {};
}

async function setAppTestModeSettings(accountId, testModeSettings) {
  if (!redisClient) {
    if (VERBOSE_LOGGING) console.log('[REDIS] setAppTestModeSettings: Redis client not available');
    return;
  }

  const key = `user:${accountId}:app_test_mode`;
  await redisClient.set(key, JSON.stringify(testModeSettings));
  if (VERBOSE_LOGGING) console.log(`[REDIS] setAppTestModeSettings for ${accountId}:`, testModeSettings);
}

//
// Signature Request Registry (Multi-tenant webhook routing)
//

/**
 * Register a signature request to a user
 * @param {string} signatureRequestId - Dropbox Sign signature request ID
 * @param {string} accountId - User account_id
 * @param {string} email - User email
 * @param {string} apiAppId - API App client ID (optional)
 */
async function registerSignatureRequest(signatureRequestId, accountId, email, apiAppId = null) {
  if (!redisClient || !signatureRequestId || !accountId) return;

  const key = `sig_req:${signatureRequestId}`;
  const data = {
    account_id: accountId,
    email: email,
    api_app_id: apiAppId,
    created_at: new Date().toISOString()
  };

  // Set with 90-day expiration (signature requests expire after 120 days)
  await redisClient.set(key, JSON.stringify(data), { EX: 90 * 24 * 60 * 60 });
}

/**
 * Look up which user created a signature request
 * @param {string} signatureRequestId
 * @returns {Promise<{account_id: string, email: string, api_app_id: string, created_at: string} | null>}
 */
async function lookupSignatureRequestOwner(signatureRequestId) {
  if (!redisClient || !signatureRequestId) return null;

  const key = `sig_req:${signatureRequestId}`;
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : null;
}

/**
 * Add callback event to user's Redis storage
 * @param {string} accountId
 * @param {string} signatureRequestId
 * @param {object} event - {event, key, signer, timestamp}
 */
async function addWebhookEvent(accountId, signatureRequestId, event) {
  if (!redisClient || !accountId || !signatureRequestId) return;

  const key = `user:${accountId}:webhook_events`;
  const existingData = await redisClient.get(key);
  const webhookEvents = existingData ? JSON.parse(existingData) : {};

  if (!webhookEvents[signatureRequestId]) {
    webhookEvents[signatureRequestId] = [];
  }

  // Don't add duplicates (same event+signer)
  if (!webhookEvents[signatureRequestId].some(e => e.key === event.key)) {
    webhookEvents[signatureRequestId].push(event);
  }

  // Enforce max 1000 signature requests (FIFO cleanup)
  const sigReqIds = Object.keys(webhookEvents);
  if (sigReqIds.length > 1000) {
    delete webhookEvents[sigReqIds[0]];
  }

  await redisClient.set(key, JSON.stringify(webhookEvents));
}

/**
 * Get all callback events for a user
 * @param {string} accountId
 * @returns {Promise<object>} - {signatureRequestId: [events]}
 */
async function getWebhookEvents(accountId) {
  if (!redisClient || !accountId) return {};

  const key = `user:${accountId}:webhook_events`;
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : {};
}

/**
 * Set callback enabled/disabled for a specific API App
 * @param {string} accountId
 * @param {string} apiAppId - API App client ID
 * @param {boolean} enabled
 */
async function setAppWebhookEnabled(accountId, apiAppId, enabled) {
  if (!redisClient || !accountId || !apiAppId) return;

  const key = `user:${accountId}:app_webhook_enabled`;
  const existingData = await redisClient.get(key);
  const settings = existingData ? JSON.parse(existingData) : {};

  settings[apiAppId] = enabled;

  await redisClient.set(key, JSON.stringify(settings));
}

/**
 * Get callback enabled settings for all API Apps
 * @param {string} accountId
 * @returns {Promise<object>} - {apiAppId: true/false}
 */
async function getAppWebhookSettings(accountId) {
  if (!redisClient || !accountId) return {};

  const key = `user:${accountId}:app_webhook_enabled`;
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : {};
}

/**
 * Check if callbacks are enabled for a specific API App
 * @param {string} accountId
 * @param {string} apiAppId
 * @returns {Promise<boolean>}
 */
async function isAppWebhookEnabled(accountId, apiAppId) {
  if (!redisClient || !accountId || !apiAppId) return true; // Default: enabled

  const settings = await getAppWebhookSettings(accountId);

  // If setting doesn't exist, default to true (enabled)
  return settings[apiAppId] !== false;
}

//
// 4. Setup SSE for real-time client updates (multi-tenant)
//
const sseClients = new Map(); // Map<accountId, Set<res>>

// Broadcast helper - now accepts optional accountId for targeted broadcast
function broadcastStatus(status, sigReqId, filesUrl = null, extra = {}) {
  const payload = { status, sigReqId, filesUrl, source: extra.source || 'app', ...extra };
  const msg = JSON.stringify(payload);

  // If accountId is provided, only broadcast to that user's clients
  if (extra.accountId) {
    const userClients = sseClients.get(extra.accountId);
    if (userClients) {
      for (const client of userClients) {
        client.write(`data: ${msg}\n\n`);
      }
    }
  } else {
    // Fallback: broadcast to all clients (for backwards compatibility)
    for (const userClients of sseClients.values()) {
      for (const client of userClients) {
        client.write(`data: ${msg}\n\n`);
      }
    }
  }
}

function broadcastLogUpdate(accountId = null) {
  if (accountId) {
    // Broadcast only to specific user
    const userClients = sseClients.get(accountId);
    if (userClients) {
      for (const client of userClients) {
        client.write(`event: log_update\ndata: {}\n\n`);
      }
    }
  } else {
    // Broadcast to all users
    for (const userClients of sseClients.values()) {
      for (const client of userClients) {
        client.write(`event: log_update\ndata: {}\n\n`);
      }
    }
  }
}

// Make SSE and broadcast functions available to routes
app.locals.sseClients = sseClients;
app.locals.broadcastStatus = broadcastStatus;
app.locals.broadcastLogUpdate = broadcastLogUpdate;
app.locals.validateApiKeyAndGetAccount = validateApiKeyAndGetAccount;
app.locals.generateCsrfToken = generateCsrfToken;
app.locals.securityHelpers = { generateCsrfToken };

// Make templates and document templates available to routes
app.locals.templateMap = templateMap;
app.locals.documentTemplates = documentTemplates;

//
// 5. Serve static frontend (public/index.html, logo, etc.)
//
app.use(express.static(path.join(process.cwd(), "public")));

//
// 6. /templates → return only the IDs from .env along with friendly titles
//
// (Route moved to src/routes/index.js)

// Theme routes moved to src/routes/themes.js
// Document templates route moved to src/routes/index.js

// Persistent disk caches for apps and templates (survive restarts)
const APPS_CACHE_FILE = path.join(EVENTS_DIR, 'cache-apps.json');
const TEMPLATES_CACHE_FILE = path.join(EVENTS_DIR, 'cache-templates.json');

function loadDiskCache(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { data: null, timestamp: 0 }; }
}

let appsServerCache = loadDiskCache(APPS_CACHE_FILE);


//
// 6a-2. PUT /api-apps/visibility → save app visibility locally
//





// Get callback settings for all API Apps

// Batch update callback settings for all apps (prevents race condition)

// Toggle callback enabled/disabled for a specific API App

// Save selected API app (hidden setting, not shown in Settings UI)

// Get list of available API users (emails only, no keys)
// Legacy API user management endpoints removed (API key authentication mode)

//
// 6a-3. GET /api-apps/:clientId → fetch full details for a single API app
//

//
// 6a-3a. GET /api-apps/:clientId/logo → proxy logo image with authentication
//

//
// 6a-4. PUT /api-apps/:clientId → update API app (name, callback, domains, logo, white labeling)
//
const appLogoUpload = multer({ dest: os.tmpdir() });

// 6a-5. DELETE /api-apps/:clientId → delete API app

//
// 6b. /api-templates → fetch templates from Dropbox Sign API
//
let templatesServerCache = loadDiskCache(TEMPLATES_CACHE_FILE);
const SLOW_CACHE_TTL = 10000; // 10 seconds for templates & apps (to catch shared templates quickly)

// Helper: fetch templates from Dropbox Sign API and update cache
async function refreshTemplatesCache(limit, req) {
  const pageSize = Math.min(limit, 20);
  const allTemplates = [];
  let page = 1;
  let hasMore = true;

  // Get account ID for per-user data
  const accountId = req.session?.accountInfo?.account_id || 'global';
  const userTemplateLabels = await getTemplateLabels(accountId);

  // Get user's account_id to include shared templates
  const userAccountId = req.session.accountInfo?.account_id;
  if (VERBOSE_LOGGING) console.log('[TEMPLATES] Fetching templates for account_id:', userAccountId);

  while (hasMore) {
    // Pass account_id to include templates shared with this user
    const response = await apiCall(req, 'TemplateApi', 'templateList', [userAccountId || undefined, page, pageSize], {
      method: 'GET',
      endpoint: '/template/list'
    });

    if (VERBOSE_LOGGING) console.log('[TEMPLATES] API Response - page:', page, 'templates count:', response.body?.templates?.length || 0);
    if (VERBOSE_LOGGING) console.log('[TEMPLATES] listInfo:', JSON.stringify(response.body?.listInfo, null, 2));

    const templates = response.body?.templates || [];

    // Log template details for debugging
    templates.forEach(t => {
      if (VERBOSE_LOGGING) console.log('[TEMPLATES] Found template:', t.templateId, '-', t.title,
                  '| isCreator:', t.isCreator, '| canEdit:', t.canEdit,
                  '| accounts:', t.accounts?.map(a => a.emailAddress).join(', '));
    });
    for (const t of templates) {
      const signerRoles = (t.signerRoles || []).map(r => r.name || r.role || '(unnamed)');

      // Determine creator email: if isCreator is true, use authenticated user's email
      // Otherwise, take the first account (which should be the owner)
      let creatorEmail = '—';
      if (t.isCreator) {
        creatorEmail = req.session.accountInfo?.email_address || '—';
      } else {
        const creatorAccount = (t.accounts || [])[0];
        creatorEmail = creatorAccount?.emailAddress || '—';
      }

      allTemplates.push({
        id: t.templateId,
        title: t.title || '(Untitled)',
        labels: userTemplateLabels[t.templateId] || [],
        metadata: t.metadata || {},
        isCreator: t.isCreator || false,
        canEdit: t.canEdit || false,
        signerCount: signerRoles.length,
        signerRoles,
        createdBy: creatorEmail,
      });
    }

    const total = response.body?.listInfo?.numResults || 0;
    if (allTemplates.length >= limit || allTemplates.length >= total || templates.length < pageSize) {
      hasMore = false;
    } else {
      page++;
    }
  }

  const result = allTemplates.slice(0, limit);
  req.session.templatesCache = { data: result, limit, timestamp: Date.now() };
  return result;
}


//
// 6c. PUT /api-templates/:id/metadata → save template labels locally
//

//
// 6b-9. GET /api/templates/raw → raw template list for debugging
//

//
// 6c-0. GET /api/team/debug → debug team hierarchy (admin only)
//

//
// 6c-1. GET /api/team/members → fetch all team members
//

//
// 6c-1b. GET /api/team/:teamId/sub_teams → fetch sub-teams for a specific team
//

//
// 6c-2. GET /api/team/sub-teams → fetch all sub-teams
//

//
// 6c-3. POST /api/templates/share → share templates with team/sub-team/member
//

// Delete a template

//
// 6d. /signatures → return signature requests (default 25)
//
// Server-side cache for signature list (avoids hammering the API)
let signaturesServerCache = { data: null, pageSize: null, timestamp: 0 };
const SIGNATURES_CACHE_TTL = 5000; // 5 seconds


//
// 6c. DELETE /signatures → cancel selected signature requests
//

//
// Frontend Error Logging Endpoint
//
app.post('/api/log-error', express.json(), (req, res) => {
  const error = req.body;
  const errorType = error.type || 'unknown';

  // Format error for logging
  const logMessage = [
    `[FRONTEND ${errorType.toUpperCase()}]`,
    error.message || 'No message',
    error.url ? `\n  URL: ${error.url}` : '',
    error.source ? `\n  Source: ${error.source}:${error.line}:${error.column}` : '',
    error.stack ? `\n  Stack: ${error.stack}` : '',
    error.userAgent ? `\n  User Agent: ${error.userAgent}` : '',
  ].filter(Boolean).join('');

  if (VERBOSE_LOGGING) console.error(logMessage);

  res.status(200).json({ logged: true });
});

// Helper function to rotate log files
function rotateLogFile(logFile, maxFiles) {
  const logDir = path.dirname(logFile);
  const logBaseName = path.basename(logFile, '.log');

  // Delete oldest log if we're at max files
  const oldestLog = path.join(logDir, `${logBaseName}.${maxFiles}.log`);
  if (fs.existsSync(oldestLog)) {
    fs.unlinkSync(oldestLog);
  }

  // Shift existing rotated logs (N -> N+1)
  for (let i = maxFiles - 1; i >= 1; i--) {
    const currentLog = path.join(logDir, `${logBaseName}.${i}.log`);
    const nextLog = path.join(logDir, `${logBaseName}.${i + 1}.log`);
    if (fs.existsSync(currentLog)) {
      fs.renameSync(currentLog, nextLog);
    }
  }

  // Move current log to .1.log
  const rotatedLog = path.join(logDir, `${logBaseName}.1.log`);
  fs.renameSync(logFile, rotatedLog);

  if (VERBOSE_LOGGING) console.log(`[LOG] Rotated browser console log (size exceeded threshold)`);
}

// POST /api/log-console - Log browser console output to file with rotation
app.post('/api/log-console', express.json(), async (req, res) => {
  const log = req.body;
  const level = (log.level || 'log').toUpperCase();

  // Format log message
  const logMessage = [
    `[BROWSER ${level}]`,
    log.timestamp,
    log.message,
    log.url ? `\n  URL: ${log.url}` : ''
  ].filter(Boolean).join(' ');

  if (VERBOSE_LOGGING) console.log(logMessage);

  // Get rotation settings from Redis
  let maxSizeBytes = 10 * 1024 * 1024; // Default 10MB
  let maxFiles = 3; // Default keep 3 rotated files

  if (redisClient) {
    try {
      const maxSizeStr = await redisClient.get('system:console_logging_max_size');
      const maxFilesStr = await redisClient.get('system:console_logging_max_files');
      if (maxSizeStr) maxSizeBytes = parseInt(maxSizeStr);
      if (maxFilesStr) maxFiles = parseInt(maxFilesStr);
    } catch (err) {
      console.error('[LOG] Error reading rotation settings:', err);
    }
  }

  // Write to dedicated browser log file
  const logDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFile = path.join(logDir, 'browser-console.log');
  const logLine = `${logMessage}\n`;

  try {
    // Check if rotation is needed
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      if (stats.size >= maxSizeBytes) {
        // Rotate log files
        rotateLogFile(logFile, maxFiles);
      }
    }

    fs.appendFileSync(logFile, logLine);
  } catch (err) {
    console.error('[LOG] Failed to write browser log:', err.message);
  }

  res.status(200).json({ logged: true });
});

//
// Public API: Tooltip Configuration
// GET /api/tooltips/config - Get tooltip configuration for frontend
//
app.get('/api/tooltips/config', requireSession, async (req, res) => {
  try {
    let data;

    if (!redisClient) {
      // Load default tooltip config when Redis unavailable
      const { getDefaultTooltipConfig } = await import('./src/config/tooltip-defaults.js');
      data = getDefaultTooltipConfig();
    } else {
      let config = await redisClient.get('system:tooltips');
      if (!config) {
        // Initialize with defaults if not configured yet
        const { getDefaultTooltipConfig } = await import('./src/config/tooltip-defaults.js');
        const defaults = getDefaultTooltipConfig();
        await redisClient.set('system:tooltips', JSON.stringify(defaults));
        config = JSON.stringify(defaults);
        if (VERBOSE_LOGGING) console.log('[TOOLTIP] Initialized tooltip configuration with defaults');
      }
      data = JSON.parse(config);
    }

    // Filter: only return enabled tooltips
    const enabledTooltips = {};
    for (const [id, tooltip] of Object.entries(data.tooltips)) {
      if (tooltip.enabled) {
        enabledTooltips[id] = {
          text: tooltip.text,
          position: tooltip.position,
          sourceUrl: tooltip.sourceUrl || ''
        };
      }
    }

    // Cache for 5 minutes
    res.set('Cache-Control', 'public, max-age=300');

    res.json({
      globalSettings: data.globalSettings,
      tooltips: enabledTooltips
    });
  } catch (err) {
    console.error('[API] Error fetching tooltip config:', err);
    // Graceful degradation: return empty config on error
    res.json({
      globalSettings: { enabled: false },
      tooltips: {}
    });
  }
});

//
// GET /api/endpoint-docs - Get API endpoint documentation mapping
//
app.get('/api/endpoint-docs', requireAuth, async (req, res) => {
  try {
    const { API_ENDPOINT_DOCS } = await import('./src/config/api-endpoint-docs.js');

    // Cache for 1 hour (this data doesn't change often)
    res.set('Cache-Control', 'public, max-age=3600');

    res.json({
      success: true,
      endpoints: API_ENDPOINT_DOCS
    });
  } catch (err) {
    console.error('[API] Error fetching endpoint docs:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to load endpoint documentation mapping'
    });
  }
});

//
// Mount all route modules with base paths
//
app.use(authRoutes);              // Login, logout, auth status (no prefix - uses /login, /logout, /auth/status)
app.use(onboardingRoutes);        // Onboarding flow (no prefix - uses /onboarding/*)
app.use('/api-logs', apiLogsRoutes);       // API logs (GET /api-logs, DELETE /api-logs)
app.use('/themes', themesRoutes);          // Theme management (GET/PUT/DELETE /themes/*)
app.use('/settings', settingsRoutes);      // User settings (GET/PUT /settings/*)
app.use('/api/team', teamRoutes);          // Team API (GET /api/team/*)
app.use('/api-templates', templatesRoutes); // Template management (GET /api-templates/*)
app.use('/api-apps', apiAppsRoutes);       // API app management (GET/PUT/DELETE /api-apps/*)
app.use('/signatures', signaturesRoutes);  // Signature requests (GET/DELETE /signatures)
app.use('/admin', adminRoutes);            // Admin panel (GET/DELETE /admin/*)
app.use('/admin/translations', adminTranslationsRoutes); // Translation management (GET/POST /admin/translations)
app.use(signingRoutes);           // Signing flows (no prefix - uses /sign, /embedded, /create-template, etc.)
app.use(webhooksRoutes);          // Webhook callbacks (POST /events/callback)
app.use(indexRoutes);             // Main routes (home /, events, templates, 404 catch-all)

//
// Validate Configuration & Start the server
//
function validateConfig() {
  const errors = [];
  const warnings = [];

  // Session secret - auto-generate if missing (with warning in production)
  if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    if (IS_PRODUCTION) {
      warnings.push('SESSION_SECRET was auto-generated - consider setting it explicitly for production');
    }
  }

  // Production-specific requirements
  if (IS_PRODUCTION) {
    if (process.env.SESSION_SECRET === 'your-secret-key-change-in-production') {
      errors.push('SESSION_SECRET must be changed in production');
    }
    if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
      warnings.push('REDIS_URL not set - sessions will not persist across restarts');
    }
  }

  // Print results
  if (errors.length > 0) {
    console.error('\n❌ CONFIGURATION ERRORS:');
    errors.forEach(err => console.error(`  - ${err}`));
    console.error('\nServer cannot start. Fix errors in .env file.\n');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  CONFIGURATION WARNINGS:');
    warnings.forEach(warn => console.warn(`  - ${warn}`));
    console.warn('');
  }

  // Success message
  console.log(`\n✓ Environment: ${IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  if (redisClient) {
    console.log(`✓ Redis: ${process.env.REDIS_URL || process.env.REDIS_HOST}\n`);
  } else {
    console.log(`⚠️  Redis: DISABLED (ALLOW_NO_REDIS=true) - Data will not persist!\n`);
  }
}

validateConfig();

app.listen(PORT, () =>
  console.log(`Server listening on http://localhost:${PORT}`)
);