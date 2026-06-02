// src/routes/api-apps.js
import { Router } from 'express';
import express from 'express';
import fs from 'fs';
import os from 'os';
import https from 'https';
import multer from 'multer';
import * as DropboxSign from '@dropbox/sign';
import { requireAuth } from '../middleware/auth.js';
import { apiCall } from '../services/dropbox-sign.js';
import { VERBOSE_LOGGING } from '../config/security.js';
import { decryptApiKey } from '../utils/crypto.js';

const router = Router();

// Cache TTL for API apps list
const SLOW_CACHE_TTL = 10000; // 10 seconds

/**
 * GET /api-apps - Get API apps list with caching
 * Supports force refresh and applies per-user settings
 */
router.get('/', requireAuth, async (req, res) => {
  // Prevent browser caching of user-specific data
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const { getAppTestModeSettings, getAppWebhookSettings, setAppTestModeSettings } = req.app.locals.redisHelpers;
  const now = Date.now();
  const forceRefresh = req.query.force === '1';

  const accountId = req.session?.accountInfo?.account_id || 'global';

  // Redis is the durable source for this setting. Save currently sends several
  // session-mutating requests in parallel, so the session can briefly contain an
  // older snapshot even after Redis has the user's saved checkbox state.
  const persistedAppTestMode = await getAppTestModeSettings(accountId);
  if (persistedAppTestMode && Object.keys(persistedAppTestMode).length > 0) {
    req.session.appTestMode = persistedAppTestMode;
    if (VERBOSE_LOGGING) console.log('[API-APPS] Loaded persisted test mode for account', accountId, ':', req.session.appTestMode);
  } else if (!req.session.appTestMode) {
    req.session.appTestMode = {};
    if (VERBOSE_LOGGING) console.log('[API-APPS] No persisted test mode for account', accountId);
  } else {
    if (VERBOSE_LOGGING) console.log('[API-APPS] Using session test mode fallback for account', accountId, ':', req.session.appTestMode);
  }

  // Session-based cache (per user)
  if (!req.session.appsCache) {
    req.session.appsCache = { data: null, timestamp: 0 };
  }

  const cacheIsFresh = !forceRefresh && req.session.appsCache.data && (now - req.session.appsCache.timestamp) < SLOW_CACHE_TTL;

  // Helper: overlay current visibility/testMode/webhookEnabled onto cached app data
  async function applyAppSettings(apps) {
    const sessionAppVisibility = req.session.appVisibility || {};
    const sessionAppTestMode = req.session.appTestMode || {};
    const webhookSettings = accountId ? await getAppWebhookSettings(accountId) : {};

    if (VERBOSE_LOGGING) console.log('[APPLY-SETTINGS] Applying test mode settings:', sessionAppTestMode);

    return apps.map(a => {
      // Always respect saved webhook setting from Redis (default: true if not set)
      const webhookEnabled = webhookSettings[a.clientId] !== false;

      // Use isOwned to determine default visibility (owned = true, unowned = false)
      // If isOwned is not set (old cached data), default to true for backward compatibility
      const defaultVisible = a.isOwned !== undefined ? a.isOwned : true;

      // Default to true (test mode) to match server-side behavior in signing.js:getTestMode()
      // This prevents SMS auth errors when session is empty
      const testModeValue = sessionAppTestMode[a.clientId] !== undefined ? sessionAppTestMode[a.clientId] : true;
      if (VERBOSE_LOGGING) console.log(`[APPLY-SETTINGS] App ${a.clientId} (${a.name}): testMode = ${testModeValue}`);

      return {
        ...a,
        visible: sessionAppVisibility[a.clientId] !== undefined ? sessionAppVisibility[a.clientId] : defaultVisible,
        testMode: testModeValue,
        webhookEnabled,
      };
    });
  }

  if (cacheIsFresh) {
    return res.json(await applyAppSettings(req.session.appsCache.data));
  }

  // Stale cache exists: serve immediately, refresh in background (skip if forced)
  if (req.session.appsCache.data && !forceRefresh) {
    res.json(await applyAppSettings(req.session.appsCache.data));
    // Background refresh
    (async () => {
      try {
        const response = await apiCall(req, 'ApiAppApi', 'apiAppList', [1, 20], {
          method: 'GET',
          endpoint: '/api_app/list'
        });
        const sessionAppVisibility = req.session.appVisibility || {};
        const sessionAppTestMode = req.session.appTestMode || {};
        const currentUserEmail = req.session.accountInfo?.email_address?.toLowerCase();
        const apps = (response.body?.apiApps || []).map(app => {
          const isOwned = currentUserEmail && app.ownerAccount?.emailAddress?.toLowerCase() === currentUserEmail;
          // For unowned apps: default visible = false, and respect saved setting if explicitly set
          // For owned apps: default visible = true
          const defaultVisible = isOwned;
          return {
            clientId: app.clientId,
            name: app.name,
            visible: sessionAppVisibility[app.clientId] !== undefined ? sessionAppVisibility[app.clientId] : defaultVisible,
            testMode: sessionAppTestMode[app.clientId] !== undefined ? sessionAppTestMode[app.clientId] : false,
            callbackUrl: app.callbackUrl || '',
            owner: app.ownerAccount?.emailAddress || '—',
            domains: (app.domains || []).join(', ') || '—',
            isApproved: app.isApproved || false,
            oauthScopes: app.oauth?.scopes || [],
            hasWhiteLabeling: !!app.whiteLabelingOptions,
            isOwned: isOwned,
          };
        });
        req.session.appsCache = { data: apps, timestamp: Date.now() };
      } catch (err) { if (VERBOSE_LOGGING) console.warn("[/api-apps] Background refresh failed:", err?.message || err); }
    })();
    return;
  }

  // No cache at all: must fetch synchronously
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await apiCall(req, 'ApiAppApi', 'apiAppList', [1, 20], {
        method: 'GET',
        endpoint: '/api_app/list'
      });
      const currentUserEmail = req.session.accountInfo?.email_address?.toLowerCase();
      const apps = (response.body?.apiApps || []).map(app => {
        const isOwned = currentUserEmail && app.ownerAccount?.emailAddress?.toLowerCase() === currentUserEmail;
        // For unowned apps: default visible = false
        // For owned apps: default visible = true
        const defaultVisible = isOwned;
        return {
          clientId: app.clientId,
          name: app.name,
          callbackUrl: app.callbackUrl || '',
          owner: app.ownerAccount?.emailAddress || '—',
          domains: (app.domains || []).join(', ') || '—',
          isApproved: app.isApproved || false,
          oauthScopes: app.oauth?.scopes || [],
          hasWhiteLabeling: !!app.whiteLabelingOptions,
          isOwned: isOwned,
          visible: defaultVisible,
        };
      });
      req.session.appsCache = { data: apps, timestamp: Date.now() };
      return res.json(await applyAppSettings(apps));
    } catch (err) {
      const isRateLimit = err?.statusCode === 429 || err?.body?.error?.errorName === 'exceeded_rate';
      if (isRateLimit && attempt < 2) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
        continue;
      }
      if (isRateLimit) {
        return res.status(429).json({ error: "Rate limited by Dropbox Sign API", rateLimited: true });
      }
      const reason = err?.message || err;
      console.error("Error in /api-apps:", reason);
      return res.status(500).json({ error: "Failed to fetch API apps" });
    }
  }
});

