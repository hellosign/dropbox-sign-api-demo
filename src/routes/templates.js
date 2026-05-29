// src/routes/templates.js
import { Router } from 'express';
import express from 'express';
import * as DropboxSign from '@dropbox/sign';
import { requireAuth } from '../middleware/auth.js';
import { apiCall } from '../services/dropbox-sign.js';
import { VERBOSE_LOGGING } from '../config/security.js';

const router = Router();

// Cache TTL for templates list
const SLOW_CACHE_TTL = 10000; // 10 seconds (to catch shared templates quickly)

/**
 * Helper: fetch templates from Dropbox Sign API and update cache
 */
async function refreshTemplatesCache(limit, req) {
  const { getTemplateLabels, getTemplateMergeFields, setTemplateMergeFields } = req.app.locals.redisHelpers;

  const pageSize = Math.min(limit, 20);
  const allTemplates = [];
  let page = 1;
  let hasMore = true;

  // Get account ID for per-user data
  const accountId = req.session?.accountInfo?.account_id || 'global';
  const userTemplateLabels = await getTemplateLabels(accountId);
  const userTemplateMergeFields = await getTemplateMergeFields(accountId);

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
    // Identify templates that need merge field detection (not in Redis cache)
    const templatesNeedingDetection = templates.filter(t => {
      return !userTemplateMergeFields[t.templateId];
    });

    if (VERBOSE_LOGGING && templatesNeedingDetection.length > 0) {
      console.log('[TEMPLATES] Need to detect merge fields for', templatesNeedingDetection.length, 'templates');
    }

    // Fetch details only for templates without metadata
    const templateDetailPromises = templatesNeedingDetection.map(t =>
      apiCall(req, 'TemplateApi', 'templateGet', [t.templateId], {
        method: 'GET',
        endpoint: `/template/${t.templateId}`
      })
      .then(details => ({
        templateId: t.templateId,
        customFields: details.body?.template?.customFields || []
      }))
      .catch(err => {
        if (VERBOSE_LOGGING) console.warn('[TEMPLATES] Could not fetch details for', t.templateId, ':', err?.message);
        return { templateId: t.templateId, customFields: [] };
      })
    );

    const templateDetails = await Promise.all(templateDetailPromises);
    const detailsMap = Object.fromEntries(templateDetails.map(d => [d.templateId, d.customFields]));

    // Store merge field metadata in Redis for templates that were just detected
    for (const t of templatesNeedingDetection) {
      const customFields = detailsMap[t.templateId] || [];
      const mergeFields = customFields.filter(cf => cf.signer === null);

      const hasMergeFields = mergeFields.length > 0;
      const mergeFieldNames = mergeFields.map(mf => mf.name).filter(Boolean);

      // Store in Redis (synchronously to ensure it's saved before response)
      await setTemplateMergeFields(accountId, t.templateId, hasMergeFields, mergeFieldNames);
    }

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

      // Get merge field info from Redis cache (fast) or from detection (slow, first time only)
      let hasMergeFields = false;
      let mergeFieldNames = [];

      const cachedMergeFields = userTemplateMergeFields[t.templateId];
      if (cachedMergeFields) {
        // Use cached data from Redis (fast path)
        hasMergeFields = cachedMergeFields.hasMergeFields;
        mergeFieldNames = cachedMergeFields.mergeFieldNames || [];
      } else if (detailsMap[t.templateId]) {
        // Use freshly detected fields (slow path, only happens once per template)
        const customFields = detailsMap[t.templateId];
        const mergeFields = customFields.filter(cf => cf.signer === null);
        hasMergeFields = mergeFields.length > 0;
        mergeFieldNames = mergeFields.map(mf => mf.name).filter(Boolean);
        if (VERBOSE_LOGGING) console.log('[TEMPLATES] Detected merge fields in', t.title, ':', mergeFieldNames);
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
        hasMergeFields,
        mergeFieldNames,
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

/**
 * GET /api-templates - Get templates list with caching
 * Supports pagination and force refresh
 */
router.get('/', requireAuth, async (req, res) => {
  // Prevent browser caching of user-specific data
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const { getTemplateLabels } = req.app.locals.redisHelpers;
  const limit = Math.min(parseInt(req.query.pageSize, 10) || 25, 100);
  const forceRefresh = req.query.force === 'true';
  const now = Date.now();

  if (VERBOSE_LOGGING) console.log('[API-TEMPLATES] Request from:', req.session.accountInfo?.email_address,
              '| force:', forceRefresh, '| limit:', limit);

  // Session-based cache (per user)
  if (!req.session.templatesCache) {
    req.session.templatesCache = { data: null, limit: 0, timestamp: 0 };
  }

  const cacheAge = req.session.templatesCache.timestamp ? now - req.session.templatesCache.timestamp : 'none';
  const cacheIsFresh = !forceRefresh && req.session.templatesCache.data && req.session.templatesCache.limit === limit &&
      (now - req.session.templatesCache.timestamp) < SLOW_CACHE_TTL;

  if (VERBOSE_LOGGING) console.log('[API-TEMPLATES] Cache status:', cacheIsFresh ? 'FRESH (using cache)' : 'STALE (fetching new)',
              '| age:', cacheAge === 'none' ? 'none' : (cacheAge + 'ms'));

  if (cacheIsFresh) {
    const accountId = req.session?.accountInfo?.account_id || 'global';
    const userTemplateLabels = await getTemplateLabels(accountId);
    const refreshed = req.session.templatesCache.data.map(t => ({ ...t, labels: userTemplateLabels[t.id] || [] }));
    return res.json(refreshed);
  }

  // Stale cache exists: serve it immediately, refresh in background (unless force refresh requested)
  if (!forceRefresh && req.session.templatesCache.data) {
    const accountId = req.session?.accountInfo?.account_id || 'global';
    const userTemplateLabels = await getTemplateLabels(accountId);
    const refreshed = req.session.templatesCache.data.map(t => ({ ...t, labels: userTemplateLabels[t.id] || [] }));
    res.json(refreshed);
    // Background refresh (fire-and-forget)
    refreshTemplatesCache(limit, req).catch(err => console.warn("[/api-templates] Background refresh failed:", err?.message || err));
    return;
  }

  // No cache at all: must fetch synchronously
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await refreshTemplatesCache(limit, req);
      return res.json(result);
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
      console.error("Error in /api-templates:", reason);
      return res.status(500).json({ error: "Failed to fetch templates" });
    }
  }
});

