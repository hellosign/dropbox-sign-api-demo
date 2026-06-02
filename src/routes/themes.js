// src/routes/themes.js
import { Router } from 'express';
import express from 'express';
import { requireSession } from '../middleware/auth.js';

const router = Router();

/**
 * GET /themes - Get themes for current user
 * Returns per-user themes from Redis
 */
router.get('/', requireSession, async (req, res) => {
  // Prevent browser caching of user-specific data
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const accountId = req.session?.accountInfo?.account_id || 'global';
  const { getThemes } = req.app.locals.redisHelpers;

  const userThemes = await getThemes(accountId);
  res.json(userThemes);
});

/**
 * PUT /themes/:id - Update or create a theme
 * Allows PUT to create new themes (for "Save As" functionality)
 */
router.put('/:id', requireSession, express.json(), async (req, res) => {
  const accountId = req.session?.accountInfo?.account_id || 'global';
  const themeId = req.params.id;
  const updatedTheme = req.body;
  const { getThemes, setTheme } = req.app.locals.redisHelpers;

  const userThemes = await getThemes(accountId);

  // Allow PUT to create new themes (for "Save As" functionality)
  const isNewTheme = !userThemes[themeId];

  // Update or create theme via DAL
  try {
    await setTheme(accountId, themeId, updatedTheme);
    console.log(`[Themes] ${isNewTheme ? 'Created' : 'Updated'} theme:`, themeId);
    const updatedThemes = await getThemes(accountId);
    res.json({ success: true, theme: updatedThemes[themeId] });
  } catch (error) {
    console.error("Error saving theme:", error);
    res.status(500).json({ error: "Failed to save theme" });
  }
});

/**
 * DELETE /themes/:id - Delete a theme
 * Optionally deletes associated templates from Dropbox Sign
 */
router.delete('/:id', requireSession, express.json(), async (req, res) => {
  const accountId = req.session?.accountInfo?.account_id || 'global';
  const themeId = req.params.id;
  const { deleteTemplates } = req.body || {};
  const { getThemes, getTemplateLabels, setTemplateLabels, deleteTheme } = req.app.locals.redisHelpers;

  console.log(`[DELETE /themes/${themeId}] Request received, deleteTemplates:`, deleteTemplates);

  const userThemes = await getThemes(accountId);
  if (!userThemes[themeId]) {
    console.log(`[DELETE /themes/${themeId}] Theme not found`);
    return res.status(404).json({ error: "Theme not found" });
  }

  try {
    // Find templates attached to this theme
    const userTemplateLabels = await getTemplateLabels(accountId);
    const attachedTemplateIds = Object.entries(userTemplateLabels)
      .filter(([_, labels]) => labels.includes(themeId))
      .map(([id, _]) => id);

    console.log(`[DELETE /themes/${themeId}] Found ${attachedTemplateIds.length} attached templates`);

    // Delete templates from Dropbox Sign if requested
    if (deleteTemplates && attachedTemplateIds.length > 0) {
      console.log(`[DELETE /themes/${themeId}] Deleting templates from Dropbox Sign...`);
      for (const templateId of attachedTemplateIds) {
        try {
          await apiCall(req, 'TemplateApi', 'templateDelete', [templateId], {
            method: 'DELETE',
            endpoint: `/template/${templateId}`
          });
          console.log(`[DELETE /themes/${themeId}] Successfully deleted template: ${templateId}`);
        } catch (error) {
          console.error(`[DELETE /themes/${themeId}] Failed to delete template ${templateId}:`, error.message);
          // Continue deleting other templates even if one fails
        }
      }
    }

    // Remove template labels for this theme
    console.log(`[DELETE /themes/${themeId}] Removing template labels...`);
    const updatedLabels = { ...userTemplateLabels };
    for (const templateId of attachedTemplateIds) {
      const labels = updatedLabels[templateId] || [];
      updatedLabels[templateId] = labels.filter(l => l !== themeId);
      // Remove entry if no labels left
      if (updatedLabels[templateId].length === 0) {
        delete updatedLabels[templateId];
      }
    }

    // Save updated template labels via DAL
    console.log(`[DELETE /themes/${themeId}] Saving template labels...`);
    await setTemplateLabels(accountId, updatedLabels);

    // Delete theme via DAL
    console.log(`[DELETE /themes/${themeId}] Deleting theme...`);
    await deleteTheme(accountId, themeId);
    console.log(`[DELETE /themes/${themeId}] Theme deleted successfully`);

    const responseData = {
      success: true,
      deletedTheme: themeId,
      deletedTemplates: deleteTemplates ? attachedTemplateIds : [],
      removedLabels: !deleteTemplates ? attachedTemplateIds : []
    };

    console.log(`[DELETE /themes/${themeId}] Sending success response:`, responseData);
    res.json(responseData);
  } catch (error) {
    console.error(`[DELETE /themes/${themeId}] Error:`, error);
    res.status(500).json({ error: "Failed to delete theme: " + error.message });
  }
});

export default router;
