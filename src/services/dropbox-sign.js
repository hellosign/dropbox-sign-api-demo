// src/services/dropbox-sign.js
import * as DropboxSign from '@dropbox/sign';
import { decryptApiKey } from '../utils/crypto.js';
import { buildRequestDetail } from '../utils/logging.js';
import { redactSensitiveData } from '../utils/validation.js';

// These will be injected when the service is initialized
let redisClient = null;
let getApiLogs = null;
let broadcastLogUpdate = null;
let inMemoryApiLogs = null;

/**
 * Initialize the Dropbox Sign service with Redis dependencies
 * This must be called after Redis is set up
 */
export function initDropboxSignService(dependencies) {
  redisClient = dependencies.redisClient;
  getApiLogs = dependencies.getApiLogs;
  broadcastLogUpdate = dependencies.broadcastLogUpdate;
  inMemoryApiLogs = dependencies.inMemoryApiLogs;
}

/**
 * Internal function to add API log
 */
async function addApiLog(entry, accountId = 'global', req = null) {
  if (req && req.session?.accountInfo?.account_id) {
    accountId = req.session.accountInfo.account_id;
  }

  // Redact sensitive data before storing
  const redactedEntry = redactSensitiveData(entry);

  const logEntry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    timestamp: new Date().toISOString(),
    ...redactedEntry,
  };

  if (!redisClient) {
    // Use in-memory storage when Redis unavailable
    if (inMemoryApiLogs) {
      inMemoryApiLogs.unshift(logEntry);
      const MAX_LOGS = 20;
      if (inMemoryApiLogs.length > MAX_LOGS) {
        inMemoryApiLogs.length = MAX_LOGS;
      }
    }
    return;
  }

  // Async Redis update (non-blocking)
  (async () => {
    try {
      const key = `user:${accountId}:api_logs`;
      const userLogs = await getApiLogs(accountId);
      userLogs.unshift(logEntry);

      // Apply FIFO limit per user
      const MAX_LOGS = 20; // Reduced from 50 to save Redis memory
      if (userLogs.length > MAX_LOGS) {
        userLogs.length = MAX_LOGS;
      }

      await redisClient.set(key, JSON.stringify(userLogs));
      broadcastLogUpdate(accountId);  // Only broadcast to this user
    } catch (err) {
      console.error('[REDIS] Error adding API log:', err.message);
    }
  })();
}

/**
 * Centralized API call wrapper with automatic logging
 * @param {Request} req - Express request object (for session)
 * @param {string} apiClassName - Name of API class (e.g., 'SignatureRequestApi')
 * @param {string} method - Method name to call (e.g., 'signatureRequestGet')
 * @param {Array} args - Arguments to pass to the method
 * @param {Object} logMeta - Metadata for logging (method, endpoint, description)
 * @returns {Promise} - API response
 */
export async function apiCall(req, apiClassName, method, args = [], logMeta = {}) {
  const startTime = Date.now();

  try {
    // Get and decrypt API key
    const encryptedKey = req.session.apiKey;
    if (!encryptedKey) {
      throw new Error('User not authenticated - API key required');
    }
    const apiKey = decryptApiKey(encryptedKey);
    if (!apiKey) {
      throw new Error('Failed to decrypt API key - please re-login');
    }

    // Create API client
    const ApiClass = DropboxSign[apiClassName];
    if (!ApiClass) {
      throw new Error(`Unknown API class: ${apiClassName}`);
    }
    const client = new ApiClass();
    client.username = apiKey;

    // Execute API call
    const result = await client[method](...args);

    // Auto-log successful call
    addApiLog({
      type: 'api_response',
      method: logMeta.method || 'UNKNOWN',
      endpoint: logMeta.endpoint || `/${method}`,
      requestBody: buildRequestDetail({
        method: logMeta.method || 'POST',
        apiPath: logMeta.endpoint || `/${method}`,
        body: args[0]
      }),
      response: result,
      status: 'success',
      duration: Date.now() - startTime
    }, null, req);

    return result;
  } catch (error) {
    // Extract detailed error message from Dropbox Sign API response
    const errorMsg = error?.body?.error?.errorMsg || error?.message || error.toString();

    // Auto-log failed call
    addApiLog({
      type: 'api_error',
      method: logMeta.method || 'UNKNOWN',
      endpoint: logMeta.endpoint || `/${method}`,
      requestBody: buildRequestDetail({
        method: logMeta.method || 'POST',
        apiPath: logMeta.endpoint || `/${method}`,
        body: args[0]
      }),
      error: errorMsg,
      errorDetails: error?.body?.error,
      status: 'error',
      duration: Date.now() - startTime
    }, null, req);

    throw error;
  }
}

/**
 * Legacy compatibility wrapper - get API client for manual usage
 * @deprecated Use apiCall() instead for automatic logging
 */
export async function getUserApiClient(req, ApiClass) {
  const encryptedKey = req.session.apiKey;
  if (!encryptedKey) {
    throw new Error('User not authenticated - API key required');
  }

  // Decrypt API key before using it
  const apiKey = decryptApiKey(encryptedKey);
  if (!apiKey) {
    throw new Error('Failed to decrypt API key - please re-login');
  }

  const client = new ApiClass();
  client.username = apiKey;  // API key authentication uses username field
  return client;
}

/**
 * Validates API key and fetches account information
 * Returns: { account_id, email_address, is_locked, is_paid_hs, is_paid_hf, role_code }
 * Throws: Error if API key is invalid
 */
export async function validateApiKeyAndGetAccount(apiKey) {
  const accountApi = new DropboxSign.AccountApi();
  accountApi.username = apiKey;

  try {
    const response = await accountApi.accountGet();
    return response.account;
  } catch (error) {
    if (error.statusCode === 401) {
      throw new Error('Invalid API key');
    }
    throw error;
  }
}