/**
 * PUT /form-fields-defaults - Save form fields defaults
 * Saves to Redis for current user
 */
router.put('/form-fields-defaults', requireAuth, express.json(), async (req, res) => {
  const accountId = req.session?.accountInfo?.account_id || 'global';
  const { fields } = req.body;
  const { setFormFieldsDefaults } = req.app.locals.redisHelpers;

  if (!Array.isArray(fields)) {
    return res.status(400).json({ error: "Missing 'fields' array in request body" });
  }

  await setFormFieldsDefaults(accountId, fields);
  res.json({ success: true });
});

/**
 * DELETE /form-fields-defaults - Reset form fields to global defaults
 * Clears user's Redis data, causing reload from form-fields-defaults.json
 */
router.delete('/form-fields-defaults', requireAuth, async (req, res) => {
  const accountId = req.session?.accountInfo?.account_id || 'global';
  const { deleteFormFieldsDefaults } = req.app.locals.redisHelpers;

  await deleteFormFieldsDefaults(accountId);
  res.json({ success: true });
});

/**
 * PUT /api-apps/visibility - Save app visibility settings
 * Stores in session (per-user)
 */
router.put('/visibility', requireAuth, express.json(), (req, res) => {
  const { visibility } = req.body;

  if (!visibility || typeof visibility !== 'object') {
    return res.status(400).json({ error: "Missing 'visibility' object in request body" });
  }

  // Store in session instead of global appVisibility
  if (!req.session.appVisibility) req.session.appVisibility = {};
  for (const [clientId, isVisible] of Object.entries(visibility)) {
    req.session.appVisibility[clientId] = !!isVisible;
  }

  // Invalidate apps cache so next load uses fresh settings
  if (req.session.appsCache) {
    req.session.appsCache.timestamp = 0;
  }

  res.json({ success: true, visibility: req.session.appVisibility });
});

