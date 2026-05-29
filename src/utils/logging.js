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
