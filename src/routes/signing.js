// src/routes/signing.js
// Signing-related routes: signature requests, embedded signing, templates, unclaimed drafts

import { Router } from 'express';
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import * as DropboxSign from '@dropbox/sign';
import { requireAuth } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rate-limit.js';
import { apiCall } from '../services/dropbox-sign.js';
import { generatePdfFromMarkdown } from '../services/pdf-generator.js';
import { replaceFieldPlaceholders } from '../utils/validation.js';
import { buildRequestDetail } from '../utils/logging.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Multer configurations for file uploads
const autoAppendUpload = multer({ dest: os.tmpdir() });
const embeddedAutoUpload = multer({ dest: os.tmpdir() });
const unclaimedUpload = multer({ dest: os.tmpdir() });

// Helper function to get test mode for a client ID
async function getTestMode(clientId, req = null) {
  // Priority 1: Check Redis storage. Save updates can race with other
  // session-mutating requests, so Redis is the durable source of truth.
  if (req?.app?.locals?.redisHelpers) {
    const accountId = req?.session?.accountInfo?.account_id || 'global';
    const redisTestMode = await req.app.locals.redisHelpers.getAppTestModeSettings(accountId);
    if (redisTestMode && redisTestMode[clientId] !== undefined) {
      if (req.session) {
        req.session.appTestMode = redisTestMode;
      }
      return redisTestMode[clientId];
    }
  }

  // Priority 2: Check session fallback for environments without Redis.
  if (req?.session?.appTestMode?.[clientId] !== undefined) {
    return req.session.appTestMode[clientId];
  }

  // Default: true (test mode) - allows skipDomainVerification for demos
  return true;
}

// Helper function to get themes for an account (accesses Redis via req.app.locals)
async function getThemes(accountId, redisClient) {
  if (!redisClient) {
    // Load default themes from config/themes.json when Redis unavailable
    const themesPath = path.join(__dirname, '../../config/themes.json');
    const defaultThemes = JSON.parse(fs.readFileSync(themesPath, 'utf8'));
    return defaultThemes;
  }

  const key = `user:${accountId}:themes`;
  const cached = await redisClient.get(key);

  if (cached) {
    return JSON.parse(cached);
  }

  // First-time: load default themes from config
  const themesPath = path.join(__dirname, '../../config/themes.json');
  const defaultThemes = JSON.parse(fs.readFileSync(themesPath, 'utf8'));
  return defaultThemes;
}

