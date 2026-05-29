/**
 * API Endpoint Documentation URLs
 * Maps Dropbox Sign API endpoints to their documentation pages
 */

export const API_ENDPOINT_DOCS = {
  // Account endpoints
  '/account': 'https://developers.hellosign.com/api/account/get',
  '/account/create': 'https://developers.hellosign.com/api/account/create',
  '/account/update': 'https://developers.hellosign.com/api/account/update',
  '/account/verify': 'https://developers.hellosign.com/api/account/verify',

  // Signature Request endpoints
  '/signature_request/send': 'https://developers.hellosign.com/api/signature-request/send',
  '/signature_request/send_with_template': 'https://developers.hellosign.com/api/signature-request/send-with-template',
  '/signature_request/bulk_send_with_template': 'https://developers.hellosign.com/api/signature-request/bulk-send-with-template',
  '/signature_request/remind': 'https://developers.hellosign.com/api/signature-request/remind',
  '/signature_request/cancel': 'https://developers.hellosign.com/api/signature-request/cancel',
  '/signature_request/remove': 'https://developers.hellosign.com/api/signature-request/remove',
  '/signature_request/files': 'https://developers.hellosign.com/api/signature-request/files',
  '/signature_request/list': 'https://developers.hellosign.com/api/signature-request/list',
  '/signature_request/get': 'https://developers.hellosign.com/api/signature-request/get',
  '/signature_request/update': 'https://developers.hellosign.com/api/signature-request/update',
  '/signature_request/release_hold': 'https://developers.hellosign.com/api/signature-request/release-hold',
  '/signature_request/create_embedded': 'https://developers.hellosign.com/api/signature-request/create-embedded',
  '/signature_request/create_embedded_with_template': 'https://developers.hellosign.com/api/signature-request/create-embedded-with-template',

  // Template endpoints
  '/template/list': 'https://developers.hellosign.com/api/template/list',
  '/template/get': 'https://developers.hellosign.com/api/template/get',
  '/template/add_user': 'https://developers.hellosign.com/api/template/add-user',
  '/template/remove_user': 'https://developers.hellosign.com/api/template/remove-user',
  '/template/create_embedded_draft': 'https://developers.hellosign.com/api/template/create-embedded-draft',
  '/template/delete': 'https://developers.hellosign.com/api/template/delete',
  '/template/files': 'https://developers.hellosign.com/api/template/files',
  '/template/update_files': 'https://developers.hellosign.com/api/template/update-files',

  // Embedded endpoints
  '/embedded/sign_url': 'https://developers.hellosign.com/api/embedded/sign-url',
  '/embedded/edit_url': 'https://developers.hellosign.com/api/embedded/edit-url',

  // Unclaimed Draft endpoints
  '/unclaimed_draft/create': 'https://developers.hellosign.com/api/unclaimed-draft/create',
  '/unclaimed_draft/create_embedded': 'https://developers.hellosign.com/api/unclaimed-draft/create-embedded',
  '/unclaimed_draft/create_embedded_with_template': 'https://developers.hellosign.com/api/unclaimed-draft/create-embedded-with-template',

  // Team endpoints
  '/team': 'https://developers.hellosign.com/api/team/get',
  '/team/create': 'https://developers.hellosign.com/api/team/create',
  '/team/update': 'https://developers.hellosign.com/api/team/update',
  '/team/destroy': 'https://developers.hellosign.com/api/team/destroy',
  '/team/add_member': 'https://developers.hellosign.com/api/team/add-member',
  '/team/remove_member': 'https://developers.hellosign.com/api/team/remove-member',
  '/team/info': 'https://developers.hellosign.com/api/team/info',
  '/team/members': 'https://developers.hellosign.com/api/team/members',
  '/team/sub_teams': 'https://developers.hellosign.com/api/team/sub-teams',

  // Bulk Send Job endpoints
  '/bulk_send_job/get': 'https://developers.hellosign.com/api/bulk-send-job/get',
  '/bulk_send_job/list': 'https://developers.hellosign.com/api/bulk-send-job/list',

  // API App endpoints
  '/api_app/get': 'https://developers.hellosign.com/api/api-app/get',
  '/api_app/list': 'https://developers.hellosign.com/api/api-app/list',
  '/api_app/create': 'https://developers.hellosign.com/api/api-app/create',
  '/api_app/update': 'https://developers.hellosign.com/api/api-app/update',
  '/api_app/delete': 'https://developers.hellosign.com/api/api-app/delete',

  // Report endpoints
  '/report/create': 'https://developers.hellosign.com/api/report/create',

  // OAuth endpoints
  '/oauth/token': 'https://developers.hellosign.com/api/oauth',

  // Fax endpoints (if available)
  '/fax/send': 'https://developers.hellosign.com/api/fax/send',
  '/fax/get': 'https://developers.hellosign.com/api/fax/get',
  '/fax/list': 'https://developers.hellosign.com/api/fax/list',
  '/fax/files': 'https://developers.hellosign.com/api/fax/files',
  '/fax/delete': 'https://developers.hellosign.com/api/fax/delete',
};

/**
 * Get documentation URL for a given endpoint
 * Handles endpoints with IDs like /signature_request/{id}/remind
 * @param {string} endpoint - API endpoint path
 * @returns {string|null} Documentation URL or null if not found
 */
export function getEndpointDocsUrl(endpoint) {
  if (!endpoint) return null;

  // Direct match
  if (API_ENDPOINT_DOCS[endpoint]) {
    return API_ENDPOINT_DOCS[endpoint];
  }

  // Try to match by removing IDs (e.g., /signature_request/123abc/remind -> /signature_request/remind)
  const normalizedEndpoint = endpoint.replace(/\/[0-9a-f]{32,}/g, '').replace(/\/[0-9]+/g, '');
  if (API_ENDPOINT_DOCS[normalizedEndpoint]) {
    return API_ENDPOINT_DOCS[normalizedEndpoint];
  }

  // Try base path (e.g., /signature_request/something -> /signature_request/list)
  const parts = endpoint.split('/').filter(p => p);
  if (parts.length >= 2) {
    const basePath = `/${parts[0]}/${parts[1]}`;
    if (API_ENDPOINT_DOCS[basePath]) {
      return API_ENDPOINT_DOCS[basePath];
    }
  }

  // Fall back to main API documentation
  return 'https://developers.hellosign.com/';
}
