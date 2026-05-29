(function() {
  'use strict';

  let loggingEnabled = false;

  // Check if console logging is enabled
  async function checkLoggingEnabled() {
    try {
      const res = await fetch('/admin/api/console-logging');
      const data = await res.json();
      loggingEnabled = data.enabled;

      if (loggingEnabled) {
        originalConsole.log('[ConsoleLogger] Browser console streaming enabled');
      }
    } catch (err) {
      originalConsole.error('[ConsoleLogger] Failed to check logging status:', err);
    }
  }

  // Send log to server
  function sendToServer(level, args, timestamp) {
    if (!loggingEnabled) return;

    const logEntry = {
      level: level,
      message: args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' '),
      url: window.location.href,
      timestamp: timestamp || new Date().toISOString(),
      userAgent: navigator.userAgent
    };

    // Use sendBeacon for reliability (works even during page unload)
    const blob = new Blob([JSON.stringify(logEntry)], { type: 'application/json' });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/log-console', blob);
    } else {
      // Fallback to fetch
      fetch('/api/log-console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logEntry)
      }).catch(() => {}); // Silent fail
    }
  }

  // Override console methods
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    info: console.info,
    error: console.error
  };

  ['log', 'warn', 'info', 'error'].forEach(level => {
    console[level] = function(...args) {
      // Call original console method first
      originalConsole[level].apply(console, args);

      // Send to server if enabled
      sendToServer(level, args, new Date().toISOString());
    };
  });

  // Initialize on page load
  checkLoggingEnabled();

  // Re-check every 60 seconds (in case admin changes setting)
  setInterval(checkLoggingEnabled, 60000);
})();