// Helper function to register signature request to user (multi-tenant routing)
async function registerSignatureRequest(signatureRequestId, accountId, email, apiAppId, redisClient) {
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

// Helper function to record events (uses Redis via req.app.locals.redisHelpers)
function recordEvent(sigReqId, eventType, signerEmail, redisHelpers) {
  if (redisHelpers && redisHelpers.recordEvent) {
    redisHelpers.recordEvent(sigReqId, eventType, signerEmail);
  }
}

// Helper function to save warnings (uses Redis via req.app.locals.redisHelpers)
function saveWarnings(sigReqId, warnings, redisHelpers) {
  if (redisHelpers && redisHelpers.saveWarnings) {
    redisHelpers.saveWarnings(sigReqId, warnings);
  }
}

// Helper function to add API log entry
function addApiLog(entry, accountId, redisHelpers) {
  if (redisHelpers && redisHelpers.addApiLog) {
    redisHelpers.addApiLog(entry, accountId);
  }
}

// Route 1: POST /sign - Template-based signature request
router.post(
  "/sign",
  requireAuth,
  express.urlencoded({ extended: false }),
  async (req, res) => {
    const {
      name,
      email,
      field1,
      field2,
      field3,
      template_id,
      name2,
      email2,
      singleSigner,
      signingOrder,
      smsAuth,
      smsPhone,
      eidAuth,
      theme_id,
      client_id
    } = req.body;

    console.log(`[SIGN REQUEST] client_id: ${client_id}, template_id: ${template_id}`);
    console.log('[SIGN REQUEST] req.body:', JSON.stringify(req.body, null, 2));

    // Validate
    if (!template_id) {
      return res.status(400).json({ error: "Please select a template." });
    }
    if (!name || !email || !field1 || !field2 || !field3) {
      return res.status(400).json({ error: "All fields are required." });
    }

    const isSingleSigner = singleSigner === 'on';
    const accountId = req.session?.accountInfo?.account_id || 'global';
    const redisClient = req.app.locals.redisClient;
    const redisHelpers = req.app.locals.redisHelpers;
    const userThemes = await getThemes(accountId, redisClient);
    const themeConfig = userThemes[theme_id] || userThemes[Object.keys(userThemes)[0]];

    try {
      // Fetch template to check signer roles and custom fields
      const tmplResponse = await apiCall(req, 'TemplateApi', 'templateGet', [template_id.trim()], {
        method: 'GET',
        endpoint: `/template/${template_id.trim()}`
      });
      const tmplRolesRaw = tmplResponse.body?.template?.signerRoles || [];
      const tmplRoles = tmplRolesRaw.map(r => r.name);
      const tmplCustomFields = tmplResponse.body?.template?.customFields || [];
      const validFieldNames = new Set(tmplCustomFields.map(f => f.name));

      // Log template role details to see if roles have order
      console.log('[SIGN] Template roles:', JSON.stringify(tmplRolesRaw.map(r => ({
        name: r.name,
        order: r.order
      })), null, 2));

      // Check if template has force_signer_order or other relevant flags
      const template = tmplResponse.body?.template;
      console.log('[SIGN] Template flags:', JSON.stringify({
        usePreexistingFields: template?.usePreexistingFields,
        skipMeNow: template?.skipMeNow,
        allowReassign: template?.allowReassign,
        metadata: template?.metadata
      }, null, 2));

      if (tmplRoles.length === 0) {
        return res.status(400).json({ error: "Template has no signer roles defined." });
      }

      // Determine signing order mode (default to sequential for backward compatibility)
      const isParallel = signingOrder === 'parallel';
      console.log(`[SIGN] signingOrder parameter: "${signingOrder}", isParallel: ${isParallel}`);

      // Check if template enforces sequential signing
      const templateHasSequentialOrder = tmplRolesRaw.length > 1 &&
        tmplRolesRaw.some(r => r.order !== undefined && r.order !== null && r.order > 0);

      if (templateHasSequentialOrder && isParallel) {
        console.warn('[SIGN] WARNING: User selected parallel mode, but template enforces sequential signing');
        console.warn('[SIGN] Template will override the parallel request');
      }

      // Map signers to the template's actual roles
      const primarySigner = new DropboxSign.SubSignatureRequestTemplateSigner();
      primarySigner.role = tmplRoles[0];
      primarySigner.name = name.trim();
      primarySigner.emailAddress = email.trim();
      // Note: Template-based requests do not support runtime 'order' field
      // Signing order is controlled by the template's role configuration
      if (smsAuth === 'on' && smsPhone) {
        primarySigner.smsPhoneNumber = smsPhone.trim();
        primarySigner.smsPhoneNumberType = 'authentication';
      }

      const signers = [primarySigner];

      if (!isSingleSigner) {
        if (!name2 || !email2) {
          return res.status(400).json({ error: "Second signer fields are required." });
        }
        if (tmplRoles.length < 2) {
          return res.status(400).json({ error: "Template only has one signer role — uncheck 'Single Signer' or pick a two-role template." });
        }

        const secondSigner = new DropboxSign.SubSignatureRequestTemplateSigner();
        secondSigner.role = tmplRoles[1];
        secondSigner.name = name2.trim();
        secondSigner.emailAddress = email2.trim();
        // Note: signingOrder parameter (parallel/sequential) has no effect on template-based requests
        // The template's role configuration determines signing order
        console.log(`[SIGN] signingOrder parameter "${signingOrder}" ignored for template-based request`);
        signers.push(secondSigner);
      }

      // Only include custom fields that exist in the template
      const allCustomFields = [
        { name: "field1", value: field1.trim() },
        { name: "field2", value: field2.trim() },
        { name: "field3", value: field3.trim() },
      ];
      const matchedFields = allCustomFields.filter(f => validFieldNames.has(f.name));

      // Use the template's own title as the signature request subject
      const templateTitle = tmplResponse.body?.template?.title || themeConfig.email.subject;

      // Build the request using SDK model
      const options = new DropboxSign.SignatureRequestSendWithTemplateRequest();
      options.templateIds = [template_id.trim()];
      options.signers = signers;
      options.subject = templateTitle;
      options.message = themeConfig.email.message;
      // Use per-API-app test mode setting
      options.testMode = client_id ? await getTestMode(client_id, req) : true;
      // Set which API app to use for the signature request (enables app-specific callbacks)
      if (client_id) {
        options.clientId = client_id;
      }
      if (matchedFields.length > 0) {
        options.customFields = matchedFields;
      }
      if (eidAuth === 'on') {
        options.isEid = true;
      }
      // SMS authentication is incompatible with signer reassignment
      if (smsAuth === 'on' && smsPhone) {
        options.allowReassign = false;
      }

      // Debug: Log what we're actually sending to the API
      console.log('[SIGN] Sending to API - signers:', JSON.stringify(signers.map(s => ({
        role: s.role,
        name: s.name,
        email: s.emailAddress,
        smsPhoneNumber: s.smsPhoneNumber,
        smsPhoneNumberType: s.smsPhoneNumberType
      })), null, 2));
      console.log('[SIGN] Request options:', JSON.stringify({
        testMode: options.testMode,
        allowReassign: options.allowReassign,
        isEid: options.isEid,
        clientId: options.clientId
      }, null, 2));

      const response = await apiCall(req, 'SignatureRequestApi', 'signatureRequestSendWithTemplate', [options], {
        method: 'POST',
        endpoint: '/signature_request/send_with_template'
      });

      // Log the order values returned by the API
      const returnedSignatures = response.body?.signatureRequest?.signatures || [];
      console.log(`[SIGN] API returned ${returnedSignatures.length} signatures with orders:`,
        returnedSignatures.map(s => ({ name: s.signerName, order: s.order })));

      const sigReqId =
        response.data?.signature_request?.signature_request_id ||
        response.body?.signatureRequest?.signatureRequestId ||
        response.signature_request?.signature_request_id ||
        response.signatureRequest?.signatureRequestId;

      if (!sigReqId) {
        console.error("No signature_request_id in response:", response);
        throw new Error("Missing signature_request_id");
      }

      recordEvent(sigReqId, "signature_request_sent", null, redisHelpers);
      saveWarnings(sigReqId, response.body?.warnings, redisHelpers);

      // Register signature request to user (multi-tenant callback routing)
      const accountId = req.session?.accountInfo?.account_id;
      const accountEmail = req.session?.accountInfo?.email_address;
      if (accountId && sigReqId) {
        await registerSignatureRequest(sigReqId, accountId, accountEmail, client_id, redisClient);
      }

      // Store in session
      if (req.session.signatureRequests) {
        req.session.signatureRequests.push({
          signatureRequestId: sigReqId,
          createdAt: Date.now(),
          templateId: template_id.trim(),
          subject: templateTitle
        });
      }

      return res.json({ success: true, signatureRequestId: sigReqId });
    } catch (err) {
      const apiMsg = err?.body?.error?.errorMsg || err?.message || 'Unknown error';
      console.error("Error in /sign:", apiMsg);
      console.error("Full error body:", JSON.stringify(err?.body, null, 2));

      const errorResponse = { error: `Error sending signature request: ${apiMsg}` };
      console.error("Sending error response to client:", JSON.stringify(errorResponse));
      return res.status(500).json(errorResponse);
    }
  }
);

// Route 2: POST /embedded - Embedded signing with template
router.post('/embedded', requireAuth, express.urlencoded({ extended: false }), async (req, res) => {
  const {
    signerName,
    signerEmail,
    signerName2,
    signerEmail2,
    singleSigner,
    signingOrder,
    template_id,
    field1,
    field2,
    field3,
    smsPhone,
    client_id
  } = req.body;

  const CLIENT_ID = process.env.CLIENT_ID;

  if (!template_id || !signerName || !signerEmail) {
    return res.status(400).json({ error: 'Missing required fields: template_id, signerName, or signerEmail' });
  }

  try {
    // With API key authentication, use the selected API App's client_id directly
    // This enables full API App switching for embedded signing demos
    const effectiveClientId = client_id || CLIENT_ID;
    const authenticatedEmail = req.session?.accountInfo?.email_address;

    console.log(`[EMBEDDED] Authenticated as: ${authenticatedEmail}, using API App: ${effectiveClientId}`);

    // Fetch template to get actual signer roles and custom fields
    const tmplResponse = await apiCall(req, 'TemplateApi', 'templateGet', [template_id.trim()], {
      method: 'GET',
      endpoint: `/template/${template_id.trim()}`
    });
    const tmplRoles = (tmplResponse.body?.template?.signerRoles || []).map(r => r.name);
    const tmplCustomFields = tmplResponse.body?.template?.customFields || [];
    const validFieldNames = new Set(tmplCustomFields.map(f => f.name));

    if (tmplRoles.length === 0) {
      return res.status(400).json({ error: 'Template has no signer roles defined.' });
    }

    // Determine if single or multi-signer mode
    const isSingleSigner = singleSigner === 'true' || singleSigner === true;

    // Determine signing order mode (default to sequential for backward compatibility)
    const isParallel = signingOrder === 'parallel';
    console.log(`[EMBEDDED] signingOrder parameter: "${signingOrder}", isParallel: ${isParallel}`);

    // First signer
    const embeddedSigner = new DropboxSign.SubSignatureRequestTemplateSigner();
    embeddedSigner.role = tmplRoles[0];
    embeddedSigner.name = signerName.trim();
    embeddedSigner.emailAddress = signerEmail.trim();
    // Note: Template-based requests do not support runtime 'order' field
    // Signing order is controlled by the template's role configuration
    if (smsPhone) {
      embeddedSigner.smsPhoneNumber = smsPhone.trim();
    }

    const signers = [embeddedSigner];

    // Add second signer if not single signer mode
    if (!isSingleSigner) {
      if (!signerName2 || !signerEmail2) {
        return res.status(400).json({ error: 'Second signer name and email are required when Single Signer is unchecked.' });
      }
      if (tmplRoles.length < 2) {
        return res.status(400).json({ error: 'Template only has one signer role. Uncheck "Single Signer" requires a template with two roles.' });
      }

      const secondSigner = new DropboxSign.SubSignatureRequestTemplateSigner();
      secondSigner.role = tmplRoles[1];
      secondSigner.name = signerName2.trim();
      secondSigner.emailAddress = signerEmail2.trim();
      // Note: signingOrder parameter (parallel/sequential) has no effect on template-based requests
      // The template's role configuration determines signing order
      console.log(`[EMBEDDED] signingOrder parameter "${signingOrder}" ignored for template-based request`);
      signers.push(secondSigner);
    }

    // Only include custom fields that exist in the template
    const allCustomFields = [
      { name: "field1", value: field1?.trim() || '' },
      { name: "field2", value: field2?.trim() || '' },
      { name: "field3", value: field3?.trim() || '' },
    ];
    const matchedFields = allCustomFields.filter(f => validFieldNames.has(f.name));

    const createOpts = new DropboxSign.SignatureRequestCreateEmbeddedWithTemplateRequest();
    createOpts.testMode = await getTestMode(effectiveClientId, req);
    createOpts.signers = signers;
    createOpts.templateIds = [template_id.trim()];
    createOpts.clientId = effectiveClientId;
    createOpts.metadata = { embedded: 'true' };  // Mark as embedded for detection
    if (matchedFields.length > 0) {
      createOpts.customFields = matchedFields;
    }

    console.log(`[EMBEDDED] Creating signature request - testMode: ${createOpts.testMode}, clientId: ${effectiveClientId}`);

    // 1) Create the embedded signature request
    let cr = await apiCall(req, 'SignatureRequestApi', 'signatureRequestCreateEmbeddedWithTemplate', [createOpts], {
      method: 'POST',
      endpoint: '/signature_request/create_embedded_with_template'
    });

    // 2) Pull the signature_request object
    const sigReq = cr.body?.signatureRequest;
    if (!sigReq || !sigReq.signatures?.length) {
      throw new Error('No signatures array in response.');
    }

    // Log the order values returned by the API
    console.log(`[EMBEDDED] API returned ${sigReq.signatures.length} signatures with orders:`,
      sigReq.signatures.map(s => ({ name: s.signerName, order: s.order })));

    // 3) Grab the signature id
    const signatureId = sigReq.signatures[0].signatureId;
    if (!signatureId) {
      throw new Error(`Could not extract signatureId from response: ${JSON.stringify(sigReq.signatures[0], null, 2)}`);
    }

    // 4) Generate the embedded signing URL
    let es = await apiCall(req, 'EmbeddedApi', 'embeddedSignUrl', [signatureId], {
      method: 'GET',
      endpoint: `/embedded/sign_url/${signatureId}`
    });

    // 5) Record sent event and return to the front end
    const redisHelpers = req.app.locals.redisHelpers;
    recordEvent(sigReq.signatureRequestId, 'signature_request_sent', null, redisHelpers);
    saveWarnings(sigReq.signatureRequestId, cr.body?.warnings, redisHelpers);

    // Register signature request to user (multi-tenant callback routing)
    const accountId = req.session?.accountInfo?.account_id;
    const accountEmail = req.session?.accountInfo?.email_address;
    const redisClient = req.app.locals.redisClient;
    if (accountId && sigReq.signatureRequestId) {
      await registerSignatureRequest(sigReq.signatureRequestId, accountId, accountEmail, client_id, redisClient);
    }

    return res.json({
      signUrl: es.body.embedded.signUrl,
      clientId: effectiveClientId,
      testMode: createOpts.testMode,
      signatureRequestId: sigReq.signatureRequestId,
      totalSigners: signers.length,
      currentSigner: 0
    });
  } catch (e) {
    const apiMsg = e?.body?.error?.errorMsg || e?.message || 'Unknown error';
    console.error('Embed error:', apiMsg);

    // Check for common embedded signing authorization errors
    if (apiMsg.includes('not authorized to make requests')) {
      return res.status(403).json({
        error: 'The selected API App is not authorized for embedded signing with your account. Please use an API App that you own.'
      });
    }

    // Check for domain verification errors
    if (apiMsg.includes('Domain mismatch') || apiMsg.includes('domain verification')) {
      return res.status(400).json({
        error: 'Domain verification failed. Please ensure:\n' +
               '1. This API App is in TEST MODE (check the API Apps tab)\n' +
               '2. The signature request was created in test mode\n' +
               '3. Your domain is registered in the API App settings (or use test mode with skipDomainVerification)'
      });
    }

    // Check for app not approved error
    if (apiMsg.includes('not approved')) {
      return res.status(400).json({
        error: 'App not approved yet. Apps that are not approved cannot run in production mode.\n\n' +
               'To use this app:\n' +
               '1. Go to the API Apps screen\n' +
               '2. Select "Test Mode" for this app\n' +
               '3. Try again'
      });
    }

    return res.status(500).json({ error: `Embed error: ${apiMsg}` });
  }
});

// Route 2.5: POST /embedded-next-signer - Generate embedded URL for subsequent signers
router.post('/embedded-next-signer', requireAuth, express.json(), async (req, res) => {
  const { signatureRequestId, signerIndex } = req.body;

  console.log(`[EMBEDDED-NEXT] Request received - sigReqId: ${signatureRequestId}, signerIndex: ${signerIndex}`);

  if (!signatureRequestId || signerIndex === undefined) {
    console.log('[EMBEDDED-NEXT] Missing required fields');
    return res.status(400).json({ error: 'Missing required fields: signatureRequestId or signerIndex' });
  }

  try {
    const accountId = req.session?.accountInfo?.account_id;
    const redisClient = req.app.locals.redisClient;

    console.log(`[EMBEDDED-NEXT] Account ID: ${accountId}`);

    // Validate that this user owns this signature request
    const ownerKey = `sig_req:${signatureRequestId}`;
    const ownerData = await redisClient.get(ownerKey);

    console.log(`[EMBEDDED-NEXT] Owner data from Redis:`, ownerData ? 'found' : 'not found');

    if (!ownerData) {
      console.log('[EMBEDDED-NEXT] Signature request not found in Redis');
      return res.status(404).json({ error: 'Signature request not found or expired' });
    }

    const owner = JSON.parse(ownerData);
    console.log(`[EMBEDDED-NEXT] Owner account: ${owner.account_id}, Current account: ${accountId}`);

    if (owner.account_id !== accountId) {
      console.log('[EMBEDDED-NEXT] Account mismatch - not authorized');
      return res.status(403).json({ error: 'Not authorized to access this signature request' });
    }

    // Fetch signature request to get signer details
    const srResponse = await apiCall(req, 'SignatureRequestApi', 'signatureRequestGet', [signatureRequestId], {
      method: 'GET',
      endpoint: `/signature_request/${signatureRequestId}`
    });

    const sigReq = srResponse.body?.signatureRequest;
    if (!sigReq || !sigReq.signatures) {
      return res.status(404).json({ error: 'Signature request data not found' });
    }

    // Validate signer index
    if (signerIndex < 0 || signerIndex >= sigReq.signatures.length) {
      return res.status(400).json({ error: 'Invalid signer index' });
    }

    const signature = sigReq.signatures[signerIndex];

    // Check if this signer has already signed
    if (signature.statusCode === 'signed') {
      return res.status(400).json({ error: 'This signer has already completed their signature' });
    }

    const signatureId = signature.signatureId;
    if (!signatureId) {
      return res.status(500).json({ error: 'Could not extract signature ID' });
    }

    // Generate embedded URL for this signer
    console.log(`[EMBEDDED-NEXT] Generating embedded URL for signature ID: ${signatureId}`);
    const esResponse = await apiCall(req, 'EmbeddedApi', 'embeddedSignUrl', [signatureId], {
      method: 'GET',
      endpoint: `/embedded/sign_url/${signatureId}`
    });

    console.log('[EMBEDDED-NEXT] Successfully generated embedded URL');
    return res.json({
      signUrl: esResponse.body.embedded.signUrl,
      signatureId: signatureId
    });

  } catch (e) {
    const apiMsg = e?.body?.error?.errorMsg || e?.message || 'Unknown error';
    console.error('[EMBEDDED-NEXT] Error:', apiMsg, e);
    return res.status(500).json({ error: `Failed to generate embedded URL: ${apiMsg}` });
  }
});

// Route 3: POST /preview-document - Generate PDF from markdown and return it
router.post('/preview-document', express.urlencoded({ extended: false }), async (req, res) => {
  const { markdownContent, signerName1, signerEmail1, field1, field2, field3, stripTextTags, logoEnabled } = req.body;

  if (!markdownContent) {
    return res.status(400).json({ error: 'No markdown content provided.' });
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
      logoEnabled: req.body.logoEnabled !== 'false' && req.body.logoEnabled !== false
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

// Route 4: POST /sign-with-document - Generate PDF and send via Text Tags API
router.post('/sign-with-document', apiLimiter, requireAuth, express.urlencoded({ extended: false }), async (req, res) => {
  const {
    name, email, field1, field2, field3,
    markdownContent, name2, email2, singleSigner, signingOrder, smsAuth, smsPhone, smsDelivery, eidAuth, theme_id, client_id,
    documentTemplateName, logoEnabled
  } = req.body;

  const CLIENT_ID = process.env.CLIENT_ID;

  if (!markdownContent) {
    return res.status(400).json({ error: 'No markdown content provided.' });
  }
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  try {
    // 1. Replace placeholders and generate PDF
    const filledMd = replaceFieldPlaceholders(markdownContent, {
      name, email, field1, field2, field3
    });

    const templateData = {
      logoEnabled: req.body.logoEnabled !== 'false' && req.body.logoEnabled !== false
    };

    console.log('[SIGN-WITH-DOCUMENT] Template data received:', templateData);

    const pdfBuffer = await generatePdfFromMarkdown(filledMd, templateData);

    // 2. Write PDF to temp file
    const tmpPath = path.join(os.tmpdir(), `sign_doc_${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, pdfBuffer);

    // 3. Build signers
    const isSingleSigner = singleSigner === 'on';
    const isParallel = signingOrder === 'parallel';

    const primarySigner = {
      name: name.trim(),
      email_address: email.trim(),
    };

    // For sequential signing, add order field (parallel = no order field)
    if (!isParallel) {
      primarySigner.order = 0;
    }

    // Handle SMS options (both can be enabled, sharing the same phone number)
    if (smsPhone && (smsAuth === 'on' || smsDelivery === 'on')) {
      primarySigner.sms_phone_number = smsPhone.trim();

      // Set phone number type based on which options are enabled
      if (smsAuth === 'on' && smsDelivery === 'on') {
        // Both enabled: authentication takes precedence (more secure)
        primarySigner.sms_phone_number_type = 'authentication';
      } else if (smsAuth === 'on') {
        primarySigner.sms_phone_number_type = 'authentication';
      } else if (smsDelivery === 'on') {
        primarySigner.sms_phone_number_type = 'delivery';
      }
    }

    const signers = [primarySigner];

    if (!isSingleSigner && name2 && email2) {
      const secondSigner = {
        name: name2.trim(),
        email_address: email2.trim(),
      };
      // For sequential signing, add order field (parallel = no order field)
      if (!isParallel) {
        secondSigner.order = 1;
      }
      signers.push(secondSigner);
    }

    // 4. Send via Dropbox Sign API with text tags
    const accountId = req.session?.accountInfo?.account_id || 'global';
    const redisClient = req.app.locals.redisClient;
    const redisHelpers = req.app.locals.redisHelpers;
    const userThemes = await getThemes(accountId, redisClient);
    const themeConfig = userThemes[theme_id] || userThemes[Object.keys(userThemes)[0]];

    const docName = documentTemplateName || 'Custom Document';
    const options = {
      test_mode: await getTestMode(client_id || CLIENT_ID, req),
      title: docName,
      subject: `Demo Text Tags ${docName}`,
      message: themeConfig.email.message,
      signers,
      files: [fs.createReadStream(tmpPath)],
      use_text_tags: true,
      hide_text_tags: true,
    };

    // Set which API app to use for the signature request (enables app-specific callbacks)
    if (client_id) {
      options.client_id = client_id;
    }

    if (eidAuth === 'on') {
      options.isEid = true;
    }

    const response = await apiCall(req, 'SignatureRequestApi', 'signatureRequestSend', [options], {
      method: 'POST',
      endpoint: '/signature_request/send'
    });

    // Log signing order: verify if API honored our parallel/sequential request
    if (!isSingleSigner) {
      const returnedSignatures = response.body?.signatureRequest?.signatures || response.data?.signature_request?.signatures || [];
      const actualOrders = returnedSignatures.map(s => s.order);
      const requestedParallel = signers.every(s => s.order === undefined);
      const apiReturnedOrdered = actualOrders.some(o => o !== null && o !== undefined);

      if (requestedParallel && apiReturnedOrdered) {
        console.warn(`[SIGN-WITH-DOCUMENT] Parallel signing requested (no order field) but API returned ordered signatures.`);
        console.warn(`[SIGN-WITH-DOCUMENT] This may indicate an account limitation or API constraint.`);
        console.warn(`[SIGN-WITH-DOCUMENT] API returned orders: ${actualOrders.join(', ')}`);
      }
    }

    // 5. Clean up temp file
    fs.unlinkSync(tmpPath);

    const sigReqId =
      response.data?.signature_request?.signature_request_id ||
      response.body?.signatureRequest?.signatureRequestId ||
      response.signature_request?.signature_request_id ||
      response.signatureRequest?.signatureRequestId;

    if (sigReqId) {
      recordEvent(sigReqId, 'signature_request_sent', null, redisHelpers);
      saveWarnings(sigReqId, response.body?.warnings, redisHelpers);

      // Register signature request to user (multi-tenant callback routing)
      const accountId = req.session?.accountInfo?.account_id;
      const accountEmail = req.session?.accountInfo?.email_address;
      if (accountId) {
        await registerSignatureRequest(sigReqId, accountId, accountEmail, client_id, redisClient);
      }
    }

    return res.json({ success: true, signatureRequestId: sigReqId });
  } catch (err) {
    const apiMsg = err?.body?.error?.errorMsg || err?.message || 'Unknown error';
    console.error('Error in /sign-with-document:', apiMsg);
    console.error('Full error:', JSON.stringify(err?.body, null, 2));
    return res.status(500).json({ error: `Error sending document for signature: ${apiMsg}` });
  }
});

// Route 5: POST /embedded-document - Generate PDF and create embedded signing with text tags
router.post('/embedded-document', express.urlencoded({ extended: false }), async (req, res) => {
  const {
    signerName, signerEmail, field1, field2, field3,
    markdownContent, smsPhone, client_id, documentTemplateName, logoEnabled
  } = req.body;

  const CLIENT_ID = process.env.CLIENT_ID;

  if (!markdownContent || !signerName || !signerEmail) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    // With API key authentication, use the selected API App's client_id directly
    const effectiveClientId = client_id || CLIENT_ID;
    const authenticatedEmail = req.session?.accountInfo?.email_address;

    console.log(`[EMBEDDED] Authenticated as: ${authenticatedEmail}, using API App: ${effectiveClientId}`);

    const filledMd = replaceFieldPlaceholders(markdownContent, {
      name: signerName, email: signerEmail, field1, field2, field3
    });

    const templateData = {
      logoEnabled: req.body.logoEnabled !== 'false' && req.body.logoEnabled !== false
    };

    const pdfBuffer = await generatePdfFromMarkdown(filledMd, templateData);

    const tmpPath = path.join(os.tmpdir(), `embed_doc_${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, pdfBuffer);

    const embeddedSigner = { name: signerName.trim(), email_address: signerEmail.trim(), role: 'signer1' };
    if (smsPhone) {
      embeddedSigner.sms_phone_number = smsPhone.trim();
    }

    const docName = documentTemplateName || 'Custom Document';
    const createOpts = {
      test_mode: await getTestMode(effectiveClientId, req),
      title: `Demo Text Tags ${docName}`,
      signers: [embeddedSigner],
      files: [fs.createReadStream(tmpPath)],
      use_text_tags: true,
      hide_text_tags: true,
      clientId: effectiveClientId,
      metadata: { embedded: 'true' },  // Mark as embedded for detection
    };

    let cr = await apiCall(req, 'SignatureRequestApi', 'signatureRequestCreateEmbedded', [createOpts], {
      method: 'POST',
      endpoint: '/signature_request/create_embedded'
    });

    fs.unlinkSync(tmpPath);

    const sigReq = cr.body?.signatureRequest;
    if (!sigReq || !sigReq.signatures?.length) {
      throw new Error('No signatures array in response.');
    }

    const signatureId = sigReq.signatures[0].signatureId;
    let es = await apiCall(req, 'EmbeddedApi', 'embeddedSignUrl', [signatureId], {
      method: 'GET',
      endpoint: `/embedded/sign_url/${signatureId}`
    });

    const redisHelpers = req.app.locals.redisHelpers;
    recordEvent(sigReq.signatureRequestId, 'signature_request_sent', null, redisHelpers);
    saveWarnings(sigReq.signatureRequestId, cr.body?.warnings, redisHelpers);
    return res.json({
      signUrl: es.body.embedded.signUrl,
      clientId: effectiveClientId // Return the actual client_id used
    });
  } catch (err) {
    console.error('Error in /embedded-document:', err);
    const errMsg = err?.body?.error?.errorMsg || err?.message || 'Unknown error';

    // Check for common embedded signing authorization errors
    if (errMsg.includes('not authorized to make requests')) {
      return res.status(403).json({
        error: 'The selected API App is not authorized for embedded signing with your account. Please use an API App that you own.'
      });
    }

    return res.status(500).json({ error: errMsg });
  }
});

// Route 6: POST /sign-auto-append - Upload file and send with auto-appended signature fields
router.post('/sign-auto-append', apiLimiter, requireAuth, autoAppendUpload.single('file'), async (req, res) => {
  const { name, email, name2, email2, singleSigner, signingOrder, smsAuth, smsPhone, eidAuth, theme_id, client_id, documentTemplateName } = req.body;
  const file = req.file;

  const CLIENT_ID = process.env.CLIENT_ID;

  if (!file) return res.status(400).json({ error: 'No file uploaded.' });
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' });

  try {
    const isSingleSigner = singleSigner === 'on';
    const isParallel = signingOrder === 'parallel';

    const primarySigner = { name: name.trim(), email_address: email.trim() };
    if (smsAuth === 'on' && smsPhone) primarySigner.sms_phone_number = smsPhone.trim();
    // For sequential signing, add order field (parallel = no order field)
    if (!isParallel) primarySigner.order = 0;

    const signers = [primarySigner];
    if (!isSingleSigner && name2 && email2) {
      const secondSigner = { name: name2.trim(), email_address: email2.trim() };
      // For sequential signing, add order field (parallel = no order field)
      if (!isParallel) secondSigner.order = 1;
      signers.push(secondSigner);
    }

    const accountId = req.session?.accountInfo?.account_id || 'global';
    const redisClient = req.app.locals.redisClient;
    const redisHelpers = req.app.locals.redisHelpers;
    const userThemes = await getThemes(accountId, redisClient);
    const themeConfig = userThemes[theme_id] || userThemes[Object.keys(userThemes)[0]];
    const docName = documentTemplateName || file.originalname || 'Uploaded Document';

    const options = {
      test_mode: await getTestMode(client_id || CLIENT_ID, req),
      title: docName,
      subject: `Demo Auto-append ${docName}`,
      message: themeConfig.email.message,
      signers,
      files: [fs.createReadStream(file.path)],
      // No use_text_tags — Dropbox Sign auto-appends signing fields
    };

    // Set which API app to use for the signature request (enables app-specific callbacks)
    if (client_id) {
      options.client_id = client_id;
    }

    if (eidAuth === 'on') options.isEid = true;

    const response = await apiCall(req, 'SignatureRequestApi', 'signatureRequestSend', [options], {
      method: 'POST',
      endpoint: '/signature_request/send'
    });

    fs.unlinkSync(file.path);

    const sigReqId = response.body?.signatureRequest?.signatureRequestId;
    if (sigReqId) {
      recordEvent(sigReqId, 'signature_request_sent', null, redisHelpers);
      saveWarnings(sigReqId, response.body?.warnings, redisHelpers);

      // Register signature request to user (multi-tenant callback routing)
      const accountId = req.session?.accountInfo?.account_id;
      const accountEmail = req.session?.accountInfo?.email_address;
      if (accountId) {
        await registerSignatureRequest(sigReqId, accountId, accountEmail, client_id, redisClient);
      }
    }

    return res.json({ success: true, signatureRequestId: sigReqId });
  } catch (err) {
    const apiMsg = err?.body?.error?.errorMsg || err?.message || 'Unknown error';
    console.error('Error in /sign-auto-append:', apiMsg);
    console.error('Full error:', JSON.stringify(err?.body, null, 2));
    if (file && file.path) try { fs.unlinkSync(file.path); } catch (_) {}
    return res.status(500).json({ error: `Error sending document for signature (auto-append): ${apiMsg}` });
  }
});

// Route 7: POST /embedded-auto-append - Upload file and create embedded signing with auto-appended fields
router.post('/embedded-auto-append', embeddedAutoUpload.single('file'), async (req, res) => {
  const { signerName, signerEmail, smsPhone, client_id, documentTemplateName } = req.body;
  const file = req.file;

  const CLIENT_ID = process.env.CLIENT_ID;

  if (!file || !signerName || !signerEmail) {
    return res.status(400).json({ error: 'File, name, and email are required.' });
  }

  try {
    const embeddedSigner = { name: signerName.trim(), email_address: signerEmail.trim() };
    if (smsPhone) embeddedSigner.sms_phone_number = smsPhone.trim();

    const docName = documentTemplateName || file.originalname || 'Uploaded Document';
    const createOpts = {
      test_mode: await getTestMode(client_id || CLIENT_ID, req),
      title: `Demo Auto-append ${docName}`,
      signers: [embeddedSigner],
      files: [fs.createReadStream(file.path)],
      clientId: client_id || CLIENT_ID,
      metadata: { embedded: 'true' },  // Mark as embedded for detection
      // No use_text_tags — auto-appended fields
    };

    let cr = await apiCall(req, 'SignatureRequestApi', 'signatureRequestCreateEmbedded', [createOpts], {
      method: 'POST',
      endpoint: '/signature_request/create_embedded'
    });

    fs.unlinkSync(file.path);

    const sigReq = cr.body?.signatureRequest;
    if (!sigReq || !sigReq.signatures?.length) throw new Error('No signatures in response.');

    const signatureId = sigReq.signatures[0].signatureId;
    let es = await apiCall(req, 'EmbeddedApi', 'embeddedSignUrl', [signatureId], {
      method: 'GET',
      endpoint: `/embedded/sign_url/${signatureId}`
    });

    const redisHelpers = req.app.locals.redisHelpers;
    recordEvent(sigReq.signatureRequestId, 'signature_request_sent', null, redisHelpers);
    saveWarnings(sigReq.signatureRequestId, cr.body?.warnings, redisHelpers);
    return res.json({ signUrl: es.body.embedded.signUrl });
  } catch (err) {
    console.error('Error in /embedded-auto-append:', err);
    if (file && file.path) try { fs.unlinkSync(file.path); } catch (_) {}
    return res.status(500).json({ error: err.message });
  }
});

// Route 8: POST /sign-with-formfields - Generate PDF and send with form_fields_per_document
router.post('/sign-with-formfields', apiLimiter, requireAuth, express.urlencoded({ extended: false }), async (req, res) => {
  const {
    name, email, field1, field2, field3,
    markdownContent, name2, email2, singleSigner, signingOrder, smsAuth, smsPhone, eidAuth, theme_id, client_id,
    documentTemplateName, formFieldsJson, logoEnabled
  } = req.body;

  const CLIENT_ID = process.env.CLIENT_ID;

  if (!markdownContent) return res.status(400).json({ error: 'No markdown content provided.' });
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' });

  try {
    // Strip text tags from markdown before generating PDF
    let filledMd = replaceFieldPlaceholders(markdownContent, { name, email, field1, field2, field3 });
    filledMd = filledMd.replace(/\[(sig|initial|date|cb|text)\|\w+\|\w+(?:\|[^\]]*)?\]/g, '');

    const templateData = {
      logoEnabled: req.body.logoEnabled !== 'false' && req.body.logoEnabled !== false
    };

    const pdfBuffer = await generatePdfFromMarkdown(filledMd, templateData);

    const tmpPath = path.join(os.tmpdir(), `sign_ff_${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, pdfBuffer);

    const isSingleSigner = singleSigner === 'on';
    const isParallel = signingOrder === 'parallel';

    const primarySigner = new DropboxSign.SubSignatureRequestSigner();
    primarySigner.name = name.trim();
    primarySigner.emailAddress = email.trim();
    // For sequential signing, add order field (parallel = no order field)
    if (!isParallel) primarySigner.order = 0;
    if (smsAuth === 'on' && smsPhone) primarySigner.smsPhoneNumber = smsPhone.trim();
    const signers = [primarySigner];
    if (!isSingleSigner && name2 && email2) {
      const secondSigner = new DropboxSign.SubSignatureRequestSigner();
      secondSigner.name = name2.trim();
      secondSigner.emailAddress = email2.trim();
      // For sequential signing, add order field (parallel = no order field)
      if (!isParallel) secondSigner.order = 1;
      signers.push(secondSigner);
    }

    // Parse form fields and build SDK model instances
    let rawFields = [];
    try { rawFields = JSON.parse(formFieldsJson || '[]'); } catch (_) {}

    // Count pages in the generated PDF to filter out fields on non-existent pages
    let pdfPageCount = 1;
    let pdfPageHeights = [];
    try {
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      pdfPageCount = pdfDoc.getPageCount();
      pdfPageHeights = pdfDoc.getPages().map(p => p.getHeight());
      console.log(`[sign-with-formfields] PDF has ${pdfPageCount} page(s), heights:`, pdfPageHeights);
    } catch (e) {
      console.warn('[sign-with-formfields] Could not count PDF pages:', e.message);
    }

    // Filter out fields that reference non-existent signers or pages, or have invalid coordinates
    const validRawFields = rawFields.filter(f => {
      if (f.signer >= signers.length) return false;
      // f.page is 0-indexed, so page 0 = first page, page 1 = second page, etc.
      if (f.page >= pdfPageCount) {
        console.log(`[sign-with-formfields] Filtering out field ${f.api_id || f.apiId} (page ${f.page} doesn't exist, PDF has ${pdfPageCount} pages)`);
        return false;
      }
      // Check if y coordinate is within page bounds
      if (pdfPageHeights.length > 0 && f.page < pdfPageHeights.length) {
        const pageHeight = pdfPageHeights[f.page];
        if (f.y < 0 || f.y >= pageHeight) {
          console.log(`[sign-with-formfields] Filtering out field ${f.api_id || f.apiId} (y=${f.y} is outside page ${f.page} bounds 0-${pageHeight})`);
          return false;
        }
      }
      return true;
    });

    // Ensure all api_id values are unique (Dropbox Sign rejects duplicates)
    const seenIds = new Set();
    for (const f of validRawFields) {
      const id = f.api_id || f.apiId;
      if (!id || seenIds.has(id)) {
        f.api_id = 'field_' + Math.random().toString(36).slice(2, 10);
      }
      seenIds.add(f.api_id || f.apiId);
    }

    const typeClassMap = {
      signature: DropboxSign.SubFormFieldsPerDocumentSignature,
      date_signed: DropboxSign.SubFormFieldsPerDocumentDateSigned,
      text: DropboxSign.SubFormFieldsPerDocumentText,
      initials: DropboxSign.SubFormFieldsPerDocumentInitials,
      checkbox: DropboxSign.SubFormFieldsPerDocumentCheckbox,
    };

    // Also ensure field names are unique (API may reject duplicate names)
    const seenNames = new Map();
    for (const f of validRawFields) {
      if (f.name) {
        const count = seenNames.get(f.name) || 0;
        seenNames.set(f.name, count + 1);
        if (count > 0) f.name = `${f.name} ${count + 1}`;
      }
    }

    const formFields = validRawFields.map(f => {
      const Cls = typeClassMap[f.type] || DropboxSign.SubFormFieldsPerDocumentSignature;
      const field = new Cls();
      field.documentIndex = 0;
      field.apiId = f.api_id || f.apiId || ('field_' + Math.random().toString(36).slice(2, 10));
      field.type = f.type;
      field.x = f.x;
      field.y = f.y;
      field.width = f.width;
      field.height = f.height;
      field.required = f.required !== false;
      field.signer = String(f.signer);  // SDK expects string
      field.page = (f.page || 0) + 1;   // SDK expects 1-indexed
      if (f.name) field.name = f.name;
      return field;
    });

    console.log('[sign-with-formfields] signers:', signers.length, 'fields:', formFields.length,
      'apiIds:', formFields.map(f => f.apiId), 'names:', formFields.map(f => f.name));
    console.log('[sign-with-formfields] field details:', formFields.map(f => ({
      id: f.apiId, page: f.page, x: f.x, y: f.y, signer: f.signer
    })));

    // Validate that each signer has at least one field assigned
    const signersWithFields = new Set(formFields.map(f => parseInt(f.signer)));
    const signersWithoutFields = [];
    for (let i = 0; i < signers.length; i++) {
      if (!signersWithFields.has(i)) {
        signersWithoutFields.push(i);
      }
    }
    if (signersWithoutFields.length > 0) {
      const signerNames = signersWithoutFields.map(i => `Signer ${i + 1} (${signers[i].name})`).join(', ');
      return res.status(400).json({ error: `Each signer must have at least one field assigned. Missing fields for: ${signerNames}` });
    }

    const accountId = req.session?.accountInfo?.account_id || 'global';
    const redisClient = req.app.locals.redisClient;
    const redisHelpers = req.app.locals.redisHelpers;
    const userThemes = await getThemes(accountId, redisClient);
    const themeConfig = userThemes[theme_id] || userThemes[Object.keys(userThemes)[0]];
    const docName = documentTemplateName || 'Custom Document';

    const sendReq = new DropboxSign.SignatureRequestSendRequest();
    sendReq.testMode = await getTestMode(client_id || CLIENT_ID, req);
    sendReq.title = docName;
    sendReq.subject = `Demo Form Fields ${docName}`;
    sendReq.message = themeConfig.email.message;
    sendReq.signers = signers;
    sendReq.files = [fs.createReadStream(tmpPath)];
    // Set which API app to use for the signature request (enables app-specific callbacks)
    if (client_id) {
      sendReq.clientId = client_id;
    }
    sendReq.formFieldsPerDocument = formFields;

    if (eidAuth === 'on') sendReq.isEid = true;

    const options = sendReq;

    const response = await apiCall(req, 'SignatureRequestApi', 'signatureRequestSend', [options], {
      method: 'POST',
      endpoint: '/signature_request/send'
    });

    fs.unlinkSync(tmpPath);

    const sigReqId = response.body?.signatureRequest?.signatureRequestId;
    if (sigReqId) {
      recordEvent(sigReqId, 'signature_request_sent', null, redisHelpers);
      saveWarnings(sigReqId, response.body?.warnings, redisHelpers);

      // Register signature request to user (multi-tenant callback routing)
      const accountId = req.session?.accountInfo?.account_id;
      const accountEmail = req.session?.accountInfo?.email_address;
      if (accountId) {
        await registerSignatureRequest(sigReqId, accountId, accountEmail, client_id, redisClient);
      }
    }

    return res.json({ success: true, signatureRequestId: sigReqId });
  } catch (err) {
    const apiMsg = err?.body?.error?.errorMsg || err?.message || 'Unknown error';
    console.error('Error in /sign-with-formfields:', apiMsg);
    console.error('Full error:', JSON.stringify(err?.body, null, 2));
    return res.status(500).json({ error: `Error sending document for signature (form fields): ${apiMsg}` });
  }
});

// Route 9: POST /embedded-formfields - Generate PDF and create embedded signing with form_fields_per_document
router.post('/embedded-formfields', express.urlencoded({ extended: false }), async (req, res) => {
  const {
    signerName, signerEmail, field1, field2, field3,
    markdownContent, smsPhone, client_id, documentTemplateName, formFieldsJson, logoEnabled
  } = req.body;

  const CLIENT_ID = process.env.CLIENT_ID;

  if (!markdownContent || !signerName || !signerEmail) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    let filledMd = replaceFieldPlaceholders(markdownContent, { name: signerName, email: signerEmail, field1, field2, field3 });
    filledMd = filledMd.replace(/\[(sig|initial|date|cb|text)\|\w+\|\w+(?:\|[^\]]*)?\]/g, '');

    const templateData = {
      logoEnabled: req.body.logoEnabled !== 'false' && req.body.logoEnabled !== false
    };

    const pdfBuffer = await generatePdfFromMarkdown(filledMd, templateData);

    const tmpPath = path.join(os.tmpdir(), `embed_ff_${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, pdfBuffer);

    const embeddedSigner = new DropboxSign.SubSignatureRequestSigner();
    embeddedSigner.name = signerName.trim();
    embeddedSigner.emailAddress = signerEmail.trim();
    embeddedSigner.order = 0;
    if (smsPhone) embeddedSigner.smsPhoneNumber = smsPhone.trim();

    let rawFields = [];
    try { rawFields = JSON.parse(formFieldsJson || '[]'); } catch (_) {}

    const signers = [embeddedSigner];

    // Filter out fields that reference non-existent signers
    const validRawFields = rawFields.filter(f => f.signer < signers.length);

    // Ensure all api_id values are unique (Dropbox Sign rejects duplicates)
    const seenIds2 = new Set();
    for (const f of validRawFields) {
      const id = f.api_id || f.apiId;
      if (!id || seenIds2.has(id)) {
        f.api_id = 'field_' + Math.random().toString(36).slice(2, 10);
      }
      seenIds2.add(f.api_id || f.apiId);
    }

    const typeClassMap = {
      signature: DropboxSign.SubFormFieldsPerDocumentSignature,
      date_signed: DropboxSign.SubFormFieldsPerDocumentDateSigned,
      text: DropboxSign.SubFormFieldsPerDocumentText,
      initials: DropboxSign.SubFormFieldsPerDocumentInitials,
      checkbox: DropboxSign.SubFormFieldsPerDocumentCheckbox,
    };

    // Also ensure field names are unique (API may reject duplicate names)
    const seenNames2 = new Map();
    for (const f of validRawFields) {
      if (f.name) {
        const count = seenNames2.get(f.name) || 0;
        seenNames2.set(f.name, count + 1);
        if (count > 0) f.name = `${f.name} ${count + 1}`;
      }
    }

    const formFields = validRawFields.map(f => {
      const Cls = typeClassMap[f.type] || DropboxSign.SubFormFieldsPerDocumentSignature;
      const field = new Cls();
      field.documentIndex = 0;
      field.apiId = f.api_id || f.apiId || ('field_' + Math.random().toString(36).slice(2, 10));
      field.type = f.type;
      field.x = f.x;
      field.y = f.y;
      field.width = f.width;
      field.height = f.height;
      field.required = f.required !== false;
      field.signer = String(f.signer);
      field.page = (f.page || 0) + 1;
      if (f.name) field.name = f.name;
      return field;
    });

    const docName = documentTemplateName || 'Custom Document';
    const clientIdForRequest = client_id || CLIENT_ID;
    const createOpts = new DropboxSign.SignatureRequestCreateEmbeddedRequest();
    createOpts.testMode = await getTestMode(clientIdForRequest, req);
    createOpts.title = `Demo Form Fields ${docName}`;
    createOpts.signers = signers;
    createOpts.files = [fs.createReadStream(tmpPath)];
    createOpts.clientId = clientIdForRequest;
    createOpts.metadata = { embedded: 'true' };  // Mark as embedded for detection
    createOpts.formFieldsPerDocument = formFields;

    let cr = await apiCall(req, 'SignatureRequestApi', 'signatureRequestCreateEmbedded', [createOpts], {
      method: 'POST',
      endpoint: '/signature_request/create_embedded'
    });

    fs.unlinkSync(tmpPath);

    const sigReq = cr.body?.signatureRequest;
    if (!sigReq || !sigReq.signatures?.length) throw new Error('No signatures in response.');

    const signatureId = sigReq.signatures[0].signatureId;
    let es = await apiCall(req, 'EmbeddedApi', 'embeddedSignUrl', [signatureId], {
      method: 'GET',
      endpoint: `/embedded/sign_url/${signatureId}`
    });

    const redisHelpers = req.app.locals.redisHelpers;
    recordEvent(sigReq.signatureRequestId, 'signature_request_sent', null, redisHelpers);
    saveWarnings(sigReq.signatureRequestId, cr.body?.warnings, redisHelpers);
    return res.json({ signUrl: es.body.embedded.signUrl });
  } catch (err) {
    console.error('Error in /embedded-formfields:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Route 10: POST /unclaimed-draft-file - Create embedded unclaimed draft with uploaded file
router.post('/unclaimed-draft-file', requireAuth, unclaimedUpload.single('file'), async (req, res) => {
  const { signerName, signerEmail, client_id } = req.body;
  const file = req.file;

  const CLIENT_ID = process.env.CLIENT_ID;

  if (!signerName || !signerEmail || !file) {
    return res.status(400).json({ error: 'Name, email, and file are required.' });
  }

  // Use selected API App or default CLIENT_ID
  let selectedClientId = client_id || CLIENT_ID;
  if (!selectedClientId) {
    return res.status(400).json({ error: 'No API App (client_id) configured.' });
  }

  const accountEmail = req.session.accountInfo?.email_address;

  try {
    const createOpts = {
      clientId: selectedClientId,
      requesterEmailAddress: accountEmail || signerEmail.trim(),
      files: [fs.createReadStream(file.path)],
      signers: [{ name: signerName.trim(), emailAddress: signerEmail.trim() }],
      testMode: await getTestMode(selectedClientId, req),
      type: 'request_signature',
      isForEmbeddedSigning: false,
    };

    let response;
    try {
      response = await apiCall(req, 'UnclaimedDraftApi', 'unclaimedDraftCreateEmbedded', [createOpts], {
        method: 'POST',
        endpoint: '/unclaimed_draft/create_embedded'
      });
    } catch (err) {
      // If API call fails, throw the error
      throw err;
    }

    // Clean up temp file
    fs.unlinkSync(file.path);

    // For embedded unclaimed drafts, check if we have a claim_url or signatures
    const unclaimedDraft = response.body?.unclaimedDraft;

    // Register signature request to user (multi-tenant callback routing)
    const sigReqId = unclaimedDraft?.signatureRequest?.signatureRequestId;
    if (sigReqId) {
      const accountId = req.session?.accountInfo?.account_id;
      const accountEmail = req.session?.accountInfo?.email_address;
      const redisClient = req.app.locals.redisClient;
      if (accountId) {
        await registerSignatureRequest(sigReqId, accountId, accountEmail, createOpts.clientId, redisClient);
      }
    }

    // Try to get embedded URL if signatures are available
    if (unclaimedDraft?.signatureRequest?.signatures?.length > 0) {
      const signatureId = unclaimedDraft.signatureRequest.signatures[0].signatureId;

      const embeddedResponse = await apiCall(req, 'EmbeddedApi', 'embeddedSignUrl', [signatureId], {
        method: 'GET',
        endpoint: `/embedded/sign_url/${signatureId}`
      });

      return res.json({
        signUrl: embeddedResponse.body.embedded.signUrl,
        clientId: createOpts.clientId // Tell frontend which client_id was actually used
      });
    }

    // Fallback to claim URL (may not work in iframe)
    const claimUrl = unclaimedDraft?.claimUrl;
    if (!claimUrl) {
      throw new Error('No claim_url or signatures in response');
    }

    console.log('[unclaimed-draft-file] Using claimUrl (prep-and-send flow) with client_id:', createOpts.clientId);

    // Return the claimUrl with a flag indicating it might not work
    return res.json({
      signUrl: claimUrl,
      isClaimUrl: true,
      clientId: createOpts.clientId, // Tell frontend which client_id was actually used
      warning: 'This app returned a prep-and-send URL instead of an embedded signing URL. It may not display correctly in the iframe.'
    });
  } catch (err) {
    console.error('Error in /unclaimed-draft-file:', err);
    if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    return res.status(500).json({ error: err.message });
  }
});

// Route 11: POST /unclaimed-draft-template - Create embedded unclaimed draft with template
router.post('/unclaimed-draft-template', requireAuth, express.urlencoded({ extended: false }), async (req, res) => {
  const { signerName, signerEmail, template_id, client_id } = req.body;

  const CLIENT_ID = process.env.CLIENT_ID;

  if (!signerName || !signerEmail || !template_id) {
    return res.status(400).json({ error: 'Name, email, and template are required.' });
  }

  // Use selected API App or default CLIENT_ID
  let selectedClientId = client_id || CLIENT_ID;
  if (!selectedClientId) {
    return res.status(400).json({ error: 'No API App (client_id) configured.' });
  }

  const accountEmail = req.session.accountInfo?.email_address;

  try {
    // Fetch template to get actual signer roles
    const tmplResponse = await apiCall(req, 'TemplateApi', 'templateGet', [template_id.trim()], {
      method: 'GET',
      endpoint: `/template/${template_id.trim()}`
    });
    const tmplRoles = (tmplResponse.body?.template?.signerRoles || []).map(r => r.name);
    if (tmplRoles.length === 0) {
      return res.status(400).json({ error: 'Template has no signer roles defined.' });
    }

    const primarySigner = new DropboxSign.SubUnclaimedDraftTemplateSigner();
    primarySigner.role = tmplRoles[0];
    primarySigner.name = signerName.trim();
    primarySigner.emailAddress = signerEmail.trim();

    const createOpts = new DropboxSign.UnclaimedDraftCreateEmbeddedWithTemplateRequest();
    createOpts.clientId = selectedClientId;
    createOpts.requesterEmailAddress = accountEmail || signerEmail.trim();
    createOpts.templateIds = [template_id.trim()];
    createOpts.signers = [primarySigner];
    createOpts.testMode = await getTestMode(selectedClientId, req);
    createOpts.isForEmbeddedSigning = false;

    let response;
    try {
      response = await apiCall(req, 'UnclaimedDraftApi', 'unclaimedDraftCreateEmbeddedWithTemplate', [createOpts], {
        method: 'POST',
        endpoint: '/unclaimed_draft/create_embedded_with_template'
      });
    } catch (err) {
      // If API call fails, throw the error
      throw err;
    }

    // For embedded unclaimed drafts, check if we have a claim_url or signatures
    const unclaimedDraft = response.body?.unclaimedDraft;

    // Register signature request to user (multi-tenant callback routing)
    const sigReqId = unclaimedDraft?.signatureRequest?.signatureRequestId;
    if (sigReqId) {
      const accountId = req.session?.accountInfo?.account_id;
      const accountEmail = req.session?.accountInfo?.email_address;
      const redisClient = req.app.locals.redisClient;
      if (accountId) {
        await registerSignatureRequest(sigReqId, accountId, accountEmail, createOpts.clientId, redisClient);
      }
    }

    // Try to get embedded URL if signatures are available
    if (unclaimedDraft?.signatureRequest?.signatures?.length > 0) {
      const signatureId = unclaimedDraft.signatureRequest.signatures[0].signatureId;

      const embeddedResponse = await apiCall(req, 'EmbeddedApi', 'embeddedSignUrl', [signatureId], {
        method: 'GET',
        endpoint: `/embedded/sign_url/${signatureId}`
      });

      return res.json({
        signUrl: embeddedResponse.body.embedded.signUrl,
        clientId: createOpts.clientId // Tell frontend which client_id was actually used
      });
    }

    // Fallback to claim URL (may not work in iframe)
    const claimUrl = unclaimedDraft?.claimUrl;
    if (!claimUrl) {
      throw new Error('No claim_url or signatures in response');
    }

    console.log('[unclaimed-draft-template] Using claimUrl (prep-and-send flow) with client_id:', createOpts.clientId);

    // Return the claimUrl with a flag indicating it might not work
    return res.json({
      signUrl: claimUrl,
      isClaimUrl: true,
      clientId: createOpts.clientId, // Tell frontend which client_id was actually used
      warning: 'This app returned a prep-and-send URL instead of an embedded signing URL. It may not display correctly in the iframe.'
    });
  } catch (err) {
    console.error('Error in /unclaimed-draft-template:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Route 12: POST /create-template - Generate PDF from markdown and create a Dropbox Sign template
router.post('/create-template', apiLimiter, requireAuth, express.urlencoded({ extended: false }), async (req, res) => {
  const {
    name, email, field1, field2, field3,
    markdownContent, client_id, templateName, logoEnabled
  } = req.body;

  console.log('[CREATE-TEMPLATE] logoEnabled from request:', logoEnabled, 'type:', typeof logoEnabled);

  const CLIENT_ID = process.env.CLIENT_ID;

  if (!markdownContent) {
    return res.status(400).json({ error: 'No markdown content provided.' });
  }

  try {
    // 1. Replace placeholders
    const filledMd = replaceFieldPlaceholders(markdownContent, {
      name: name || '', email: email || '', field1: field1 || '',
      field2: field2 || '', field3: field3 || ''
    });

    // 2. Strip text tags before PDF generation
    // Text tags like [sig|req|signer1] are removed so they don't appear as visible text.
    // Fields will be added manually in the embedded template editor that opens after creation.
    const textTagPattern = /\[(sig|text|initial|date|check|checkbox|cb)\|[^\]]+\]/g;
    const foundTags = filledMd.match(textTagPattern);
    if (foundTags) {
      console.log(`✅ Stripping ${foundTags.length} text tags from PDF:`, foundTags.slice(0, 3));
    }

    const mdWithoutTags = filledMd.replace(textTagPattern, '');

    const templateData = {
      logoEnabled: req.body.logoEnabled !== 'false' && req.body.logoEnabled !== false
    };

    const pdfBuffer = await generatePdfFromMarkdown(mdWithoutTags, templateData);

    // 2. Write PDF to temp file
    const tmpPath = path.join(os.tmpdir(), `template_${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, pdfBuffer);

    // 3. Extract signer roles from text tags
    const signerRoleSet = new Set();
    if (foundTags) {
      foundTags.forEach(tag => {
        // Text tag format: [sig|req|signer1] or [text|req|signer1|label]
        const parts = tag.match(/\[([^\]]+)\]/)[1].split('|');
        if (parts.length >= 3) {
          const signerRole = parts[2]; // e.g., "signer1", "Employee", "Employer"
          signerRoleSet.add(signerRole);
        }
      });
    }

    // Convert to array and sort for consistent ordering
    const signerRoleNames = Array.from(signerRoleSet).sort();

    // Create SubTemplateRole objects
    const signerRoles = signerRoleNames.map((roleName, index) => {
      const role = new DropboxSign.SubTemplateRole();
      // Capitalize first letter for display
      role.name = roleName.charAt(0).toUpperCase() + roleName.slice(1);
      role.order = index;
      return role;
    });

    // Fallback: if no roles found in text tags, use default roles
    if (signerRoles.length === 0) {
      console.log('[CREATE TEMPLATE] No roles found in text tags, using defaults');
      const role1 = new DropboxSign.SubTemplateRole();
      role1.name = 'Signer';
      role1.order = 0;
      signerRoles.push(role1);
    }

    console.log(`[CREATE TEMPLATE] Extracted ${signerRoles.length} signer roles:`, signerRoles.map(r => r.name));

    // 4. Define merge fields (custom fields that can be populated at send time)
    const mergeFields = ['field1', 'field2', 'field3'].map(fieldName => {
      const mf = new DropboxSign.SubMergeField();
      mf.name = fieldName;
      mf.type = 'text';
      return mf;
    });

    // 5. Build the template creation request
    const createReq = new DropboxSign.TemplateCreateEmbeddedDraftRequest();

    // Use selected API App or default CLIENT_ID
    let selectedClientId = client_id || CLIENT_ID;
    if (!selectedClientId) {
      throw new Error('No client_id provided. Please select an API app.');
    }

    createReq.clientId = selectedClientId;
    createReq.files = [fs.createReadStream(tmpPath)];
    createReq.title = templateName || 'Untitled Template';
    createReq.subject = templateName || 'Untitled Template';
    createReq.message = 'Please review and sign this agreement.';
    createReq.signerRoles = signerRoles;
    createReq.mergeFields = mergeFields;
    createReq.testMode = await getTestMode(selectedClientId, req);
    createReq.usePreexistingFields = false; // Text tags stripped, fields added manually in editor
    createReq.showPreview = true;

    let response;
    try {
      response = await apiCall(req, 'TemplateApi', 'templateCreateEmbeddedDraft', [createReq], {
        method: 'POST',
        endpoint: '/template/create_embedded_draft'
      });
    } catch (err) {
      // If API call fails, throw the error
      throw err;
    }

    // 6. Clean up temp file
    fs.unlinkSync(tmpPath);

    const editUrl = response.body?.template?.editUrl;
    const templateId = response.body?.template?.templateId;

    if (!editUrl) {
      throw new Error('No edit_url in response');
    }

    // Invalidate templates cache so the new template appears on refresh
    if (req.session.templatesCache) {
      req.session.templatesCache.data = null; // Clear cache data completely
      req.session.templatesCache.timestamp = 0;
    }

    return res.json({ editUrl, templateId });
  } catch (err) {
    console.error('Error in /create-template:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Route 13: POST /create-template-direct - Create template directly from text tags (no embedded editor)
router.post('/create-template-direct', apiLimiter, requireAuth, express.urlencoded({ extended: false }), async (req, res) => {
  const {
    name, email, field1, field2, field3,
    markdownContent, templateName, logoEnabled,
    client_id
  } = req.body;

  if (!markdownContent) {
    return res.status(400).json({ error: 'No markdown content provided.' });
  }

  try {
    // 1. Replace placeholders and generate PDF
    const filledMd = replaceFieldPlaceholders(markdownContent, {
      name: name || '', email: email || '', field1: field1 || '',
      field2: field2 || '', field3: field3 || ''
    });

    const templateData = {
      logoEnabled: req.body.logoEnabled !== 'false' && req.body.logoEnabled !== false
    };

    const pdfBuffer = await generatePdfFromMarkdown(filledMd, templateData);

    // 2. Write PDF to temp file
    const tmpPath = path.join(os.tmpdir(), `template_${Date.now()}.pdf`);
    fs.writeFileSync(tmpPath, pdfBuffer);

    // 3. Define signer roles
    const role1 = new DropboxSign.SubTemplateRole();
    role1.name = 'Customer';
    role1.order = 0;
    const role2 = new DropboxSign.SubTemplateRole();
    role2.name = 'Provider';
    role2.order = 1;

    // 4. Define merge fields (custom fields that can be populated at send time)
    const mergeFields = ['field1', 'field2', 'field3'].map(fieldName => {
      const mf = new DropboxSign.SubMergeField();
      mf.name = fieldName;
      mf.type = 'text';
      return mf;
    });

    // 5. Build the direct template creation request (NOT embedded draft)
    const CLIENT_ID = process.env.CLIENT_ID;
    const clientIdForTemplate = client_id || CLIENT_ID;
    const createReq = new DropboxSign.TemplateCreateRequest();
    createReq.files = [fs.createReadStream(tmpPath)];
    createReq.title = templateName || 'Untitled Template';
    createReq.signerRoles = [role1, role2];
    createReq.mergeFields = mergeFields;
    createReq.testMode = await getTestMode(clientIdForTemplate, req);
    createReq.usePreexistingFields = true; // Parse text tags automatically

    // Use direct template creation (no embedded editor)
    const response = await apiCall(req, 'TemplateApi', 'templateCreate', [createReq], {
      method: 'POST',
      endpoint: '/template/create'
    });

    // 6. Clean up temp file
    fs.unlinkSync(tmpPath);

    const templateId = response.body?.template?.templateId;

    if (!templateId) {
      throw new Error('No template_id in response');
    }

    // Invalidate templates cache so the new template appears on refresh
    if (req.session.templatesCache) {
      req.session.templatesCache.data = null; // Clear cache data completely
      req.session.templatesCache.timestamp = 0;
    }

    return res.json({
      success: true,
      templateId,
      message: 'Template created successfully with text tags!'
    });
  } catch (err) {
    console.error('Error in /create-template-direct:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Route 14: POST /create-embedded-template - Create embedded template (this route is mentioned but not in the extracted code)
// Skipping this route as it's not present in the provided server.js code

// Route 15: GET /preview-mandate - Preview mandate letterhead
router.get('/preview-mandate', async (req, res) => {
  // 1. Grab the query params from the form
  const {
    signerName1,
    field1,
    field2,
    signerEmail1,
    field3,
    // …any other fields you care about…
  } = req.query;

  try {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const fontkit = (await import('@pdf-lib/fontkit')).default;

    // 2. Load your base PDF
    const pdfPath = path.join(process.cwd(), 'public', 'EV_selling_mandate_luxury.pdf');
    const existingPdfBytes = fs.readFileSync(pdfPath);

    // 3. Create a PDFDocument from it
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // 4. Grab the first page (or whichever page has the placeholders)
    var page = pdfDoc.getPage(0);

    pdfDoc.registerFontkit(fontkit);
    const notoBytes = fs.readFileSync(path.join(process.cwd(), 'public', 'NotoSans-Regular.ttf'));
    const notoSans = await pdfDoc.embedFont(notoBytes);

    // 5. Embed a font
    const helvetica = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // 6. Draw the text at the right coordinates
    //    You will have to tweak these X/Y values so they line up with your PDF's form fields.

    const pageHeight = page.getSize().height;      // e.g. 842 for A4

   // signerName1
    var xPt = 4.58 * 72;  // ≃ 332.64
    var yInFromTop = 3.61;
    var yPt = pageHeight - (yInFromTop * 72);

    page.drawText(signerName1 || '—', {
      x: xPt,
      y: yPt,
      size: 10,
      font: notoSans,
      color: rgb(0, 0, 0),
    });

    // field1
    xPt = 4.43 * 72;  // ≃ 332.64
    yInFromTop = 3.91;
    yPt = pageHeight - (yInFromTop * 72);
    page.drawText(field1 || '—', {
      x: xPt,
      y: yPt,
      size: 10,
      font: notoSans,
      color: rgb(0, 0, 0),
    });

    // currentDate
    const formatDate = (date) => {
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    };
    const currentDate = formatDate(new Date());

    // 7. Draw the text at the right coordinates
    xPt = 4.18 * 72; // ≃ 332.64
    yInFromTop = 4.64;
    yPt = pageHeight - (yInFromTop * 72);
    page.drawText(`${currentDate}`, {
      x: xPt,
      y: yPt,
      size: 10,
      font: notoSans,
      color: rgb(0, 0, 0),
    });

// --- second page -----------------
  // 4. Grab the first page (or whichever page has the placeholders)
    var page = pdfDoc.getPage(1);

   // signerName1
    var xPt = 1.80 * 72;  // ≃ 332.64
    var yInFromTop = 1.46;
    var yPt = pageHeight - (yInFromTop * 72);

    page.drawText(signerName1 || '—', {
      x: xPt,
      y: yPt,
      size: 10,
      font: notoSans,
      color: rgb(0, 0, 0),
    });

    // field1
    xPt = 1.60 * 72;  // ≃ 332.64
    yInFromTop = 3.31;
    yPt = pageHeight - (yInFromTop * 72);
    page.drawText(field1 || '—', {
      x: xPt,
      y: yPt,
      size: 10,
      font: notoSans,
      color: rgb(0, 0, 0),
    });

    // field2
    xPt = 1.40 * 72;  // ≃ 332.64
    var yInFromTop = 3.54;
    var yPt = pageHeight - (yInFromTop * 72);
    page.drawText(field2 || '—', {
      x: xPt,
      y: yPt,
      size: 10,
      font: notoSans,
      color: rgb(0, 0, 0),
    });

 // email
    xPt = 1.60 * 72;  // ≃ 332.64
    yInFromTop = 2;
    yPt = pageHeight - (yInFromTop * 72);
    page.drawText(signerEmail1 || '—', {
      x: xPt,
      y: yPt,
      size: 10,
      font: notoSans,
      color: rgb(0, 0, 0),
    });

    // field3
    xPt = 1.90 * 72;  // ≃ 332.64
    yInFromTop = 4.08;
    yPt = pageHeight - (yInFromTop * 72);
    page.drawText(field3 || '—', {
      x: xPt,
      y: yPt,
      size: 10,
      font: notoSans,
      color: rgb(0, 0, 0),
    });

    // currentDate
    xPt = 6.68 * 72; // ≃ 332.64
    yInFromTop = 7.15;
    yPt = pageHeight - (yInFromTop * 72);
    page.drawText(`${currentDate}`, {
      x: xPt,
      y: yPt,
      size: 10,
      font: notoSans,
      color: rgb(0, 0, 0),
    });

    // 7. Serialize the PDF to bytes
    const pdfBytes = await pdfDoc.save();

    // 8. Stream it back
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview_mandate.pdf"');
    return res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('Error generating PDF preview:', err);
    return res.status(500).send('Could not generate preview');
  }
});

export default router;
