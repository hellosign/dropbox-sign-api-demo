// src/routes/admin.js
import { Router } from 'express';
import { requireAuth, requireSession, requireAdmin } from '../middleware/auth.js';
import { IS_PRODUCTION } from '../../server.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

/**
 * GET /admin - Admin dashboard page
 * Renders admin interface for managing users
 */
router.get('/', requireSession, requireAdmin, (req, res) => {
  res.render('admin', {
    userEmail: req.session.accountInfo?.email_address,
    isAdmin: true
  });
});

/**
 * GET /admin/api/users - List all users
 * Returns list of all active and inactive users
 */
router.get('/api/users', requireSession, requireAdmin, async (req, res) => {
  const { getAllUsers } = req.app.locals.redisHelpers;

  try {
    const users = await getAllUsers();

    res.json({
      success: true,
      count: users.length,
      activeCount: users.filter(u => u.isActive).length,
      inactiveCount: users.filter(u => !u.isActive).length,
      users: users
    });
  } catch (err) {
    console.error('[ADMIN] Error fetching users:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /admin/api/users/:accountId - Get specific user details
 * Returns detailed user data from Redis
 */
router.get('/api/users/:accountId', requireSession, requireAdmin, async (req, res) => {
  const { getUserDataKeys, getAllActiveSessions } = req.app.locals.redisHelpers;

  try {
    const { accountId } = req.params;

    // Get user data from Redis
    const userData = await getUserDataKeys(accountId);

    // Get session info
    const sessions = await getAllActiveSessions();
    const userSession = sessions.find(s => s.data.accountInfo.account_id === accountId);

    res.json({
      success: true,
      accountId,
      session: userSession ? {
        sessionId: userSession.sessionId,
        email: userSession.data.accountInfo.email_address,
        roleCode: userSession.data.accountInfo.role_code,
        lastActivity: userSession.data.lastActivity || null
      } : null,
      data: userData
    });
  } catch (err) {
    console.error('[ADMIN] Error fetching user details:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * DELETE /admin/api/sessions/:sessionId - Force logout a user
 * Terminates a specific user session
 */
router.delete('/api/sessions/:sessionId', requireSession, requireAdmin, async (req, res) => {
  const redisClient = req.app.locals.redisClient;

  try {
    const { sessionId } = req.params;
    console.log(`[ADMIN] Logout request received for sessionId: ${sessionId}`);

    if (!redisClient) {
      return res.status(500).json({
        success: false,
        error: 'Redis not available'
      });
    }

    // Get session info before deleting for logging
    const sessionKey = `sess:${sessionId}`;
    console.log(`[ADMIN] Looking for session key: ${sessionKey}`);
    const sessionData = await redisClient.get(sessionKey);
    console.log(`[ADMIN] Session data found: ${sessionData ? 'yes' : 'no'}`);

    const session = sessionData ? JSON.parse(sessionData) : null;
    const userEmail = session?.accountInfo?.email_address || 'unknown';

    // Delete the session
    const deleteResult = await redisClient.del(sessionKey);
    console.log(`[ADMIN] Delete result: ${deleteResult} (1 = deleted, 0 = not found)`);

    console.log(`[ADMIN] Session ${sessionId} terminated by ${req.session.accountInfo.email_address} (user: ${userEmail})`);

    res.json({
      success: true,
      message: `Session terminated for ${userEmail}`,
      deleted: deleteResult === 1
    });
  } catch (err) {
    console.error('[ADMIN] Error terminating session:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /admin/api/stats - System statistics
 * Returns system-wide statistics and Redis info
 */
router.get('/api/stats', requireSession, requireAdmin, async (req, res) => {
  const { getAllUsers } = req.app.locals.redisHelpers;
  const redisClient = req.app.locals.redisClient;

  try {
    const allUsers = await getAllUsers();
    const activeUsers = allUsers.filter(u => u.isActive);

    // Calculate stats
    const totalSignatureRequests = activeUsers.reduce((sum, u) => sum + u.signatureRequestsCount, 0);
    const totalWebhookEvents = activeUsers.reduce((sum, u) => sum + u.webhookEventsCount, 0);
    const totalActiveSessions = activeUsers.reduce((sum, u) => sum + (u.sessions?.length || 0), 0);

    // Get Redis info
    let redisInfo = {};
    let redisBreakdown = {};
    if (redisClient) {
      try {
        const info = await redisClient.info('memory');
        const lines = info.split('\r\n');
        for (const line of lines) {
          const [key, value] = line.split(':');
          if (key && value) {
            redisInfo[key] = value;
          }
        }

        // Get key counts by pattern
        const keyPatterns = [
          { pattern: 'sess:*', label: 'Sessions' },
          { pattern: 'user:*:api_logs', label: 'API Logs' },
          { pattern: 'sig_req:*', label: 'Signature Requests' },
          { pattern: 'user:*:themes', label: 'User Themes' },
          { pattern: 'user:*:profile', label: 'User Profiles' },
          { pattern: 'user:*:settings', label: 'User Settings' },
          { pattern: 'user:*:app_test_mode', label: 'Test Mode Settings' },
          { pattern: 'user:*:app_webhook_enabled', label: 'Webhook Settings' },
          { pattern: 'onboarding:*', label: 'Onboarding' },
        ];

        for (const { pattern, label } of keyPatterns) {
          const keys = await redisClient.keys(pattern);
          let totalSize = 0;

          // Sample up to 10 keys to estimate size
          const samplesToCheck = keys.slice(0, Math.min(keys.length, 10));
          for (const key of samplesToCheck) {
            const size = await redisClient.memoryUsage(key) || 0;
            totalSize += size;
          }

          // Extrapolate total size from sample
          const avgSize = samplesToCheck.length > 0 ? totalSize / samplesToCheck.length : 0;
          const estimatedTotal = avgSize * keys.length;

          redisBreakdown[label] = {
            count: keys.length,
            size: estimatedTotal,
            sizeHuman: estimatedTotal > 1024 * 1024
              ? `${(estimatedTotal / (1024 * 1024)).toFixed(2)} MB`
              : estimatedTotal > 1024
                ? `${(estimatedTotal / 1024).toFixed(2)} KB`
                : `${estimatedTotal.toFixed(0)} bytes`
          };
        }

        // Get total keys
        const totalKeys = await redisClient.dbSize();
        const accountedKeys = Object.values(redisBreakdown).reduce((sum, val) => sum + val.count, 0);
        redisBreakdown['Other'] = {
          count: totalKeys - accountedKeys,
          size: 0,
          sizeHuman: 'Unknown'
        };

      } catch (err) {
        console.warn('[ADMIN] Failed to get Redis info:', err.message);
      }
    }

    res.json({
      success: true,
      stats: {
        totalUsers: allUsers.length,
        activeUsers: activeUsers.length,
        inactiveUsers: allUsers.length - activeUsers.length,
        totalActiveSessions,
        totalSignatureRequests,
        totalWebhookEvents,
        redisConnected: !!redisClient,
        redisMemory: redisInfo.used_memory_human || 'N/A',
        redisBreakdown,
        environment: IS_PRODUCTION ? 'production' : 'development'
      }
    });
  } catch (err) {
    console.error('[ADMIN] Error fetching stats:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * DELETE /admin/api/users/:accountId/data/:dataType - Clear specific user data
 * Removes specific data type for a user (e.g., themes, settings)
 */
router.delete('/api/users/:accountId/data/:dataType', requireSession, requireAdmin, async (req, res) => {
  const redisClient = req.app.locals.redisClient;
  const { hasExistingData, setOnboardingStatus } = req.app.locals.redisHelpers;

  try {
    const { accountId, dataType } = req.params;

    if (!redisClient) {
      return res.status(500).json({
        success: false,
        error: 'Redis not available'
      });
    }

    const key = `user:${accountId}:${dataType}`;
    await redisClient.del(key);

    console.log(`[ADMIN] Cleared ${key} by ${req.session.accountInfo.email_address}`);

    // If user has no remaining data, reset onboarding status so they see the setup flow
    const userStillHasData = await hasExistingData(accountId);
    if (!userStillHasData) {
      await setOnboardingStatus(accountId, 'pending', req.session);
      console.log(`[ADMIN] Reset onboarding status for ${accountId} (no data remaining)`);
    }

    res.json({
      success: true,
      message: `Cleared ${dataType} for account ${accountId}`
    });
  } catch (err) {
    console.error('[ADMIN] Error clearing user data:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * DELETE /admin/api/users/:accountId - Delete user completely
 * Removes all user data and sessions from Redis
 */
router.delete('/api/users/:accountId', requireSession, requireAdmin, async (req, res) => {
  const { getAllActiveSessions, deleteUserCompletely } = req.app.locals.redisHelpers;
  const redisClient = req.app.locals.redisClient;

  try {
    const { accountId } = req.params;
    const adminEmail = req.session.accountInfo.email_address;

    if (!redisClient) {
      return res.status(500).json({
        success: false,
        error: 'Redis not available'
      });
    }

    // Safety check: prevent admin from deleting themselves
    if (req.session.accountInfo.account_id === accountId) {
      return res.status(403).json({
        success: false,
        error: 'Cannot delete your own account while logged in'
      });
    }

    // Get user info before deletion for logging
    const sessions = await getAllActiveSessions();
    const userSession = sessions.find(s => s.data.accountInfo.account_id === accountId);
    const userEmail = userSession?.data.accountInfo.email_address || 'unknown';

    // Perform complete deletion
    const result = await deleteUserCompletely(accountId);

    console.log(`[ADMIN] User deleted completely by ${adminEmail}:`, {
      userEmail,
      accountId,
      sessionsDeleted: result.sessionsDeleted,
      dataKeysDeleted: result.dataKeysDeleted,
      totalKeys: result.totalKeysDeleted
    });

    res.json({
      success: true,
      message: `User ${userEmail} deleted completely`,
      details: {
        email: userEmail,
        accountId: result.accountId,
        sessionsDeleted: result.sessionsDeleted,
        dataKeysDeleted: result.dataKeysDeleted,
        totalKeysDeleted: result.totalKeysDeleted
      }
    });
  } catch (err) {
    console.error('[ADMIN] Error deleting user:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /admin/api/console-logging - Get console logging settings
 * Note: Uses requireSession (not requireAdmin) so all users can check if logging is enabled
 */
router.get('/api/console-logging', requireSession, async (req, res) => {
  const { redisClient } = req.app.locals;

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    const enabled = await redisClient.get('system:console_logging_enabled');
    const maxSize = await redisClient.get('system:console_logging_max_size');
    const maxFiles = await redisClient.get('system:console_logging_max_files');

    res.json({
      enabled: enabled === 'true',
      maxSizeMB: maxSize ? Math.round(parseInt(maxSize) / (1024 * 1024)) : 10,
      maxFiles: maxFiles ? parseInt(maxFiles) : 3
    });
  } catch (err) {
    console.error('[ADMIN] Error getting console logging settings:', err);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

/**
 * PUT /admin/api/console-logging - Update console logging settings
 */
router.put('/api/console-logging', requireAdmin, async (req, res) => {
  const { redisClient } = req.app.locals;

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    const { enabled, maxSizeMB, maxFiles } = req.body;

    // Convert MB to bytes
    const maxSizeBytes = (maxSizeMB || 10) * 1024 * 1024;

    await redisClient.set('system:console_logging_enabled', enabled ? 'true' : 'false');
    await redisClient.set('system:console_logging_max_size', maxSizeBytes.toString());
    await redisClient.set('system:console_logging_max_files', (maxFiles || 3).toString());

    console.log(`[ADMIN] Console logging settings updated by ${req.session.accountInfo?.email_address}:`, {
      enabled,
      maxSizeMB,
      maxFiles
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[ADMIN] Error saving console logging settings:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

/**
 * POST /admin/api/clear-logs - Clear all log files
 */
router.post('/api/clear-logs', requireAdmin, async (req, res) => {
  try {
    const logsDir = path.join(__dirname, '../../logs');
    const logFiles = [
      'browser-console.log',
      'ngrok-error.log',
      'ngrok-out.log',
      'server-error.log',
      'server-out.log'
    ];

    const filesCleared = [];

    for (const logFile of logFiles) {
      const logPath = path.join(logsDir, logFile);
      try {
        // Write empty string to the file (clears it without deleting)
        await fs.writeFile(logPath, '', 'utf8');
        filesCleared.push(logFile);
      } catch (err) {
        console.warn(`[ADMIN] Could not clear ${logFile}:`, err.message);
      }
    }

    console.log(`[ADMIN] Logs cleared by ${req.session.accountInfo?.email_address}:`, filesCleared);

    res.json({
      success: true,
      filesCleared
    });
  } catch (err) {
    console.error('[ADMIN] Error clearing logs:', err);
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

/**
 * GET /admin/tooltip-management - Tooltip management page
 */
router.get('/tooltip-management', requireSession, requireAdmin, (req, res) => {
  res.render('admin-tooltip-management', {
    userEmail: req.session.accountInfo?.email_address,
    isAdmin: true
  });
});

/**
 * GET /admin/api/tooltips - Get all tooltip configuration
 */
router.get('/api/tooltips', requireSession, requireAdmin, async (req, res) => {
  const { redisClient } = req.app.locals;

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    const config = await redisClient.get('system:tooltips');
    if (!config) {
      // Initialize with defaults if not configured yet
      const { getDefaultTooltipConfig } = await import('../config/tooltip-defaults.js');
      const defaults = getDefaultTooltipConfig();
      await redisClient.set('system:tooltips', JSON.stringify(defaults));
      return res.json({ success: true, config: defaults });
    }

    res.json({ success: true, config: JSON.parse(config) });
  } catch (err) {
    console.error('[ADMIN] Error fetching tooltips:', err);
    res.status(500).json({ error: 'Failed to fetch tooltips' });
  }
});

/**
 * PUT /admin/api/tooltips/settings - Update global tooltip settings
 * NOTE: Must come BEFORE /:tooltipId route to avoid matching "settings" as a tooltip ID
 */
router.put('/api/tooltips/settings', requireSession, requireAdmin, async (req, res) => {
  const { redisClient } = req.app.locals;
  const { enabled, defaultPosition, showDelay, hideDelay } = req.body;

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    const config = await redisClient.get('system:tooltips');
    if (!config) {
      return res.status(404).json({ error: 'Tooltip configuration not found' });
    }

    const data = JSON.parse(config);

    if (enabled !== undefined) data.globalSettings.enabled = enabled;
    if (defaultPosition !== undefined) data.globalSettings.defaultPosition = defaultPosition;
    if (showDelay !== undefined) data.globalSettings.showDelay = parseInt(showDelay);
    if (hideDelay !== undefined) data.globalSettings.hideDelay = parseInt(hideDelay);

    await redisClient.set('system:tooltips', JSON.stringify(data));

    console.log(`[ADMIN] Global tooltip settings updated by ${req.session.accountInfo.email_address}:`, { enabled, defaultPosition, showDelay, hideDelay });

    res.json({ success: true, settings: data.globalSettings });
  } catch (err) {
    console.error('[ADMIN] Error updating tooltip settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * PUT /admin/api/tooltips/bulk - Bulk update tooltips
 * NOTE: Must come BEFORE /:tooltipId route to avoid matching "bulk" as a tooltip ID
 */
router.put('/api/tooltips/bulk', requireSession, requireAdmin, async (req, res) => {
  const { redisClient } = req.app.locals;
  const { tooltipIds, updates } = req.body;

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    if (!Array.isArray(tooltipIds) || !updates) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const config = await redisClient.get('system:tooltips');
    if (!config) {
      return res.status(404).json({ error: 'Tooltip configuration not found' });
    }

    const data = JSON.parse(config);
    let updated = 0;

    for (const tooltipId of tooltipIds) {
      if (data.tooltips[tooltipId]) {
        if (updates.enabled !== undefined) {
          data.tooltips[tooltipId].enabled = updates.enabled;
        }
        data.tooltips[tooltipId].lastModified = new Date().toISOString();
        updated++;
      }
    }

    await redisClient.set('system:tooltips', JSON.stringify(data));

    console.log(`[ADMIN] Bulk updated ${updated} tooltips by ${req.session.accountInfo.email_address}`);

    res.json({ success: true, updated });
  } catch (err) {
    console.error('[ADMIN] Error bulk updating tooltips:', err);
    res.status(500).json({ error: 'Failed to bulk update' });
  }
});

/**
 * PUT /admin/api/tooltips/:tooltipId - Update single tooltip
 * NOTE: Must come AFTER /settings and /bulk routes (more specific routes first)
 */
router.put('/api/tooltips/:tooltipId', requireSession, requireAdmin, async (req, res) => {
  const { redisClient } = req.app.locals;
  const { tooltipId } = req.params;
  const { text, position, enabled, sourceUrl } = req.body;

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    // Validation
    if (text && text.length > 500) {
      return res.status(400).json({ error: 'Tooltip text exceeds 500 characters' });
    }
    if (position && !['top', 'bottom', 'left', 'right'].includes(position)) {
      return res.status(400).json({ error: 'Invalid position value' });
    }
    if (sourceUrl && sourceUrl.length > 0) {
      // Basic URL validation
      try {
        new URL(sourceUrl);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid URL format for sourceUrl' });
      }
    }

    const config = await redisClient.get('system:tooltips');
    if (!config) {
      return res.status(404).json({ error: 'Tooltip configuration not found' });
    }

    const data = JSON.parse(config);
    if (!data.tooltips[tooltipId]) {
      return res.status(404).json({ error: 'Tooltip not found' });
    }

    // Update fields
    if (text !== undefined) data.tooltips[tooltipId].text = text;
    if (position !== undefined) data.tooltips[tooltipId].position = position;
    if (enabled !== undefined) data.tooltips[tooltipId].enabled = enabled;
    if (sourceUrl !== undefined) data.tooltips[tooltipId].sourceUrl = sourceUrl;
    data.tooltips[tooltipId].lastModified = new Date().toISOString();

    await redisClient.set('system:tooltips', JSON.stringify(data));

    console.log(`[ADMIN] Tooltip ${tooltipId} updated by ${req.session.accountInfo.email_address}:`, { text, position, enabled, sourceUrl });

    res.json({ success: true, tooltip: data.tooltips[tooltipId] });
  } catch (err) {
    console.error('[ADMIN] Error updating tooltip:', err);
    res.status(500).json({ error: 'Failed to update tooltip' });
  }
});

/**
 * POST /admin/api/tooltips/reset - Reset all tooltips to defaults
 */
router.post('/api/tooltips/reset', requireSession, requireAdmin, async (req, res) => {
  const { redisClient } = req.app.locals;

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    const { getDefaultTooltipConfig } = await import('../data/tooltip-defaults.js');
    const defaults = getDefaultTooltipConfig();
    await redisClient.set('system:tooltips', JSON.stringify(defaults));

    console.log(`[ADMIN] Tooltips reset to defaults by ${req.session.accountInfo.email_address}`);

    res.json({ success: true, message: 'Tooltips reset to defaults', config: defaults });
  } catch (err) {
    console.error('[ADMIN] Error resetting tooltips:', err);
    res.status(500).json({ error: 'Failed to reset tooltips' });
  }
});

/**
 * GET /admin/access-control - Access control management page
 */
router.get('/access-control', requireSession, requireAdmin, (req, res) => {
  res.render('admin-access-control', {
    userEmail: req.session.accountInfo?.email_address,
    isAdmin: true
  });
});

/**
 * GET /admin/security - Security events dashboard
 */
router.get('/security', requireSession, requireAdmin, (req, res) => {
  res.render('admin-security', {
    userEmail: req.session.accountInfo?.email_address,
    isAdmin: true
  });
});

/**
 * GET /admin/api/security/events - Get security events
 */
router.get('/api/security/events', requireSession, requireAdmin, async (req, res) => {
  const { getSecurityEvents } = req.app.locals.securityLogger;

  try {
    const { ip, limit = 100, eventType } = req.query;
    const events = await getSecurityEvents({ ip, limit: parseInt(limit), eventType });

    res.json({
      success: true,
      count: events.length,
      events
    });
  } catch (err) {
    console.error('[ADMIN] Error fetching security events:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /admin/api/security/stats - Get security statistics
 */
router.get('/api/security/stats', requireSession, requireAdmin, async (req, res) => {
  const { getSecurityStats } = req.app.locals.securityLogger;

  try {
    const stats = await getSecurityStats();

    res.json({
      success: true,
      stats
    });
  } catch (err) {
    console.error('[ADMIN] Error fetching security stats:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /admin/api/security/block-ip - Manually block an IP
 */
router.post('/api/security/block-ip', requireSession, requireAdmin, async (req, res) => {
  const { blockIP } = req.app.locals.securityLogger;

  try {
    const { ip, duration = 86400 } = req.body; // Default 24 hours

    if (!ip) {
      return res.status(400).json({ success: false, error: 'IP address required' });
    }

    const success = await blockIP(ip, parseInt(duration));

    res.json({
      success,
      message: success ? `IP ${ip} blocked for ${duration} seconds` : 'Failed to block IP'
    });
  } catch (err) {
    console.error('[ADMIN] Error blocking IP:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /admin/api/security/clear-logs - Clear all security logs
 */
router.post('/api/security/clear-logs', requireSession, requireAdmin, async (req, res) => {
  const redisClient = req.app.locals.redisClient;

  try {
    const adminEmail = req.session.accountInfo?.email_address;
    let filesCleared = [];
    let redisKeysDeleted = 0;

    // 1. Clear security log file
    const logsDir = path.join(__dirname, '../../logs');
    const securityLogFile = path.join(logsDir, 'security.log');

    try {
      await fs.writeFile(securityLogFile, '', 'utf8');
      filesCleared.push('security.log');
    } catch (err) {
      console.warn(`[ADMIN] Could not clear security.log:`, err.message);
    }

    // 2. Clear Redis security keys
    if (redisClient) {
      try {
        // Get all security keys
        const securityKeys = await redisClient.keys('security:*');

        if (securityKeys.length > 0) {
          // Delete all security keys
          redisKeysDeleted = await redisClient.del(securityKeys);
        }
      } catch (err) {
        console.error('[ADMIN] Error clearing Redis security keys:', err);
      }
    }

    console.log(`[ADMIN] Security logs cleared by ${adminEmail}:`, {
      filesCleared,
      redisKeysDeleted
    });

    res.json({
      success: true,
      message: 'Security logs cleared successfully',
      details: {
        filesCleared,
        redisKeysDeleted
      }
    });
  } catch (err) {
    console.error('[ADMIN] Error clearing security logs:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to clear security logs'
    });
  }
});

/**
 * GET /admin/api/access-control - Get current access control settings
 */
router.get('/api/access-control', requireSession, requireAdmin, async (req, res) => {
  const { redisClient } = req.app.locals;
  const { getAllActiveSessions } = req.app.locals.redisHelpers;
  const { getAllowedDomains, getAllowedEmails, getAdminEmails, ALLOWED_DOMAINS, ALLOWED_EMAILS, ADMIN_EMAILS } = await import('../config/constants.js');

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    // Get current settings (from Redis or fallback to .env)
    const allowedDomains = await getAllowedDomains(redisClient);
    const allowedEmails = await getAllowedEmails(redisClient);
    const adminEmails = await getAdminEmails(redisClient);

    // Get baseline from .env
    const baselineDomains = ALLOWED_DOMAINS;
    const baselineEmails = ALLOWED_EMAILS;
    const baselineAdmins = ADMIN_EMAILS;

    // Count active sessions per domain/email
    const sessions = await getAllActiveSessions();
    const domainCounts = {};
    const emailCounts = {};

    sessions.forEach(session => {
      const email = session.data.accountInfo?.email_address?.toLowerCase();
      if (email) {
        const domain = email.split('@')[1];
        domainCounts[domain] = (domainCounts[domain] || 0) + 1;
        emailCounts[email] = (emailCounts[email] || 0) + 1;
      }
    });

    res.json({
      success: true,
      current: {
        domains: allowedDomains,
        emails: allowedEmails,
        admins: adminEmails
      },
      baseline: {
        domains: baselineDomains,
        emails: baselineEmails,
        admins: baselineAdmins
      },
      sessionCounts: {
        domains: domainCounts,
        emails: emailCounts
      }
    });
  } catch (err) {
    console.error('[ADMIN] Error getting access control:', err);
    res.status(500).json({ error: 'Failed to get access control settings' });
  }
});

/**
 * POST /admin/api/access-control/add-domain - Add allowed domain
 */
router.post('/api/access-control/add-domain', requireSession, requireAdmin, async (req, res) => {
  const { redisClient } = req.app.locals;
  const { logSecurityEvent } = req.app.locals.securityLogger || {};
  const { getAllowedDomains } = await import('../config/constants.js');

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    const { domain } = req.body;
    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({ error: 'Domain is required' });
    }

    // Validate domain format
    const domainLower = domain.trim().toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domainLower)) {
      return res.status(400).json({ error: 'Invalid domain format' });
    }

    // Get current domains
    const currentDomains = await getAllowedDomains(redisClient);

    // Check if already exists
    if (currentDomains.includes(domainLower)) {
      return res.status(400).json({ error: 'Domain already in whitelist' });
    }

    // Add domain
    const updatedDomains = [...currentDomains, domainLower];
    await redisClient.set('system:allowed_domains', JSON.stringify(updatedDomains));

    console.log(`[ADMIN] Domain added by ${req.session.accountInfo.email_address}: ${domainLower}`);

    // Log security event
    if (logSecurityEvent) {
      await logSecurityEvent({
        eventType: 'access_control_changed',
        ip: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip,
        userAgent: req.headers['user-agent'],
        suspicionScore: 0,
        reasons: [`Admin added domain: ${domainLower}`],
        adminEmail: req.session.accountInfo.email_address
      });
    }

    res.json({
      success: true,
      message: `Domain ${domainLower} added`,
      domains: updatedDomains
    });
  } catch (err) {
    console.error('[ADMIN] Error adding domain:', err);
    res.status(500).json({ error: 'Failed to add domain' });
  }
});

/**
 * POST /admin/api/access-control/remove-domain - Remove allowed domain
 */
router.post('/api/access-control/remove-domain', requireSession, requireAdmin, async (req, res) => {
  const { redisClient } = req.app.locals;
  const { logSecurityEvent } = req.app.locals.securityLogger || {};
  const { getAllowedDomains } = await import('../config/constants.js');

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    const { domain } = req.body;
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }

    const domainLower = domain.trim().toLowerCase();

    // Prevent admin from removing their own domain
    const adminEmail = req.session.accountInfo.email_address.toLowerCase();
    const adminDomain = adminEmail.split('@')[1];
    if (domainLower === adminDomain) {
      return res.status(403).json({ error: 'Cannot remove your own domain (would lock you out)' });
    }

    // Get current domains
    const currentDomains = await getAllowedDomains(redisClient);

    // Check if exists
    if (!currentDomains.includes(domainLower)) {
      return res.status(400).json({ error: 'Domain not in whitelist' });
    }

    // Remove domain
    const updatedDomains = currentDomains.filter(d => d !== domainLower);
    await redisClient.set('system:allowed_domains', JSON.stringify(updatedDomains));

    console.log(`[ADMIN] Domain removed by ${req.session.accountInfo.email_address}: ${domainLower}`);

    // Log security event
    if (logSecurityEvent) {
      await logSecurityEvent({
        eventType: 'access_control_changed',
        ip: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip,
        userAgent: req.headers['user-agent'],
        suspicionScore: 0,
        reasons: [`Admin removed domain: ${domainLower}`],
        adminEmail: req.session.accountInfo.email_address
      });
    }

    res.json({
      success: true,
      message: `Domain ${domainLower} removed (blocks new logins, existing sessions remain active)`,
      domains: updatedDomains
    });
  } catch (err) {
    console.error('[ADMIN] Error removing domain:', err);
    res.status(500).json({ error: 'Failed to remove domain' });
  }
});

/**
 * POST /admin/api/access-control/add-email - Add allowed email
 */
router.post('/api/access-control/add-email', requireSession, requireAdmin, async (req, res) => {
  const { redisClient } = req.app.locals;
  const { logSecurityEvent } = req.app.locals.securityLogger || {};
  const { getAllowedEmails } = await import('../config/constants.js');

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Validate email format
    const emailLower = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Get current emails
    const currentEmails = await getAllowedEmails(redisClient);

    // Check if already exists
    if (currentEmails.includes(emailLower)) {
      return res.status(400).json({ error: 'Email already in whitelist' });
    }

    // Add email
    const updatedEmails = [...currentEmails, emailLower];
    await redisClient.set('system:allowed_emails', JSON.stringify(updatedEmails));

    console.log(`[ADMIN] Email added by ${req.session.accountInfo.email_address}: ${emailLower}`);

    // Log security event
    if (logSecurityEvent) {
      await logSecurityEvent({
        eventType: 'access_control_changed',
        ip: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip,
        userAgent: req.headers['user-agent'],
        suspicionScore: 0,
        reasons: [`Admin added email: ${emailLower}`],
        adminEmail: req.session.accountInfo.email_address
      });
    }

    res.json({
      success: true,
      message: `Email ${emailLower} added`,
      emails: updatedEmails
    });
  } catch (err) {
    console.error('[ADMIN] Error adding email:', err);
    res.status(500).json({ error: 'Failed to add email' });
  }
});

/**
 * POST /admin/api/access-control/remove-email - Remove allowed email
 */
router.post('/api/access-control/remove-email', requireSession, requireAdmin, async (req, res) => {
  const { redisClient } = req.app.locals;
  const { logSecurityEvent } = req.app.locals.securityLogger || {};
  const { getAllowedEmails } = await import('../config/constants.js');

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const emailLower = email.trim().toLowerCase();

    // Prevent admin from removing their own email
    const adminEmail = req.session.accountInfo.email_address.toLowerCase();
    if (emailLower === adminEmail) {
      return res.status(403).json({ error: 'Cannot remove your own email (would lock you out)' });
    }

    // Get current emails
    const currentEmails = await getAllowedEmails(redisClient);

    // Check if exists
    if (!currentEmails.includes(emailLower)) {
      return res.status(400).json({ error: 'Email not in whitelist' });
    }

    // Remove email
    const updatedEmails = currentEmails.filter(e => e !== emailLower);
    await redisClient.set('system:allowed_emails', JSON.stringify(updatedEmails));

    console.log(`[ADMIN] Email removed by ${req.session.accountInfo.email_address}: ${emailLower}`);

    // Log security event
    if (logSecurityEvent) {
      await logSecurityEvent({
        eventType: 'access_control_changed',
        ip: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip,
        userAgent: req.headers['user-agent'],
        suspicionScore: 0,
        reasons: [`Admin removed email: ${emailLower}`],
        adminEmail: req.session.accountInfo.email_address
      });
    }

    res.json({
      success: true,
      message: `Email ${emailLower} removed (blocks new logins, existing sessions remain active)`,
      emails: updatedEmails
    });
  } catch (err) {
    console.error('[ADMIN] Error removing email:', err);
    res.status(500).json({ error: 'Failed to remove email' });
  }
});

/**
 * POST /admin/api/access-control/force-logout-domain - Force logout all sessions from domain
 */
router.post('/api/access-control/force-logout-domain', requireSession, requireAdmin, async (req, res) => {
  const { redisClient } = req.app.locals;
  const { getAllActiveSessions } = req.app.locals.redisHelpers;
  const { logSecurityEvent } = req.app.locals.securityLogger || {};

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    const { domain } = req.body;
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }

    const domainLower = domain.trim().toLowerCase();

    // Prevent admin from logging themselves out
    const adminEmail = req.session.accountInfo.email_address.toLowerCase();
    const adminDomain = adminEmail.split('@')[1];
    if (domainLower === adminDomain) {
      return res.status(403).json({ error: 'Cannot force logout your own domain (would lock you out)' });
    }

    // Get all sessions and filter by domain
    const sessions = await getAllActiveSessions();
    const sessionsToDelete = sessions.filter(s => {
      const email = s.data.accountInfo?.email_address?.toLowerCase();
      if (email) {
        const sessDomain = email.split('@')[1];
        return sessDomain === domainLower;
      }
      return false;
    });

    // Delete sessions
    let deletedCount = 0;
    for (const session of sessionsToDelete) {
      const sessionKey = `sess:${session.sessionId}`;
      await redisClient.del(sessionKey);
      deletedCount++;
    }

    console.log(`[ADMIN] Force logout domain ${domainLower} by ${adminEmail}: ${deletedCount} sessions deleted`);

    // Log security event
    if (logSecurityEvent) {
      await logSecurityEvent({
        eventType: 'access_control_changed',
        ip: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip,
        userAgent: req.headers['user-agent'],
        suspicionScore: 0,
        reasons: [`Admin forced logout for domain: ${domainLower} (${deletedCount} sessions)`],
        adminEmail: req.session.accountInfo.email_address
      });
    }

    res.json({
      success: true,
      message: `Force logged out ${deletedCount} session(s) from @${domainLower}`,
      deletedCount
    });
  } catch (err) {
    console.error('[ADMIN] Error force logout domain:', err);
    res.status(500).json({ error: 'Failed to force logout' });
  }
});

/**
 * POST /admin/api/access-control/force-logout-email - Force logout specific email
 */
router.post('/api/access-control/force-logout-email', requireSession, requireAdmin, async (req, res) => {
  const { redisClient } = req.app.locals;
  const { getAllActiveSessions } = req.app.locals.redisHelpers;
  const { logSecurityEvent } = req.app.locals.securityLogger || {};

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const emailLower = email.trim().toLowerCase();

    // Prevent admin from logging themselves out
    const adminEmail = req.session.accountInfo.email_address.toLowerCase();
    if (emailLower === adminEmail) {
      return res.status(403).json({ error: 'Cannot force logout yourself (would lock you out)' });
    }

    // Get all sessions and filter by email
    const sessions = await getAllActiveSessions();
    const sessionsToDelete = sessions.filter(s => {
      const sessEmail = s.data.accountInfo?.email_address?.toLowerCase();
      return sessEmail === emailLower;
    });

    // Delete sessions
    let deletedCount = 0;
    for (const session of sessionsToDelete) {
      const sessionKey = `sess:${session.sessionId}`;
      await redisClient.del(sessionKey);
      deletedCount++;
    }

    console.log(`[ADMIN] Force logout email ${emailLower} by ${adminEmail}: ${deletedCount} sessions deleted`);

    // Log security event
    if (logSecurityEvent) {
      await logSecurityEvent({
        eventType: 'access_control_changed',
        ip: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip,
        userAgent: req.headers['user-agent'],
        suspicionScore: 0,
        reasons: [`Admin forced logout for email: ${emailLower} (${deletedCount} sessions)`],
        adminEmail: req.session.accountInfo.email_address
      });
    }

    res.json({
      success: true,
      message: `Force logged out ${deletedCount} session(s) for ${emailLower}`,
      deletedCount
    });
  } catch (err) {
    console.error('[ADMIN] Error force logout email:', err);
    res.status(500).json({ error: 'Failed to force logout' });
  }
});

/**
 * POST /admin/api/access-control/add-admin - Add admin email
 */
router.post('/api/access-control/add-admin', requireSession, requireAdmin, async (req, res) => {
  const { redisClient } = req.app.locals;
  const { logSecurityEvent } = req.app.locals.securityLogger || {};
  const { getAdminEmails } = await import('../config/constants.js');

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Validate email format
    const emailLower = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Get current admins
    const currentAdmins = await getAdminEmails(redisClient);

    // Check if already exists
    if (currentAdmins.includes(emailLower)) {
      return res.status(400).json({ error: 'Email already in admin list' });
    }

    // Add admin
    const updatedAdmins = [...currentAdmins, emailLower];
    await redisClient.set('system:admin_emails', JSON.stringify(updatedAdmins));

    console.log(`[ADMIN] Admin added by ${req.session.accountInfo.email_address}: ${emailLower}`);

    // Log security event
    if (logSecurityEvent) {
      await logSecurityEvent({
        eventType: 'access_control_changed',
        ip: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip,
        userAgent: req.headers['user-agent'],
        suspicionScore: 0,
        reasons: [`Admin added admin: ${emailLower}`],
        adminEmail: req.session.accountInfo.email_address
      });
    }

    res.json({
      success: true,
      message: `Admin ${emailLower} added`,
      admins: updatedAdmins
    });
  } catch (err) {
    console.error('[ADMIN] Error adding admin:', err);
    res.status(500).json({ error: 'Failed to add admin' });
  }
});

/**
 * POST /admin/api/access-control/remove-admin - Remove admin email
 */
router.post('/api/access-control/remove-admin', requireSession, requireAdmin, async (req, res) => {
  const { redisClient } = req.app.locals;
  const { logSecurityEvent } = req.app.locals.securityLogger || {};
  const { getAdminEmails } = await import('../config/constants.js');

  try {
    if (!redisClient) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const emailLower = email.trim().toLowerCase();

    // Prevent admin from removing themselves
    const currentAdminEmail = req.session.accountInfo.email_address.toLowerCase();
    if (emailLower === currentAdminEmail) {
      return res.status(403).json({ error: 'Cannot remove yourself from admin list (would lock you out)' });
    }

    // Get current admins
    const currentAdmins = await getAdminEmails(redisClient);

    // Check if exists
    if (!currentAdmins.includes(emailLower)) {
      return res.status(400).json({ error: 'Email not in admin list' });
    }

    // Prevent removing last admin
    if (currentAdmins.length === 1) {
      return res.status(403).json({ error: 'Cannot remove the last admin (system would be locked)' });
    }

    // Remove admin
    const updatedAdmins = currentAdmins.filter(e => e !== emailLower);
    await redisClient.set('system:admin_emails', JSON.stringify(updatedAdmins));

    console.log(`[ADMIN] Admin removed by ${req.session.accountInfo.email_address}: ${emailLower}`);

    // Log security event
    if (logSecurityEvent) {
      await logSecurityEvent({
        eventType: 'access_control_changed',
        ip: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip,
        userAgent: req.headers['user-agent'],
        suspicionScore: 0,
        reasons: [`Admin removed admin: ${emailLower}`],
        adminEmail: req.session.accountInfo.email_address
      });
    }

    res.json({
      success: true,
      message: `Admin ${emailLower} removed`,
      admins: updatedAdmins
    });
  } catch (err) {
    console.error('[ADMIN] Error removing admin:', err);
    res.status(500).json({ error: 'Failed to remove admin' });
  }
});

/**
 * GET /admin/theme-management - Theme management page
 */
router.get('/theme-management', requireSession, requireAdmin, (req, res) => {
  res.render('admin-theme-management', {
    userEmail: req.session.accountInfo?.email_address,
    isAdmin: true
  });
});

/**
 * GET /admin/api/themes/defaults - Get all default themes
 */
router.get('/api/themes/defaults', requireSession, requireAdmin, async (req, res) => {
  try {
    const themesPath = path.join(process.cwd(), 'config/themes.json');
    const themesData = await fs.readFile(themesPath, 'utf-8');
    const themes = JSON.parse(themesData);

    res.json({
      success: true,
      themes
    });
  } catch (err) {
    console.error('[ADMIN] Error reading default themes:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * PUT /admin/api/themes/defaults/:themeId - Add or update a theme in defaults
 */
router.put('/api/themes/defaults/:themeId', requireSession, requireAdmin, async (req, res) => {
  try {
    const { themeId } = req.params;
    const { themeData } = req.body;

    // Validate theme structure
    if (!themeData || !themeData.id || !themeData.name || !themeData.sections) {
      return res.status(400).json({
        success: false,
        error: 'Invalid theme structure. Required fields: id, name, sections'
      });
    }

    // Ensure themeId matches themeData.id
    if (themeData.id !== themeId) {
      return res.status(400).json({
        success: false,
        error: 'Theme ID mismatch'
      });
    }

    const themesPath = path.join(process.cwd(), 'config/themes.json');
    const backupPath = path.join(process.cwd(), 'config/themes.json.backup');

    // Read current themes
    const themesContent = await fs.readFile(themesPath, 'utf-8');
    const themes = JSON.parse(themesContent);

    // Create backup
    await fs.writeFile(backupPath, themesContent);
    console.log('[ADMIN] Created backup of themes.json');

    // Update themes
    themes[themeId] = themeData;

    // Write back to file
    await fs.writeFile(themesPath, JSON.stringify(themes, null, 2));
    console.log(`[ADMIN] Updated theme ${themeId} in config/themes.json`);

    res.json({
      success: true,
      message: 'Theme added to defaults'
    });
  } catch (err) {
    console.error('[ADMIN] Error updating default theme:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * DELETE /admin/api/themes/defaults/:themeId - Remove a theme from defaults
 */
router.delete('/api/themes/defaults/:themeId', requireSession, requireAdmin, async (req, res) => {
  try {
    const { themeId } = req.params;

    const themesPath = path.join(process.cwd(), 'config/themes.json');
    const backupPath = path.join(process.cwd(), 'config/themes.json.backup');

    // Read current themes
    const themesContent = await fs.readFile(themesPath, 'utf-8');
    const themes = JSON.parse(themesContent);

    // Check if theme exists
    if (!themes[themeId]) {
      return res.status(404).json({
        success: false,
        error: 'Theme not found in defaults'
      });
    }

    // Create backup
    await fs.writeFile(backupPath, themesContent);
    console.log('[ADMIN] Created backup of themes.json');

    // Delete theme
    delete themes[themeId];

    // Write back to file
    await fs.writeFile(themesPath, JSON.stringify(themes, null, 2));
    console.log(`[ADMIN] Removed theme ${themeId} from config/themes.json`);

    res.json({
      success: true,
      message: 'Theme removed from defaults'
    });
  } catch (err) {
    console.error('[ADMIN] Error deleting default theme:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /admin/api/themes/user-count/:themeId - Count users who have a theme
 */
router.get('/api/themes/user-count/:themeId', requireSession, requireAdmin, async (req, res) => {
  try {
    const { themeId } = req.params;
    const { getAllUsers, getThemes } = req.app.locals.redisHelpers;

    const users = await getAllUsers();
    const usersWithTheme = [];

    for (const user of users) {
      const userThemes = await getThemes(user.accountId);
      if (userThemes[themeId]) {
        usersWithTheme.push(user.email);
      }
    }

    res.json({
      success: true,
      count: usersWithTheme.length,
      users: usersWithTheme
    });
  } catch (err) {
    console.error('[ADMIN] Error counting users with theme:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /admin/api/themes/publish/:themeId - Publish a theme to all users
 */
router.post('/api/themes/publish/:themeId', requireSession, requireAdmin, async (req, res) => {
  try {
    const { themeId } = req.params;
    const { themeData, overwriteExisting } = req.body;

    if (!themeData) {
      return res.status(400).json({
        success: false,
        error: 'Theme data is required'
      });
    }

    const { publishThemeToAllUsers } = req.app.locals.redisHelpers;
    const result = await publishThemeToAllUsers(themeId, themeData, overwriteExisting || false);

    res.json({
      success: true,
      publishedTo: result.publishedCount,
      skipped: result.skippedCount,
      total: result.totalUsers
    });
  } catch (err) {
    console.error('[ADMIN] Error publishing theme:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * DELETE /admin/api/themes/remove-from-users/:themeId - Remove a theme from all users
 */
router.delete('/api/themes/remove-from-users/:themeId', requireSession, requireAdmin, async (req, res) => {
  try {
    const { themeId } = req.params;
    const { removeThemeFromAllUsers } = req.app.locals.redisHelpers;

    const result = await removeThemeFromAllUsers(themeId);

    res.json({
      success: true,
      removedFrom: result.removedCount,
      usersWithTheme: result.removedCount
    });
  } catch (err) {
    console.error('[ADMIN] Error removing theme from users:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /admin/api/themes/import - Import a theme from JSON file
 */
router.post('/api/themes/import', requireSession, requireAdmin, async (req, res) => {
  try {
    const { themeData, addToDefaults, publishToUsers } = req.body;

    if (!themeData) {
      return res.status(400).json({
        success: false,
        error: 'Theme data is required'
      });
    }

    // Validate theme structure
    if (!themeData.id || !themeData.name || !themeData.sections) {
      return res.status(400).json({
        success: false,
        error: 'Invalid theme structure. Required fields: id, name, sections'
      });
    }

    const themeId = themeData.id;
    let addedToDefaults = false;
    let publishedCount = 0;

    // Add to defaults if requested
    if (addToDefaults) {
      const themesPath = path.join(process.cwd(), 'config/themes.json');
      const backupPath = path.join(process.cwd(), 'config/themes.json.backup');

      const themesContent = await fs.readFile(themesPath, 'utf-8');
      const themes = JSON.parse(themesContent);

      // Create backup
      await fs.writeFile(backupPath, themesContent);

      // Add theme
      themes[themeId] = themeData;

      // Write back
      await fs.writeFile(themesPath, JSON.stringify(themes, null, 2));
      console.log(`[ADMIN] Imported theme ${themeId} to config/themes.json`);
      addedToDefaults = true;
    }

    // Publish to users if requested
    if (publishToUsers) {
      const { publishThemeToAllUsers } = req.app.locals.redisHelpers;
      const result = await publishThemeToAllUsers(themeId, themeData, false);
      publishedCount = result.publishedCount;
    }

    res.json({
      success: true,
      themeId,
      addedToDefaults,
      publishedTo: publishedCount,
      message: 'Theme imported successfully'
    });
  } catch (err) {
    console.error('[ADMIN] Error importing theme:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

export default router;
