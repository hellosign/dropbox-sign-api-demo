// src/routes/settings.js
import { Router } from 'express';
import express from 'express';
import * as DropboxSign from '@dropbox/sign';
import { requireAuth } from '../middleware/auth.js';
import { apiCall } from '../services/dropbox-sign.js';

const router = Router();

/**
 * GET /settings - Get settings for current user
 * Returns per-user settings from Redis
 */
router.get('/', requireAuth, async (req, res) => {
  // Prevent browser caching of user-specific data
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const accountId = req.session?.accountInfo?.account_id || 'global';
  const { getSettings } = req.app.locals.redisHelpers;

  const userSettings = await getSettings(accountId);
  res.json(userSettings);
});

/**
 * PUT /settings - Update settings for current user
 * Saves settings to Redis
 */
router.put('/', requireAuth, express.json(), async (req, res) => {
  const accountId = req.session?.accountInfo?.account_id || 'global';
  const { settings } = req.body;
  const { setSettings, getSettings } = req.app.locals.redisHelpers;

  console.log('[PUT /settings] Request received:', { accountId, settings, body: req.body });

  if (!settings || typeof settings !== 'object') {
    console.log('[PUT /settings] Invalid settings:', { settings, typeofSettings: typeof settings });
    return res.status(400).json({ error: "Missing 'settings' object in request body" });
  }

  try {
    await setSettings(accountId, settings);
    const updatedSettings = await getSettings(accountId);
    console.log('[PUT /settings] Settings updated successfully:', { accountId, updatedSettings });
    res.json({ success: true, settings: updatedSettings });
  } catch (error) {
    console.error('[PUT /settings] Error saving settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

/**
 * PUT /settings/selected-api-app - Save selected API app
 * Hidden setting, not shown in Settings UI
 */
router.put('/selected-api-app', requireAuth, express.json(), async (req, res) => {
  const accountId = req.session?.accountInfo?.account_id || 'global';
  const { clientId } = req.body;
  const { setSettings } = req.app.locals.redisHelpers;

  if (typeof clientId !== 'string') {
    return res.status(400).json({ error: "Invalid clientId" });
  }

  await setSettings(accountId, { selectedApiApp: clientId });
  res.json({ success: true });
});

/**
 * PUT /settings/selected-theme - Save selected theme
 * Replaces the defaultTheme setting
 */
router.put('/selected-theme', requireAuth, express.json(), async (req, res) => {
  const accountId = req.session?.accountInfo?.account_id || 'global';
  const { themeId } = req.body;
  const { setSettings } = req.app.locals.redisHelpers;

  if (typeof themeId !== 'string') {
    return res.status(400).json({ error: "Invalid themeId" });
  }

  await setSettings(accountId, { selectedTheme: themeId });
  res.json({ success: true });
});

/**
 * PUT /settings/selected-document-mode - Save selected document mode
 */
router.put('/selected-document-mode', requireAuth, express.json(), async (req, res) => {
  const accountId = req.session?.accountInfo?.account_id || 'global';
  const { mode } = req.body;
  const { setSettings } = req.app.locals.redisHelpers;

  if (typeof mode !== 'string') {
    return res.status(400).json({ error: "Invalid mode" });
  }

  await setSettings(accountId, { selectedDocumentMode: mode });
  res.json({ success: true });
});

/**
 * PUT /settings/selected-template - Save selected template
 */
router.put('/selected-template', requireAuth, express.json(), async (req, res) => {
  const accountId = req.session?.accountInfo?.account_id || 'global';
  const { templateId } = req.body;
  const { setSettings } = req.app.locals.redisHelpers;

  if (typeof templateId !== 'string') {
    return res.status(400).json({ error: "Invalid templateId" });
  }

  await setSettings(accountId, { selectedTemplate: templateId });
  res.json({ success: true });
});

/**
 * POST /settings/locale - Save user's language preference
 * Updates session and persists to Redis
 */
router.post('/locale', requireAuth, express.json(), async (req, res) => {
  const { locale } = req.body;
  const ALLOWED_LOCALES = ['en', 'es', 'ja'];

  console.log('[Locale Switch] Received request:', { locale, body: req.body });

  // Validate locale
  if (!locale || !ALLOWED_LOCALES.includes(locale)) {
    console.log('[Locale Switch] Invalid locale:', locale);
    return res.status(400).json({ error: 'Invalid locale', allowed: ALLOWED_LOCALES });
  }

  // Save to session for immediate use
  if (!req.session.preferences) req.session.preferences = {};
  req.session.preferences.locale = locale;
  console.log('[Locale Switch] Saved to session:', req.session.preferences);

  // Persist to Redis for long-term storage
  const accountId = req.session?.accountInfo?.account_id || 'global';
  const { setSettings } = req.app.locals.redisHelpers;
  await setSettings(accountId, { locale });
  console.log('[Locale Switch] Saved to Redis for account:', accountId);

  res.json({ success: true, locale });
});

export default router;
