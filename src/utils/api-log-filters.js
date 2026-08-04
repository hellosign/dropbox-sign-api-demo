/**
 * Filter helpers for API log retrieval.
 */

const ERROR_CALLBACK_EVENTS = new Set([
  'signature_request_invalid',
  'file_error',
]);

function collectSignatureErrorsFromRequest(signatureRequest, errors) {
  if (!signatureRequest || typeof signatureRequest !== 'object') return;

  const signatures = signatureRequest.signatures;
  if (!Array.isArray(signatures)) return;

  for (const signature of signatures) {
    const message = signature?.error || signature?.errorMsg || signature?.error_msg;
    if (message) errors.push(String(message));
  }
}

export function getSignatureErrorsFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];

  const errors = [];
  collectSignatureErrorsFromRequest(payload.signature_request, errors);
  collectSignatureErrorsFromRequest(payload.signatureRequest, errors);
  collectSignatureErrorsFromRequest(payload.body?.signatureRequest, errors);
  collectSignatureErrorsFromRequest(payload.body?.signature_request, errors);
  collectSignatureErrorsFromRequest(payload.data?.signature_request, errors);

  const signatureLists = [
    payload.body?.signatureRequests,
    payload.body?.signature_requests,
    payload.data?.signature_requests,
  ];

  for (const list of signatureLists) {
    if (!Array.isArray(list)) continue;
    for (const signatureRequest of list) {
      collectSignatureErrorsFromRequest(signatureRequest, errors);
    }
  }

  return errors;
}

export function getCallbackEventType(log) {
  const response = log?.response;
  if (!response || typeof response !== 'object') return '';

  return response.event?.event_type
    || response.event?.eventType
    || '';
}

export function getLogWarnings(log) {
  if (log?.error) return [];
  const response = log?.response;
  if (!response || typeof response !== 'object') return [];

  const warnings = response.body?.warnings
    || response.warnings
    || response.data?.warnings
    || [];

  return Array.isArray(warnings) ? warnings : [];
}

export function getLogSignatureErrors(log) {
  if (log?.error) return [];
  return getSignatureErrorsFromPayload(log?.response);
}

export function getLogStatusKind(log) {
  if (log?.type === 'api_error' || log?.status === 'error') return 'error';

  const callbackEvent = log?.type === 'callback' ? getCallbackEventType(log) : '';
  if (ERROR_CALLBACK_EVENTS.has(callbackEvent)) return 'error';

  if (getLogSignatureErrors(log).length > 0) return 'error';
  if (getLogWarnings(log).length > 0) return 'warning';

  if (log?.type === 'callback') return 'callback';
  if (log?.type === 'api_response' || log?.status === 'success') return 'success';
  return 'other';
}

export function getIssueSummary(log) {
  if (log?.error) return log.error;

  const signatureErrors = getLogSignatureErrors(log);
  if (signatureErrors.length > 0) return signatureErrors[0];

  const callbackEvent = getCallbackEventType(log);
  if (ERROR_CALLBACK_EVENTS.has(callbackEvent)) {
    return signatureErrors[0] || `Callback event: ${callbackEvent}`;
  }

  const warnings = getLogWarnings(log);
  if (warnings.length === 0) return '';

  const first = warnings[0];
  if (!first || typeof first !== 'object') return String(first || '');

  return first.warningMsg
    || first.warning_msg
    || first.warningName
    || first.warning_name
    || 'API warning';
}

export function getErrorType(log) {
  if (log?.errorDetails && typeof log.errorDetails === 'object') {
    const details = log.errorDetails;
    const fromDetails = details.errorName
      || details.error_name
      || details.warningName
      || details.warning_name;
    if (fromDetails) return fromDetails;
  }

  const signatureErrors = getLogSignatureErrors(log);
  if (signatureErrors.length > 0) {
    const message = signatureErrors[0];
    if (/^Text tags error:/i.test(message)) return 'text_tags_error';
    return 'signature_error';
  }

  const callbackEvent = getCallbackEventType(log);
  if (ERROR_CALLBACK_EVENTS.has(callbackEvent)) return callbackEvent;

  const warnings = getLogWarnings(log);
  if (warnings.length > 0) {
    const first = warnings[0];
    if (first && typeof first === 'object') {
      return first.warningName || first.warning_name || '';
    }
  }

  return '';
}

export function isIssueLogEntry(log) {
  return getLogStatusKind(log) === 'error' || getLogStatusKind(log) === 'warning';
}

export function isErrorLogEntry(log) {
  return getLogStatusKind(log) === 'error';
}

function safeJsonForSearch(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function buildLogSearchText(log) {
  return [
    log?.error,
    getIssueSummary(log),
    ...getLogSignatureErrors(log),
    log?.endpoint,
    log?.method,
    getErrorType(log),
    getCallbackEventType(log),
    safeJsonForSearch(log?.requestBody),
    safeJsonForSearch(log?.response),
  ].filter(Boolean).join(' ').toLowerCase();
}

export function filterApiLogs(logs, query = {}) {
  if (!Array.isArray(logs)) return [];

  let filtered = logs;

  if (query.status === 'issues') {
    filtered = filtered.filter(isIssueLogEntry);
  } else if (query.status === 'error') {
    filtered = filtered.filter(isErrorLogEntry);
  } else if (query.status === 'warning') {
    filtered = filtered.filter((log) => getLogStatusKind(log) === 'warning');
  } else if (query.status === 'success') {
    filtered = filtered.filter((log) => getLogStatusKind(log) === 'success');
  } else if (query.status === 'callback') {
    filtered = filtered.filter((log) => getLogStatusKind(log) === 'callback');
  }

  if (query.method) {
    const method = String(query.method).toUpperCase();
    filtered = filtered.filter((log) => String(log.method || '').toUpperCase() === method);
  }

  if (query.endpoint) {
    const endpoint = String(query.endpoint);
    filtered = filtered.filter((log) => String(log.endpoint || '').includes(endpoint));
  }

  if (query.errorType) {
    const errorType = String(query.errorType).toLowerCase();
    filtered = filtered.filter((log) => getErrorType(log).toLowerCase().includes(errorType));
  }

  if (query.q) {
    const term = String(query.q).toLowerCase();
    filtered = filtered.filter((log) => buildLogSearchText(log).includes(term));
  }

  return filtered;
}
