// Toast Notification System
// Shared utility for showing toast notifications across all modules

(function() {
  'use strict';

  /**
   * Show a toast notification
   * @param {string} message - The message to display
   * @param {string} type - Toast type: 'success', 'error', 'warning', 'info'
   * @param {number} duration - Duration in milliseconds (default: 5000)
   */
  window.showToast = function(message, type = 'info', duration = 5000) {
    const toast = document.createElement('div');
    toast.textContent = message;

    // Color mapping
    const colors = {
      success: '#10b981',
      error: '#ef4444',
      warning: '#f59e0b',
      info: '#3b82f6'
    };

    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 24px;
      background: ${colors[type] || colors.info};
      color: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      max-width: 400px;
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
      opacity: 1;
      transition: opacity 0.3s;
    `;

    document.body.appendChild(toast);

    // Auto-dismiss after duration
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  };

  // Convenience methods
  window.showSuccessToast = function(message, duration) {
    window.showToast(message, 'success', duration);
  };

  window.showErrorToast = function(message, duration) {
    window.showToast(message, 'error', duration);
  };

  window.showWarningToast = function(message, duration) {
    window.showToast(message, 'warning', duration);
  };

  window.showInfoToast = function(message, duration) {
    window.showToast(message, 'info', duration);
  };

})();