/**
 * PUT /api-templates/:id/metadata - Save template labels
 * Updates template labels in Redis
 */
router.put('/:id/metadata', requireAuth, express.json(), async (req, res) => {
  const accountId = req.session?.accountInfo?.account_id || 'global';
  const { id } = req.params;
  const { labels } = req.body;
  const { setTemplateLabel, getTemplateLabels } = req.app.locals.redisHelpers;

  if (!Array.isArray(labels)) {
    return res.status(400).json({ error: "Missing 'labels' array in request body" });
  }

  await setTemplateLabel(accountId, id, labels.filter(Boolean));
  const userTemplateLabels = await getTemplateLabels(accountId);

  res.json({ success: true, labels: userTemplateLabels[id] });
});

/**
 * GET /api/templates/raw - Raw template list for debugging
 * Fetches templates with and without account_id for comparison
 */
router.get('/raw', requireAuth, async (req, res) => {
  try {
    const accountId = req.session.accountInfo?.account_id;

    console.log('[RAW-TEMPLATES] Fetching for account_id:', accountId, 'email:', req.session.accountInfo?.email_address);

    // Test 1: Without account_id
    const resp1 = await apiCall(req, 'TemplateApi', 'templateList', [undefined, 1, 100], {
      method: 'GET',
      endpoint: '/template/list'
    });

    // Test 2: With account_id
    const resp2 = await apiCall(req, 'TemplateApi', 'templateList', [accountId, 1, 100], {
      method: 'GET',
      endpoint: '/template/list'
    });

    res.json({
      user: {
        email: req.session.accountInfo?.email_address,
        account_id: accountId,
      },
      without_account_id: {
        count: resp1.body?.templates?.length || 0,
        templates: resp1.body?.templates?.map(t => ({
          id: t.templateId,
          title: t.title,
          isCreator: t.isCreator,
          canEdit: t.canEdit,
          accounts: t.accounts?.map(a => a.emailAddress),
        })),
      },
      with_account_id: {
        count: resp2.body?.templates?.length || 0,
        templates: resp2.body?.templates?.map(t => ({
          id: t.templateId,
          title: t.title,
          isCreator: t.isCreator,
          canEdit: t.canEdit,
          accounts: t.accounts?.map(a => a.emailAddress),
        })),
      },
    });
  } catch (err) {
    console.error('[RAW-TEMPLATES] Error:', err?.message);
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/templates/share - Share templates with team/sub-team/member
 * Shares templates with specified email addresses
 */
router.post('/share', requireAuth, express.json(), async (req, res) => {
  try {
    console.log('[SHARE] User:', req.session.accountInfo?.email_address);
    console.log('[SHARE] Request body:', JSON.stringify(req.body, null, 2));

    const { template_ids, share_with, emails, skip_notification } = req.body;

    if (!template_ids || !Array.isArray(template_ids) || template_ids.length === 0) {
      return res.status(400).json({ error: "Missing or invalid template_ids array" });
    }

    if (!share_with || share_with !== 'emails') {
      return res.status(400).json({ error: "Invalid share_with value. Must be 'emails'" });
    }

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: "Missing or invalid emails array" });
    }

    // Determine which users to share with
    let targetUsers = emails.map(email => ({ email_address: email }));

    console.log('[SHARE] Will share with:', targetUsers.map(u => u.email_address));

    // Try to resolve email addresses to account IDs for better team support
    for (let user of targetUsers) {
      try {
        // Try to get account info by email to get account_id
        const accountResp = await apiCall(req, 'AccountApi', 'accountGet', [null, user.email_address], {
          method: 'GET',
          endpoint: '/account'
        });

        if (accountResp.body?.account?.accountId) {
          user.account_id = accountResp.body.account.accountId;
          console.log('[SHARE] Resolved', user.email_address, 'to account_id:', user.account_id);
        }
      } catch (err) {
        // If we can't resolve the account, continue with just email
        console.log('[SHARE] Could not resolve account_id for', user.email_address);
      }
    }

    // Share each template with each target user
    let sharedCount = 0;
    const errors = [];

    console.log('[SHARE] Starting to share', template_ids.length, 'template(s) with', targetUsers.length, 'user(s)');

    for (const templateId of template_ids) {
      for (const user of targetUsers) {
        try {
          const addUserRequest = new DropboxSign.TemplateAddUserRequest();

          // Prefer account_id over email for better team/sub-team support
          if (user.account_id) {
            addUserRequest.accountId = user.account_id;
            console.log('[SHARE] Sharing template', templateId, 'with account_id:', user.account_id, '(', user.email_address, ')');
          } else {
            addUserRequest.emailAddress = user.email_address;
            console.log('[SHARE] Sharing template', templateId, 'with email:', user.email_address);
          }

          addUserRequest.skipNotification = skip_notification || false;

          const shareResp = await apiCall(req, 'TemplateApi', 'templateAddUser', [templateId, addUserRequest], {
            method: 'POST',
            endpoint: `/template/add_user/${templateId}`
          });

          sharedCount++;
          console.log('[SHARE] ✓ Success');
        } catch (err) {
          // Log error but continue with other templates/users
          console.error('[SHARE] ✗ Error sharing with', user.email_address, ':', err?.body?.error?.errorMsg || err?.message);

          const errorMsg = err?.body?.error?.errorMsg || err?.message || 'Unknown error';
          errors.push({
            template_id: templateId,
            user_email: user.email_address,
            error: errorMsg
          });
        }
      }
    }

    console.log('[SHARE] Completed:', sharedCount, 'successful,', errors.length, 'errors');

    // Invalidate templates cache since access has changed
    if (req.session.templatesCache) {
      req.session.templatesCache.timestamp = 0;
    }

    res.json({
      success: true,
      shared_count: sharedCount,
      errors: errors.length > 0 ? errors : undefined,
      total_attempted: template_ids.length * targetUsers.length
    });
  } catch (err) {
    console.error("Error sharing templates:", err?.message || err);
    console.error("Error statusCode:", err?.statusCode);
    console.error("Error body:", err?.body);
    console.error("Error response body:", err?.response?.body);

    const apiError = err?.body?.error?.errorMsg || err?.body?.error_msg || err?.response?.body?.error?.errorMsg;
    const statusCode = err?.statusCode || 500;

    res.status(statusCode).json({
      error: "Failed to share templates",
      details: err?.message,
      apiError: apiError,
      statusCode: statusCode
    });
  }
});

