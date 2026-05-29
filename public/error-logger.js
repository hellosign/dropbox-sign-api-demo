// Frontend Error Logger
// Captures browser errors and sends them to server for logging

(function() {
  'use strict';

  const LOG_ENDPOINT = '/api/log-error';

  /**
   * Send error to server
   */
  function logToServer(errorData) {
    // Use sendBeacon if available (works even during page unload)
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(errorData)], { type: 'application/json' });
      navigator.sendBeacon(LOG_ENDPOINT, blob);
    } else {
      // Fallback to fetch
      fetch(LOG_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(errorData)
      }).catch(() => {}); // Silent fail - don't throw errors from error logger
    }
  }

  /**
   * Capture unhandled JavaScript errors
   */
  window.addEventListener('error', function(event) {
    // Ignore errors from browser extensions
    if (event.filename && event.filename.startsWith('chrome-extension://')) {
      return;
    }

    logToServer({
      type: 'error',
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Capture unhandled promise rejections
   */
  window.addEventListener('unhandledrejection', function(event) {
    logToServer({
      type: 'unhandled_rejection',
      message: 'Unhandled Promise Rejection',
      reason: event.reason?.toString(),
      stack: event.reason?.stack,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * Capture console.error calls (optional - can be noisy)
   * Wraps the original console.error to send errors to server
   */
  const originalConsoleError = console.error;
  console.error = function(...args) {
    // Call original console.error first
    originalConsoleError.apply(console, args);

    // Log to server
    try {
      const message = args.map(arg => {
        if (typeof arg === 'object') {
          return JSON.stringify(arg, null, 2);
        }
        return String(arg);
      }).join(' ');

      logToServer({
        type: 'console_error',
        message: message,
        url: window.location.href,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      // Don't let error logging break the app
    }
  };

  console.log('[ErrorLogger] Frontend error logging initialized');

})();
