// src/routes/api-logs.js
import { Router } from 'express';
import express from 'express';
import { requireSession } from '../middleware/auth.js';
import { filterApiLogs } from '../utils/api-log-filters.js';

const router = Router();

/**
 * GET /api-logs - Get API logs for current user
 * Query params:
 *   status=issues — errors and successful responses with API warnings
 *   status=error  — api_error entries only
 *   status=warning|success|callback — filter by log kind
 *   method        — filter by HTTP method (GET, POST, etc.)
 *   endpoint      — substring match on endpoint path
 *   errorType     — substring match on error/warning name
 *   q             — free-text search across message, endpoint, method, error type
 */
router.get('/', requireSession, async (req, res) => {
  // Prevent browser caching of user-specific data
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const accountId = req.session?.accountInfo?.account_id || 'global';
  const { getApiLogs } = req.app.locals.redisHelpers;

  const userLogs = await getApiLogs(accountId);
  const filtered = filterApiLogs(userLogs, req.query);
  res.json(filtered);
});

/**
 * DELETE /api-logs - Clear API logs for current user
 * Removes all logs from Redis for the authenticated user
 */
router.delete('/', requireSession, express.json(), async (req, res) => {
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
