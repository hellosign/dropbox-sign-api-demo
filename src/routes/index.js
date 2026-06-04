// src/routes/index.js
import { Router } from 'express';
import express from 'express';
import i18n from 'i18n';
import { requireAuth, requireSession } from '../middleware/auth.js';
import { TEMPLATE_IDS, CLIENT_ID, ADMIN_EMAILS } from '../config/constants.js';
import { recordEvent } from '../services/events.js';
import { generatePdfFromMarkdown } from '../services/pdf-generator.js';

const router = Router();

// SSE clients map - will be accessed from app.locals
let sseClients;

/**
 * Initialize SSE clients map
 * @param {Map} clients - SSE clients map from server.js
 */
export function initSSE(clients) {
  sseClients = clients;
}

/**
 * GET /api/csrf-token - Get CSRF token
 * Returns CSRF token for form protection
 */
router.get('/api/csrf-token', (req, res) => {
  const { generateCsrfToken } = req.app.locals.securityHelpers || {};
  if (!generateCsrfToken) {
    // Fallback if not available in app.locals
    return res.json({ token: '' });
  }
  const token = generateCsrfToken(req, res);
  res.json({ token });
});

/**
 * GET /events/stream - Server-Sent Events endpoint
 * Provides real-time updates to authenticated users
 */
router.get('/events/stream', requireSession, (req, res) => {
  const accountId = req.session?.accountInfo?.account_id;

  if (!accountId) {
    return res.status(401).end();
  }

  // Write status code and headers immediately
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no", // Disable nginx buffering
  });

  // Send initial comment to establish connection (required for some proxies/browsers)
  res.write(": connected\n\n");

  // heartbeat every 15s to keep ngrok/proxies from timing out
  const interval = setInterval(() => res.write(":\n\n"), 15000);

  // Add client to per-user set
  const sseClients = req.app.locals.sseClients;
  if (!sseClients.has(accountId)) {
    sseClients.set(accountId, new Set());
  }
  sseClients.get(accountId).add(res);

  req.on("close", () => {
    clearInterval(interval);
    const userClients = sseClients.get(accountId);
    if (userClients) {
      userClients.delete(res);
      if (userClients.size === 0) {
        sseClients.delete(accountId);
      }
    }
  });
});

/**
 * GET /webhook-events - Get callback events for current user
 * Returns webhook events from Redis (multi-tenant)
 */
router.get('/webhook-events', requireSession, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const accountId = req.session?.accountInfo?.account_id;
  const { getWebhookEvents } = req.app.locals.redisHelpers;

  if (!accountId) {
    return res.json({});
  }

  // Read from Redis instead of session
  const webhookEvents = await getWebhookEvents(accountId);

  res.json(webhookEvents);
});

/**
 * GET /templates - Get template list from .env
 * Returns only the IDs from .env along with friendly titles
 */
router.get('/templates', requireSession, (req, res) => {
  // templateMap is stored in app.locals
  const templateMap = req.app.locals.templateMap || {};

  const list = TEMPLATE_IDS.map((id) => {
    const entry = templateMap[id];
    return {
      id,
      title: (typeof entry === 'object' ? entry.title : entry) || id,
      theme: (typeof entry === 'object' ? entry.theme : null),
    };
  });
  res.json(list);
});

/**
 * GET /document-templates - Get document templates
 * Returns available document templates for markdown-based signing
 */
router.get('/document-templates', (req, res) => {
  // documentTemplates is stored in app.locals
  const documentTemplates = req.app.locals.documentTemplates || [];
  res.json(documentTemplates);
});

/**
 * Helper function to replace field placeholders in markdown
 */