/**
 * PUT /api-apps/test-mode - Save test mode settings
 * Stores in session and persists to Redis
 */
router.put('/test-mode', requireAuth, express.json(), async (req, res) => {
  const { testMode } = req.body;
  const { setAppTestModeSettings } = req.app.locals.redisHelpers;

  if (!testMode || typeof testMode !== 'object') {
    return res.status(400).json({ error: "Missing 'testMode' object in request body" });
  }

  const accountId = req.session?.accountInfo?.account_id || 'global';

  // Store in session for immediate use
  // CRITICAL: Create a completely new object to ensure express-session detects the change
  const newTestModeSettings = {};
  for (const [clientId, isTest] of Object.entries(testMode)) {
    newTestModeSettings[clientId] = !!isTest;
  }

  // Replace the entire appTestMode property
  req.session.appTestMode = newTestModeSettings;

  // Force express-session to recognize the session as modified
  req.session.touch();

  if (VERBOSE_LOGGING) console.log('[TEST-MODE] Saving test mode settings for account', accountId, ':', req.session.appTestMode);
  if (VERBOSE_LOGGING) console.log('[TEST-MODE] Test mode object keys:', Object.keys(req.session.appTestMode));

  // Persist to Redis for durability
  await setAppTestModeSettings(accountId, req.session.appTestMode);

  // Invalidate apps cache so next load uses fresh settings
  if (req.session.appsCache) {
    req.session.appsCache.timestamp = 0;
  }

  if (VERBOSE_LOGGING) console.log('[TEST-MODE] Settings saved to Redis and cache invalidated');
  if (VERBOSE_LOGGING) console.log('[TEST-MODE] Session ID:', req.sessionID);
  if (VERBOSE_LOGGING) console.log('[TEST-MODE] Session appTestMode before save:', req.session.appTestMode);

  // Save session to ensure changes persist
  req.session.save((err) => {
    if (err) {
      console.error('[TEST-MODE] Error saving session:', err);
      return res.status(500).json({ error: 'Failed to save session' });
    }
    if (VERBOSE_LOGGING) console.log('[TEST-MODE] Session save completed successfully');
    res.json({ success: true, testMode: req.session.appTestMode });
  });
});

/**
 * PUT /api-apps/:clientId/webhook-enabled - Toggle webhook for specific app
 * Saves to Redis for current user
 */
router.put('/:clientId/webhook-enabled', requireAuth, express.json(), async (req, res) => {
  const accountId = req.session?.accountInfo?.account_id;
  const { clientId } = req.params;
  const { enabled } = req.body;
  const { setAppWebhookEnabled } = req.app.locals.redisHelpers;

  if (!accountId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: "Invalid 'enabled' value - must be boolean" });
  }

  await setAppWebhookEnabled(accountId, clientId, enabled);
  if (VERBOSE_LOGGING) console.log(`[CALLBACK SETTING] Saved for app ${clientId}: ${enabled}`);
  res.json({ success: true, clientId, enabled });
});