/**
 * DELETE /api/templates/:templateId - Delete a template
 * Removes template from Dropbox Sign and clears local labels
 */
router.delete('/:templateId', requireAuth, async (req, res) => {
  const { getTemplateLabels, setTemplateLabels } = req.app.locals.redisHelpers;

  try {
    const { templateId } = req.params;

    if (!templateId) {
      return res.status(400).json({ error: "Missing template ID" });
    }

    console.log('[DELETE-TEMPLATE] User:', req.session.accountInfo?.email_address, 'Template ID:', templateId);

    // Delete the template
    const response = await apiCall(req, 'TemplateApi', 'templateDelete', [templateId], {
      method: 'DELETE',
      endpoint: `/template/delete/${templateId}`
    });

    console.log('[DELETE-TEMPLATE] ✓ Successfully deleted template:', templateId);

    // Remove from template labels if present
    const accountId = req.session?.accountInfo?.account_id || 'global';
    const userTemplateLabels = await getTemplateLabels(accountId);
    if (userTemplateLabels[templateId]) {
      delete userTemplateLabels[templateId];
      await setTemplateLabels(accountId, userTemplateLabels);
      console.log('[DELETE-TEMPLATE] Removed template label for:', templateId);
    }

    // Invalidate templates cache
    if (req.session.templatesCache) {
      req.session.templatesCache.timestamp = 0;
    }

    res.json({
      success: true,
      template_id: templateId
    });
  } catch (err) {
    console.error('[DELETE-TEMPLATE] Error:', err?.message || err);
    console.error('[DELETE-TEMPLATE] Error body:', err?.body);

    const apiError = err?.body?.error?.errorMsg || err?.body?.error_msg || err?.response?.body?.error?.errorMsg;
    const statusCode = err?.statusCode || 500;

    res.status(statusCode).json({
      error: "Failed to delete template",
      details: err?.message,
      apiError: apiError,
      statusCode: statusCode
    });
  }
});

export default router;