function replaceFieldPlaceholders(md, fields) {
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

/**
 * GET / - Home page
 * Renders main application interface
 */
router.get('/', requireSession, async (req, res) => {
  const accountId = req.session?.accountInfo?.account_id || 'global';
  const { getSettings, getThemes, getFormFieldsDefaults, getOnboardingStatus, hasExistingData } = req.app.locals.redisHelpers;

  // Check for existing data BEFORE seeding with getSettings/getThemes
  const userHasExistingData = await hasExistingData(accountId);

  const userSettings = await getSettings(accountId);
  const userThemes = await getThemes(accountId, req.session);
  // Use selectedTheme for session persistence, fallback to defaultTheme (legacy), then first theme
  const defaultThemeId = (userSettings.selectedTheme && userThemes[userSettings.selectedTheme])
    ? userSettings.selectedTheme
    : (userSettings.defaultTheme && userThemes[userSettings.defaultTheme])
    ? userSettings.defaultTheme
    : Object.keys(userThemes)[0];
  const t = userThemes[defaultThemeId];

  const secondSigner = t.sections.left.secondSigner || {};
  const userFormFields = await getFormFieldsDefaults(accountId);

  // Check if user is admin
  const userEmail = req.session.accountInfo?.email_address?.toLowerCase();
  const isAdmin = ADMIN_EMAILS.includes(userEmail);

  // Get and clear API key rotation notice
  const apiKeyRotationNotice = req.session.apiKeyRotationNotice;
  delete req.session.apiKeyRotationNotice;

  // Check onboarding status
  const onboardingStatus = await getOnboardingStatus(accountId, req.session);
  const showOnboarding = onboardingStatus === 'pending';

  // Check if user has Dropbox Sign admin role (role code 'a')
  const isTeamAdmin = req.session.accountInfo?.role_code === 'a';

  res.render('index', {
    title: 'Sign API Portal',
    apiKeyConfigured: !!req.session.accountInfo,
    userEmail: req.session.accountInfo?.email_address,
    isAdmin: isAdmin,
    isTeamAdmin: isTeamAdmin,
    apiKeyRotationNotice: apiKeyRotationNotice,
    showOnboarding: showOnboarding,
    hasExistingData: userHasExistingData,
    clientId: process.env.CLIENT_ID,
    themes: JSON.stringify(userThemes),
    formFieldsDefaults: JSON.stringify(userFormFields),
    portalSettings: JSON.stringify({
      selectedApiApp: userSettings.selectedApiApp || '',
      selectedTheme: userSettings.selectedTheme || '',
      selectedDocumentMode: userSettings.selectedDocumentMode || '',
      selectedTemplate: userSettings.selectedTemplate || '',
      fullscreenSigning: userSettings.fullscreenSigning,
      smsDeliveryEnabled: userSettings.smsDeliveryEnabled,
      logoOnTextTags: userSettings.logoOnTextTags,
      showFeedbackWidget: userSettings.showFeedbackWidget !== false, // default to true
    }),
    selectedApiApp: userSettings.selectedApiApp || '',
    defaultThemeId,
    pageTitle: t.pageTitle,
    tabLabel: t.tabLabel,
    leftSectionTitle: t.sections.left.title,
    rightSectionTitle: t.sections.right.title,
    nameLabel: t.sections.left.fields[0].label,
    emailLabel: t.sections.left.fields[1].label,
    name: t.sections.left.fields[0].defaultValue,
    email: t.sections.left.fields[1].defaultValue,
    secondNameLabel: t.sections.left.fields[2]?.label || res.locals.__('form.label.signer_name'),
    name2: secondSigner.name || '',
    secondEmailLabel: t.sections.left.fields[3]?.label || res.locals.__('form.label.signer_email'),
    email2: secondSigner.email || '',
    field1Label: t.sections.right.fields[0].label,
    field2Label: t.sections.right.fields[1].label,
    field3Label: t.sections.right.fields[2].label,
    field1: t.sections.right.fields[0].defaultValue,
    field2: t.sections.right.fields[1].defaultValue,
    field3: t.sections.right.fields[2].defaultValue,
    sendBtnText: res.locals.__('buttons.send_signature_template'),
    previewBtnText: t.buttons.preview,
    embedBtnText: res.locals.__('buttons.view_sign_embedded'),
  });
});

/**
 * POST /preview-document - Generate PDF from markdown
 * Creates a PDF preview from markdown content with optional logo
 */
router.post('/preview-document', express.urlencoded({ extended: false }), async (req, res) => {
  const { markdownContent, signerName1, signerEmail1, field1, field2, field3, stripTextTags, logoEnabled } = req.body;

  if (!markdownContent) {
    return res.status(400).send('No markdown content provided.');
  }

  try {
    let filledMd = replaceFieldPlaceholders(markdownContent, {
      name: signerName1, email: signerEmail1, field1, field2, field3
    });

    // Strip Dropbox Sign text tags when used in form-fields mode
    if (stripTextTags === 'true') {
      filledMd = filledMd.replace(/\[(sig|initial|date|cb|text)\|\w+\|\w+(?:\|[^\]]*)?\]/g, '');
    }

    const templateData = {
      logoEnabled: logoEnabled !== 'false' && logoEnabled !== false
    };

    const pdfBytes = await generatePdfFromMarkdown(filledMd, templateData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="document_preview.pdf"');
    return res.send(pdfBytes);
  } catch (err) {
    console.error('Error generating document preview:', err);
    return res.status(500).send('Could not generate document preview');
  }
});

/**
 * Catch-all route - Redirect to home
 * Must be registered last
 */
router.get('*', (req, res) => {
  res.redirect('/');
});

export default router;