/**
 * GET /api-apps/webhook-settings - Get callback settings for all API Apps
 * Returns per-app webhook enabled/disabled state from Redis
 * NOTE: This route MUST come before /:clientId to avoid clientId="webhook-settings"
 */
router.get('/webhook-settings', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const accountId = req.session?.accountInfo?.account_id;
  const { getAppWebhookSettings } = req.app.locals.redisHelpers;

  if (!accountId) {
    return res.json({});
  }

  const settings = await getAppWebhookSettings(accountId);
  res.json(settings);
});

/**
 * PUT /api-apps/webhook-settings - Batch update callback settings for all apps
 * Updates callback URLs on Dropbox Sign and saves settings to Redis
 * Prevents race condition by updating all apps at once
 * NOTE: This route MUST come before /:clientId to avoid clientId="webhook-settings"
 */
router.put('/webhook-settings', requireAuth, express.json(), async (req, res) => {
  const accountId = req.session?.accountInfo?.account_id;
  const { settings } = req.body;
  const redisClient = req.app.locals.redisClient;

  if (!accountId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: "Invalid settings object" });
  }

  try {
    // Get the callback URL from environment config
    const callbackUrl = process.env.CALLBACK_URL || '';

    if (!callbackUrl) {
      return res.status(400).json({
        error: 'CALLBACK_URL not configured in .env file. Please add CALLBACK_URL=https://your-domain.com/webhook to your .env file.'
      });
    }

    // Get current apps list to update callback URLs on Dropbox Sign
    const appsResponse = await apiCall(req, 'ApiAppApi', 'apiAppList', [1, 20], {
      method: 'GET',
      endpoint: '/api_app/list'
    });
    const apps = appsResponse.body?.apiApps || [];

    // Get current user's email for ownership check
    const currentUserEmail = req.session.accountInfo?.email_address?.toLowerCase();

    // For each app, set or clear the callback URL based on enabled state
    const updatePromises = [];
    const errors = [];

    for (const app of apps) {
      const clientId = app.clientId;

      // Only process apps that are in the settings object (user is modifying them)
      if (settings[clientId] === undefined) {
        continue; // Skip apps not in the request
      }

      const isEnabled = settings[clientId] !== false; // Default: enabled
      const currentCallbackUrl = app.callbackUrl || '';
      const ownerEmail = app.ownerAccount?.emailAddress?.toLowerCase();

      // Validate clientId format
      if (!clientId || typeof clientId !== 'string' || clientId.length !== 32) {
        console.error(`[CALLBACK] Invalid clientId format: "${clientId}" (length: ${clientId?.length || 0})`);
        errors.push(`Invalid client ID for app "${app.name}" - expected 32 characters, got ${clientId?.length || 0}`);
        continue;
      }

      // Check if user owns this app before allowing modifications
      if (currentUserEmail !== ownerEmail) {
        if (VERBOSE_LOGGING) console.log(`[CALLBACK] User ${currentUserEmail} attempted to modify app ${clientId} owned by ${ownerEmail} - blocked`);
        errors.push(`Cannot modify "${app.name}" - you don't own this app`);
        continue; // Skip this app
      }

      // Update callback URL on Dropbox Sign if state changed
      if (isEnabled && !currentCallbackUrl) {
        // Enable: Set callback URL from .env
        if (VERBOSE_LOGGING) console.log(`[CALLBACK] Enabling callbacks for app ${clientId} (${app.name}) - setting URL: ${callbackUrl}`);
        const updateReq = new DropboxSign.ApiAppUpdateRequest();
        updateReq.callbackUrl = callbackUrl;
        updatePromises.push(
          apiCall(req, 'ApiAppApi', 'apiAppUpdate', [clientId, updateReq], {
            method: 'PUT',
            endpoint: `/api_app/${clientId}`
          }).catch(err => {
            console.error(`[CALLBACK] Failed to set callback URL for ${clientId}:`, err.message);
            errors.push(`Failed to enable callbacks for "${app.name}": ${err.message}`);
          })
        );
      } else if (!isEnabled && currentCallbackUrl) {
        // Disable: Clear callback URL
        if (VERBOSE_LOGGING) console.log(`[CALLBACK] Disabling callbacks for app ${clientId} (${app.name}) - clearing URL`);
        const updateReq = new DropboxSign.ApiAppUpdateRequest();
        updateReq.callbackUrl = '';
        updatePromises.push(
          apiCall(req, 'ApiAppApi', 'apiAppUpdate', [clientId, updateReq], {
            method: 'PUT',
            endpoint: `/api_app/${clientId}`
          }).catch(err => {
            console.error(`[CALLBACK] Failed to clear callback URL for ${clientId}:`, err.message);
            errors.push(`Failed to disable callbacks for "${app.name}": ${err.message}`);
          })
        );
      }
    }

    // Wait for all API updates to complete
    await Promise.all(updatePromises);

    // Save webhook settings to Redis
    const key = `user:${accountId}:app_webhook_enabled`;
    await redisClient.set(key, JSON.stringify(settings));

    // Only force refresh if we actually made API updates (callback URLs changed)
    const shouldRefresh = updatePromises.length > 0;
    if (shouldRefresh && req.session.appsCache) {
      req.session.appsCache.timestamp = 0; // Invalidate cache
    }

    if (VERBOSE_LOGGING) console.log(`[WEBHOOK SETTINGS] Saved for user ${accountId}:`, settings);

    // Return response with any errors
    if (errors.length > 0) {
      res.json({ success: true, shouldRefresh, errors });
    } else {
      res.json({ success: true, shouldRefresh });
    }
  } catch (err) {
    console.error('[CALLBACK SETTINGS] Error updating webhook settings:', err);
    return res.status(500).json({ error: 'Failed to update webhook settings' });
  }
});

