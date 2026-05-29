// src/routes/api-logs.js
import { Router } from 'express';
import express from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api-logs - Get API logs for current user
 * Returns per-user API logs from Redis
 */
router.get('/', requireAuth, async (req, res) => {
  // Prevent browser caching of user-specific data
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const accountId = req.session?.accountInfo?.account_id || 'global';
  const { getApiLogs } = req.app.locals.redisHelpers;

  const userLogs = await getApiLogs(accountId);
  res.json(userLogs);
});

/**
 * DELETE /api-logs - Clear API logs for current user
 * Removes all logs from Redis for the authenticated user
 */
router.delete('/', requireAuth, express.json(), async (req, res) => {
  const accountId = req.session?.accountInfo?.account_id || 'global';
  const redisClient = req.app.locals.redisClient;
  const { clearApiLogs } = req.app.locals.redisHelpers;

  if (!redisClient) {
    // Clear in-memory logs when Redis unavailable
    if (clearApiLogs) {
      clearApiLogs(accountId);
    }
    return res.json({ success: true });
  }

  const key = `user:${accountId}:api_logs`;
  await redisClient.set(key, JSON.stringify([]));
  res.json({ success: true });
});

export default router;
