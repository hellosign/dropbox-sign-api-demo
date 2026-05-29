/**
 * Tooltip System - Frontend Rendering Engine
 * Lightweight vanilla JavaScript implementation for Sign Portal Demo
 *
 * Usage: Add data-tooltip="tooltipId" attribute to any element
 */

(function() {
  'use strict';

  let tooltipConfig = null;
  let activeTooltip = null;
  let showTimeout = null;
  let hideTimeout = null;

  /**
   * Initialize tooltip system
   */
  async function initTooltips() {
    try {
      // Fetch tooltip configuration from backend
      const res = await fetch('/api/tooltips/config');
      tooltipConfig = await res.json();

      // Check if tooltips are globally enabled
      if (!tooltipConfig.globalSettings?.enabled) {
        console.log('[Tooltip] Tooltips disabled globally');
        return;
      }

      console.log('[Tooltip] Loaded configuration:', Object.keys(tooltipConfig.tooltips).length, 'tooltips enabled');

      // Find all elements with data-tooltip attribute
      attachTooltipsToElements();

    } catch (err) {
      console.error('[Tooltip] Failed to initialize:', err);
    }
  }

  /**
   * Attach tooltips to all elements with data-tooltip attribute
   */
  function attachTooltipsToElements() {
    const elements = document.querySelectorAll('[data-tooltip]');

    elements.forEach(element => {
      const tooltipId = element.getAttribute('data-tooltip');
      const tooltipDef = tooltipConfig.tooltips[tooltipId];

      if (!tooltipDef) {
        console.warn('[Tooltip] No definition found for:', tooltipId);
        return;
      }

      // Attach event listeners
      element.addEventListener('mouseenter', (e) => handleMouseEnter(e, tooltipDef));
      element.addEventListener('mouseleave', handleMouseLeave);
      element.addEventListener('focus', (e) => handleMouseEnter(e, tooltipDef));
      element.addEventListener('blur', handleMouseLeave);
    });

    console.log('[Tooltip] Attached to', elements.length, 'elements');
  }

  /**
   * Handle mouse enter / focus
   */
  function handleMouseEnter(event, tooltipDef) {
    // Clear any pending hide timeout
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    // Clear any pending show timeout
    if (showTimeout) {
      clearTimeout(showTimeout);
    }

    // Show tooltip after configured delay
    showTimeout = setTimeout(() => {
      showTooltip(event.target, tooltipDef);
    }, tooltipConfig.globalSettings.showDelay || 500);
  }

  /**
   * Handle mouse leave / blur
   */
  function handleMouseLeave() {
    // Clear show timeout
    if (showTimeout) {
      clearTimeout(showTimeout);
      showTimeout = null;
    }

    // Hide tooltip after configured delay
    hideTimeout = setTimeout(() => {
      hideTooltip();
    }, tooltipConfig.globalSettings.hideDelay || 200);
  }

  /**
   * Show tooltip
   */
  function showTooltip(targetElement, tooltipDef) {
    // Remove existing tooltip
    hideTooltip();

    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.className = 'portal-tooltip';

    // Create text node for tooltip text
    const textNode = document.createTextNode(tooltipDef.text);
    tooltip.appendChild(textNode);

    // If tooltip has a sourceUrl, add a "Learn more" link with icon
    if (tooltipDef.sourceUrl && tooltipDef.sourceUrl.trim() !== '') {
      // Add space before link
      tooltip.appendChild(document.createTextNode(' '));

      // Create link element
      const link = document.createElement('a');
      link.href = tooltipDef.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '📚 Docs';
      link.title = 'Open documentation in new tab';

      // Style the link
      Object.assign(link.style, {
        color: '#60a5fa',
        textDecoration: 'none',
        fontWeight: '500',
        fontSize: '12px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        marginLeft: '4px'
      });

      // Hover effect
      link.addEventListener('mouseenter', () => {
        link.style.color = '#93c5fd';
        link.style.textDecoration = 'underline';
      });
      link.addEventListener('mouseleave', () => {
        link.style.color = '#60a5fa';
        link.style.textDecoration = 'none';
      });

      tooltip.appendChild(link);
    }

    // Apply base styles
    Object.assign(tooltip.style, {
      position: 'fixed',
      zIndex: '10000',
      background: '#1e293b',
      color: 'white',
      padding: '8px 12px',
      borderRadius: '6px',
      fontSize: '13px',
      lineHeight: '1.4',
      maxWidth: '300px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      pointerEvents: (tooltipDef.sourceUrl && tooltipDef.sourceUrl.trim() !== '') ? 'auto' : 'none',
      opacity: '0',
      transition: 'opacity 0.2s ease-in-out'
    });

    document.body.appendChild(tooltip);

    // Position tooltip
    positionTooltip(tooltip, targetElement, tooltipDef.position);

    // If tooltip has pointer events (clickable link), keep it visible when mouse is over it
    if (tooltipDef.sourceUrl && tooltipDef.sourceUrl.trim() !== '') {
      tooltip.addEventListener('mouseenter', () => {
        if (hideTimeout) {
          clearTimeout(hideTimeout);
          hideTimeout = null;
        }
      });
      tooltip.addEventListener('mouseleave', () => {
        hideTimeout = setTimeout(() => {
          hideTooltip();
        }, tooltipConfig.globalSettings.hideDelay || 200);
      });
    }

    // Fade in
    requestAnimationFrame(() => {
      tooltip.style.opacity = '1';
    });

    activeTooltip = tooltip;
  }

  /**
   * Position tooltip relative to target element
   */
  function positionTooltip(tooltip, targetElement, preferredPosition) {
    const targetRect = targetElement.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const spacing = 8; // Gap between tooltip and element

    let position = preferredPosition || 'top';
    let left, top;

    // Calculate position based on preference
    switch (position) {
      case 'top':
        left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
        top = targetRect.top - tooltipRect.height - spacing;

        // Check if tooltip goes off screen
        if (top < 0) {
          // Flip to bottom
          position = 'bottom';
          top = targetRect.bottom + spacing;
        }
        break;

      case 'bottom':
        left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
        top = targetRect.bottom + spacing;

        // Check if tooltip goes off screen
        if (top + tooltipRect.height > viewportHeight) {
          // Flip to top
          position = 'top';
          top = targetRect.top - tooltipRect.height - spacing;
        }
        break;

      case 'left':
        left = targetRect.left - tooltipRect.width - spacing;
        top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);

        // Check if tooltip goes off screen
        if (left < 0) {
          // Flip to right
          position = 'right';
          left = targetRect.right + spacing;
        }
        break;

      case 'right':
        left = targetRect.right + spacing;
        top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);

        // Check if tooltip goes off screen
        if (left + tooltipRect.width > viewportWidth) {
          // Flip to left
          position = 'left';
          left = targetRect.left - tooltipRect.width - spacing;
        }
        break;
    }

    // Clamp horizontal position to viewport
    if (left < spacing) {
      left = spacing;
    } else if (left + tooltipRect.width > viewportWidth - spacing) {
      left = viewportWidth - tooltipRect.width - spacing;
    }

    // Clamp vertical position to viewport
    if (top < spacing) {
      top = spacing;
    } else if (top + tooltipRect.height > viewportHeight - spacing) {
      top = viewportHeight - tooltipRect.height - spacing;
    }

    // Apply final position
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  /**
   * Hide tooltip
   */
  function hideTooltip() {
    if (activeTooltip) {
      activeTooltip.style.opacity = '0';

      // Remove from DOM after fade out
      setTimeout(() => {
        if (activeTooltip && activeTooltip.parentNode) {
          activeTooltip.parentNode.removeChild(activeTooltip);
        }
        activeTooltip = null;
      }, 200);
    }
  }

  /**
   * Public API: Manually refresh tooltips (for dynamic content)
   */
  window.refreshTooltips = function() {
    console.log('[Tooltip] Manually refreshing tooltips');
    attachTooltipsToElements();
  };

  /**
   * Public API: Reinitialize tooltips (useful after AJAX content loads)
   */
  window.reinitTooltips = function() {
    console.log('[Tooltip] Reinitializing tooltip system');
    initTooltips();
  };

  // Initialize on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTooltips);
  } else {
    // DOM already loaded
    initTooltips();
  }

})();