/**
 * GET /api-apps/:clientId - Get full details for a single API app
 * Fetches app details from Dropbox Sign
 */
router.get('/:clientId', requireAuth, async (req, res) => {
  const { clientId } = req.params;
  try {
    const response = await apiCall(req, 'ApiAppApi', 'apiAppGet', [clientId], {
      method: 'GET',
      endpoint: `/api_app/${clientId}`
    });
    const app = response.body?.apiApp;
    if (!app) throw new Error('No app in response');

    return res.json({
      clientId: app.clientId,
      name: app.name,
      callbackUrl: app.callbackUrl || '',
      domains: app.domains || [],
      isApproved: app.isApproved,
      canInsertEverywhere: app.options?.canInsertEverywhere || false,
      whiteLabelingOptions: app.whiteLabelingOptions || {},
      oauthScopes: app.oauth?.scopes || [],
      createdAt: app.createdAt,
    });
  } catch (err) {
    const statusCode = err.response?.status || err.statusCode || 500;
    const errorMsg = err?.body?.error?.errorMsg || err?.message || 'Failed to fetch app details';
    console.error(`Error in /api-apps/${clientId}: status=${statusCode}, message=${errorMsg}`, err);
    return res.status(statusCode).json({ error: errorMsg });
  }
});

/**
 * GET /api-apps/:clientId/logo - Proxy logo image with authentication
 * Fetches logo from Dropbox Sign and streams to client
 */
