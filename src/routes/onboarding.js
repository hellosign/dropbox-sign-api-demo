// src/routes/onboarding.js
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import * as DropboxSign from '@dropbox/sign';
import { requireAuth } from '../middleware/auth.js';
import { strictLimiter } from '../middleware/rate-limit.js';
import { apiCall } from '../services/dropbox-sign.js';
import { VERBOSE_LOGGING } from '../config/security.js';

const router = Router();

// Onboarding app presets (imported from server.js)
const onboardingAppPresets = [
  {
    namePrefix: 'acme-app',
    domains: ['${DOMAIN}'],
    callbackUrl: null,
    oauthCallbackUrl: null,
    oauthScopes: [],
    logoFile: 'acme-logo.png'
  },
  {
    namePrefix: 'hanford-app',
    domains: ['${DOMAIN}'],
    callbackUrl: '${CALLBACK_URL}',
    oauthCallbackUrl: null,
    oauthScopes: [],
    logoFile: 'hanford-logo.png'
  }
];

/**
 * POST /onboarding/create-apps - Create preset demo apps for first-time users
 * Creates 3 demo API apps with preset configurations for onboarding
 */
router.post('/onboarding/create-apps', strictLimiter, requireAuth, async (req, res) => {
  const redisClient = req.app.locals.redisClient;
  const { setOnboardingStatus, getAppTestModeSettings, setAppTestModeSettings, getAppWebhookSettings } = req.app.locals.redisHelpers;
  const accountId = req.session.accountInfo?.account_id;

  if (!accountId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  console.log(`[ONBOARDING] Creating demo apps for account ${accountId}`);

  try {
    const createdApps = [];
    const errors = [];
    const warnings = [];

    // Track which presets have callback URLs to configure webhooks later
    const presetsWithCallbacks = new Map(); // Map of appName -> hasCallback

    // Detect if we're in localhost mode (no DOMAIN configured)
    const isLocalhostMode = !process.env.DOMAIN && !process.env.CALLBACK_URL;

    // Create apps from presets
    for (const preset of onboardingAppPresets) {
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const appName = `${preset.namePrefix}-${randomSuffix}`;

      // Replace ${CALLBACK_URL} placeholder with env var
      let callbackUrl = preset.callbackUrl;
      if (callbackUrl && callbackUrl.includes('${CALLBACK_URL}')) {
        callbackUrl = callbackUrl.replace('${CALLBACK_URL}', process.env.CALLBACK_URL || 'http://localhost:3001/webhook');
      }

      // Replace ${OAUTH_REDIRECT_URI} in OAuth callback URL
      let oauthCallbackUrl = preset.oauthCallbackUrl;
      if (oauthCallbackUrl && oauthCallbackUrl.includes('${OAUTH_REDIRECT_URI}')) {
        oauthCallbackUrl = oauthCallbackUrl.replace('${OAUTH_REDIRECT_URI}', process.env.OAUTH_REDIRECT_URI || '');
      }
      // Fallback: if no OAUTH_REDIRECT_URI set, don't enable OAuth
      if (oauthCallbackUrl && !process.env.OAUTH_REDIRECT_URI) {
        console.warn(`[ONBOARDING] Skipping OAuth for ${appName} - OAUTH_REDIRECT_URI not set in environment`);
        oauthCallbackUrl = null;
      }

      // Track if this preset has a callback URL
      presetsWithCallbacks.set(appName, !!callbackUrl);

      try {
        // Replace ${DOMAIN} placeholder in domains
        let domains = preset.domains.map(domain => {
          if (domain.includes('${DOMAIN}')) {
            // Try to get domain from DOMAIN env var, or extract from CALLBACK_URL
            let actualDomain = process.env.DOMAIN;
            if (!actualDomain && process.env.CALLBACK_URL) {
              try {
                const url = new URL(process.env.CALLBACK_URL);
                actualDomain = url.hostname;
              } catch (err) {
                console.warn('[ONBOARDING] Could not parse CALLBACK_URL for domain');
              }
            }

            // If still no domain, detect current environment and use localhost
            if (!actualDomain) {
              actualDomain = 'localhost';
              console.warn(`[ONBOARDING] No DOMAIN configured - using localhost for ${appName} (callbacks will be disabled)`);
            }

            return domain.replace('${DOMAIN}', actualDomain);
          }
          return domain;
        });

        // Don't filter out localhost - Dropbox Sign allows it for local development
        // domains = domains.filter(d => d !== 'localhost');

        const appData = new DropboxSign.ApiAppCreateRequest();
        appData.name = appName;
        appData.domains = domains;

        console.log(`[ONBOARDING] Creating ${appName} with domains:`, domains);

        // Only set callback URL if not in localhost mode
        if (callbackUrl && !isLocalhostMode) {
          appData.callbackUrl = callbackUrl;
        } else if (callbackUrl && isLocalhostMode) {
          console.warn(`[ONBOARDING] Skipping callback URL for ${appName} - localhost mode (no DOMAIN configured)`);
        }

        // Configure OAuth if scopes are defined
        if (preset.oauthScopes && preset.oauthScopes.length > 0 && oauthCallbackUrl) {
          appData.oauth = {
            callbackUrl: oauthCallbackUrl,
            scopes: preset.oauthScopes
          };
        }

        if (VERBOSE_LOGGING) console.log(`[ONBOARDING] Attempting to create ${appName} with domains:`, domains, 'webhookCallback:', callbackUrl, 'oauthCallback:', oauthCallbackUrl || 'none');
        const result = await apiCall(req, 'ApiAppApi', 'apiAppCreate', [appData], {
          method: 'POST',
          endpoint: '/api_app'
        });
        const createdApp = result.body.apiApp;
        createdApps.push(createdApp);
        if (VERBOSE_LOGGING) console.log(`[ONBOARDING] Created ${appName} from preset ${preset.namePrefix}`);

        // Attach logo AFTER app creation (more reliable than during creation)
        if (preset.logoFile && createdApp.clientId) {
          const logoPath = path.join(process.cwd(), 'public', preset.logoFile);

          if (fs.existsSync(logoPath)) {
            try {
              const updateReq = new DropboxSign.ApiAppUpdateRequest();
              updateReq.customLogoFile = fs.createReadStream(logoPath);
              await apiCall(req, 'ApiAppApi', 'apiAppUpdate', [createdApp.clientId, updateReq], {
                method: 'PUT',
                endpoint: `/api_app/${createdApp.clientId}`
              });
              console.log(`[ONBOARDING] Logo attached to ${appName}`);
            } catch (logoErr) {
              console.warn(`[ONBOARDING] Logo upload failed for ${appName}:`, logoErr.message);
              // App already created, logo failure is non-critical
            }
          } else {
            console.warn(`[ONBOARDING] Logo file not found: ${logoPath}`);
          }
        }
      } catch (err) {
        console.error(`[ONBOARDING] Failed to create ${appName}:`, err.message);
        console.error(`[ONBOARDING] Full error:`, err);
        if (err.body) {
          console.error(`[ONBOARDING] Error body:`, JSON.stringify(err.body));
        }

        // Check for environment configuration error first
        if (err.message && err.message.includes('DOMAIN or CALLBACK_URL')) {
          errors.push({
            app: appName,
            error: 'Server configuration error - DOMAIN environment variable not set',
            isConfigError: true
          });
          continue; // Skip to next app
        }

        // Extract meaningful error message
        const errorName = err?.body?.error?.errorName;
        const errorMsg = err?.body?.error?.errorMsg || err.message;
        const statusCode = err?.statusCode;

        // Special handling for logo-related errors
        if (errorName === 'invalid_contrast_ratio') {
          errors.push({
            app: appName,
            error: 'Logo contrast ratio insufficient - app created without logo',
            warning: true // Mark as non-critical
          });
        } else if (errorName === 'feature_not_available' || errorName === 'upgrade_required') {
          errors.push({
            app: appName,
            error: 'API Apps feature not available on your plan. Please upgrade your Dropbox Sign account.',
            isPlanRestriction: true
          });
        } else if (statusCode === 403 || errorName === 'forbidden' || errorName === 'unauthorized') {
          // 403 or permission errors likely mean account doesn't have API app creation permission
          errors.push({
            app: appName,
            error: 'Permission denied - API Apps may not be available on your plan',
            isPlanRestriction: true
          });
        } else if (errorMsg === 'HTTP request failed' || statusCode >= 500) {
          // Generic HTTP errors or server errors - likely a plan or permission issue
          errors.push({
            app: appName,
            error: 'Unable to create app - check account permissions',
            isPlanRestriction: true
          });
        } else if (errorMsg && errorMsg.toLowerCase().includes('invalid hostname')) {
          // Invalid hostname error - likely environment misconfiguration
          errors.push({
            app: appName,
            error: `Invalid hostname (${domains.join(', ')}) - server may be misconfigured`,
            isConfigError: true
          });
        } else if (errorMsg && (errorMsg.toLowerCase().includes('no domain specified') || errorMsg.toLowerCase().includes('domain') && errorMsg.toLowerCase().includes('required'))) {
          errors.push({
            app: appName,
            error: 'No domain configured. Set the DOMAIN environment variable (e.g. "example.com") in your .env file.',
            isConfigError: true
          });
        } else if (errorMsg && errorMsg.toLowerCase().includes('callback_url') && errorMsg.toLowerCase().includes('https')) {
          errors.push({
            app: appName,
            error: 'Callback URL must be a valid HTTPS URL. Set CALLBACK_URL in your .env file (e.g. "https://yourdomain.com/webhook").',
            isConfigError: true
          });
        } else {
          errors.push({ app: appName, error: errorMsg });
        }
      }
    }

    // Enable test mode for created apps
    if (createdApps.length > 0 && redisClient) {
      try {
        const testModeSettings = await getAppTestModeSettings(accountId) || {};
        createdApps.forEach(app => {
          testModeSettings[app.clientId] = true;
        });
        await setAppTestModeSettings(accountId, testModeSettings);
        if (VERBOSE_LOGGING) console.log(`[ONBOARDING] Enabled test mode for ${createdApps.length} demo apps`);
      } catch (err) {
        console.error('[ONBOARDING] Failed to enable test mode:', err);
      }
    }

    // Configure webhook settings - only enable for apps with callback URLs
    if (createdApps.length > 0 && redisClient) {
      try {
        const webhookSettings = await getAppWebhookSettings(accountId) || {};
        createdApps.forEach(app => {
          // Check if this app had a callback URL in its preset
          const appName = app.name;
          const hasCallback = presetsWithCallbacks.get(appName);
          webhookSettings[app.clientId] = hasCallback === true;
        });
        const key = `user:${accountId}:app_webhook_enabled`;
        await redisClient.set(key, JSON.stringify(webhookSettings));
        if (VERBOSE_LOGGING) console.log(`[ONBOARDING] Configured webhook settings for ${createdApps.length} demo apps`);
      } catch (err) {
        console.error('[ONBOARDING] Failed to configure webhook settings:', err);
      }
    }

    // Mark onboarding as completed
    await setOnboardingStatus(accountId, 'completed', req.session);

    // Invalidate API apps cache so new apps appear immediately
    if (req.session.appsCache) {
      req.session.appsCache.timestamp = 0;
    }

    // Return results
    if (createdApps.length > 0) {
      res.json({
        success: true,
        created: createdApps.length,
        apps: createdApps.map(a => ({ clientId: a.clientId, name: a.name })),
        errors: errors.length > 0 ? errors : undefined,
        isLocalhostMode,
        localhostWarning: isLocalhostMode
          ? 'Apps created successfully in localhost mode. Callback webhooks are disabled because DOMAIN is not configured. To enable callbacks, set DOMAIN and CALLBACK_URL in your .env file and restart.'
          : undefined
      });
    } else {
      // Check if all errors are plan restrictions or config errors
      const isPlanRestriction = errors.every(e => e.isPlanRestriction);
      const isConfigError = errors.some(e => e.isConfigError);

      res.status(isPlanRestriction ? 403 : isConfigError ? 500 : 500).json({
        error: isPlanRestriction
          ? 'Dropbox Sign didn\'t allow us to create demo apps for your account.'
          : isConfigError
          ? 'Environment Configuration Required'
          : 'Failed to create demo apps',
        message: isPlanRestriction
          ? 'This usually means your account is on a "per user" plan instead of an "API" plan. API Apps can only be created on API-enabled plans.'
          : isConfigError
          ? 'API apps could not be created because required environment variables are not configured. Set DOMAIN (e.g. "example.com") and CALLBACK_URL (must be HTTPS, e.g. "https://example.com/webhook") in your .env file, then restart the server.'
          : 'Unable to create demo apps. Please check the details below.',
        suggestion: isPlanRestriction
          ? 'You can still use this portal with any existing API apps in your account. To create new API apps, contact Dropbox Sign support to upgrade to an API plan.'
          : isConfigError
          ? 'You can skip this step and use existing API apps in your account, or configure the environment variables and try again.'
          : null,
        details: errors,
        isPlanRestriction,
        isConfigError
      });
    }
  } catch (err) {
    console.error('[ONBOARDING] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /onboarding/dismiss - User skipped onboarding
 * Marks onboarding as dismissed so it doesn't show again
 */
router.post('/onboarding/dismiss', requireAuth, async (req, res) => {
  const { setOnboardingStatus } = req.app.locals.redisHelpers;
  const accountId = req.session.accountInfo?.account_id;

  if (!accountId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  await setOnboardingStatus(accountId, 'dismissed', req.session);
  console.log(`[ONBOARDING] User ${accountId} dismissed onboarding`);
  res.json({ success: true });
});

/**
 * POST /onboarding/reset-data - Clear all user data and start fresh
 * Deletes all user-specific Redis keys and resets onboarding status
 */
router.post('/onboarding/reset-data', requireAuth, async (req, res) => {
  const redisClient = req.app.locals.redisClient;
  const { setOnboardingStatus } = req.app.locals.redisHelpers;
  const accountId = req.session.accountInfo?.account_id;

  if (!accountId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    console.log(`[ONBOARDING] Clearing all data for account ${accountId}`);

    // Clear all user-specific Redis keys
    const keysToDelete = [
      `user:${accountId}:themes`,
      `user:${accountId}:settings`,
      `user:${accountId}:api_logs`,
      `user:${accountId}:app_test_mode`,
      `user:${accountId}:onboarding_status`
    ];

    for (const key of keysToDelete) {
      const deleted = await redisClient.del(key);
      if (deleted) {
        console.log(`[ONBOARDING] Deleted key: ${key}`);
      }
    }

    // Reset onboarding status to pending so they see first-time flow
    await setOnboardingStatus(accountId, 'pending', req.session);

    console.log(`[ONBOARDING] Successfully cleared all data for ${accountId}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`[ONBOARDING] Failed to clear data for ${accountId}:`, err);
    res.status(500).json({ error: 'Failed to clear data' });
  }
});

export default router;
