// src/utils/logging.js

const DS_BASE_URL = 'https://api.hellosign.com/v3';

/**
 * Build request detail object for API logging
 */
export function buildRequestDetail({ method, apiPath, body, contentType, hasFile }) {
  const headers = {
    'Authorization': 'API key (per user session)',
    'User-Agent': '@dropbox/sign Node SDK',
  };
  if (contentType) {
    headers['Content-Type'] = contentType;
  } else if (hasFile) {
    headers['Content-Type'] = 'multipart/form-data';
  } else if (method !== 'GET' && method !== 'DELETE') {
    headers['Content-Type'] = 'application/json';
  }
  return {
    method,
    url: `${DS_BASE_URL}${apiPath}`,
    headers,
    body: body || null,
  };
}

/**
 * Extract API warnings from a successful Dropbox Sign SDK response.
 * Text-tag issues often surface here instead of as api_error entries.
 */
export function extractApiWarnings(result) {
  if (!result || typeof result !== 'object') return [];

  const warnings = result.body?.warnings
    || result.warnings
    || result.data?.warnings
    || result.response?.body?.warnings
    || [];

  return Array.isArray(warnings) ? warnings : [];
}

/**
 * Normalize warning shape from Dropbox Sign API (camelCase or snake_case).
 */
export function normalizeApiWarning(warning) {
  if (!warning || typeof warning !== 'object') {
    const message = String(warning || '').trim();
    return { message, type: '', details: { warningMsg: message } };
  }

  const message = warning.warningMsg || warning.warning_msg || warning.message || '';
  const type = warning.warningName || warning.warning_name || '';

  return {
    message,
    type,
    details: warning,
  };
}