router.get('/:clientId/logo', requireAuth, async (req, res) => {
  const { clientId } = req.params;
  try {
    const encryptedApiKey = req.session.apiKey;
    if (!encryptedApiKey) {
      return res.status(401).send('Not authenticated');
    }

    const apiKey = decryptApiKey(encryptedApiKey);
    if (!apiKey) {
      return res.status(401).send('Failed to decrypt API key');
    }

    // Fetch logo from Dropbox Sign using the content endpoint (on app subdomain)
    const auth = Buffer.from(`${apiKey}:`).toString('base64');
    const options = {
      hostname: 'app.hellosign.com',
      path: `/content/viewCustomLogo/client_id/${clientId}`,
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`
      }
    };

    https.get(options, (apiRes) => {
      if (apiRes.statusCode === 404) {
        if (VERBOSE_LOGGING) console.log(`[LOGO] Logo not found for ${clientId}`);
        return res.status(404).send('Logo not found');
      }

      if (apiRes.statusCode !== 200) {
        // Collect error body for debugging
        let errorBody = '';
        apiRes.on('data', chunk => errorBody += chunk);
        apiRes.on('end', () => {
          console.error(`[LOGO] Failed to fetch logo for ${clientId}: ${apiRes.statusCode}`, errorBody);
          res.status(apiRes.statusCode).send('Failed to fetch logo');
        });
        return;
      }

      // Forward the image to the client
      res.set('Content-Type', apiRes.headers['content-type'] || 'image/png');
      res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      apiRes.pipe(res);
    }).on('error', (err) => {
      console.error(`[LOGO] HTTPS error fetching logo for ${clientId}:`, err.message);
      if (!res.headersSent) {
        res.status(500).send('Failed to fetch logo');
      }
    });
  } catch (err) {
    console.error(`Error in logo endpoint for ${clientId}:`, err?.message || err);
    res.status(500).send('Failed to fetch logo');
  }
});

/**
 * PUT /api-apps/:clientId - Update API app
 * Updates name, callback, domains, logo, white labeling
 */
const appLogoUpload = multer({ dest: os.tmpdir() });
router.put('/:clientId', requireAuth, appLogoUpload.single('custom_logo_file'), async (req, res) => {
  const { clientId } = req.params;
  if (VERBOSE_LOGGING) console.log(`[API APPS] PUT request for clientId: ${clientId}`);
  if (VERBOSE_LOGGING) console.log(`[API APPS] Request body:`, { name: req.body.name, domains: req.body.domains, callbackUrl: req.body.callbackUrl });
  try {
    const updateReq = new DropboxSign.ApiAppUpdateRequest();

    if (req.body.name) updateReq.name = req.body.name;
    if (req.body.callbackUrl !== undefined) updateReq.callbackUrl = req.body.callbackUrl;
    if (req.body.domains) {
      try {
        const parsedDomains = JSON.parse(req.body.domains);
        if (VERBOSE_LOGGING) console.log(`[API APPS] Parsed domains:`, parsedDomains);
        updateReq.domains = parsedDomains;
      } catch (_) {
        if (VERBOSE_LOGGING) console.log(`[API APPS] Failed to parse domains:`, req.body.domains);
      }
    }
    // Set canInsertEverywhere in options
    if (req.body.canInsertEverywhere !== undefined) {
      const opts = new DropboxSign.SubOptions();
      opts.canInsertEverywhere = req.body.canInsertEverywhere === '1';
      updateReq.options = opts;
    }

    // Set whiteLabelingOptions at top level (not nested under options)
    if (req.body.white_labeling_options) {
      try {
        const wlOpts = JSON.parse(req.body.white_labeling_options);
        const wl = new DropboxSign.SubWhiteLabelingOptions();
        Object.assign(wl, wlOpts);
        updateReq.whiteLabelingOptions = wl;
      } catch (_) {}
    }
    if (req.file) {
      updateReq.customLogoFile = fs.createReadStream(req.file.path);
    }

    if (VERBOSE_LOGGING) console.log(`[API APPS] Sending update request:`, JSON.stringify(updateReq, null, 2));

    const response = await apiCall(req, 'ApiAppApi', 'apiAppUpdate', [clientId, updateReq], {
      method: 'PUT',
      endpoint: `/api_app/${clientId}`
    });

    if (req.file) try { fs.unlinkSync(req.file.path); } catch (_) {}

    // Invalidate apps cache so next list fetch picks up changes
    if (req.session.appsCache) {
      req.session.appsCache.timestamp = 0;
      if (VERBOSE_LOGGING) console.log(`[API APPS] Cache invalidated for session`);
    }

    const app = response.body?.apiApp;
    const warnings = response.body?.warnings || [];
    if (VERBOSE_LOGGING) console.log(`[API APPS] Update successful. Returned domains:`, app?.domains);
    if (warnings.length > 0) {
      if (VERBOSE_LOGGING) console.log(`[API APPS] API warnings:`, warnings);
    }

    // Save session to persist cache invalidation
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error(`[API APPS] Session save failed:`, err);
          reject(err);
        } else {
          if (VERBOSE_LOGGING) console.log(`[API APPS] Session saved successfully`);
          resolve();
        }
      });
    });

    return res.json({
      success: true,
      clientId: app?.clientId || clientId,
      name: app?.name,
      callbackUrl: app?.callbackUrl || '',
      domains: app?.domains || [],
      whiteLabelingOptions: app?.whiteLabelingOptions || {},
      warnings: warnings.map(w => w.warningMsg || w.warningName).filter(Boolean),
    });
  } catch (err) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch (_) {}
    // The SDK may nest errors in different places — try all of them
    let rawMsg = err?.body?.error?.errorMsg
      || err?.response?.body?.error?.error_msg
      || err?.body?.error?.error_msg
      || null;
    // Try parsing the response body if it's a string
    if (!rawMsg && err?.response?.text) {
      try {
        const parsed = JSON.parse(err.response.text);
        rawMsg = parsed?.error?.error_msg || parsed?.error?.errorMsg || null;
      } catch (_) {}
    }
    // rawMsg can be an array, or a string that looks like a JSON array
    if (typeof rawMsg === 'string' && rawMsg.startsWith('[')) {
      try { rawMsg = JSON.parse(rawMsg); } catch (_) {}
    }
    let errorMsg;
    if (Array.isArray(rawMsg)) {
      errorMsg = rawMsg.map(e => {
        if (e.error_type === 'invalid_contrast_ratio') {
          const names = (e.element_name || '').split(' and ').map(n => n.replace(/_/g, ' ')).join(' and ');
          return `Insufficient contrast between ${names}`;
        }
        return e.error_type || JSON.stringify(e);
      }).join('; ');
    } else if (typeof rawMsg === 'string') {
      errorMsg = rawMsg;
    } else {
      errorMsg = err?.message || 'Failed to update app';
    }
    console.error(`Error in PUT /api-apps/${clientId}:`, errorMsg);
    return res.status(500).json({ error: errorMsg });
  }
});

/**
 * DELETE /api-apps/:clientId - Delete API app
 * Removes app from Dropbox Sign
 */
router.delete('/:clientId', requireAuth, async (req, res) => {
  const { clientId } = req.params;

  if (VERBOSE_LOGGING) console.log(`[API APPS] DELETE request for clientId: ${clientId}`);

  try {
    // Delete the app via Dropbox Sign API
    if (VERBOSE_LOGGING) console.log(`[API APPS] Calling apiAppDelete for: ${clientId}`);
    const response = await apiCall(req, 'ApiAppApi', 'apiAppDelete', [clientId], {
      method: 'DELETE',
      endpoint: `/api_app/${clientId}`
    });

    if (VERBOSE_LOGGING) console.log(`[API APPS] Successfully deleted app: ${clientId}`);

    // Invalidate cache
    if (req.session.appsCache) {
      req.session.appsCache.timestamp = 0;
    }

    res.json({ success: true, message: 'App deleted successfully' });
  } catch (err) {
    const errorMsg = err.body?.error?.errorMsg || err.message || 'Unknown error';
    const statusCode = err.response?.status || err.statusCode || 500;
    console.error(`[API APPS] Error deleting ${clientId}: status=${statusCode}, error=${errorMsg}`);

    return res.status(statusCode).json({ error: errorMsg });
  }
});

export default router;
