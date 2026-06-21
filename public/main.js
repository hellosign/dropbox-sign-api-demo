// public/main.js

// CSRF Token Helper - get token from meta tag or cookie
function getCsrfToken() {
  // Try to get from cookie first (check both production and development cookie names)
  const cookies = document.cookie.split(';');
  for (let cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === '__Host-psifi.x-csrf-token' || name === 'psifi.x-csrf-token') {
      return decodeURIComponent(value);
    }
  }
  return null;
}

// Enhanced fetch wrapper with CSRF token and API key (from browser sessionStorage)
async function fetchWithCsrf(url, options = {}) {
  const token = getCsrfToken();
  const headers = options.headers || {};

  // Add API key from browser storage (never stored server-side)
  const apiKey = sessionStorage.getItem('dbxSignApiKey');
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  // Add CSRF token for state-changing requests
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method?.toUpperCase())) {
    if (token) {
      headers['x-csrf-token'] = token;
    }
  }

  // Prevent fetch from following redirects (e.g., to /login on session expiry)
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}), // Start with options headers (e.g., Content-Type)
      ...headers // Then add/override with API key and CSRF token (these take priority)
    },
    redirect: 'manual'
  });

  // Handle session expiry (401 or opaque redirect to login)
  if (response.status === 401 || response.type === 'opaqueredirect') {
    sessionStorage.removeItem('dbxSignApiKey');
    window.location.href = '/login';
    throw new Error('Session expired. Redirecting to login.');
  }

  return response;
}

document.addEventListener('DOMContentLoaded', () => {
  let client = null;

  // Embedded signing state for multi-signer flow
  let embeddedSigningState = {
    signatureRequestId: null,
    currentSignerIndex: 0,
    totalSigners: 1
  };

  // Signing order state (sequential or parallel)
  let signingOrder = 'sequential';

  // ===== Fix inline onclick handlers blocked by CSP =====

  // Signing overlay close button
  const signingCloseBtn = document.getElementById('signingCloseBtn');
  if (signingCloseBtn) {
    signingCloseBtn.addEventListener('click', () => {
      console.log('[Close Button] X button clicked - closing overlay');
      closeSigningOverlay();
    });
  } else {
    console.warn('[Close Button] signingCloseBtn not found in DOM');
  }

  function clearSigningContainer() {
    const signingContainer = document.getElementById('signingContainer');
    if (signingContainer) {
      signingContainer.replaceChildren();
    }
  }

  function prepareSigningOverlay() {
    const overlay = document.getElementById('signingOverlay');

    // Close any existing HelloSign session first
    try {
      if (client && typeof client.close === 'function') {
        client.close();
        console.log('[Prepare Overlay] Closed existing HelloSign session');
      }
    } catch (err) {
      console.warn('[Prepare Overlay] Failed to close existing HelloSign session:', err);
    }

    clearSigningContainer();
    overlay.style.display = 'flex';
    return document.getElementById('signingContainer');
  }

  // Helper function to close signing overlay
  function closeSigningOverlay(resetState = true) {
    const overlay = document.getElementById('signingOverlay');

    // Close the HelloSign iframe session properly
    try {
      if (client && typeof client.close === 'function') {
        client.close();
        console.log('[Close Button] HelloSign client.close() called');
      }
    } catch (err) {
      console.warn('[Close Button] Failed to close HelloSign client:', err);
    }

    overlay.style.display = 'none';
    clearSigningContainer();

    if (resetState) {
      embeddedSigningState = {
        signatureRequestId: null,
        currentSignerIndex: 0,
        totalSigners: 1
      };
      console.log('[Close Button] Overlay closed and state reset');
    } else {
      console.log('[Close Button] Overlay closed, state preserved:', embeddedSigningState);
    }
  }

  // ===== Signing Order Toggle =====
  const singleSignerCheckbox = document.getElementById('singleSigner');
  const signingOrderIndicator = document.getElementById('signingOrderIndicator');
  const signingOrderToggle = document.getElementById('signingOrderToggle');

  // Helper function to update signing order indicator visibility
  function updateSigningOrderVisibility() {
    if (!singleSignerCheckbox || !signingOrderIndicator) return;

    const documentModeSelect = document.getElementById('documentMode');
    const isTemplateMode = documentModeSelect && documentModeSelect.value === 'none';
    const isMultiSigner = !singleSignerCheckbox.checked;

    // Show only when: multi-signer AND not using template
    // (Templates have pre-configured signing order that cannot be changed)
    if (isMultiSigner && !isTemplateMode) {
      signingOrderIndicator.style.display = 'inline-block';
    } else {
      signingOrderIndicator.style.display = 'none';
    }
  }

  // Show/hide signing order indicator based on Single Signer checkbox
  if (singleSignerCheckbox && signingOrderIndicator) {
    singleSignerCheckbox.addEventListener('change', updateSigningOrderVisibility);
  }

  // Toggle between sequential and parallel signing modes
  if (signingOrderToggle) {
    signingOrderToggle.addEventListener('click', () => {
      if (signingOrder === 'sequential') {
        signingOrder = 'parallel';
        signingOrderToggle.textContent = '═══ both sign ═══';
        signingOrderToggle.title = 'Click to switch to sequential signing';
      } else {
        signingOrder = 'sequential';
        signingOrderToggle.textContent = '↓ then signs ↓';
        signingOrderToggle.title = 'Click to switch to parallel signing';
      }
      console.log('[Signing Order] Changed to:', signingOrder);
    });
  }

  // Show icon for second signer to start their signing session
  function showSecondSignerPrompt() {
    // Just add the clickable icon next to second signer name field
    addSignatureReadyBadge();
  }

  // Add a clickable signature icon next to the second signer's name field
  function addSignatureReadyBadge() {
    // Remove any existing badge
    const existingBadge = document.getElementById('signatureReadyBadge');
    if (existingBadge) {
      existingBadge.remove();
    }

    // Find the label for signerName2
    const signerName2Label = document.querySelector('label[for="signerName2"]');
    if (signerName2Label) {
      const badge = document.createElement('span');
      badge.id = 'signatureReadyBadge';
      badge.className = 'signature-ready-icon';
      badge.title = 'Ready to sign - Click to start';
      badge.innerHTML = '&#x270D;'; // Writing hand (✍️)
      badge.style.cursor = 'pointer';

      // Add click handler to start second signer
      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startSecondSigner();
      });

      signerName2Label.appendChild(badge);
    }
  }

  // Start the second signer's embedded session
  async function startSecondSigner() {
    try {
      console.log('[Second Signer] Current state:', embeddedSigningState);

      if (!embeddedSigningState.signatureRequestId) {
        throw new Error('Missing signatureRequestId - state may have been reset');
      }

      const nextIndex = embeddedSigningState.currentSignerIndex + 1;

      console.log('[Second Signer] Requesting embedded URL for signer', nextIndex);

      // Request next signer's URL
      const response = await fetchWithCsrf('/embedded-next-signer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signatureRequestId: embeddedSigningState.signatureRequestId,
          signerIndex: nextIndex
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[Second Signer] Server error:', response.status, errorData);
        throw new Error(errorData.error || `Failed to load second signer (${response.status})`);
      }

      const data = await response.json();
      console.log('[Second Signer] Received URL:', data);
      const { signUrl } = data;

      // Update state
      embeddedSigningState.currentSignerIndex = nextIndex;

      // Remove the icon badge
      const badge = document.getElementById('signatureReadyBadge');
      if (badge) badge.remove();

      // Open signing overlay
      const signingContainer = prepareSigningOverlay();

      // Wait a moment before opening to ensure clean state
      await new Promise(resolve => setTimeout(resolve, 300));

      // Re-initialize HelloSign client (use same client_id as first signer)
      const selectedClientId = getSelectedClientId();
      initHelloSignClient(selectedClientId);

      // Wait for client to initialize
      await new Promise(resolve => setTimeout(resolve, 100));

      // Open signing session
      client.open(signUrl, {
        container: signingContainer,
        skipDomainVerification: true,
        allowCancel: true
      });

      console.log('[Second Signer] Opened signing session');

    } catch (error) {
      console.error('[Second Signer] Error:', error);
      showErrorToast(`Failed to start second signer: ${error.message || 'Unknown error'}`);
    }
  }

  // Rotation notice dismiss button
  const dismissRotationBtn = document.querySelector('.dismiss-rotation-notice');
  if (dismissRotationBtn) {
    dismissRotationBtn.addEventListener('click', function() {
      this.parentElement.style.display = 'none';
    });
  }

  // Onboarding modal buttons
  const createDemoAppsBtn = document.getElementById('createDemoAppsBtn');
  const skipOnboardingBtn = document.getElementById('skipOnboardingBtn');
  const continueExistingBtn = document.getElementById('continueExistingBtn');
  const startFreshBtn = document.getElementById('startFreshBtn');

  if (createDemoAppsBtn) {
    createDemoAppsBtn.addEventListener('click', createDemoApps);
  }
  if (skipOnboardingBtn) {
    skipOnboardingBtn.addEventListener('click', skipOnboarding);
  }
  if (continueExistingBtn) {
    continueExistingBtn.addEventListener('click', continueWithExistingData);
  }
  if (startFreshBtn) {
    startFreshBtn.addEventListener('click', startFresh);
  }

  // Toast notification functions are now in /public/toast.js

  // ===== Portal Settings =====
  const settings = window.portalSettings || {};

  // Helper function to add logo setting to form submissions
  function addLogoSetting(formData) {
    const logoEnabled = settings.logoOnTextTags !== false; // default to true
    if (formData instanceof URLSearchParams) {
      formData.append('logoEnabled', logoEnabled.toString());
    } else if (formData instanceof FormData) {
      formData.append('logoEnabled', logoEnabled.toString());
    }
    return formData;
  }

  function applySigningMode() {
    const overlay = document.getElementById('signingOverlay');
    if (!overlay) return;
    if (settings.fullscreenSigning) {
      overlay.classList.add('signing-fullscreen');
    } else {
      overlay.classList.remove('signing-fullscreen');
    }
  }
  applySigningMode();

  // Settings tab — auto-save on change
  const fullscreenToggle = document.getElementById('settingFullscreenSigning');
  if (fullscreenToggle) {
    fullscreenToggle.checked = !!settings.fullscreenSigning;
    fullscreenToggle.addEventListener('change', async () => {
      settings.fullscreenSigning = fullscreenToggle.checked;
      applySigningMode();
      try {
        const res = await fetchWithCsrf('/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: { fullscreenSigning: settings.fullscreenSigning } }),
        });
        if (!res.ok) throw new Error('Failed');
        showSuccessToast('Setting saved');
      } catch (err) {
        console.error('Error saving settings:', err);
        showErrorToast('Failed to save setting');
      }
    });
  }

  // Settings tab — logo on text tags toggle
  const logoOnTextTagsToggle = document.getElementById('settingLogoOnTextTags');
  if (logoOnTextTagsToggle) {
    logoOnTextTagsToggle.checked = settings.logoOnTextTags !== false; // default to true
    logoOnTextTagsToggle.addEventListener('change', async () => {
      settings.logoOnTextTags = logoOnTextTagsToggle.checked;
      try {
        const res = await fetchWithCsrf('/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: { logoOnTextTags: settings.logoOnTextTags } }),
        });
        if (!res.ok) throw new Error('Failed');
        showSuccessToast('Logo setting saved');
      } catch (err) {
        console.error('Error saving logo setting:', err);
        showErrorToast('Failed to save logo setting');
      }
    });
  }

  // Settings tab — SMS Delivery toggle
  const smsDeliveryToggle = document.getElementById('settingSmsDeliveryEnabled');
  if (smsDeliveryToggle) {
    smsDeliveryToggle.checked = !!settings.smsDeliveryEnabled;
    smsDeliveryToggle.addEventListener('change', async () => {
      settings.smsDeliveryEnabled = smsDeliveryToggle.checked;
      console.log('[SMS Delivery] Starting save request:', { enabled: settings.smsDeliveryEnabled });
      try {
        console.log('[SMS Delivery] Making fetch request to /settings');
        const res = await fetchWithCsrf('/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: { smsDeliveryEnabled: settings.smsDeliveryEnabled } }),
        });
        console.log('[SMS Delivery] Fetch completed:', { ok: res.ok, status: res.status, statusText: res.statusText });
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
          console.error('SMS Delivery setting save failed:', { status: res.status, statusText: res.statusText, error: errorData });
          throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`);
        }
        const responseData = await res.json();
        console.log('[SMS Delivery] Save successful:', responseData);
        showSuccessToast('SMS Delivery setting saved');
        // Update visibility of SMS Delivery checkbox in signing form
        updateSmsOptionsVisibility();
      } catch (err) {
        console.error('Error saving SMS Delivery setting:', err.message || err);
        console.error('Full error object:', err);
        showErrorToast('Failed to save SMS Delivery setting');
      }
    });
  }


  // Legacy default theme setting removed - theme selection now persists automatically

  // Legacy API user management UI removed

  function getSelectedClientId() {
    return document.getElementById('appSelect')?.value || null;
  }

  function initHelloSignClient(clientId) {
    if (!clientId) return;
    try {
      client = new HelloSign({ clientId });

      // Log ALL events for debugging compatibility issues
      const allEvents = ['sign', 'cancel', 'close', 'error', 'send', 'createTemplate', 'ready', 'message', 'decline', 'reassign', 'finish_and_sign_later'];

      allEvents.forEach(eventName => {
        client.on(eventName, (data) => {
          console.log(`[HelloSign Event] "${eventName}" fired:`, data);

          // Special handling for 'sign' event in multi-signer flow
          if (eventName === 'sign') {
            if (embeddedSigningState.totalSigners > 1 &&
                embeddedSigningState.currentSignerIndex < embeddedSigningState.totalSigners - 1) {
              console.log('[HelloSign Event] Multi-signer: first signer completed');
              closeSigningOverlay(false); // Don't reset state
              showSuccessToast('First signer completed!');
              loadSignaturesDebounced();
              showSecondSignerPrompt();
            } else {
              console.log('[HelloSign Event] Single signer or last signer: closing overlay');
              closeSigningOverlay(true); // Reset state
              showSuccessToast('Document signed successfully!');
              loadSignaturesDebounced();
            }
          }

          // Close overlay for other completion events
          if (['cancel', 'close', 'send', 'createTemplate', 'decline', 'finish_and_sign_later'].includes(eventName)) {
            console.log(`[HelloSign Event] Closing overlay due to "${eventName}" event`);
            closeSigningOverlay(true);

            if (eventName === 'createTemplate') {
              templatesLoaded = false;
              showSuccessToast('Template saved! Go to Templates tab to view it.');
            }
          }
        });
      });

      console.log('[HelloSign Client] Initialized with clientId:', clientId, '- Listening for events:', allEvents.join(', '));
    } catch (err) {
      console.error('[initHelloSignClient] Failed to initialize HelloSign client:', err);
    }
  }


  // ===== Tab switching =====
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      try {
        const targetId = btn.dataset.tab;
        tabButtons.forEach((b) => b.classList.remove('active'));
        tabPanels.forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        const targetPanel = document.getElementById(targetId);
        if (targetPanel) {
          targetPanel.classList.add('active');
        } else {
          console.error('[Tab Switch] Target panel not found:', targetId);
        }

        if (targetId === 'tab-editor') {
          console.log('[Tab Switch] Activating Document Editor tab');
          // Ensure the editor sub-tabs are visible - manually activate the first one
          const editorTabs = document.querySelectorAll('#tab-editor .editor-sub-tab');
          const editorPanels = document.querySelectorAll('#tab-editor .editor-sub-panel');
          const firstActiveTab = Array.from(editorTabs).find(t => t.classList.contains('active'));
          const activePanelId = firstActiveTab ? firstActiveTab.dataset.subtab : 'subtab-text-tags';

          editorTabs.forEach(t => t.classList.toggle('active', t.dataset.subtab === activePanelId));
          editorPanels.forEach(p => p.classList.toggle('active', p.id === activePanelId));
          console.log('[Tab Switch] Activated sub-tab:', activePanelId);
        }
        if (targetId === 'tab-status') {
          loadSignatures();
        }
        if (targetId === 'tab-api-logs') {
          loadApiLogs();
        }
        if (targetId === 'tab-templates') {
          loadTemplatesTab(false);
        }
        if (targetId === 'tab-apps') {
          loadAppsTab(false);
        }

        // Update page title based on active tab
        updatePageTitle(targetId);

        // Hide side panel on API Logs tab (redundant), show on other tabs
        updateSidePanelVisibility(targetId);
      } catch (err) {
        console.error('[Tab Switch] Error switching tabs:', err);
      }
    });
  });

  // Update page title based on active tab
  function updatePageTitle(tabId) {
    const tabTitles = {
      'tab-editor': 'Sign Portal - Send Signatures',
      'tab-status': 'Sign Portal - Signature Status',
      'tab-templates': 'Sign Portal - Templates',
      'tab-team': 'Sign Portal - Team',
      'tab-apps': 'Sign Portal - API Apps',
      'tab-settings': 'Sign Portal - Settings',
      'tab-api-logs': 'Sign Portal - API Logs'
    };
    document.title = tabTitles[tabId] || 'Sign API Portal';
  }

  // ===== Signature Status loading =====
  const pageSizeSelect = document.getElementById('pageSizeSelect');
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
  const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');
  const sendRemindersBtn = document.getElementById('sendRemindersBtn');
  const selectAllCheckbox = document.getElementById('selectAllSigs');
  let signaturesCache = null;
  let signaturesCachePageSize = null;
  let deletedSignatureIds = new Set(); // Track deleted IDs to filter during refresh

  // Only initialize if elements exist (not on admin page)
  if (!pageSizeSelect || !deleteSelectedBtn || !downloadSelectedBtn || !sendRemindersBtn || !selectAllCheckbox) {
    console.log('[Signature Status] Elements not found, skipping initialization');
  } else {
    pageSizeSelect.addEventListener('change', () => loadSignatures());

  function updateDeleteButton() {
    const checked = document.querySelectorAll('.sig-row-checkbox:checked');
    deleteSelectedBtn.disabled = checked.length === 0;
    deleteSelectedBtn.style.opacity = checked.length === 0 ? '0.5' : '1';

    // Enable/disable download button
    downloadSelectedBtn.disabled = checked.length === 0;
    downloadSelectedBtn.style.opacity = checked.length === 0 ? '0.5' : '1';
    downloadSelectedBtn.style.cursor = checked.length === 0 ? 'not-allowed' : 'pointer';

    // Update download button title/tooltip
    if (checked.length > 0) {
      downloadSelectedBtn.title = `Download ${checked.length} document(s)`;
    } else {
      downloadSelectedBtn.title = 'Download selected documents';
    }

    // Check if any selected signatures are embedded
    const hasEmbedded = Array.from(checked).some(cb => {
      console.log('[REMINDER BTN] Checkbox dataset:', cb.dataset.id, 'isEmbedded:', cb.dataset.isEmbedded);
      return cb.dataset.isEmbedded === 'true';
    });

    // Disable Send reminders button if no signatures selected OR if any are embedded
    const shouldDisableReminders = checked.length === 0 || hasEmbedded;
    sendRemindersBtn.disabled = shouldDisableReminders;
    sendRemindersBtn.style.opacity = shouldDisableReminders ? '0.5' : '1';
    sendRemindersBtn.style.cursor = shouldDisableReminders ? 'not-allowed' : 'pointer';

    // Update button text and tooltip
    if (hasEmbedded && checked.length > 0) {
      sendRemindersBtn.textContent = t('signature_status.send_reminders_count').replace('{count}', checked.length);
      sendRemindersBtn.title = 'Cannot send reminders for embedded signatures';
    } else if (checked.length > 0) {
      sendRemindersBtn.textContent = t('signature_status.send_reminders_count').replace('{count}', checked.length);
      sendRemindersBtn.title = '';
    } else {
      sendRemindersBtn.textContent = t('signature_status.send_reminders');
      sendRemindersBtn.title = '';
    }
  }

  selectAllCheckbox.addEventListener('change', () => {
    const checkboxes = document.querySelectorAll('.sig-row-checkbox');
    checkboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
    updateDeleteButton();
  });

  downloadSelectedBtn.addEventListener('click', async () => {
    const checked = document.querySelectorAll('.sig-row-checkbox:checked');
    const ids = Array.from(checked).map(cb => cb.dataset.id);
    if (ids.length === 0) return;

    // Download each selected signature request
    downloadSelectedBtn.disabled = true;
    downloadSelectedBtn.style.opacity = '0.5';
    downloadSelectedBtn.style.cursor = 'not-allowed';
    const originalTitle = downloadSelectedBtn.title;
    downloadSelectedBtn.title = 'Downloading...';

    let successCount = 0;
    let failCount = 0;

    for (const id of ids) {
      try {
        const response = await fetchWithCsrf(`/signatures/download/${id}`);

        if (!response.ok) {
          failCount++;
          console.error(`Failed to download ${id}:`, response.statusText);
          continue;
        }

        // Get the filename from Content-Disposition header if available
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = `signature_request_${id}.pdf`;
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
          if (filenameMatch) {
            filename = filenameMatch[1];
          }
        }

        // Download the file
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        successCount++;

        // Small delay between downloads to avoid overwhelming the browser
        if (ids.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (err) {
        failCount++;
        console.error(`Error downloading ${id}:`, err);
      }
    }

    // Show result toast
    if (successCount > 0 && failCount === 0) {
      window.showToast(`Successfully downloaded ${successCount} document(s)`, 'success');
    } else if (successCount > 0 && failCount > 0) {
      window.showToast(`Downloaded ${successCount} document(s), ${failCount} failed`, 'warning');
    } else {
      window.showToast('Failed to download documents', 'error');
    }

    // Re-enable button
    downloadSelectedBtn.disabled = false;
    downloadSelectedBtn.style.opacity = '1';
    downloadSelectedBtn.style.cursor = 'pointer';
    downloadSelectedBtn.title = originalTitle;

    // Update button state via updateDeleteButton
    updateDeleteButton();
  });

  sendRemindersBtn.addEventListener('click', async () => {
    const checked = document.querySelectorAll('.sig-row-checkbox:checked');
    const ids = Array.from(checked).map(cb => cb.dataset.id);
    if (ids.length === 0) return;

    // Check if any selected signatures are embedded
    const hasEmbedded = Array.from(checked).some(cb => {
      console.log('[REMINDER CLICK] Checkbox dataset:', cb.dataset.id, 'isEmbedded:', cb.dataset.isEmbedded);
      return cb.dataset.isEmbedded === 'true';
    });
    console.log('[REMINDER CLICK] hasEmbedded:', hasEmbedded, 'checked count:', checked.length);
    if (hasEmbedded) {
      window.showToast('Cannot send reminders for embedded signatures', 'error');
      return;
    }

    sendRemindersBtn.disabled = true;
    sendRemindersBtn.textContent = t('buttons.sending');

    try {
      const res = await fetchWithCsrf('/signatures/remind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }

      const data = await res.json();

      // Count successful reminders and collect error messages
      let totalSent = 0;
      let totalFailed = 0;
      const failedResults = [];
      data.results.forEach(result => {
        if (result.success && result.remindersSent) {
          totalSent += result.remindersSent;
        }
        if (result.success === false || (result.totalPending && result.remindersSent < result.totalPending)) {
          totalFailed++;
          failedResults.push(result);
        }
      });

      // Show success message
      if (totalSent > 0) {
        window.showToast(`Successfully sent ${totalSent} reminder(s)`, 'success');
      }
      if (totalFailed > 0) {
        // Check if all failures are due to embedded signatures
        const allEmbeddedErrors = failedResults.every(r =>
          r.error && r.error.toLowerCase().includes('embedded')
        );

        if (allEmbeddedErrors) {
          window.showToast('Cannot send reminders for embedded signatures', 'error');
        } else if (failedResults.length === 1) {
          // If only one failure, show the specific error message
          const errorMsg = failedResults[0].error ||
                          (failedResults[0].details && failedResults[0].details[0] && failedResults[0].details[0].error) ||
                          'Unknown error';
          window.showToast(`Failed to send reminder: ${errorMsg}`, 'error');
        } else {
          window.showToast(`Failed to send some reminders. Check console for details.`, 'error');
        }
        console.error('Reminder failures:', failedResults);
      }
      if (totalSent === 0 && totalFailed === 0) {
        window.showToast('No pending signers to remind', 'info');
      }

    } catch (err) {
      console.error('Error sending reminders:', err);
      window.showToast('Failed to send reminders: ' + err.message, 'error');
    }

    sendRemindersBtn.textContent = t('signature_status.send_reminders');
    sendRemindersBtn.disabled = false;
    selectAllCheckbox.checked = false;
    updateDeleteButton();

    // Refresh signature list to show updated reminder status
    await loadSignatures();
  });

  deleteSelectedBtn.addEventListener('click', async () => {
    const checked = document.querySelectorAll('.sig-row-checkbox:checked');
    const ids = Array.from(checked).map(cb => cb.dataset.id);
    if (ids.length === 0) return;

    deleteSelectedBtn.disabled = true;
    deleteSelectedBtn.textContent = 'Deleting...';

    // Track deleted IDs to filter them out during refresh
    ids.forEach(id => deletedSignatureIds.add(id));

    // Immediately remove rows from DOM for instant feedback
    checked.forEach(cb => {
      const row = cb.closest('tr');
      if (row) row.remove();
    });

    // Invalidate cache to prevent showing stale data
    signaturesCache = null;

    try {
      const res = await fetchWithCsrf('/signatures', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }

      // Wait for delete to complete before refreshing
      await res.json();
    } catch (err) {
      console.error('Error deleting signatures:', err);
      alert('Failed to delete some signature requests.');
      // Remove from deleted set on error so they can be retried
      ids.forEach(id => deletedSignatureIds.delete(id));
    }

    deleteSelectedBtn.textContent = 'Delete';
    selectAllCheckbox.checked = false;

    // Refresh after delete completes to avoid race condition
    await loadSignatures();
  });

  // Returns progressive CSS class based on step position within total steps
  function stepClass(step) {
    if (step === 'Declined') return 'declined';
    if (step === 'Error') return 'error';
    if (step === 'Pending') return 'pending';
    const map = { 'Sent': 'step-1', 'Viewed': 'step-2', 'Signed': 'step-3', 'Complete': 'step-4' };
    return map[step] || 'fallback';
  }

  async function renderSignatures(data) {
    const tbody = document.getElementById('signaturesBody');
    const table = document.getElementById('signaturesTable');
    const loading = document.getElementById('statusLoading');

    loading.style.display = 'none';
    tbody.innerHTML = '';

    // Filter out recently deleted signature requests to prevent limbo state
    const filteredData = data.filter(item => !deletedSignatureIds.has(item.id));

    if (filteredData.length === 0) {
      loading.textContent = 'No signature requests found.';
      loading.style.display = 'block';
      table.style.display = 'none';
      return;
    }

    // Get current user's email to check ownership
    let currentUserEmail = '';
    try {
      const authRes = await fetchWithCsrf('/auth/status');
      const authData = await authRes.json();
      currentUserEmail = authData.email?.toLowerCase() || '';
    } catch (err) {
      console.warn('Failed to fetch current user email:', err);
    }

    selectAllCheckbox.checked = false;
    filteredData.forEach((item) => {
      const tr = document.createElement('tr');

      const tdCheck = document.createElement('td');

      // Only show delete checkbox if user owns this signature request
      const userOwnsSig = currentUserEmail && item.sender &&
                          currentUserEmail === item.sender.toLowerCase();

      if (userOwnsSig) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.classList.add('sig-row-checkbox');
        checkbox.dataset.id = item.id;
        checkbox.dataset.isEmbedded = item.isEmbedded ? 'true' : 'false';
        checkbox.addEventListener('change', updateDeleteButton);

        // Debug logging
        console.log('[RENDER] Created checkbox for:', item.title, 'ID:', item.id, 'isEmbedded:', item.isEmbedded, 'dataset value:', checkbox.dataset.isEmbedded);

        // Add tooltip for embedded requests
        if (item.isEmbedded) {
          checkbox.title = 'Embedded request (cannot send reminders, but can delete)';
        }

        tdCheck.appendChild(checkbox);
      } else {
        // Show a dash or nothing for signatures user doesn't own
        tdCheck.textContent = '—';
        tdCheck.style.color = '#cbd5e1';
        tdCheck.style.textAlign = 'center';
      }

      tr.appendChild(tdCheck);

      const tdTitle = document.createElement('td');
      tdTitle.textContent = item.title;
      tr.appendChild(tdTitle);

      const tdSender = document.createElement('td');
      tdSender.textContent = item.sender || '';
      tr.appendChild(tdSender);

      const tdProgress = document.createElement('td');
      tdProgress.style.position = 'relative';

      const signers = item.signers || [];
      const showSignerName = signers.length > 0;

      signers.forEach((signer) => {
        const row = document.createElement('div');
        row.classList.add('signer-progress');

        if (showSignerName) {
          const nameEl = document.createElement('span');
          nameEl.classList.add('signer-name');
          nameEl.textContent = signer.name;
          nameEl.title = signer.email || signer.name;
          row.appendChild(nameEl);
        }

        const pillsContainer = document.createElement('span');
        pillsContainer.classList.add('progress-pills');

        signer.steps.forEach((step, idx) => {
          if (idx > 0) {
            const arrow = document.createElement('span');
            arrow.classList.add('progress-pill-arrow');
            arrow.textContent = '\u203a';
            pillsContainer.appendChild(arrow);
          }

          const pill = document.createElement('span');
          pill.classList.add('progress-pill', stepClass(step.step));
          pill.textContent = step.step;

          // Timestamp popover on hover
          if (step.timestamp) {
            pill.addEventListener('mouseenter', () => {
              const pop = document.createElement('span');
              pop.classList.add('pill-popover');
              const d = new Date(step.timestamp * 1000);
              pop.textContent = d.toLocaleDateString('en-GB', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              });
              pill.appendChild(pop);
            });
            pill.addEventListener('mouseleave', () => {
              const pop = pill.querySelector('.pill-popover');
              if (pop) pop.remove();
            });
          }

          // Decline/error reason on click
          if (step.reason) {
            pill.style.cursor = 'pointer';
            pill.title = 'Click to see details';
            pill.addEventListener('click', () => {
              const existing = document.querySelector('.error-popover');
              if (existing) existing.remove();
              const popover = document.createElement('div');
              popover.classList.add('error-popover');
              popover.textContent = step.reason;
              const closeBtn = document.createElement('span');
              closeBtn.textContent = '\u00d7';
              closeBtn.classList.add('error-popover-close');
              closeBtn.addEventListener('click', (e) => { e.stopPropagation(); popover.remove(); });
              popover.prepend(closeBtn);
              tdProgress.appendChild(popover);
            });
          }

          pillsContainer.appendChild(pill);
        });

        row.appendChild(pillsContainer);

        // Feature icons: per-signer flags + request-level flags
        const features = [];
        if (signer.hasPin) features.push({ icon: '🔑', label: 'Passcode verification' });
        if (signer.hasSms) features.push({ icon: '💬', label: 'SMS authentication' });
        if (item.hasEid) features.push({ icon: '🪪', label: 'eID verification' });
        if (item.hasAttachments) features.push({ icon: '📎', label: 'Attachment required' });
        if (item.isEmbedded) features.push({ icon: '🔗', label: 'Embedded signing (cannot send reminders)' });

        if (features.length > 0) {
          const iconsWrap = document.createElement('span');
          iconsWrap.classList.add('progress-features');
          features.forEach((f) => {
            const icon = document.createElement('span');
            icon.classList.add('feature-icon');
            icon.textContent = f.icon;
            icon.title = f.label;
            iconsWrap.appendChild(icon);
          });
          row.appendChild(iconsWrap);
        }

        tdProgress.appendChild(row);
      });

      // Fallback if no signers data at all
      if (signers.length === 0) {
        const pill = document.createElement('span');
        pill.classList.add('progress-pill', 'fallback');
        pill.textContent = item.status;
        tdProgress.appendChild(pill);
      }

      // Warning indicator — append inline after the last signer's pills
      if (item.warnings && item.warnings.length > 0) {
        const warnIcon = document.createElement('span');
        warnIcon.classList.add('warning-icon');
        warnIcon.textContent = '\u26A0';
        warnIcon.title = `${item.warnings.length} warning(s) — click to view`;
        warnIcon.addEventListener('click', () => {
          const existing = tdProgress.querySelector('.warning-popover');
          if (existing) { existing.remove(); return; }
          const popover = document.createElement('div');
          popover.classList.add('warning-popover');
          const closeBtn = document.createElement('span');
          closeBtn.textContent = '\u00d7';
          closeBtn.classList.add('warning-popover-close');
          closeBtn.addEventListener('click', (e) => { e.stopPropagation(); popover.remove(); });
          popover.appendChild(closeBtn);
          item.warnings.forEach((w) => {
            const line = document.createElement('div');
            line.classList.add('warning-line');
            const name = document.createElement('span');
            name.classList.add('warning-name');
            name.textContent = w.warningName;
            const msg = document.createElement('span');
            msg.classList.add('warning-msg');
            msg.textContent = w.warningMsg;
            line.appendChild(name);
            line.appendChild(msg);
            popover.appendChild(line);
          });
          tdProgress.appendChild(popover);
        });
        // Attach to the last signer row so it appears inline after the pills
        const lastRow = tdProgress.querySelector('.signer-progress:last-child');
        if (lastRow) {
          lastRow.appendChild(warnIcon);
        } else {
          tdProgress.appendChild(warnIcon);
        }
      }

      tr.appendChild(tdProgress);

      const tdMeta = document.createElement('td');
      const meta = item.metadata || {};
      const metaKeys = Object.keys(meta);
      if (metaKeys.length > 0) {
        metaKeys.forEach(key => {
          const tag = document.createElement('span');
          tag.classList.add('metadata-tag');
          tag.textContent = `${key}: ${meta[key]}`;
          tag.title = `${key}: ${meta[key]}`;
          tdMeta.appendChild(tag);
        });
      } else {
        tdMeta.textContent = '\u2014';
        tdMeta.style.color = '#94a3b8';
      }
      tr.appendChild(tdMeta);

      const tdDate = document.createElement('td');
      if (item.updatedAt) {
        const date = new Date(item.updatedAt * 1000);
        tdDate.textContent = date.toLocaleDateString('en-GB', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
      } else {
        tdDate.textContent = '\u2014';
      }
      tr.appendChild(tdDate);

      tbody.appendChild(tr);
    });

    table.style.display = 'table';
    updateDeleteButton();
  }

  function fetchSignatures(pageSize) {
    return fetchWithCsrf(`/signatures?pageSize=${pageSize}`)
      .then((res) => {
        if (res.status === 429) { showWarningToast('API rate limited — retrying...'); throw new Error('Rate limited'); }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      });
  }

  // Debounce to prevent rapid-fire API calls (e.g. multiple SSE events)
  let loadSignaturesTimer = null;
  function loadSignaturesDebounced() {
    clearTimeout(loadSignaturesTimer);
    loadSignaturesTimer = setTimeout(loadSignatures, 500);
  }

  function loadSignatures() {
    const table = document.getElementById('signaturesTable');
    const loading = document.getElementById('statusLoading');
    const errorEl = document.getElementById('statusError');
    const refreshing = document.getElementById('statusRefreshing');
    const pageSize = pageSizeSelect.value;

    errorEl.style.display = 'none';

    // If we have cached data for this page size, show it immediately
    const hasExistingData = signaturesCache && signaturesCachePageSize === pageSize;
    if (hasExistingData) {
      renderSignatures(signaturesCache);
      refreshing.style.display = 'inline';
    } else {
      // First load with no cache — show the loading message, hide the table
      loading.textContent = 'Loading signature requests...';
      loading.style.display = 'block';
      table.style.display = 'none';
    }

    fetchSignatures(pageSize)
      .then((data) => {
        refreshing.style.display = 'none';
        signaturesCache = data;
        signaturesCachePageSize = pageSize;

        // Clean up deleted IDs that no longer exist in server data
        const serverIds = new Set(data.map(item => item.id));
        deletedSignatureIds.forEach(id => {
          if (!serverIds.has(id)) {
            deletedSignatureIds.delete(id);
          }
        });

        renderSignatures(data);
      })
      .catch((err) => {
        refreshing.style.display = 'none';
        // If we had cached data showing, keep it visible and just show error inline
        if (!hasExistingData) {
          loading.style.display = 'none';
          table.style.display = 'none';
        }
        errorEl.textContent = 'Failed to load signature requests. Please try again.';
        errorEl.style.display = 'block';
        console.error('Error fetching signatures:', err);
      });
  }

  // Background prefetch signatures after critical resources (apps, templates) finish loading
  function prefetchSignatures() {
    const pageSize = pageSizeSelect.value;
    fetchSignatures(pageSize)
      .then((data) => {
        signaturesCache = data;
        signaturesCachePageSize = pageSize;
      })
      .catch(() => { /* silent — prefetch is best-effort */ });
  }
  } // End signature status initialization

  // ===== Shared data — declare all variables at top to prevent temporal dead zone =====
  // Use window.themesData directly so it can be updated by visual editor
  if (!window.themesData) {
    window.themesData = {};
  }
  const themesData = window.themesData; // Reference, not copy
  const portalSettings = window.portalSettings || {};
  // Use saved theme from last session, fallback to window.currentThemeId (server default), then first theme
  let currentThemeId = (portalSettings.selectedTheme && themesData[portalSettings.selectedTheme])
    ? portalSettings.selectedTheme
    : window.currentThemeId || Object.keys(themesData)[0];

  let allTemplates = [];
  let templatesLoaded = false;
  let templatePageSizeValue = 25;
  let templateSearchQuery = '';

  let allApps = [];
  let appsLoaded = false;

  let docTemplates = [];

  console.log('[Init] themesData loaded:', Object.keys(themesData));
  console.log('[Init] novafront_installation theme:', themesData['novafront_installation']);

  function loadTemplatesOnce(force) {
    if (templatesLoaded && !force) {
      return Promise.resolve(allTemplates);
    }
    // Add force parameter to URL to bypass server cache
    const forceParam = force ? '&force=true' : '';
    return fetchWithCsrf(`/api-templates?pageSize=${templatePageSizeValue}${forceParam}`)
      .then(res => {
        if (res.status === 429) { showWarningToast('API rate limited loading templates — retrying...'); throw new Error('Rate limited'); }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(list => {
        allTemplates = Array.isArray(list) ? list : [];
        templatesLoaded = true;
        return allTemplates;
      });
  }

  const themeSelect = document.getElementById('themeSelect');
  if (!themeSelect) {
    console.warn('[Theme] themeSelect element not found - user may not be logged in');
    return; // Exit early if element doesn't exist
  }

  Object.entries(themesData).forEach(([id, theme]) => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = theme.name;
    if (id === currentThemeId) o.selected = true;
    themeSelect.appendChild(o);
  });

  function applyTheme(themeId) {
    const theme = themesData[themeId];
    if (!theme) return;
    currentThemeId = themeId;
    window.currentThemeId = themeId; // Expose for visual editor

    // Swap all labels via data-theme-target
    const targets = {
      pageTitle: theme.pageTitle,
      tabLabel: theme.tabLabel,
      leftSectionTitle: theme.sections.left.title,
      rightSectionTitle: theme.sections.right.title,
      nameLabel: theme.sections.left.fields[0].label,
      emailLabel: theme.sections.left.fields[1].label,
      secondNameLabel: theme.sections.left.fields[2]?.label || 'Name',
      secondEmailLabel: theme.sections.left.fields[3]?.label || 'Email',
      field1Label: theme.sections.right?.fields?.[0]?.label || 'Field 1',
      field2Label: theme.sections.right?.fields?.[1]?.label || 'Field 2',
      field3Label: theme.sections.right?.fields?.[2]?.label || 'Field 3',
      // sendBtn and embedBtn are server-translated, don't overwrite them here
    };
    Object.entries(targets).forEach(([key, value]) => {
      const el = document.querySelector(`[data-theme-target="${key}"]`);
      if (el) el.textContent = value;
    });

    // Update default values
    // Try fields array defaultValue first (user-editable), then fall back to firstSigner (legacy)
    const nameValue = theme.sections.left.fields[0]?.defaultValue || theme.sections?.left?.firstSigner?.name || '';
    const emailValue = theme.sections.left.fields[1]?.defaultValue || theme.sections?.left?.firstSigner?.email || '';

    document.getElementById('signerName1').value = nameValue;
    document.getElementById('signerEmail1').value = emailValue;
    document.getElementById('field1').value = theme.sections.right?.fields?.[0]?.defaultValue || '';
    document.getElementById('field2').value = theme.sections.right?.fields?.[1]?.defaultValue || '';
    document.getElementById('field3').value = theme.sections.right?.fields?.[2]?.defaultValue || '';

    // Update second signer defaults
    const secondSigner = theme.sections.left.secondSigner || {};
    document.getElementById('signerName2').value = secondSigner.name || '';
    document.getElementById('signerEmail2').value = secondSigner.email || '';

    // Filter templates
    filterTemplatesByTheme(themeId);

    // Switch document editor to matching template
    applyDocumentTemplate(themeId);
  }

  function filterTemplatesByTheme(themeId) {
    if (!allTemplates || !Array.isArray(allTemplates)) return; // Guard: ensure allTemplates exists
    const sel = document.getElementById('templateSelect');
    sel.innerHTML = '<option value="" disabled selected>-- Select --</option>';
    const filtered = allTemplates.filter(t =>
      t.labels && t.labels.length > 0 && t.labels.includes(themeId)
    );
    filtered.forEach(template => {
      const o = document.createElement('option');
      o.value = template.id;
      const label = template.hasMergeFields
        ? `${template.title} [Merge Fields]`
        : template.title;
      o.textContent = label;
      if (template.hasMergeFields && template.mergeFieldNames && template.mergeFieldNames.length > 0) {
        o.title = 'Merge fields: ' + template.mergeFieldNames.join(', ');
      }
      sel.appendChild(o);
    });
    if (filtered.length === 0) {
      sel.innerHTML = '<option value="" disabled selected>' + (window.i18n?.noTemplatesForTheme || 'No templates for this theme') + '</option>';
    }

    // Restore saved template selection if available
    if (portalSettings.selectedTemplate && filtered.some(t => t.id === portalSettings.selectedTemplate)) {
      sel.value = portalSettings.selectedTemplate;
    }

    // Update button states based on template availability
    updateTemplateButtonStates(filtered.length > 0);
  }

  function updateTemplateButtonStates(hasTemplates) {
    const documentMode = document.getElementById('documentMode')?.value;
    const sendBtn = document.getElementById('sendBtn');
    const embedBtn = document.getElementById('embedBtn');
    const unclaimedTemplateBtn = document.getElementById('unclaimedTemplateBtn');
    const templateSelect = document.getElementById('templateSelect');

    // Check if a template is actually selected (not just available)
    const templateSelected = templateSelect && templateSelect.value && templateSelect.value !== '';

    // Only affect buttons when in template mode (none)
    if (documentMode === 'none') {
      if (!hasTemplates) {
        // "Use Template" mode with no templates - disable template-dependent buttons
        if (sendBtn) {
          sendBtn.disabled = true;
          sendBtn.style.opacity = '0.5';
          sendBtn.style.cursor = 'not-allowed';
          sendBtn.title = window.i18n?.noTemplatesForTheme || 'No templates available for this theme';
        }

        if (embedBtn) {
          embedBtn.disabled = true;
          embedBtn.style.opacity = '0.5';
          embedBtn.style.cursor = 'not-allowed';
          embedBtn.title = window.i18n?.noTemplatesForTheme || 'No templates available for this theme';
        }

        if (unclaimedTemplateBtn) {
          unclaimedTemplateBtn.disabled = true;
          unclaimedTemplateBtn.style.opacity = '0.5';
          unclaimedTemplateBtn.style.cursor = 'not-allowed';
          unclaimedTemplateBtn.title = window.i18n?.noTemplatesForTheme || 'No templates available for this theme';
        }
      } else if (!templateSelected) {
        // Templates available but none selected - disable buttons
        if (sendBtn) {
          sendBtn.disabled = true;
          sendBtn.style.opacity = '0.5';
          sendBtn.style.cursor = 'not-allowed';
          sendBtn.title = window.i18n?.selectTemplateFirst || 'Please select a template';
        }

        if (embedBtn) {
          embedBtn.disabled = true;
          embedBtn.style.opacity = '0.5';
          embedBtn.style.cursor = 'not-allowed';
          embedBtn.title = window.i18n?.selectTemplateFirst || 'Please select a template';
        }

        if (unclaimedTemplateBtn) {
          unclaimedTemplateBtn.disabled = true;
          unclaimedTemplateBtn.style.opacity = '0.5';
          unclaimedTemplateBtn.style.cursor = 'not-allowed';
          unclaimedTemplateBtn.title = window.i18n?.selectTemplateFirst || 'Please select a template';
        }
      } else {
        // Re-enable buttons when templates are available AND one is selected
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.style.opacity = '1';
          sendBtn.style.cursor = 'pointer';
          sendBtn.title = '';
        }

        if (embedBtn) {
          embedBtn.disabled = false;
          embedBtn.style.opacity = '1';
          embedBtn.style.cursor = 'pointer';
          embedBtn.title = '';
        }

        if (unclaimedTemplateBtn) {
          unclaimedTemplateBtn.disabled = false;
          unclaimedTemplateBtn.style.opacity = '1';
          unclaimedTemplateBtn.style.cursor = 'pointer';
          unclaimedTemplateBtn.title = '';
        }

        // Check domain verification before final enable
        if (typeof updateEmbeddedButtonStates === 'function') {
          updateEmbeddedButtonStates();
        }
      }
    }
  }

  // Expose applyTheme globally for visual editor
  window.applyTheme = applyTheme;

  themeSelect.addEventListener('change', () => {
    const selectedThemeId = themeSelect.value;
    applyTheme(selectedThemeId);

    // Save the selected theme to settings
    fetchWithCsrf('/settings/selected-theme', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeId: selectedThemeId })
    }).catch(err => console.error('Failed to save selected theme:', err));
  });

  // ✅ Shared API Apps cache
  const appSelect = document.getElementById('appSelect');

  function loadAppsOnce(force) {
    if (appsLoaded && !force) return Promise.resolve(allApps);
    return fetchWithCsrf('/api-apps' + (force ? '?force=1' : ''))
      .then(res => {
        if (res.status === 429) { showWarningToast('API rate limited loading apps — retrying...'); throw new Error('Rate limited'); }
        if (!res.ok) {
          console.error('[loadAppsOnce] Failed to load apps:', res.status, res.statusText);
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then(apps => {
        console.log('[loadAppsOnce] Loaded apps:', apps);
        allApps = apps;
        appsLoaded = true;
        return apps;
      })
      .catch(err => {
        console.error('[loadAppsOnce] Error loading apps:', err);
        throw err;
      });
  }

  function populateAppDropdown() {
    console.log('[populateAppDropdown] Called. allApps:', allApps);
    if (!allApps || !Array.isArray(allApps)) {
      console.warn('[populateAppDropdown] allApps not available or not array');
      return;
    }
    const visibleApps = allApps.filter(app => app.visible !== false);
    console.log('[populateAppDropdown] Visible apps:', visibleApps.length);
    appSelect.innerHTML = '';
    if (visibleApps.length === 0) {
      appSelect.innerHTML = '<option value="" disabled selected>No apps available</option>';
      return;
    }
    visibleApps.forEach(app => {
      const o = document.createElement('option');
      o.value = app.clientId;
      o.textContent = app.name;
      appSelect.appendChild(o);
    });
    console.log('[populateAppDropdown] Populated', visibleApps.length, 'apps');

    // Pre-select the saved API app if available
    const savedApiApp = portalSettings?.selectedApiApp;
    if (savedApiApp && visibleApps.some(app => app.clientId === savedApiApp)) {
      appSelect.value = savedApiApp;
    } else {
      appSelect.selectedIndex = 0;
    }
    initHelloSignClient(appSelect.value);

    // Update SMS options based on selected app's test mode
    if (typeof updateSmsOptionsVisibility === 'function') {
      updateSmsOptionsVisibility();
    }
  }

  appSelect.addEventListener('change', () => {
    const selectedClientId = appSelect.value;
    initHelloSignClient(selectedClientId);

    // Save the selected API app to settings (hidden, not shown in Settings UI)
    fetchWithCsrf('/settings/selected-api-app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: selectedClientId })
    }).catch(err => console.error('Failed to save selected API app:', err));

    // Update SMS options based on test mode
    if (typeof updateSmsOptionsVisibility === 'function') {
      updateSmsOptionsVisibility();
    }
  });

  // ✅ Populate template dropdown (uses shared cache)
  function loadTemplatesForDropdown(force) {
    return loadTemplatesOnce(force).then(() => filterTemplatesByTheme(currentThemeId)).catch(() => {
      const sel = document.getElementById('templateSelect');
      sel.innerHTML = '<option value="" disabled selected>Failed to load templates — check API key</option>';
    });
  }

  // Sequential loading to avoid API rate limits: templates first, then apps (with delay), then signatures
  loadTemplatesForDropdown()
    .then(() => new Promise(r => setTimeout(r, 300)))
    .then(() => loadAppsOnce()
      .then(() => populateAppDropdown())
      .catch(err => {
        console.error('[Loading] Failed to load apps:', err);
        appSelect.innerHTML = '<option value="" disabled selected>Failed to load apps — check API key</option>';
        throw err; // Re-throw to stop the chain
      }))
    .then(() => new Promise(r => setTimeout(r, 300)))
    .then(() => prefetchSignatures())
    .catch(err => {
      console.error('[Loading] Sequential loading error (after apps):', err);
      // Don't overwrite the dropdown here - it might have been populated successfully
    });

  // ===== Document Mode dropdown toggle =====
  const documentModeSelect = document.getElementById('documentMode');
  const templateSelect = document.getElementById('templateSelect');
  const autoAppendFileInput = document.getElementById('autoAppendFileInput');
  const autoAppendChooseBtn = document.getElementById('autoAppendChooseBtn');
  let autoAppendFile = null; // stores the File object for auto-append mode

  function resetChooseFileBtn() {
    autoAppendChooseBtn.textContent = 'Choose File';
    autoAppendChooseBtn.classList.remove('has-file');
    autoAppendFile = null;
    autoAppendFileInput.value = '';
  }

  autoAppendChooseBtn.addEventListener('click', () => {
    // If a file is already attached, the × area clears it
    if (autoAppendFile) {
      resetChooseFileBtn();
      documentModeSelect.value = 'none';
      documentModeSelect.dispatchEvent(new Event('change'));
      return;
    }
    autoAppendFileInput.click();
  });

  function getDocumentMode() { return documentModeSelect.value; }

  documentModeSelect.addEventListener('change', () => {
    const mode = getDocumentMode();
    const sendBtn = document.getElementById('sendBtn');
    const embedBtn = document.getElementById('embedBtn');
    const unclaimedTemplateBtn = document.getElementById('unclaimedTemplateBtn');
    const unclaimedFileBtn = document.getElementById('unclaimedFileBtn');

    if (mode === 'none') {
      templateSelect.disabled = false;
      templateSelect.setAttribute('required', '');
      resetChooseFileBtn();
    } else {
      templateSelect.disabled = true;
      templateSelect.removeAttribute('required');
      templateSelect.setCustomValidity('');
    }

    if (mode === 'auto-append') {
      autoAppendChooseBtn.disabled = false;
    } else {
      autoAppendChooseBtn.disabled = true;
      resetChooseFileBtn();
    }

    // Handle button states and text based on document mode
    if (mode === 'auto-append') {
      // Auto-append mode: Button 1 is disabled until file is chosen
      const originalSendText = sendBtn.getAttribute('data-original-text') || sendBtn.textContent;
      if (!sendBtn.getAttribute('data-original-text')) {
        sendBtn.setAttribute('data-original-text', originalSendText);
      }

      // Change button text to "Send for Signature (Document)"
      sendBtn.textContent = window.i18n?.sendSignatureDocument || 'Send for Signature (Document)';

      // Only enable send button if a file has been chosen
      if (autoAppendFile) {
        sendBtn.disabled = false;
        sendBtn.style.opacity = '1';
        sendBtn.style.cursor = 'pointer';
        sendBtn.title = '';
      } else {
        sendBtn.disabled = true;
        sendBtn.style.opacity = '0.5';
        sendBtn.style.cursor = 'not-allowed';
        sendBtn.title = 'Please choose a file first';
      }

      // Disable "View & Sign (Embedded Template)" button
      if (embedBtn) {
        embedBtn.disabled = true;
        embedBtn.style.opacity = '0.5';
        embedBtn.style.cursor = 'not-allowed';
      }

      // Keep "Prepare a File & Send (Unclaimed Draft)" enabled
      if (unclaimedFileBtn) {
        unclaimedFileBtn.disabled = false;
        unclaimedFileBtn.style.opacity = '1';
        unclaimedFileBtn.style.cursor = 'pointer';
      }

      // Disable "Prepare a Template & Send (Unclaimed Draft)" button
      if (unclaimedTemplateBtn) {
        unclaimedTemplateBtn.disabled = true;
        unclaimedTemplateBtn.style.opacity = '0.5';
        unclaimedTemplateBtn.style.cursor = 'not-allowed';
      }
    } else if (mode === 'text-tags' || mode === 'form-fields') {
      // Text-tags and form-fields modes: only "Send for Signature" and "Prepare a File & Send" are active
      const originalSendText = sendBtn.getAttribute('data-original-text') || sendBtn.textContent;
      if (!sendBtn.getAttribute('data-original-text')) {
        sendBtn.setAttribute('data-original-text', originalSendText);
      }

      // Change button text to "Send for Signature (Document)"
      sendBtn.textContent = window.i18n?.sendSignatureDocument || 'Send for Signature (Document)';
      sendBtn.disabled = false;
      sendBtn.style.opacity = '1';
      sendBtn.style.cursor = 'pointer';
      sendBtn.title = '';

      // Keep "Prepare a File & Send (Unclaimed Draft)" enabled
      if (unclaimedFileBtn) {
        unclaimedFileBtn.disabled = false;
        unclaimedFileBtn.style.opacity = '1';
        unclaimedFileBtn.style.cursor = 'pointer';
      }

      // Disable "View & Sign (Embedded Template)" button
      if (embedBtn) {
        embedBtn.disabled = true;
        embedBtn.style.opacity = '0.5';
        embedBtn.style.cursor = 'not-allowed';
      }

      // Disable "Prepare a Template & Send (Unclaimed Draft)" button
      if (unclaimedTemplateBtn) {
        unclaimedTemplateBtn.disabled = true;
        unclaimedTemplateBtn.style.opacity = '0.5';
        unclaimedTemplateBtn.style.cursor = 'not-allowed';
      }
    } else {
      // Template mode (mode === 'none'): restore original button text
      const originalText = sendBtn.getAttribute('data-original-text');
      if (originalText) {
        sendBtn.textContent = originalText;
      }

      // Check if templates are available before enabling buttons
      const hasTemplates = templateSelect && templateSelect.options.length > 1 &&
                          !templateSelect.options[0].textContent.includes('No templates');

      if (hasTemplates) {
        // Re-enable buttons when templates are available (will be re-checked by domain verification)
        if (embedBtn) {
          embedBtn.disabled = false;
          embedBtn.style.opacity = '1';
          embedBtn.style.cursor = 'pointer';
          embedBtn.title = '';
        }

        if (unclaimedTemplateBtn) {
          unclaimedTemplateBtn.disabled = false;
          unclaimedTemplateBtn.style.opacity = '1';
          unclaimedTemplateBtn.style.cursor = 'pointer';
          unclaimedTemplateBtn.title = '';
        }

        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.style.opacity = '1';
          sendBtn.style.cursor = 'pointer';
          sendBtn.title = '';
        }

        // Check domain verification and potentially disable again
        if (typeof updateEmbeddedButtonStates === 'function') {
          updateEmbeddedButtonStates();
        }
      } else {
        // No templates available - disable all template buttons
        if (typeof updateTemplateButtonStates === 'function') {
          updateTemplateButtonStates(false);
        }
      }
    }

    // Switch Document Editor sub-tabs when form-fields is selected
    if (mode === 'form-fields') {
      activateEditorSubTab('subtab-form-fields');
    } else if (mode === 'text-tags') {
      activateEditorSubTab('subtab-text-tags');
    }

    // Update signing order toggle visibility based on document mode
    if (typeof updateSigningOrderVisibility === 'function') {
      updateSigningOrderVisibility();
    }

    // Save the selected document mode to settings
    fetchWithCsrf('/settings/selected-document-mode', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: mode })
    }).catch(err => console.error('Failed to save selected document mode:', err));
  });

  // Restore saved document mode from last session
  if (portalSettings.selectedDocumentMode) {
    documentModeSelect.value = portalSettings.selectedDocumentMode;
  }

  // Trigger change event on page load to set initial state
  documentModeSelect.dispatchEvent(new Event('change'));

  autoAppendFileInput.addEventListener('change', () => {
    const file = autoAppendFileInput.files[0];
    if (!file) {
      if (getDocumentMode() === 'auto-append') {
        documentModeSelect.value = 'none';
        documentModeSelect.dispatchEvent(new Event('change'));
      }
      return;
    }
    autoAppendFile = file;
    // Truncate long filenames
    const maxLen = 18;
    const displayName = file.name.length > maxLen ? file.name.slice(0, maxLen - 1) + '…' : file.name;
    autoAppendChooseBtn.textContent = displayName + '  ✕';
    autoAppendChooseBtn.classList.add('has-file');

    // Enable send button when file is chosen in auto-append mode
    if (getDocumentMode() === 'auto-append') {
      const sendBtn = document.getElementById('sendBtn');
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.style.opacity = '1';
        sendBtn.style.cursor = 'pointer';
        sendBtn.title = '';
      }
    }
  });

  // Save template selection when changed
  templateSelect.addEventListener('change', () => {
    const selectedTemplateId = templateSelect.value;
    if (selectedTemplateId) {
      fetchWithCsrf('/settings/selected-template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: selectedTemplateId })
      }).catch(err => console.error('Failed to save selected template:', err));
    }

    // Update button states based on whether a template is actually selected
    const documentMode = document.getElementById('documentMode')?.value;
    if (documentMode === 'none') {
      const templateSelect = document.getElementById('templateSelect');
      const hasTemplates = templateSelect && templateSelect.options.length > 1 &&
                          !templateSelect.options[0].textContent.includes('No templates');
      if (typeof updateTemplateButtonStates === 'function') {
        updateTemplateButtonStates(hasTemplates);
      }
    }
  });

  // ===== Document templates (driven by theme selection) =====
  function loadDocumentTemplates() {
    fetchWithCsrf('/document-templates')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(templates => {
        docTemplates = templates;
        // Apply the current theme's document template
        applyDocumentTemplate(currentThemeId);
      })
      .catch(() => {});
  }

  function currentDocTemplate() {
    const theme = themesData[currentThemeId];
    if (!theme || !theme.documentTemplate) return null;
    return docTemplates.find(t => t.id === theme.documentTemplate) || null;
  }

  function applyDocumentTemplate(themeId) {
    const theme = themesData[themeId];
    if (!theme) return;

    const markdownEditorEl = document.getElementById('markdownEditor');
    if (!markdownEditorEl) return; // Not on Form Fields tab yet

    // Use theme's documentContent directly (new approach)
    if (theme.documentContent) {
      markdownEditorEl.value = theme.documentContent;
      // Don't call renderMarkdownPreview yet - it will be called when tab is actually shown
      return;
    }

    // Fallback: old documentTemplate reference approach
    if (!docTemplates || !Array.isArray(docTemplates)) return;
    if (!theme.documentTemplate || docTemplates.length === 0) return;
    const match = docTemplates.find(t => t.id === theme.documentTemplate);
    if (match) {
      markdownEditorEl.value = match.content;
      // Don't call renderMarkdownPreview yet - it will be called when tab is actually shown
    }
  }

  loadDocumentTemplates();

  // Apply the default/initial theme on page load (after docTemplates is declared)
  if (currentThemeId) {
    applyTheme(currentThemeId);
  }

  // ===== Save as Dropbox Sign Template =====
  const saveAsTemplateBtn = document.getElementById('saveAsTemplateBtn');
  if (saveAsTemplateBtn) {
    saveAsTemplateBtn.addEventListener('click', async () => {
      const markdownContent = document.getElementById('markdownEditor').value;
      if (!markdownContent.trim()) {
        alert('Please write or select a document template first.');
        return;
      }
      const selectedClientId = getSelectedClientId();
      if (!selectedClientId) {
        alert('Please select an API App in the first tab.');
        return;
      }
      const selectedDoc = currentDocTemplate();
      const templateName = prompt('Template name:', selectedDoc ? selectedDoc.name : 'Custom Template');
      if (!templateName) return;

      saveAsTemplateBtn.disabled = true;
      saveAsTemplateBtn.textContent = 'Creating…';

      try {
        const res = await fetchWithCsrf('/create-template', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            markdownContent,
            templateName,
            client_id: selectedClientId,
            name: document.getElementById('signerName1').value,
            email: document.getElementById('signerEmail1').value,
            field1: document.getElementById('field1').value,
            field2: document.getElementById('field2').value,
            field3: document.getElementById('field3').value,
            logoEnabled: (settings.logoOnTextTags !== false).toString(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        if (data.editUrl) {
          const signingContainer = prepareSigningOverlay();
          if (!client) initHelloSignClient(selectedClientId);
          client.open(data.editUrl, {
            container: signingContainer,
            skipDomainVerification: true,
            allowCancel: true,
          });
          showSuccessToast('Template draft created with text tags! The fields should appear automatically. Review and click Save.');
        }
      } catch (err) {
        console.error('Create template error:', err);
        alert('Error creating template: ' + err.message);
      } finally {
        saveAsTemplateBtn.disabled = false;
        saveAsTemplateBtn.textContent = 'Save as Dropbox Sign Template';
      }
    });
  }

  // ===== Markdown preview with field interpolation =====
  const markdownEditor = document.getElementById('markdownEditor');
  const markdownPreview = document.getElementById('markdownPreview');

  function getFieldValues() {
    const formatDate = (d) => {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      return `${day}/${month}/${d.getFullYear()}`;
    };
    return {
      signerName1: document.getElementById('signerName1').value || '—',
      signerEmail1: document.getElementById('signerEmail1').value || '—',
      field1: document.getElementById('field1').value || '—',
      field2: document.getElementById('field2').value || '—',
      field3: document.getElementById('field3').value || '—',
      date: formatDate(new Date()),
    };
  }

  // Default field type display config for Dropbox Sign text tags (fallback)
  const defaultFieldTypeConfig = {
    sig:      { icon: '✍️', label: 'Signature' },
    initial:  { icon: '🖊️', label: 'Initials' },
    date:     { icon: '📅', label: 'Date Signed' },
    check:    { icon: '☑️', label: 'Checkbox' },
    cb:       { icon: '☑️', label: 'Checkbox' },
    checkbox: { icon: '☑️', label: 'Checkbox' },
    text:     { icon: '📝', label: 'Text Field' },
  };

  function textTagToPlaceholder(match, type, _req, signer, extra) {
    const signerClass = signer.replace(/[^a-z0-9]/gi, '');
    const signerNum = signer.replace(/\D/g, '') || '1';
    const signerLabel = `Signer ${signerNum}`;

    // Get text tags config from current theme, fallback to default
    const currentTheme = themesData[currentThemeId];
    const fieldTypeConfig = currentTheme?.textTags || defaultFieldTypeConfig;
    const cfg = fieldTypeConfig[type] || { icon: '📋', label: type };

    const label = extra ? extra.trim() : cfg.label;
    return `<span class="field-placeholder ${signerClass} type-${type}" title="${label} — ${signerLabel}">`
      + `<span class="field-icon">${cfg.icon}</span>`
      + `<span class="field-label">${label}</span>`
      + `</span>`;
  }

  function renderMarkdownPreview() {
    if (!markdownEditor || !markdownPreview) return;
    let md = markdownEditor.value;
    const vals = getFieldValues();
    // Replace {{field}} placeholders with current values
    md = md.replace(/\{\{(\w+)\}\}/g, (_, key) => vals[key] || `{{${key}}}`);
    let html = marked.parse(md);

    // Check if "Preview tags" checkbox is enabled
    const previewTagsCheckbox = document.getElementById('previewTagsCheckbox');
    const shouldPreviewTags = previewTagsCheckbox && previewTagsCheckbox.checked;

    if (shouldPreviewTags) {
      // Transform Dropbox Sign text tags into styled placeholder boxes
      // Matches patterns like [sig|req|signer1], [text|req|signer1|Notes], [check|req|signer1]
      html = html.replace(/\[(sig|initial|date|check|cb|checkbox|text)\|(\w+)\|(\w+)(?:\|([^\]]*))?\]/g, textTagToPlaceholder);
    }
    // If checkbox unchecked, text tags remain as plain text in the markdown

    markdownPreview.innerHTML = html;
  }

  if (markdownEditor) {
    markdownEditor.addEventListener('input', renderMarkdownPreview);
    // Also re-render when form fields change
    ['signerName1', 'signerEmail1', 'field1', 'field2', 'field3'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', renderMarkdownPreview);
    });
    // Re-render when "Preview tags" checkbox is toggled
    const previewTagsCheckbox = document.getElementById('previewTagsCheckbox');
    if (previewTagsCheckbox) {
      previewTagsCheckbox.addEventListener('change', renderMarkdownPreview);
    }
    // Initial render
    renderMarkdownPreview();
  }

  // ===== Editor Sub-tab Switching =====
  const editorSubTabs = document.querySelectorAll('.editor-sub-tab');
  const editorSubPanels = document.querySelectorAll('.editor-sub-panel');

  function activateEditorSubTab(panelId) {
    editorSubTabs.forEach(t => t.classList.toggle('active', t.dataset.subtab === panelId));
    editorSubPanels.forEach(p => p.classList.toggle('active', p.id === panelId));
  }

  editorSubTabs.forEach(btn => {
    btn.addEventListener('click', () => activateEditorSubTab(btn.dataset.subtab));
  });

  // ===== Settings Sub-tab Switching =====
  // Note: We reuse the editor-sub-tab and editor-sub-panel classes for consistent styling
  const settingsSubTabs = document.querySelectorAll('#tab-settings .editor-sub-tab');
  const settingsSubPanels = document.querySelectorAll('#tab-settings .editor-sub-panel');

  function activateSettingsSubTab(panelId) {
    settingsSubTabs.forEach(t => t.classList.toggle('active', t.dataset.subtab === panelId));
    settingsSubPanels.forEach(p => p.classList.toggle('active', p.id === panelId));

    // Load themes when Themes tab is activated
    if (panelId === 'subtab-settings-themes' && typeof loadThemes === 'function') {
      loadThemes();
    }
  }

  settingsSubTabs.forEach(btn => {
    btn.addEventListener('click', () => activateSettingsSubTab(btn.dataset.subtab));
  });

  // ===== Form Fields Editor =====
  const FF_PAGE_W = 595; // A4 at 72 DPI
  const FF_PAGE_H = 842;
  const ffFieldsList = document.getElementById('ffFieldsList');
  const ffOverlayLayer = document.getElementById('ffOverlayLayer');
  const ffPdfCanvas = document.getElementById('ffPdfCanvas');
  const ffDocContainer = document.getElementById('ffDocContainer');
  const ffApiPayload = document.getElementById('ffApiPayload');
  const ffPageSelect = document.getElementById('formFieldsPageSelect');
  let ffPdfDoc = null;     // pdf.js document
  let ffCanvasScale = 1;   // scale factor from PDF coords to canvas pixels
  let ffCurrentPage = 0;
  let ffTotalPages = 1;

  // Default fields for signature section
  // Note: signer indices are 0-based (signer 0 = first signer, signer 1 = second signer)
  // Coordinates are positioned near bottom of page for typical signature section
  const FF_DEFAULT_FIELDS = [
    { id: 'f1', label: 'Client Signature', apiType: 'signature',    signer: 0, page: 0, x: 50,  y: 650, w: 200, h: 28 },
    { id: 'f2', label: 'Client Date',      apiType: 'date_signed',  signer: 0, page: 0, x: 50,  y: 685, w: 150, h: 17 },
    { id: 'f3', label: 'Agent Signature',  apiType: 'signature',    signer: 1, page: 0, x: 300, y: 650, w: 200, h: 28 },
    { id: 'f4', label: 'Agent Date',       apiType: 'date_signed',  signer: 1, page: 0, x: 300, y: 685, w: 150, h: 17 },
  ];
  console.log('[FF_INIT] window.formFieldsDefaults:', window.formFieldsDefaults);

  // Load saved fields from server-side defaults, then localStorage fallback, then built-in defaults
  let ffFields;
  let ffNextId;
  let ffHasSavedDefaults = false; // true if fields were loaded from a user save (not built-in defaults)
  if (Array.isArray(window.formFieldsDefaults) && window.formFieldsDefaults.length > 0) {
    ffFields = JSON.parse(JSON.stringify(window.formFieldsDefaults)); // deep copy
    // Validate signer values - if any are > 1, it's corrupted data
    const hasCorruptedData = ffFields.some(f => f.signer > 1);
    if (hasCorruptedData) {
      console.log('[ffLoad] Detected corrupted signer values in server data, using defaults');
      ffFields = null;
    } else {
      ffNextId = ffFields.length + 1;
      ffHasSavedDefaults = true;
      console.log('[ffLoad] Loaded from server defaults:', ffFields.length, 'fields');
    }
  }

  if (!ffFields) {
    try {
      const saved = localStorage.getItem('ffSavedFields');
      const version = localStorage.getItem('ffFieldsVersion');
      if (saved) {
        ffFields = JSON.parse(saved);
        // Validate: signer values should be 0 or 1
        const hasCorruptedData = ffFields.some(f => f.signer > 1);
        // Migration: Old fields used 1-based signer indices, new uses 0-based
        // Check if we have old data and migrate it
        if (hasCorruptedData || (version !== '2' && ffFields.length > 0)) {
          console.log('[ffLoad] Detected corrupted or old data, clearing and using defaults');
          // Don't migrate - just clear and use defaults instead
          ffFields = null;
          localStorage.removeItem('ffSavedFields');
          localStorage.setItem('ffFieldsVersion', '2');
        } else {
          ffNextId = ffFields.length + 1;
          ffHasSavedDefaults = true;
          console.log('[ffLoad] Loaded from localStorage:', ffFields.length, 'fields');
        }
      }
    } catch (_) {}
  }

  if (!ffFields) {
    ffFields = JSON.parse(JSON.stringify(FF_DEFAULT_FIELDS));
    ffNextId = FF_DEFAULT_FIELDS.length + 1;
    localStorage.setItem('ffFieldsVersion', '2');
    console.log('[ffLoad] Using built-in defaults:', ffFields.length, 'fields');
  }

  // Debug: log final loaded data
  console.log('[FF_FINAL] Loaded fields:', ffFields.map(f => ({ label: f.label, signer: f.signer })));

  function buildFormFieldsPayload() {
    return ffFields.map(f => ({
      api_id: f.id,
      type: f.apiType,
      x: Math.round(f.x),
      y: Math.round(f.y),
      width: Math.round(f.w),
      height: Math.round(f.h),
      required: true,
      signer: f.signer, // Already 0-indexed (signer 0 = first signer)
      page: f.page,
      name: f.label,
    }));
  }

  let ffPayloadUserEditing = false; // true while user is typing in the payload editor

  function updateApiPayloadPreview() {
    if (ffApiPayload && !ffPayloadUserEditing) {
      const payload = [buildFormFieldsPayload()];
      if (payload[0].length === 0) {
        ffApiPayload.value = '[\n  []\n]\n\n// Click "Add Field" above to add form fields to your document';
      } else {
        ffApiPayload.value = JSON.stringify(payload, null, 2);
      }
      ffApiPayload.classList.remove('invalid');
    }
  }

  // Reverse-parse: JSON payload → ffFields
  function applyPayloadToFields(json) {
    let outer;
    try { outer = JSON.parse(json); } catch (_) { return false; }
    // Accept [[...fields]] or [...fields]
    const arr = Array.isArray(outer[0]) ? outer[0] : outer;
    if (!Array.isArray(arr)) return false;
    const mapped = arr.map((f, i) => ({
      id: f.api_id || ('f' + (i + 1)),
      label: f.name || ('Field ' + (i + 1)),
      apiType: f.type || 'signature',
      signer: (f.signer != null ? f.signer : 0), // keep 0-indexed internally
      page: f.page != null ? f.page : 0,
      x: f.x || 0,
      y: f.y || 0,
      w: f.width || 200,
      h: f.height || 40,
    }));
    ffFields = mapped;
    ffNextId = ffFields.length + 1;
    return true;
  }

  // Debounced handler for user edits in the payload textarea
  let ffPayloadTimer = null;
  ffApiPayload.addEventListener('focus', () => { ffPayloadUserEditing = true; });
  ffApiPayload.addEventListener('blur', () => {
    ffPayloadUserEditing = false;
    // On blur, if valid, sync; if not, mark invalid (don't revert — let save handler catch it)
    if (applyPayloadToFields(ffApiPayload.value)) {
      console.log('[ffBlur] Parsed OK, ffFields updated:', ffFields.length, 'fields');
      ffApiPayload.classList.remove('invalid');
      renderFFFieldsList();
      renderFFOverlays();
    } else {
      console.warn('[ffBlur] Parse FAILED — textarea has invalid JSON');
      ffApiPayload.classList.add('invalid');
    }
  });
  ffApiPayload.addEventListener('input', () => {
    clearTimeout(ffPayloadTimer);
    ffPayloadTimer = setTimeout(() => {
      if (applyPayloadToFields(ffApiPayload.value)) {
        ffApiPayload.classList.remove('invalid');
        renderFFFieldsList();
        renderFFOverlays();
        ffPayloadUserEditing = true; // keep focus mode after re-render
      } else {
        ffApiPayload.classList.add('invalid');
      }
    }, 600);
  });

  // Save / Reset default buttons
  document.getElementById('ffSaveDefaultBtn').addEventListener('click', async () => {
    // Always sync textarea edits before saving
    clearTimeout(ffPayloadTimer);
    const textVal = ffApiPayload.value.trim();
    if (textVal) {
      const applied = applyPayloadToFields(textVal);
      if (!applied) {
        ffApiPayload.classList.add('invalid');
        showErrorToast('Cannot save — invalid JSON in the payload editor');
        return;
      }
      ffApiPayload.classList.remove('invalid');
      ffPayloadUserEditing = false;
      renderFFFieldsList();
      renderFFOverlays();
    }
    // Persist to server (primary) and localStorage (fallback)
    const savePayload = JSON.parse(JSON.stringify(ffFields)); // deep copy to ensure clean save
    console.log('[ffSave] Saving fields:', savePayload);
    try {
      const res = await fetchWithCsrf('/api-apps/form-fields-defaults', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: savePayload }),
      });
      if (!res.ok) throw new Error('Server save failed: HTTP ' + res.status);
      console.log('[ffSave] Server save OK');
    } catch (err) {
      console.error('[ffSave] Server save FAILED:', err);
      showWarningToast('Server save failed — saved to browser only');
    }
    localStorage.setItem('ffSavedFields', JSON.stringify(savePayload));
    ffHasSavedDefaults = true;
    showSuccessToast('Form fields saved as default');
  });
  document.getElementById('ffResetDefaultBtn').addEventListener('click', async () => {
    try {
      await fetchWithCsrf('/api-apps/form-fields-defaults', {
        method: 'DELETE',
      });
      localStorage.removeItem('ffSavedFields');
      showSuccessToast('Form fields reset to global defaults');
      // Reload page to fetch from global defaults file
      setTimeout(() => location.reload(), 500);
    } catch (err) {
      console.error('[ffReset] Failed:', err);
      showErrorToast('Failed to reset form fields');
    }
  });

  function renderFFOverlays() {
    ffOverlayLayer.innerHTML = '';
    const containerW = ffPdfCanvas.clientWidth || ffPdfCanvas.width;
    const containerH = ffPdfCanvas.clientHeight || ffPdfCanvas.height;
    const scaleX = containerW / FF_PAGE_W;
    const scaleY = containerH / FF_PAGE_H;

    ffFields.filter(f => f.page === ffCurrentPage).forEach(f => {
      const box = document.createElement('div');
      box.className = `ff-overlay-box signer${f.signer + 1}`; // CSS uses 1-based (signer1, signer2)
      box.style.left = (f.x * scaleX) + 'px';
      box.style.top = (f.y * scaleY) + 'px';
      box.style.width = (f.w * scaleX) + 'px';
      box.style.height = (f.h * scaleY) + 'px';
      box.textContent = f.label;
      box.dataset.fieldId = f.id;
      ffOverlayLayer.appendChild(box);
    });
    updateApiPayloadPreview();
  }

  function renderFFFieldsList() {
    ffFieldsList.innerHTML = '';
    ffFields.forEach((f, idx) => {
      const item = document.createElement('div');
      item.className = 'ff-field-item' + (idx === 0 ? ' open' : '');
      item.innerHTML = `
        <div class="ff-field-header">
          <span class="ff-field-title">${f.label}</span>
          <span class="ff-field-signer-badge s${f.signer}">Signer ${f.signer + 1}</span>
          <button class="ff-remove-btn" title="Remove field">&times;</button>
        </div>
        <div class="ff-field-body">
          <div class="ff-select-row">
            <label>Type</label>
            <select data-prop="apiType">
              <option value="signature"${f.apiType==='signature'?' selected':''}>Signature</option>
              <option value="date_signed"${f.apiType==='date_signed'?' selected':''}>Date Signed</option>
              <option value="initials"${f.apiType==='initials'?' selected':''}>Initials</option>
              <option value="text"${f.apiType==='text'?' selected':''}>Text</option>
              <option value="checkbox"${f.apiType==='checkbox'?' selected':''}>Checkbox</option>
            </select>
          </div>
          <div class="ff-select-row">
            <label>Signer</label>
            <select data-prop="signer">
              <option value="0"${f.signer===0?' selected':''}>Signer 1</option>
              <option value="1"${f.signer===1?' selected':''}>Signer 2</option>
            </select>
          </div>
          <div class="ff-select-row">
            <label>Page</label>
            <select data-prop="page">
              ${Array.from({length: ffTotalPages}, (_, i) => `<option value="${i}"${f.page===i?' selected':''}>Page ${i+1}</option>`).join('')}
            </select>
          </div>
          <div class="ff-slider-row"><label>X</label><input type="range" min="0" max="${FF_PAGE_W}" value="${f.x}" data-prop="x"><span class="ff-slider-val">${Math.round(f.x)}</span></div>
          <div class="ff-slider-row"><label>Y</label><input type="range" min="0" max="${FF_PAGE_H}" value="${f.y}" data-prop="y"><span class="ff-slider-val">${Math.round(f.y)}</span></div>
          <div class="ff-slider-row"><label>Width</label><input type="range" min="20" max="400" value="${f.w}" data-prop="w"><span class="ff-slider-val">${Math.round(f.w)}</span></div>
          <div class="ff-slider-row"><label>Height</label><input type="range" min="10" max="100" value="${f.h}" data-prop="h"><span class="ff-slider-val">${Math.round(f.h)}</span></div>
        </div>
      `;

      // Accordion toggle
      item.querySelector('.ff-field-header').addEventListener('click', (e) => {
        if (e.target.closest('.ff-remove-btn')) return;
        item.classList.toggle('open');
      });

      // Remove button
      item.querySelector('.ff-remove-btn').addEventListener('click', () => {
        ffFields = ffFields.filter(ff => ff.id !== f.id);
        renderFFFieldsList();
        renderFFOverlays();
      });

      // Slider and select change handlers
      item.querySelectorAll('input[type="range"]').forEach(slider => {
        slider.addEventListener('input', () => {
          const prop = slider.dataset.prop;
          f[prop] = parseFloat(slider.value);
          slider.nextElementSibling.textContent = Math.round(f[prop]);
          renderFFOverlays();
        });
      });
      item.querySelectorAll('select[data-prop]').forEach(sel => {
        sel.addEventListener('change', () => {
          const prop = sel.dataset.prop;
          f[prop] = prop === 'signer' || prop === 'page' ? parseInt(sel.value, 10) : sel.value;
          // Re-render the badges and overlays
          const badge = item.querySelector('.ff-field-signer-badge');
          if (badge && prop === 'signer') {
            badge.className = `ff-field-signer-badge s${f.signer}`;
            badge.textContent = `Signer ${f.signer + 1}`;
          }
          renderFFOverlays();
        });
      });

      ffFieldsList.appendChild(item);
    });
  }

  // Add Field button
  document.getElementById('addFormFieldBtn').addEventListener('click', () => {
    const newField = {
      id: 'f' + (ffNextId++),
      label: 'New Field',
      apiType: 'signature',
      signer: 0,
      page: ffCurrentPage,
      x: 60,
      y: 200,
      w: 200,
      h: 40,
    };
    const name = prompt('Field label:', newField.label);
    if (!name) return;
    newField.label = name;
    ffFields.push(newField);
    renderFFFieldsList();
    renderFFOverlays();
  });

  // Page selector
  ffPageSelect.addEventListener('change', () => {
    ffCurrentPage = parseInt(ffPageSelect.value, 10);
    renderFFPage(ffCurrentPage);
    renderFFOverlays();
  });

  // Load/render PDF
  async function loadFormFieldsPdf() {
    const btn = document.getElementById('loadFormFieldsPdfBtn');
    btn.disabled = true;
    btn.textContent = 'Loading...';

    try {
      // Fetch the PDF from the preview endpoint (with text tags stripped)
      const formData = new URLSearchParams({
        markdownContent: markdownEditor.value,
        signerName1: document.getElementById('signerName1').value,
        signerEmail1: document.getElementById('signerEmail1').value,
        field1: document.getElementById('field1').value,
        field2: document.getElementById('field2').value,
        field3: document.getElementById('field3').value,
        stripTextTags: 'true',
      });
      addLogoSetting(formData);

      const res = await fetchWithCsrf('/preview-document', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Failed to generate PDF');

      const pdfData = await res.arrayBuffer();
      ffPdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
      ffTotalPages = ffPdfDoc.numPages;

      // Update page selector
      ffPageSelect.innerHTML = '';
      for (let i = 0; i < ffTotalPages; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `Page ${i + 1}`;
        ffPageSelect.appendChild(opt);
      }

      // Auto-place fields on the last page only for built-in defaults (not user-saved fields)
      const lastPage = ffTotalPages - 1;
      if (!ffHasSavedDefaults) {
        ffFields.forEach(f => { f.page = lastPage; });
      }
      ffCurrentPage = lastPage;
      ffPageSelect.value = lastPage;

      await renderFFPage(ffCurrentPage);
      renderFFFieldsList();
      renderFFOverlays();

      document.getElementById('ffPlaceholderMsg').style.display = 'none';
    } catch (err) {
      console.error('Error loading form fields PDF:', err);
      alert('Error loading document: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Load Document Preview';
    }
  }

  async function renderFFPage(pageIndex) {
    if (!ffPdfDoc) return;
    const page = await ffPdfDoc.getPage(pageIndex + 1); // pdf.js is 1-indexed
    const viewport = page.getViewport({ scale: 1 });

    // Scale canvas to fit the container width
    const containerWidth = ffDocContainer.clientWidth - 2; // subtract border
    ffCanvasScale = containerWidth / viewport.width;
    const scaledViewport = page.getViewport({ scale: ffCanvasScale });

    ffPdfCanvas.width = scaledViewport.width;
    ffPdfCanvas.height = scaledViewport.height;

    const ctx = ffPdfCanvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
  }

  document.getElementById('loadFormFieldsPdfBtn').addEventListener('click', loadFormFieldsPdf);

  // Initial render of field list and payload
  renderFFFieldsList();
  updateApiPayloadPreview();

  // ✅ Helper: Parse API response and throw on error
  async function handleApiResponse(res) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  // ✅ Helper: Add SMS phone to request params if enabled
  function addSmsPhoneIfEnabled(params, isFormData = true) {
    const smsAuth = document.getElementById('smsAuth');
    if (smsAuth.checked && !smsAuth.disabled) {
      const phone = document.getElementById('smsAuthPhone').value;
      if (isFormData) {
        params.append('smsPhone', phone);
      } else {
        params.smsPhone = phone;
      }
    }
  }

  // ✅ SMS Auth and SMS Delivery toggles (each has its own phone input)
  const smsAuthCheckbox = document.getElementById('smsAuth');
  const smsDeliveryCheckbox = document.getElementById('smsDelivery');
  const smsAuthPhoneGroup = document.getElementById('smsAuthPhoneGroup');
  const smsDeliveryPhoneGroup = document.getElementById('smsDeliveryPhoneGroup');
  const smsDeliveryCheckboxGroup = document.getElementById('smsDeliveryCheckboxGroup');

  // SMS Auth checkbox change handler
  smsAuthCheckbox.addEventListener('change', () => {
    smsAuthPhoneGroup.style.display = smsAuthCheckbox.checked ? 'block' : 'none';
    if (!smsAuthCheckbox.checked) {
      document.getElementById('smsAuthPhone').value = '';
    }
  });

  // SMS Delivery checkbox change handler
  smsDeliveryCheckbox.addEventListener('change', () => {
    smsDeliveryPhoneGroup.style.display = smsDeliveryCheckbox.checked ? 'block' : 'none';
    if (!smsDeliveryCheckbox.checked) {
      document.getElementById('smsDeliveryPhone').value = '';
    }
  });

  // Function to update SMS Auth and SMS Delivery based on test mode
  function updateSmsOptionsVisibility() {
    const isEnabled = !!settings.smsDeliveryEnabled;

    // Check if current API app is in test mode
    let isTestMode = false;
    const selectedClientId = appSelect?.value;
    if (selectedClientId && allApps) {
      const selectedApp = allApps.find(app => app.clientId === selectedClientId);
      isTestMode = selectedApp?.testMode === true;
    }

    // Get elements (may not exist if called before DOMContentLoaded completes)
    const smsAuthCheckbox = document.getElementById('smsAuth');
    const smsAuthPhoneGroup = document.getElementById('smsAuthPhoneGroup');
    const smsDeliveryCheckboxGroup = document.getElementById('smsDeliveryCheckboxGroup');

    // Update SMS Auth - disable in test mode (only update if changed)
    if (smsAuthCheckbox && smsAuthCheckbox.disabled !== isTestMode) {
      smsAuthCheckbox.disabled = isTestMode;
    }
    if (smsAuthCheckbox && isTestMode && smsAuthCheckbox.checked) {
      smsAuthCheckbox.checked = false;
      if (smsAuthPhoneGroup) smsAuthPhoneGroup.style.display = 'none';
      const smsAuthPhone = document.getElementById('smsAuthPhone');
      if (smsAuthPhone) smsAuthPhone.value = '';
    }

    // Update SMS Delivery
    const deliveryDisplay = isEnabled ? 'block' : 'none';
    if (smsDeliveryCheckboxGroup && smsDeliveryCheckboxGroup.style.display !== deliveryDisplay) {
      smsDeliveryCheckboxGroup.style.display = deliveryDisplay;
    }
    const smsDeliveryCheckbox = document.getElementById('smsDelivery');
    const deliveryDisabled = !isEnabled || isTestMode;
    if (smsDeliveryCheckbox && smsDeliveryCheckbox.disabled !== deliveryDisabled) {
      smsDeliveryCheckbox.disabled = deliveryDisabled;
    }

    if (smsDeliveryCheckbox && (!isEnabled || isTestMode)) {
      smsDeliveryCheckbox.checked = false;
      const smsDeliveryPhoneGroup = document.getElementById('smsDeliveryPhoneGroup');
      if (smsDeliveryPhoneGroup) smsDeliveryPhoneGroup.style.display = 'none';
      const smsDeliveryPhone = document.getElementById('smsDeliveryPhone');
      if (smsDeliveryPhone) smsDeliveryPhone.value = '';
    }

    // Update eID Verification - disable in test mode
    const eidAuthCheckbox = document.getElementById('eidAuth');
    if (eidAuthCheckbox) {
      if (eidAuthCheckbox.disabled !== isTestMode) {
        eidAuthCheckbox.disabled = isTestMode;
      }
      if (isTestMode && eidAuthCheckbox.checked) {
        eidAuthCheckbox.checked = false;
      }
    }
  }

  // Initialize visibility on page load (will be updated when app is selected)
  updateSmsOptionsVisibility();

  // ✅ DOM Elements
  const form = document.getElementById('mandateForm');
  const embedBtn = document.getElementById('embedBtn');
  const signingContainer = document.getElementById('signingContainer');

  // ✅ Submit for signature
  form.addEventListener('submit', e => {
    e.preventDefault();

    const nameVal = document.getElementById('signerName1').value.trim();
    const emailVal = document.getElementById('signerEmail1').value.trim();
    if (!nameVal || !emailVal) {
      alert('Please fill in Name and Email before sending.');
      return;
    }

    const mode = getDocumentMode();

    if (mode === 'none' && !templateSelect.value) {
      templateSelect.setCustomValidity('Please select a template or choose a Document mode.');
      templateSelect.reportValidity();
      setTimeout(() => templateSelect.setCustomValidity(''), 3000);
      return;
    }

    if (mode === 'auto-append' && !autoAppendFile) {
      alert('Please select a file first for Auto-append mode.');
      return;
    }

    // Uncheck SMS Auth if it's disabled (prevents sending it when in test mode)
    if (smsAuthCheckbox.disabled && smsAuthCheckbox.checked) {
      smsAuthCheckbox.checked = false;
    }

    // Visual feedback: disable button and show sending state
    const sendBtn = document.getElementById('sendBtn');
    const originalText = sendBtn.textContent;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';

    function restoreBtn() {
      sendBtn.disabled = false;
      sendBtn.textContent = originalText;
    }

    if (mode === 'auto-append') {
      // Upload file, no text tags — Dropbox Sign auto-appends fields
      const formData = new FormData(form);
      formData.set('file', autoAppendFile);
      formData.set('documentTemplateName', autoAppendFile.name);
      // Add signing order if multi-signer mode
      if (!document.getElementById('singleSigner').checked) {
        formData.set('signingOrder', signingOrder);
      }
      addLogoSetting(formData);
      fetchWithCsrf('/sign-auto-append', {
        method: 'POST',
        body: formData
      }).then(async res => {
        await handleApiResponse(res);
        showSuccessToast('Document sent for signature (auto-append)');
        refreshLogsQuietly();
      }).catch(err => {
        showErrorToast(err.message || 'Error sending document');
      }).finally(restoreBtn);
    } else if (mode === 'text-tags') {
      // Send with text tags — generate PDF from markdown
      const formData = new URLSearchParams(new FormData(form));
      formData.set('markdownContent', markdownEditor.value);
      const selDoc = currentDocTemplate();
      formData.set('documentTemplateName', selDoc ? selDoc.name : 'Custom Document');
      // Add SMS Delivery flag if enabled (uses same phone number as SMS Auth)
      if (document.getElementById('smsDelivery').checked) {
        formData.set('smsDelivery', 'on');
      }
      // Add signing order if multi-signer mode
      if (!document.getElementById('singleSigner').checked) {
        formData.set('signingOrder', signingOrder);
        console.log('[TEXT-TAGS] Sending signingOrder:', signingOrder);
      }
      addLogoSetting(formData);
      fetchWithCsrf('/sign-with-document', {
        method: 'POST',
        body: formData
      }).then(async res => {
        await handleApiResponse(res);
        showSuccessToast('Document sent for signature (text tags)');
        refreshLogsQuietly();
      }).catch(err => {
        showErrorToast(err.message || 'Error sending document');
      }).finally(restoreBtn);
    } else if (mode === 'form-fields') {
      // Send with form_fields_per_document
      try {
        const payload = buildFormFieldsPayload();
        const fd = new FormData(form);
        const formData = new URLSearchParams(fd);
        formData.set('markdownContent', markdownEditor.value);
        const selDoc = currentDocTemplate();
        formData.set('documentTemplateName', selDoc ? selDoc.name : 'Custom Document');
        formData.set('formFieldsJson', JSON.stringify(payload));
        // Add signing order if multi-signer mode
        if (!document.getElementById('singleSigner').checked) {
          formData.set('signingOrder', signingOrder);
        }
        addLogoSetting(formData);
        fetchWithCsrf('/sign-with-formfields', {
          method: 'POST',
          body: formData
        }).then(async res => {
          await handleApiResponse(res);
          showSuccessToast('Document sent for signature (form fields)');
          refreshLogsQuietly();
        }).catch(err => {
          showErrorToast(err.message || 'Error sending document');
        }).finally(restoreBtn);
      } catch (err) {
        showErrorToast('Form fields error: ' + err.message);
        restoreBtn();
      }
    } else {
      // Existing template-based flow (mode === 'none')
      const formData = new URLSearchParams(new FormData(form));
      // Add signing order if multi-signer mode
      if (!document.getElementById('singleSigner').checked) {
        formData.set('signingOrder', signingOrder);
        console.log('[SIGN] Adding signingOrder to request:', signingOrder);
      }
      fetchWithCsrf('/sign', {
        method: 'POST',
        body: formData
      }).then(async res => {
        await handleApiResponse(res);
        showSuccessToast('Signature request sent');
        refreshLogsQuietly();
      }).catch(err => {
        showErrorToast(err.message || 'Error sending email');
      }).finally(restoreBtn);
    }
  });


  // ✅ Embedded signing
embedBtn.addEventListener('click', async () => {
  const mode = getDocumentMode();
  const template_id = templateSelect.value;
  const signerName = document.getElementById('signerName1').value;
  const signerEmail = document.getElementById('signerEmail1').value;

  if (mode === 'none' && !template_id) {
    templateSelect.setCustomValidity('Please select a template or choose a Document mode.');
    templateSelect.reportValidity();
    setTimeout(() => templateSelect.setCustomValidity(''), 3000);
    return;
  }

  if (mode === 'auto-append' && !autoAppendFile) {
    alert('Please select a file first for Auto-append mode.');
    return;
  }

  if (!signerName || !signerEmail) {
    alert('Please fill in Name and Email.');
    return;
  }

  const selectedClientId = getSelectedClientId();
  if (!selectedClientId) {
    alert('Please select an API App.');
    return;
  }

  // Check if API App is in test mode for embedded signing
  try {
    const testModeRes = await fetchWithCsrf('/api-apps/test-mode');
    const testModeData = await testModeRes.json();
    const isTestMode = testModeData.testMode?.[selectedClientId];

    if (isTestMode === false) {
      const userConfirm = confirm(
        '⚠️ Embedded Signing Requires Test Mode\n\n' +
        'This API App is currently in PRODUCTION mode.\n' +
        'Embedded signing requires TEST MODE to work properly with domain verification.\n\n' +
        'Would you like to switch this app to test mode now?\n\n' +
        '(You can change this anytime in the API Apps tab)'
      );

      if (userConfirm) {
        // Switch to test mode
        const newTestMode = { ...testModeData.testMode, [selectedClientId]: true };
        await fetchWithCsrf('/api-apps/test-mode', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ testMode: newTestMode })
        });
        console.log('[EMBEDDED] Switched API App to test mode for embedded signing');
      } else {
        return; // User declined, don't proceed
      }
    }
  } catch (err) {
    console.warn('[EMBEDDED] Failed to check test mode, proceeding anyway:', err);
  }

  templateSelect.setCustomValidity('');

  let endpoint, bodyParams, useFormData = false;

  if (mode === 'auto-append') {
    endpoint = '/embedded-auto-append';
    useFormData = true;
    bodyParams = new FormData();
    bodyParams.append('file', autoAppendFile);
    bodyParams.append('signerName', signerName);
    bodyParams.append('signerEmail', signerEmail);
    bodyParams.append('client_id', selectedClientId);
    bodyParams.append('documentTemplateName', autoAppendFile.name);
    addSmsPhoneIfEnabled(bodyParams, true);
    addLogoSetting(bodyParams);
  } else if (mode === 'text-tags') {
    endpoint = '/embedded-document';
    const selDoc = currentDocTemplate();
    const logoEnabled = settings.logoOnTextTags !== false; // default to true
    console.log('[TEXT-TAGS] Logo setting:', { logoOnTextTags: settings.logoOnTextTags, logoEnabled });
    bodyParams = {
      signerName,
      signerEmail,
      field1: document.getElementById('field1').value,
      field2: document.getElementById('field2').value,
      field3: document.getElementById('field3').value,
      markdownContent: markdownEditor.value,
      client_id: selectedClientId,
      documentTemplateName: selDoc ? selDoc.name : 'Custom Document',
      logoEnabled: logoEnabled.toString()
    };
    addSmsPhoneIfEnabled(bodyParams, false);
  } else if (mode === 'form-fields') {
    endpoint = '/embedded-formfields';
    const selDoc = currentDocTemplate();
    bodyParams = {
      signerName,
      signerEmail,
      field1: document.getElementById('field1').value,
      field2: document.getElementById('field2').value,
      field3: document.getElementById('field3').value,
      markdownContent: markdownEditor.value,
      client_id: selectedClientId,
      documentTemplateName: selDoc ? selDoc.name : 'Custom Document',
      formFieldsJson: JSON.stringify(buildFormFieldsPayload()),
      logoEnabled: (settings.logoOnTextTags !== false).toString() // default to true
    };
    addSmsPhoneIfEnabled(bodyParams, false);
  } else {
    endpoint = '/embedded';
    const singleSigner = document.getElementById('singleSigner').checked;
    bodyParams = {
      template_id,
      signerName,
      signerEmail,
      singleSigner: singleSigner.toString(),
      field1: document.getElementById('field1').value,
      field2: document.getElementById('field2').value,
      field3: document.getElementById('field3').value,
      client_id: selectedClientId
    };

    // Add second signer if not single signer mode
    if (!singleSigner) {
      const signerName2 = document.getElementById('signerName2').value;
      const signerEmail2 = document.getElementById('signerEmail2').value;
      bodyParams.signerName2 = signerName2;
      bodyParams.signerEmail2 = signerEmail2;
      bodyParams.signingOrder = signingOrder; // 'sequential' or 'parallel'
      console.log('[EMBEDDED] Adding signingOrder to request:', signingOrder);
    }

    addSmsPhoneIfEnabled(bodyParams, false);
  }

  const fetchOpts = useFormData
    ? { method: 'POST', body: bodyParams }
    : { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(bodyParams) };

  const res = await fetchWithCsrf(endpoint, fetchOpts);
  const data = await res.json();

  // Check for error response from server
  if (!res.ok || data.error) {
    alert(data.error || 'Failed to create embedded signing session.');
    return;
  }

  const signUrl = data?.signUrl;
  if (!signUrl || typeof signUrl !== 'string') {
    alert('Received empty or invalid signing URL.');
    return;
  }

  // Use the client_id that the backend actually used (may differ from selected)
  const actualClientId = data.clientId || selectedClientId;
  if (actualClientId !== selectedClientId) {
    console.log(`[Embedded] Backend used ${actualClientId} instead of ${selectedClientId} for embedded signing`);
  }

  // Store embedded signing state
  embeddedSigningState = {
    signatureRequestId: data.signatureRequestId || null,
    currentSignerIndex: data.currentSigner || 0,
    totalSigners: data.totalSigners || 1
  };

  const signingContainer = prepareSigningOverlay();

  // Re-initialize HelloSign client with the actual client_id used by backend
  initHelloSignClient(actualClientId);

  client.open(signUrl, {
    container: signingContainer,
    skipDomainVerification: true,
    allowCancel: true
  });
});

  // ===== Unclaimed Draft (File) =====
  const unclaimedFileBtn = document.getElementById('unclaimedFileBtn');
  const unclaimedFileInput = document.getElementById('unclaimedFileInput');

  // Helper: Check if selected app likely supports embedded unclaimed drafts
  function checkUnclaimedDraftSupport(clientId) {
    const app = allApps.find(a => a.clientId === clientId);
    if (!app) return { supported: true, warning: null }; // Unknown app, allow attempt

    // Check if app has OAuth scopes configured (required for embedded unclaimed drafts)
    const hasOAuthScopes = app.oauthScopes && app.oauthScopes.length > 0;

    if (!hasOAuthScopes) {
      return {
        supported: false,
        warning: `The selected API app "${app.name}" does not have OAuth scopes configured and may not support embedded unclaimed drafts.\n\nWould you like to try anyway?`
      };
    }

    return { supported: true, warning: null };
  }

  unclaimedFileBtn.addEventListener('click', () => {
    const signerName = document.getElementById('signerName1').value;
    const signerEmail = document.getElementById('signerEmail1').value;
    if (!signerName || !signerEmail) {
      alert('Please fill in Name and Email.');
      return;
    }
    const selectedClientId = getSelectedClientId();
    if (!selectedClientId) {
      alert('Please select an API App.');
      return;
    }

    // Check if app supports unclaimed drafts
    const supportCheck = checkUnclaimedDraftSupport(selectedClientId);
    if (!supportCheck.supported && supportCheck.warning) {
      if (!confirm(supportCheck.warning)) {
        return;
      }
    }

    unclaimedFileInput.click();
  });

  unclaimedFileInput.addEventListener('change', async () => {
    const file = unclaimedFileInput.files[0];
    if (!file) return;

    const signerName = document.getElementById('signerName1').value;
    const signerEmail = document.getElementById('signerEmail1').value;
    const selectedClientId = getSelectedClientId();

    const formData = new FormData();
    formData.append('file', file);
    formData.append('signerName', signerName);
    formData.append('signerEmail', signerEmail);
    formData.append('client_id', selectedClientId);

    try {
      const res = await fetchWithCsrf('/unclaimed-draft-file', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const signUrl = data.signUrl;
      if (!signUrl) throw new Error('No claim URL returned.');

      // Warn if this is a claimUrl (may not work in iframe)
      if (data.isClaimUrl && data.warning) {
        console.warn('[Unclaimed Draft] ' + data.warning);
      }

      // Use the clientId returned by backend (may differ from selected if fallback occurred)
      const actualClientId = data.clientId || selectedClientId;
      if (actualClientId !== selectedClientId) {
        console.log(`[Unclaimed Draft] Backend used ${actualClientId} instead of ${selectedClientId}`);
      }

      // Re-initialize HelloSign client with the actual clientId used by backend
      initHelloSignClient(actualClientId);

      // Open in embedded iframe
      const signingContainer = prepareSigningOverlay();
      client.open(signUrl, { container: signingContainer, skipDomainVerification: true, allowCancel: true });
    } catch (err) {
      console.error('Unclaimed draft (file) error:', err);
      alert('Error creating unclaimed draft: ' + err.message);
    }

    // Reset the file input so the same file can be selected again
    unclaimedFileInput.value = '';
  });

  // ===== Unclaimed Draft (Template) =====
  const unclaimedTemplateBtn = document.getElementById('unclaimedTemplateBtn');

  unclaimedTemplateBtn.addEventListener('click', async () => {
    const signerName = document.getElementById('signerName1').value;
    const signerEmail = document.getElementById('signerEmail1').value;
    const template_id = templateSelect.value;

    if (!signerName || !signerEmail) {
      alert('Please fill in Name and Email.');
      return;
    }
    if (!template_id) {
      alert('Please select a template.');
      return;
    }
    const selectedClientId = getSelectedClientId();
    if (!selectedClientId) {
      alert('Please select an API App.');
      return;
    }

    // Check if app supports unclaimed drafts
    const supportCheck = checkUnclaimedDraftSupport(selectedClientId);
    if (!supportCheck.supported && supportCheck.warning) {
      if (!confirm(supportCheck.warning)) {
        return;
      }
    }

    try {
      const res = await fetchWithCsrf('/unclaimed-draft-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ signerName, signerEmail, template_id, client_id: selectedClientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const signUrl = data.signUrl;
      if (!signUrl) throw new Error('No claim URL returned.');

      // Warn if this is a claimUrl (may not work in iframe)
      if (data.isClaimUrl && data.warning) {
        console.warn('[Unclaimed Draft] ' + data.warning);
      }

      // Use the clientId returned by backend (may differ from selected if fallback occurred)
      const actualClientId = data.clientId || selectedClientId;
      if (actualClientId !== selectedClientId) {
        console.log(`[Unclaimed Draft] Backend used ${actualClientId} instead of ${selectedClientId}`);
      }

      // Re-initialize HelloSign client with the actual clientId used by backend
      initHelloSignClient(actualClientId);

      // Open in embedded iframe
      const signingContainer = prepareSigningOverlay();
      client.open(signUrl, { container: signingContainer, skipDomainVerification: true, allowCancel: true });
    } catch (err) {
      console.error('Unclaimed draft (template) error:', err);
      alert('Error creating unclaimed draft: ' + err.message);
    }
  });

  // ✅ SSE for webhook updates (with robust reconnection for ngrok)
  let evt;
  let sseRetryCount = 0;
  const MAX_SSE_RETRIES = 5;

  function connectSSE() {
    evt = new EventSource('/events/stream');
    evt.onopen = () => {
      console.log('SSE connected');
      sseRetryCount = 0; // Reset retry count on successful connection
    };
    evt.onerror = (err) => {
      console.warn('SSE connection error — will auto-reconnect');
      evt.close();

      // Stop retrying after max attempts to avoid spamming the server
      sseRetryCount++;
      if (sseRetryCount < MAX_SSE_RETRIES) {
        setTimeout(connectSSE, 5000); // Increased to 5 seconds
      } else {
        console.warn('SSE max retries reached. Stopping reconnection attempts.');
      }
    };
    evt.onmessage = handleSSEMessage;
    evt.addEventListener('log_update', () => refreshLogsQuietly());
  }
  // Webhook toast notification
  function showWebhookToast(status, signerName, docTitle) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.classList.add('toast');

    const eventLabels = {
      'signature_request_sent':         'Sent',
      'signature_request_viewed':       'Viewed',
      'signature_request_signed':       'Signed',
      'signature_request_all_signed':   'All Signed',
      'signature_request_downloadable': 'Ready to Download',
      'signature_request_declined':     'Declined',
      'signature_request_invalid':      'Error',
      'signature_request_expired':      'Expired',
      'signature_request_canceled':     'Cancelled',
    };
    const eventIcons = {
      'signature_request_sent':         '\u2709',
      'signature_request_viewed':       '\uD83D\uDC41',
      'signature_request_signed':       '\u2714',
      'signature_request_all_signed':   '\u2705',
      'signature_request_downloadable': '\uD83D\uDCE5',
      'signature_request_declined':     '\u2716',
      'signature_request_invalid':      '\u26A0',
      'signature_request_expired':      '\u23F0',
      'signature_request_canceled':     '\u2716',
    };

    const label = eventLabels[status] || status.replace(/signature_request_/g, '').replace(/_/g, ' ');
    const icon = eventIcons[status] || '\uD83D\uDD14';

    let detail = '';
    if (signerName && docTitle) {
      detail = signerName + ' \u2014 ' + docTitle;
    } else if (signerName) {
      detail = signerName;
    } else if (docTitle) {
      detail = docTitle;
    }

    toast.innerHTML =
      '<span class="toast-icon">' + icon + '</span>' +
      '<div class="toast-body">' +
        '<div class="toast-label">Callback</div>' +
        '<span class="toast-event">' + label + '</span>' +
        (detail ? ' <span class="toast-detail">' + detail + '</span>' : '') +
      '</div>';

    container.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', () => toast.remove());
    }, 5000);
  }

  function showSuccessToast(message) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.classList.add('toast', 'toast-success');
    toast.innerHTML =
      '<span class="toast-icon">\u2709</span>' +
      '<div class="toast-body">' +
        '<span class="toast-event">' + message + '</span>' +
      '</div>';
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
  }

  function showWarningToast(message) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.classList.add('toast', 'toast-warning');
    toast.innerHTML =
      '<span class="toast-icon">\u26A0</span>' +
      '<div class="toast-body">' +
        '<span class="toast-event">' + message + '</span>' +
      '</div>';
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', () => toast.remove());
    }, 6000);
  }

  function showErrorToast(message) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.classList.add('toast', 'toast-error');
    toast.innerHTML =
      '<span class="toast-icon">\u26A0</span>' +
      '<div class="toast-body">' +
        '<span class="toast-event">' + message + '</span>' +
      '</div>';
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', () => toast.remove());
    }, 8000);
  }

  function handleSSEMessage(e) {
    try {
      const { status, filesUrl, signerName, docTitle, source } = JSON.parse(e.data);

      // Only show toasts for real callback events, not our own send actions
      if (source === 'callback') {
        showWebhookToast(status, signerName, docTitle);
        // Silently refresh API logs so webhooks appear immediately (don't clear existing content)
        refreshLogsQuietly();
      }

      // Auto-refresh the Signature Status tab if it's currently visible (debounced)
      const statusTab = document.getElementById('tab-status');
      if (statusTab && statusTab.classList.contains('active')) {
        loadSignaturesDebounced();
      } else {
        // Invalidate the cache so next visit fetches fresh data
        signaturesCache = null;
      }
    } catch (err) {
      console.error('[SSE] Error handling message:', err);
    }
  }

  // Check auth status before connecting SSE
  fetchWithCsrf('/auth/status')
    .then(r => r.json())
    .then(data => {
      if (data.authenticated) {
        // Small delay to ensure session is fully synced to Redis before SSE connects
        setTimeout(connectSSE, 1000);
      }
    })
    .catch(err => {
      console.warn('Failed to check auth status, skipping SSE connection:', err);
    });

  // Test toast function (accessible in console for debugging)
  window.testToast = function() {
    showSuccessToast('Test toast message');
    showWebhookToast('signature_request_signed', 'John Doe', 'Test Document');
    console.log('Test toasts triggered');
  };

  // ===== API Logs Tab =====
  const refreshLogsBtn = document.getElementById('refreshLogsBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');

  // Load API endpoint documentation mapping
  let endpointDocs = {};
  fetchWithCsrf('/api/endpoint-docs')
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        endpointDocs = data.endpoints;
      }
    })
    .catch(err => console.warn('Failed to load endpoint docs:', err));

  if (refreshLogsBtn) {
    refreshLogsBtn.addEventListener('click', () => loadApiLogs());
  }
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', async () => {
      await fetchWithCsrf('/api-logs', { method: 'DELETE' });
      loadApiLogs();
    });
  }

  // ===== Side Panel: Show on all screens =====
  const showLogsOnAllScreens = document.getElementById('showLogsOnAllScreens');
  const apiLogSidePanel = document.getElementById('apiLogSidePanel');
  const mainLayout = document.querySelector('.main-layout');
  const sidePanelRefreshBtn = document.getElementById('sidePanelRefreshBtn');
  const sidePanelClearBtn = document.getElementById('sidePanelClearBtn');

  /**
   * Get documentation URL for an endpoint
   */
  function getDocsUrl(endpoint) {
    if (!endpoint) return null;

    // Direct match
    if (endpointDocs[endpoint]) {
      return endpointDocs[endpoint];
    }

    // Try to normalize endpoint (remove IDs and dynamic segments)
    // Match signature request IDs (32+ hex chars) and numeric IDs
    let normalized = endpoint.replace(/\/[0-9a-f]{32,}/gi, '').replace(/\/[0-9]+/g, '');

    // Try the normalized path first
    if (endpointDocs[normalized]) {
      return endpointDocs[normalized];
    }

    // Try with just first two parts (e.g., /signature_request/files)
    // This handles cases where there might be additional segments
    const parts = normalized.split('/').filter(p => p);
    if (parts.length >= 2) {
      const basePath = '/' + parts.slice(0, 2).join('/');
      if (endpointDocs[basePath]) {
        return endpointDocs[basePath];
      }
    }

    // Fallback to main API docs
    return 'https://developers.hellosign.com/';
  }

  function renderLogCards(container, logs) {
    container.innerHTML = '';
    if (logs.length === 0) {
      container.innerHTML = '<p style="color:#64748b; font-style:italic; padding:8px;">No API logs yet.</p>';
      return;
    }
    logs.forEach(log => {
      const card = document.createElement('div');
      card.className = 'log-card';

      const header = document.createElement('div');
      header.className = 'log-card-header';

      // Get docs URL for this endpoint (api_response or api_error types)
      const docsUrl = (log.type === 'api' || log.type === 'api_response' || log.type === 'api_error') ? getDocsUrl(log.endpoint) : null;
      const docsButton = docsUrl ? `
        <a href="${docsUrl}" target="_blank" rel="noopener noreferrer" class="log-docs-btn" title="View API documentation">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </a>
      ` : '';

      header.innerHTML = `
        <span class="log-badge ${log.type === 'callback' ? 'log-badge-webhook' : 'log-badge-api'}">${log.type === 'callback' ? 'CALLBACK' : 'API'}</span>
        <span class="log-method">${log.method}</span>
        <span class="log-endpoint">${log.endpoint}</span>
        <div class="log-header-right">
          <span class="log-time">${new Date(log.timestamp).toLocaleString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' })}</span>
          <button class="log-toggle-btn log-toggle-request">${t('api_logs.show_request')}</button>
          <button class="log-toggle-btn">${t('api_logs.show_response')}</button>
          ${docsButton}
        </div>
      `;
      card.appendChild(header);

      const requestWrapper = document.createElement('div');
      requestWrapper.className = 'log-card-body-wrapper';
      requestWrapper.style.display = 'none';
      const copyRequestBtn = document.createElement('button');
      copyRequestBtn.className = 'log-copy-btn';
      copyRequestBtn.textContent = t('api_logs.copy');
      const requestBody = document.createElement('pre');
      requestBody.className = 'log-card-body';
      requestBody.textContent = log.requestBody ? JSON.stringify(log.requestBody, null, 2) : '(no request body)';
      copyRequestBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(requestBody.textContent).then(() => {
          copyRequestBtn.textContent = t('api_logs.copied');
          setTimeout(() => { copyRequestBtn.textContent = t('api_logs.copy'); }, 1500);
        });
      });
      requestWrapper.appendChild(copyRequestBtn);
      requestWrapper.appendChild(requestBody);
      card.appendChild(requestWrapper);

      const bodyWrapper = document.createElement('div');
      bodyWrapper.className = 'log-card-body-wrapper';
      bodyWrapper.style.display = 'none';
      const copyBtn = document.createElement('button');
      copyBtn.className = 'log-copy-btn';
      copyBtn.textContent = t('api_logs.copy');
      const body = document.createElement('pre');
      body.className = 'log-card-body';
      // Show error or response
      const responseContent = log.error ? { error: log.error } : log.response;
      body.textContent = JSON.stringify(responseContent, null, 2);
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(body.textContent).then(() => {
          copyBtn.textContent = t('api_logs.copied');
          setTimeout(() => { copyBtn.textContent = t('api_logs.copy'); }, 1500);
        });
      });
      bodyWrapper.appendChild(copyBtn);
      bodyWrapper.appendChild(body);
      card.appendChild(bodyWrapper);

      header.querySelector('.log-toggle-request').addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = requestWrapper.style.display === 'none';
        requestWrapper.style.display = isHidden ? 'block' : 'none';
        e.target.textContent = isHidden ? t('api_logs.hide_request') : t('api_logs.show_request');
      });
      header.querySelector('.log-toggle-btn:not(.log-toggle-request)').addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = bodyWrapper.style.display === 'none';
        bodyWrapper.style.display = isHidden ? 'block' : 'none';
        e.target.textContent = isHidden ? t('api_logs.hide_response') : t('api_logs.show_response');
      });

      container.appendChild(card);
    });
  }

  // Silent refresh: updates logs without clearing existing content on failure
  function refreshLogsQuietly() {
    fetchWithCsrf('/api-logs')
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(logs => {
        // Refresh main API Logs tab if visible
        const logsTab = document.getElementById('tab-api-logs');
        if (logsTab && logsTab.classList.contains('active')) {
          const container = document.getElementById('logsContainer');
          renderLogCards(container, logs);
          container.style.display = 'block';
          document.getElementById('logsLoading').style.display = 'none';
        }
        // Refresh side panel if visible
        const sidePanel = document.getElementById('apiLogSidePanel');
        if (sidePanel && sidePanel.style.display !== 'none') {
          renderLogCards(document.getElementById('sidePanelLogsContainer'), logs);
        }
      })
      .catch(() => {}); // Silently ignore — keep showing existing logs
  }

  function loadSidePanelLogs() {
    const container = document.getElementById('sidePanelLogsContainer');
    fetchWithCsrf('/api-logs')
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(logs => renderLogCards(container, logs))
      .catch(() => {
        // Don't clear existing logs on refresh failure — keep showing what we have
        if (!container.querySelector('.log-card')) {
          container.innerHTML = '<p style="color:#dc2626; padding:8px;">Failed to load logs.</p>';
        }
      });
  }

  const tabBar = document.querySelector('.tab-bar');

  function getActiveTabId() {
    const activeBtn = document.querySelector('.tab-btn.active');
    return activeBtn ? activeBtn.dataset.tab : '';
  }

  function updateSidePanelVisibility(activeTabId) {
    if (!showLogsOnAllScreens || !showLogsOnAllScreens.checked) return;
    const onLogsTab = (activeTabId || getActiveTabId()) === 'tab-api-logs';
    if (onLogsTab) {
      apiLogSidePanel.style.display = 'none';
      mainLayout.classList.remove('has-side-panel');
      if (tabBar) tabBar.classList.remove('has-side-panel');
    } else {
      apiLogSidePanel.style.display = 'flex';
      mainLayout.classList.add('has-side-panel');
      if (tabBar) tabBar.classList.add('has-side-panel');
    }
  }

  if (showLogsOnAllScreens) {
    showLogsOnAllScreens.addEventListener('change', () => {
      if (showLogsOnAllScreens.checked) {
        updateSidePanelVisibility();
        loadSidePanelLogs();
      } else {
        apiLogSidePanel.style.display = 'none';
        mainLayout.classList.remove('has-side-panel');
        if (tabBar) tabBar.classList.remove('has-side-panel');
      }
    });
  }

  if (sidePanelRefreshBtn) {
    sidePanelRefreshBtn.addEventListener('click', () => loadSidePanelLogs());
  }
  if (sidePanelClearBtn) {
    sidePanelClearBtn.addEventListener('click', async () => {
      await fetchWithCsrf('/api-logs', { method: 'DELETE' });
      loadSidePanelLogs();
      // Also refresh the main logs tab if it was loaded
      const logsContainer = document.getElementById('logsContainer');
      if (logsContainer.style.display !== 'none') loadApiLogs();
    });
  }

  // ===== Templates Tab =====
  const refreshTemplatesBtn = document.getElementById('refreshTemplatesBtn');
  const templatePageSelect = document.getElementById('templatePageSize');

  if (refreshTemplatesBtn) {
    refreshTemplatesBtn.addEventListener('click', () => loadTemplatesTab(true));
  }
  if (templatePageSelect) {
    templatePageSelect.addEventListener('change', () => {
      templatePageSizeValue = parseInt(templatePageSelect.value, 10) || 25;
      loadTemplatesTab(true);
    });
  }

  const templateSearchInput = document.getElementById('templateSearchInput');
  const templateSearchBtn = document.getElementById('templateSearchBtn');

  if (templateSearchBtn) {
    templateSearchBtn.addEventListener('click', () => {
      templateSearchQuery = (templateSearchInput.value || '').trim().toLowerCase();
      loadTemplatesTab(false);
    });
  }
  if (templateSearchInput) {
    templateSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        templateSearchQuery = (templateSearchInput.value || '').trim().toLowerCase();
        loadTemplatesTab(false);
      }
    });
  }

  function loadTemplatesTab(force) {
    const tbody = document.getElementById('templatesBody');
    const table = document.getElementById('templatesTable');
    const loading = document.getElementById('templatesLoading');
    const errorEl = document.getElementById('templatesError');

    loading.style.display = 'block';
    loading.textContent = 'Loading templates...';
    errorEl.style.display = 'none';
    table.style.display = 'none';

    loadTemplatesOnce(force)
      .then(templates => {
        if (!Array.isArray(templates)) throw new Error('Unexpected response format');
        console.log('[Templates Tab] Received', templates.length, 'templates from API');
        loading.style.display = 'none';
        tbody.innerHTML = '';

        // Filter by search query if present
        if (templateSearchQuery) {
          const beforeFilter = templates.length;
          templates = templates.filter(t =>
            (t.title || '').toLowerCase().includes(templateSearchQuery)
          );
          console.log('[Templates Tab] After search filter:', templates.length, '(was', beforeFilter, ')');
        }

        if (templates.length === 0) {
          loading.textContent = templateSearchQuery ? 'No templates match your search.' : 'No templates found.';
          loading.style.display = 'block';
          return;
        }

        console.log('[Templates Tab] Rendering', templates.length, 'templates');

        // Build theme options from themesData for the checkboxes
        const themeOptions = Object.entries(themesData).map(([id, t]) => ({ id, name: t.name }));

        console.log('[Templates Tab] Building table rows for', templates.length, 'templates');
        let rowCount = 0;

        templates.forEach(tmpl => {
          const tr = document.createElement('tr');
          rowCount++;

          // Checkbox (disabled for shared templates)
          const tdCheckbox = document.createElement('td');
          tdCheckbox.style.textAlign = 'center';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'template-row-checkbox';
          checkbox.dataset.templateId = tmpl.id;
          checkbox.dataset.templateName = tmpl.title || tmpl.id;
          checkbox.dataset.isCreator = tmpl.isCreator ? 'true' : 'false';
          tdCheckbox.appendChild(checkbox);
          tr.appendChild(tdCheckbox);

          // Template Name (with "Shared" badge if not creator, and "Merge Fields" badge if applicable)
          const tdTitle = document.createElement('td');
          tdTitle.textContent = tmpl.title;
          if (!tmpl.isCreator) {
            const sharedBadge = document.createElement('span');
            sharedBadge.style.cssText = 'margin-left: 8px; padding: 2px 6px; background: #dbeafe; color: #1e40af; font-size: 11px; border-radius: 4px; font-weight: 500;';
            sharedBadge.textContent = 'Shared';
            tdTitle.appendChild(sharedBadge);
          }
          if (tmpl.hasMergeFields) {
            const mergeFieldsBadge = document.createElement('span');
            mergeFieldsBadge.style.cssText = 'margin-left: 8px; padding: 2px 6px; background: #e0e7ff; color: #4338ca; font-size: 11px; border-radius: 4px; font-weight: 500; cursor: help;';
            mergeFieldsBadge.textContent = 'Merge Fields';
            if (tmpl.mergeFieldNames && tmpl.mergeFieldNames.length > 0) {
              mergeFieldsBadge.title = 'Merge fields: ' + tmpl.mergeFieldNames.join(', ');
            }
            tdTitle.appendChild(mergeFieldsBadge);
          }
          tr.appendChild(tdTitle);

          // Template ID
          const tdId = document.createElement('td');
          tdId.style.fontFamily = "'Courier New', monospace";
          tdId.style.fontSize = '12px';
          tdId.style.color = '#64748b';
          tdId.textContent = tmpl.id;
          tr.appendChild(tdId);

          // Created By
          const tdCreator = document.createElement('td');
          tdCreator.textContent = tmpl.createdBy || '—';
          tdCreator.style.fontSize = '12px';
          tdCreator.style.color = '#64748b';
          tr.appendChild(tdCreator);

          // Signer Count
          const tdSigners = document.createElement('td');
          tdSigners.textContent = tmpl.signerCount ?? '—';
          tdSigners.style.textAlign = 'center';
          tr.appendChild(tdSigners);

          // Signer Roles
          const tdRoles = document.createElement('td');
          if (tmpl.signerRoles && tmpl.signerRoles.length > 0) {
            tmpl.signerRoles.forEach(role => {
              const badge = document.createElement('span');
              badge.className = 'label-badge';
              badge.textContent = role;
              tdRoles.appendChild(badge);
            });
          } else {
            tdRoles.innerHTML = '<span style="color:#94a3b8; font-style:italic;">—</span>';
          }
          tr.appendChild(tdRoles);

          // Current Labels (badges)
          const tdCurrent = document.createElement('td');
          if (tmpl.labels && tmpl.labels.length > 0) {
            tmpl.labels.forEach(lbl => {
              const badge = document.createElement('span');
              badge.className = 'label-badge';
              const theme = themesData[lbl];
              badge.textContent = theme ? theme.name : lbl;
              tdCurrent.appendChild(badge);
            });
          } else {
            tdCurrent.innerHTML = '<span style="color:#94a3b8; font-style:italic;">None</span>';
          }
          tr.appendChild(tdCurrent);

          // Metadata (raw JSON)
          const tdMeta = document.createElement('td');
          const metaKeys = Object.keys(tmpl.metadata || {});
          if (metaKeys.length > 0) {
            const metaStr = metaKeys.map(k => `${k}: ${tmpl.metadata[k]}`).join(', ');
            tdMeta.textContent = metaStr;
            tdMeta.style.fontSize = '12px';
            tdMeta.style.color = '#64748b';
          } else {
            tdMeta.innerHTML = '<span style="color:#94a3b8; font-style:italic;">—</span>';
          }
          tr.appendChild(tdMeta);

          // Assign Labels (checkboxes)
          const tdLabels = document.createElement('td');
          const checkboxContainer = document.createElement('div');
          checkboxContainer.className = 'label-checkboxes';

          // Helper function to update current labels badges
          const updateCurrentLabelsColumn = (selectedLabels) => {
            while (tdCurrent.firstChild) {
              tdCurrent.removeChild(tdCurrent.firstChild);
            }
            if (selectedLabels.length > 0) {
              selectedLabels.forEach(lbl => {
                const badge = document.createElement('span');
                badge.className = 'label-badge';
                const theme = themesData[lbl];
                badge.textContent = theme ? theme.name : lbl;
                tdCurrent.appendChild(badge);
              });
            } else {
              const noneSpan = document.createElement('span');
              noneSpan.style.color = '#94a3b8';
              noneSpan.style.fontStyle = 'italic';
              noneSpan.textContent = 'None';
              tdCurrent.appendChild(noneSpan);
            }
          };

          const checkboxes = [];
          themeOptions.forEach(({ id, name }) => {
            const wrapper = document.createElement('label');
            wrapper.className = 'label-checkbox-wrapper';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = id;
            cb.setAttribute('data-tooltip', 'templateLabelAssignment');
            if (tmpl.labels && tmpl.labels.includes(id)) cb.checked = true;

            // Auto-save on checkbox change
            cb.addEventListener('change', async (e) => {
              const checkbox = e.target;
              const wasChecked = checkbox.checked;

              // Disable all checkboxes in this row during save
              checkboxes.forEach(c => c.disabled = true);

              // Create and show loading indicator
              const loader = document.createElement('span');
              loader.style.cssText = 'margin-left: 4px; font-size: 11px; color: #6366f1;';
              loader.textContent = '⏳';
              wrapper.appendChild(loader);

              try {
                const selectedLabels = checkboxes.filter(cb => cb.checked).map(cb => cb.value);
                const res = await fetchWithCsrf(`/api-templates/${tmpl.id}/metadata`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ labels: selectedLabels }),
                });

                if (!res.ok) {
                  const err = await res.json();
                  throw new Error(err.error || 'Failed to save');
                }

                // Update the current labels column
                updateCurrentLabelsColumn(selectedLabels);

                // Update the in-memory cache directly
                const cached = allTemplates.find(t => t.id === tmpl.id);
                if (cached) cached.labels = selectedLabels;

                // Refresh the dropdown in tab 1 from cache (no fetch)
                filterTemplatesByTheme(currentThemeId);

                // Show success indicator briefly
                loader.textContent = '✓';
                loader.style.color = '#16a34a';
                setTimeout(() => loader.remove(), 1500);

              } catch (err) {
                console.error('Error auto-saving theme labels:', err);
                // Revert checkbox on error
                checkbox.checked = !wasChecked;
                loader.remove();

                // Show error toast
                if (window.showErrorToast) {
                  showErrorToast('Failed to save theme assignment');
                } else {
                  alert('Failed to save theme assignment: ' + err.message);
                }
              } finally {
                // Re-enable all checkboxes
                checkboxes.forEach(c => c.disabled = false);
              }
            });

            checkboxes.push(cb);
            wrapper.appendChild(cb);
            wrapper.appendChild(document.createTextNode(' ' + name));
            checkboxContainer.appendChild(wrapper);
          });

          tdLabels.appendChild(checkboxContainer);
          tr.appendChild(tdLabels);

          tbody.appendChild(tr);
        });

        console.log('[Templates Tab] Successfully added', rowCount, 'rows to table');

        table.style.display = 'table';
      })
      .catch(err => {
        loading.style.display = 'none';
        errorEl.textContent = 'Failed to load templates: ' + (err.message || err);
        errorEl.style.display = 'block';
        console.error('Error in templates tab:', err);
      });
  }

  // ===== Template Sharing =====

  // Helper function to update Share and Delete button states
  function updateShareButtonState() {
    const shareBtn = document.getElementById('shareTemplatesBtn');
    const deleteBtn = document.getElementById('deleteTemplatesBtn');
    const checkedCount = document.querySelectorAll('.template-row-checkbox:checked').length;
    if (shareBtn) {
      shareBtn.disabled = checkedCount === 0;
      shareBtn.textContent = checkedCount > 0 ? `Share (${checkedCount})` : 'Share';
    }
    if (deleteBtn) {
      deleteBtn.disabled = checkedCount === 0;
      deleteBtn.textContent = checkedCount > 0 ? `Delete (${checkedCount})` : 'Delete';
    }
  }

  // Template select-all logic
  const selectAllTemplates = document.getElementById('selectAllTemplates');
  if (selectAllTemplates) {
    selectAllTemplates.addEventListener('change', (e) => {
      const checkboxes = document.querySelectorAll('.template-row-checkbox');
      checkboxes.forEach(cb => cb.checked = e.target.checked);
      updateShareButtonState();
    });
  }

  // Event delegation for row checkboxes
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('template-row-checkbox')) {
      updateShareButtonState();
    }
  });

  // Open share modal
  async function openShareModal() {
    const modal = document.getElementById('shareTemplateModal');
    const targetType = document.getElementById('shareTargetType');
    const targetSelector = document.getElementById('shareTargetSelector');
    const confirmBtn = document.getElementById('confirmShareBtn');
    const roleInfoDiv = document.getElementById('shareUserRoleInfo');

    // Reset state
    targetType.value = '';
    targetSelector.style.display = 'none';
    confirmBtn.disabled = true;
    document.getElementById('shareModalStatus').style.display = 'none';
    document.getElementById('skipNotification').checked = false;

    // Fetch and display user role info
    try {
      const resp = await fetchWithCsrf('/auth/status');
      const data = await resp.json();

      if (data.authenticated && data.email) {
        const roleText = data.role_code === 'a' ? 'Admin' :
                        data.role_code === 'o' ? 'Owner' :
                        data.role_code === 'm' ? 'Member' :
                        data.role_code || 'Unknown';

        let roleMessage = `Your role: <strong>${roleText}</strong>`;

        if (data.role_code === 'a' || data.role_code === 'o') {
          roleMessage += ' - You can share templates with team and sub-team members.';
        } else {
          roleMessage += ' - You can only share templates with same-team members.';
        }

        roleInfoDiv.innerHTML = roleMessage;
      }
    } catch (err) {
      console.error('Failed to fetch role info:', err);
    }

    // Show modal
    modal.style.display = 'flex';
  }

  // Close share modal
  function closeShareModal() {
    const modal = document.getElementById('shareTemplateModal');
    modal.style.display = 'none';

    // Reset button state
    const confirmBtn = document.getElementById('confirmShareBtn');
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Share';

    // Uncheck all templates
    document.querySelectorAll('.template-row-checkbox').forEach(cb => cb.checked = false);
    if (document.getElementById('selectAllTemplates')) {
      document.getElementById('selectAllTemplates').checked = false;
    }
    updateShareButtonState();
  }

  // Share button click handler
  const shareTemplatesBtn = document.getElementById('shareTemplatesBtn');
  if (shareTemplatesBtn) {
    shareTemplatesBtn.addEventListener('click', openShareModal);
  }

  // Share target type change handler
  const shareTargetType = document.getElementById('shareTargetType');
  if (shareTargetType) {
    shareTargetType.addEventListener('change', (e) => {
      const type = e.target.value;
      const targetSelector = document.getElementById('shareTargetSelector');
      const confirmBtn = document.getElementById('confirmShareBtn');

      if (!type) {
        targetSelector.style.display = 'none';
        confirmBtn.disabled = true;
        return;
      }

      if (type === 'emails') {
        targetSelector.style.display = 'block';
        confirmBtn.disabled = false;
        return;
      }

      targetSelector.style.display = 'none';
      confirmBtn.disabled = true;
    });
  }

  // Email input change handler
  const shareEmailsInput = document.getElementById('shareEmailsInput');
  if (shareEmailsInput) {
    shareEmailsInput.addEventListener('input', (e) => {
      const confirmBtn = document.getElementById('confirmShareBtn');
      const emails = e.target.value.trim();
      confirmBtn.disabled = emails.length === 0;
    });
  }

  // Confirm share handler
  const confirmShareBtn = document.getElementById('confirmShareBtn');
  if (confirmShareBtn) {
    confirmShareBtn.addEventListener('click', async () => {
      const selectedTemplates = Array.from(document.querySelectorAll('.template-row-checkbox:checked'))
        .map(cb => cb.dataset.templateId);

      const shareType = document.getElementById('shareTargetType').value;
      const skipNotification = document.getElementById('skipNotification').checked;
      const statusDiv = document.getElementById('shareModalStatus');

      // Get email list
      const emailsInput = document.getElementById('shareEmailsInput').value;
      const emails = emailsInput.split('\n')
        .map(e => e.trim())
        .filter(e => e.length > 0 && e.includes('@'));

      if (emails.length === 0) {
        statusDiv.textContent = '✗ Please enter at least one valid email address';
        statusDiv.style.background = '#fee2e2';
        statusDiv.style.color = '#991b1b';
        statusDiv.style.display = 'block';
        return;
      }

      // Disable button and show loading
      confirmShareBtn.disabled = true;
      confirmShareBtn.textContent = 'Sharing...';
      statusDiv.style.display = 'none';

      try {
        const resp = await fetchWithCsrf('/api/templates/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template_ids: selectedTemplates,
            share_with: 'emails',
            emails: emails,
            skip_notification: skipNotification
          })
        });

        // Check if response is JSON
        const contentType = resp.headers.get('content-type');
        let result;
        if (contentType && contentType.includes('application/json')) {
          result = await resp.json();
        } else {
          const text = await resp.text();
          throw new Error(`Server returned non-JSON response: ${text.substring(0, 100)}`);
        }

        if (resp.ok) {
          let message = `✓ Successfully shared ${result.shared_count} of ${result.total_attempted} operations`;

          if (result.shared_count > 0) {
            message += `\n\n⏱️ Note: It may take 30-60 seconds for shared templates to appear due to Dropbox Sign API propagation delay.`;
            message += `\n💡 Recipients should wait a minute, then click the Refresh button in the Templates tab.`;
          }

          if (result.errors && result.errors.length > 0) {
            message += `\n\n⚠ ${result.errors.length} error(s):`;
            // Group errors by message
            const errorGroups = {};
            result.errors.forEach(e => {
              const key = e.error;
              if (!errorGroups[key]) errorGroups[key] = [];
              errorGroups[key].push(e.user_email);
            });

            Object.entries(errorGroups).forEach(([errMsg, users]) => {
              message += `\n• ${errMsg}`;
              if (users.length <= 2) {
                message += ` (${users.join(', ')})`;
              } else {
                message += ` (${users.length} users)`;
              }
            });
          }

          statusDiv.textContent = message;

          if (result.shared_count > 0) {
            statusDiv.style.background = '#d1fae5';
            statusDiv.style.color = '#065f46';
          } else {
            statusDiv.style.background = '#fef3c7';
            statusDiv.style.color = '#92400e';
          }

          statusDiv.style.display = 'block';
          statusDiv.style.whiteSpace = 'pre-line';
          statusDiv.style.fontSize = '13px';

          // Don't auto-close if there were errors
          if (result.errors && result.errors.length > 0) {
            confirmShareBtn.disabled = false;
            confirmShareBtn.textContent = 'Close';
          } else {
            // Close modal after 3 seconds if all succeeded
            setTimeout(() => {
              closeShareModal();
            }, 3000);
          }
        } else {
          throw new Error(result.apiError || result.error || 'Failed to share templates');
        }
      } catch (err) {
        statusDiv.textContent = `✗ Error: ${err.message}`;
        statusDiv.style.background = '#fee2e2';
        statusDiv.style.color = '#991b1b';
        statusDiv.style.display = 'block';
        confirmShareBtn.disabled = false;
        confirmShareBtn.textContent = 'Share';
      }
    });
  }

  // Cancel share handler
  const cancelShareBtn = document.getElementById('cancelShareBtn');
  if (cancelShareBtn) {
    cancelShareBtn.addEventListener('click', closeShareModal);
  }

  // Close modal on backdrop click
  const shareTemplateModal = document.getElementById('shareTemplateModal');
  if (shareTemplateModal) {
    shareTemplateModal.addEventListener('click', (e) => {
      if (e.target.id === 'shareTemplateModal') {
        closeShareModal();
      }
    });
  }

  // ===== Template Deletion =====

  // Delete button click handler
  const deleteTemplatesBtn = document.getElementById('deleteTemplatesBtn');
  if (deleteTemplatesBtn) {
    deleteTemplatesBtn.addEventListener('click', async () => {
      const allSelected = Array.from(document.querySelectorAll('.template-row-checkbox:checked'));

      // Filter to only include templates where user is creator
      const ownedTemplates = allSelected
        .filter(cb => cb.dataset.isCreator === 'true')
        .map(cb => ({ id: cb.dataset.templateId, name: cb.dataset.templateName }));

      const sharedCount = allSelected.length - ownedTemplates.length;

      if (ownedTemplates.length === 0) {
        alert('Cannot delete selected templates. You can only delete templates you created, not templates shared with you.');
        return;
      }

      let confirmMsg = `Are you sure you want to delete ${ownedTemplates.length} template(s)?\n\n${ownedTemplates.map(t => `• ${t.name}`).join('\n')}\n\n⚠️ This action cannot be undone.`;

      if (sharedCount > 0) {
        confirmMsg += `\n\nNote: ${sharedCount} shared template(s) will be skipped (you can only delete templates you created).`;
      }

      const confirmed = confirm(confirmMsg);

      if (!confirmed) return;

      // Disable button and show loading
      deleteTemplatesBtn.disabled = true;
      deleteTemplatesBtn.textContent = 'Deleting...';

      let successCount = 0;
      let failCount = 0;
      const errors = [];

      for (const template of ownedTemplates) {
        try {
          const resp = await fetchWithCsrf(`/api-templates/${template.id}`, {
            method: 'DELETE'
          });

          if (resp.ok) {
            successCount++;
          } else {
            const result = await resp.json();
            failCount++;
            const errorMsg = result.apiError || result.error || result.details || 'Unknown error';
            errors.push(`${template.name}: ${errorMsg}`);
            console.error('[DELETE-TEMPLATE] Failed:', template.id, result);
          }
        } catch (err) {
          failCount++;
          errors.push(`${template.name}: ${err.message}`);
          console.error('[DELETE-TEMPLATE] Exception:', template.id, err);
        }
      }

      // Show results only if there were errors
      if (errors.length > 0) {
        const message = `Failed to delete ${errors.length} of ${ownedTemplates.length} template(s):\n\n${errors.join('\n')}`;
        alert(message);
      }

      // Uncheck all templates
      document.querySelectorAll('.template-row-checkbox').forEach(cb => cb.checked = false);
      if (document.getElementById('selectAllTemplates')) {
        document.getElementById('selectAllTemplates').checked = false;
      }

      // Refresh the templates list (force=true to bypass cache)
      loadTemplatesTab(true);

      // Reset button state
      updateShareButtonState();
    });
  }

  // ===== API Apps Tab =====
  const refreshAppsBtn = document.getElementById('refreshAppsBtn');
  const saveAppsBtn = document.getElementById('saveAppsBtn');
  let appCheckboxes = [];
  let appTestModeCheckboxes = [];
  let appWebhookCheckboxes = [];

  if (refreshAppsBtn) {
    refreshAppsBtn.addEventListener('click', () => loadAppsTab(true));
  }
  if (saveAppsBtn) {
    saveAppsBtn.addEventListener('click', async () => {
      const visibility = {};
      appCheckboxes.forEach(({ clientId, checkbox }) => {
        visibility[clientId] = checkbox.checked;
      });
      const testMode = {};
      appTestModeCheckboxes.forEach(({ clientId, checkbox }) => {
        testMode[clientId] = checkbox.checked;
      });
      const webhookSettings = {};
      appWebhookCheckboxes.forEach(({ clientId, checkbox, owned }) => {
        // Only include settings for apps the user owns
        if (owned !== false) {
          webhookSettings[clientId] = checkbox.checked;
        }
      });

      saveAppsBtn.disabled = true;
      saveAppsBtn.textContent = 'Saving...';

      try {
        // Save all settings in parallel (batch operations)
        const [visRes, tmRes, webhookRes] = await Promise.all([
          fetchWithCsrf('/api-apps/visibility', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visibility }),
          }),
          fetchWithCsrf('/api-apps/test-mode', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testMode }),
          }),
          fetchWithCsrf('/api-apps/webhook-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: webhookSettings }),
          }),
        ]);

        // Check for errors in each response
        if (!visRes.ok) {
          const visError = await visRes.json();
          throw new Error(visError.error || 'Failed to save visibility settings');
        }
        if (!tmRes.ok) {
          const tmError = await tmRes.json();
          throw new Error(tmError.error || 'Failed to save test mode settings');
        }
        if (!webhookRes.ok) {
          const webhookError = await webhookRes.json();
          throw new Error(webhookError.error || 'Failed to save callback settings');
        }

        // Check if we need to refresh the apps list (callback URLs may have been cleared)
        const webhookData = await webhookRes.json();
        const shouldRefresh = webhookData.shouldRefresh || false;

        if (shouldRefresh) {
          // Force refresh apps list from server to get updated callback URLs
          await loadAppsTab(true);
        } else {
          // Update the in-memory cache
          allApps.forEach(app => {
            if (visibility[app.clientId] !== undefined) {
              app.visible = visibility[app.clientId];
            }
            if (testMode[app.clientId] !== undefined) {
              app.testMode = testMode[app.clientId];
            }
            if (webhookSettings[app.clientId] !== undefined) {
              app.webhookEnabled = webhookSettings[app.clientId];
            }
          });
          // Don't reload table - the in-memory update is enough
          // loadAppsTab will be called if user switches tabs, and by then session will be saved
        }

        // Check for errors from backend (e.g., ownership issues)
        if (webhookData.errors && webhookData.errors.length > 0) {
          showToast(webhookData.errors.join('\n'), 'warning');
        }

        saveAppsBtn.textContent = 'Saved!';
        saveAppsBtn.style.background = '#16a34a';
        saveAppsBtn.style.borderColor = '#16a34a';
        setTimeout(() => {
          saveAppsBtn.textContent = 'Save';
          saveAppsBtn.style.background = '#16a34a';
          saveAppsBtn.style.borderColor = '#16a34a';
          saveAppsBtn.disabled = false;
        }, 1500);

        // Refresh the dropdown to reflect changes
        populateAppDropdown();
      } catch (err) {
        console.error('Error saving app settings:', err);
        showToast(err.message || 'Failed to save settings', 'error');
        saveAppsBtn.textContent = 'Error';
        saveAppsBtn.style.background = '#dc2626';
        saveAppsBtn.style.borderColor = '#dc2626';
        setTimeout(() => {
          saveAppsBtn.textContent = 'Save';
          saveAppsBtn.style.background = '#16a34a';
          saveAppsBtn.style.borderColor = '#16a34a';
          saveAppsBtn.disabled = false;
        }, 2000);
      }
    });
  }

  // Helper function to enable/disable delete button based on checkbox selection
  function updateDeleteButtonState() {
    const deleteAppsBtn = document.getElementById('deleteAppsBtn');
    if (!deleteAppsBtn) return;

    const anyChecked = document.querySelectorAll('.delete-app-checkbox:checked').length > 0;

    deleteAppsBtn.disabled = !anyChecked;
    deleteAppsBtn.style.cursor = anyChecked ? 'pointer' : 'not-allowed';
    deleteAppsBtn.style.opacity = anyChecked ? '1' : '0.5';
  }

  // Delete selected apps button handler
  const deleteAppsBtn = document.getElementById('deleteAppsBtn');
  if (deleteAppsBtn) {
    deleteAppsBtn.addEventListener('click', async () => {
      // Get all checked delete checkboxes
      const deleteCheckboxes = document.querySelectorAll('.delete-app-checkbox:checked');

      if (deleteCheckboxes.length === 0) {
        showToast('Please select at least one app to delete', 'warning');
        return;
      }

      // Build list of apps to delete
      const appsToDelete = Array.from(deleteCheckboxes).map(cb => ({
        clientId: cb.dataset.clientId,
        name: cb.dataset.appName
      }));

      console.log('[Delete Apps] Apps to delete:', appsToDelete);

      // Show confirmation dialog
      const appNames = appsToDelete.map(a => `  • ${a.name}`).join('\n');
      const confirmMsg = `Are you sure you want to delete ${appsToDelete.length} app(s)?\n\n${appNames}\n\nThis action cannot be undone!`;

      if (!confirm(confirmMsg)) {
        return;
      }

      // Disable button and show loading state
      deleteAppsBtn.disabled = true;
      deleteAppsBtn.textContent = 'Deleting...';

      try {
        // Delete apps one by one
        const results = await Promise.allSettled(
          appsToDelete.map(app =>
            fetchWithCsrf(`/api-apps/${app.clientId}`, {
              method: 'DELETE'
            }).then(async res => {
              const data = await res.json().catch(() => ({}));
              console.log(`[Delete App] ${app.name} (${app.clientId}): status=${res.status}`, data);
              if (!res.ok) {
                throw new Error(data.error || `HTTP ${res.status}`);
              }
              return res;
            })
          )
        );

        // Check results
        console.log('[Delete Apps] All results:', results);
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        if (successful > 0) {
          showToast(`Successfully deleted ${successful} app(s)`, 'success');
        }
        if (failed > 0) {
          const errors = results
            .filter(r => r.status === 'rejected')
            .map(r => r.reason.message)
            .join(', ');
          console.error('[Delete Apps] Errors:', errors);
          showToast(`Failed to delete ${failed} app(s): ${errors}`, 'error');
        }

        // Refresh the apps list (this will reset button state via updateDeleteButtonState)
        await loadAppsTab(true);

        deleteAppsBtn.textContent = 'Delete';
        // Button state will be updated by updateDeleteButtonState when checkboxes are re-rendered
      } catch (err) {
        console.error('Error deleting apps:', err);
        showToast('Error deleting apps', 'error');
        deleteAppsBtn.textContent = 'Delete';
        updateDeleteButtonState(); // Restore proper button state
      }
    });
  }

  // White labeling color fields config
  const WL_FIELDS = [
    { key: 'headerBackgroundColor', label: 'Header BG', default: '#1a1a1a' },
    { key: 'linkColor', label: 'Link', default: '#0061FE' },
    { key: 'pageBackgroundColor', label: 'Page BG', default: '#f7f8f9' },
    { key: 'primaryButtonColor', label: 'Primary Btn', default: '#0061FE' },
    { key: 'primaryButtonColorHover', label: 'Primary Btn Hover', default: '#0061FE' },
    { key: 'primaryButtonTextColor', label: 'Primary Btn Text', default: '#ffffff' },
    { key: 'primaryButtonTextColorHover', label: 'Primary Btn Text Hover', default: '#ffffff' },
    { key: 'secondaryButtonColor', label: 'Secondary Btn', default: '#ffffff' },
    { key: 'secondaryButtonColorHover', label: 'Secondary Btn Hover', default: '#ffffff' },
    { key: 'secondaryButtonTextColor', label: 'Secondary Btn Text', default: '#0061FE' },
    { key: 'secondaryButtonTextColorHover', label: 'Secondary Btn Text Hover', default: '#0061FE' },
    { key: 'textColor1', label: 'Text Color 1', default: '#808080' },
    { key: 'textColor2', label: 'Text Color 2', default: '#ffffff' },
  ];

  function buildAppDetailPanel(clientId, detailRow) {
    const td = detailRow.querySelector('td');
    td.innerHTML = '<div class="app-detail-panel"><p style="color:#64748b;font-style:italic;">Loading app details...</p></div>';

    fetchWithCsrf(`/api-apps/${clientId}`)
      .then(async res => {
        const data = await res.json();
        if (!res.ok) {
          // Check if user doesn't own this app
          if (data.owned === false || res.status === 403 || res.status === 404) {
            throw new Error("You don't have permission to view details for apps you don't own");
          }
          throw new Error(data.error || 'Failed to load');
        }
        return data;
      })
      .then(appData => {
        const panel = document.createElement('div');
        panel.className = 'app-detail-panel';

        // --- General Section ---
        const approvedBadge = appData.isApproved
          ? '<span class="app-status-badge approved">Approved</span>'
          : '<span class="app-status-badge not-approved">Not Approved</span>';
        const generalHtml = `
          <h3>General</h3>
          <div class="app-detail-grid">
            <div class="app-detail-field">
              <label>App Name</label>
              <input type="text" data-field="name" value="${(appData.name || '').replace(/"/g, '&quot;')}" />
            </div>
            <div class="app-detail-field">
              <label>Callback URL <span style="font-size:11px;color:#94a3b8;font-weight:400;">(read-only, configured in Dropbox Sign)</span></label>
              <input type="url" data-field="callbackUrl" value="${(appData.callbackUrl || '').replace(/"/g, '&quot;')}" placeholder="(not configured)" readonly style="background:#f8fafc;cursor:not-allowed;" />
            </div>
            <div class="app-detail-field" style="grid-column:1/-1;">
              <label>Domains (comma-separated)</label>
              <input type="text" data-field="domains" value="${(appData.domains || []).join(', ')}" placeholder="example.com, app.example.com" />
              ${appData.isApproved ? '<p style="font-size:11px;color:#f59e0b;margin:4px 0 0 0;">⚠️ Approved apps may have restrictions on domain changes. You can add subdomains or multiple domains.</p>' : ''}
            </div>
            <div class="app-detail-field">
              <label>Status</label>
              <div class="app-detail-info-row">${approvedBadge}<span style="font-size:12px;color:#64748b;">${appData.isApproved ? 'Branding can be removed' : 'Dropbox Sign branding is shown'}</span></div>
            </div>
            <div class="app-detail-field">
              <label>Insert Everywhere</label>
              <div class="app-detail-info-row">
                <input type="checkbox" id="cie_${appData.clientId}" data-field="canInsertEverywhere" ${appData.canInsertEverywhere ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;" />
                <label for="cie_${appData.clientId}" style="font-size:13px;color:#1e293b;text-transform:none;letter-spacing:0;cursor:pointer;">Allow signers to insert fields everywhere in one click</label>
              </div>
            </div>
          </div>
        `;

        // --- Logo Section ---
        const logoUrl = `/api-apps/${appData.clientId}/logo`;
        const logoHtml = `
          <h3>Custom Logo <span class="tooltip-icon" data-tooltip="customLogoFile">?</span></h3>
          <div class="app-logo-section">
            <div class="app-logo-preview" style="margin-bottom:12px;">
              <img id="app-logo-${appData.clientId}"
                   alt="App logo"
                   style="max-width:200px;max-height:200px;border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:white;" />
              <div id="app-logo-placeholder-${appData.clientId}" style="display:none;color:#94a3b8;font-size:13px;font-style:italic;padding:12px;background:#f8fafc;border-radius:6px;">No custom logo uploaded yet</div>
            </div>
            <input type="file" data-field="custom_logo_file" accept="image/png,image/jpeg,image/gif,image/svg+xml" />
            <span style="font-size:12px;color:#64748b;">PNG, JPEG, GIF, or SVG. Max 200x200px recommended.</span>
          </div>
        `;

        // Load logo with authentication header
        (async () => {
          try {
            const response = await fetchWithCsrf(logoUrl, { method: 'GET' });
            if (response.ok) {
              const blob = await response.blob();
              const imgUrl = URL.createObjectURL(blob);
              const imgElement = document.getElementById(`app-logo-${appData.clientId}`);
              if (imgElement) {
                imgElement.src = imgUrl;
              }
            } else {
              // Logo not found or error - show placeholder
              const imgElement = document.getElementById(`app-logo-${appData.clientId}`);
              const placeholder = document.getElementById(`app-logo-placeholder-${appData.clientId}`);
              if (imgElement) imgElement.style.display = 'none';
              if (placeholder) placeholder.style.display = 'block';
            }
          } catch (err) {
            console.warn('Failed to load app logo:', err);
            const imgElement = document.getElementById(`app-logo-${appData.clientId}`);
            const placeholder = document.getElementById(`app-logo-placeholder-${appData.clientId}`);
            if (imgElement) imgElement.style.display = 'none';
            if (placeholder) placeholder.style.display = 'block';
          }
        })();

        // --- White Labeling Section ---
        const wlOptions = appData.whiteLabelingOptions || {};
        let wlGridHtml = '';
        WL_FIELDS.forEach(f => {
          const val = wlOptions[f.key] || f.default;
          wlGridHtml += `
            <div class="wl-color-item">
              <label>${f.label}</label>
              <div class="wl-color-row">
                <input type="color" data-wl="${f.key}" value="${val}" />
                <input type="text" data-wl-text="${f.key}" value="${val}" maxlength="7" />
              </div>
            </div>
          `;
        });
        const wlHtml = `<h3>White Labeling <span class="tooltip-icon" data-tooltip="customLogoFile">?</span></h3>
          <p style="font-size:12px;color:#64748b;margin:0 0 10px;">Customize the embedded signing appearance. The API requires sufficient contrast ratios between related colors (e.g. button text vs button background).</p>
          <div class="wl-color-grid">${wlGridHtml}</div>
          <div style="margin-top:16px;padding:12px;background:#fef3c7;border:1px solid #fbbf24;border-radius:6px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#92400e;">
              <input type="checkbox" data-field="reset_white_labeling" style="width:16px;height:16px;cursor:pointer;" />
              <span>Reset White Labeling to Defaults <span class="tooltip-icon" data-tooltip="resetWhiteLabeling">?</span></span>
            </label>
            <p style="font-size:11px;color:#92400e;margin:6px 0 0 24px;">This will remove all custom white labeling and restore default Dropbox Sign branding</p>
          </div>`;

        // --- Live Preview ---
        const previewHtml = `
          <h3>Preview</h3>
          <div class="wl-preview-frame" data-preview="frame">
            <div class="wl-preview-header" data-preview="header">
              <div class="wl-preview-header-left">
                <span class="wl-preview-logo-img">&#9998;</span>
                <span class="wl-preview-header-title" data-preview="textColor2">Dropbox Sign</span>
              </div>
              <button class="wl-preview-btn-primary" data-preview="primaryBtn">Get started</button>
            </div>
            <div class="wl-preview-powered" data-preview="pageBg">
              <span class="wl-preview-text1" data-preview="textColor1" style="font-size:11px;">Powered by <strong>Dropbox Sign</strong></span>
            </div>
            <div class="wl-preview-body" data-preview="pageBg">
              <div class="wl-preview-doc-area">
                <div class="wl-preview-doc-line" style="width:55%;height:14px;margin:0 auto 18px;"></div>
                <div class="wl-preview-doc-line"></div>
                <div class="wl-preview-doc-line med"></div>
                <div class="wl-preview-doc-line"></div>
                <div class="wl-preview-doc-line short"></div>
                <div class="wl-preview-doc-line"></div>
                <div class="wl-preview-doc-line med"></div>
                <div class="wl-preview-sig-box">
                  <span class="wl-preview-link" data-preview="link">&#9998; Click to sign</span>
                </div>
                <div class="wl-preview-doc-line" style="margin-top:14px;"></div>
                <div class="wl-preview-doc-line short"></div>
              </div>
            </div>
            <div class="wl-preview-footer" data-preview="header">
              <button class="wl-preview-btn-secondary" data-preview="secondaryBtn">Decline</button>
              <span class="wl-preview-link" data-preview="link" style="font-size:12px;">More options</span>
            </div>
          </div>
        `;

        // --- Actions ---
        const actionsHtml = `
          <div class="app-detail-actions">
            <button class="app-detail-save-btn" data-action="save">Save Changes</button>
            <button class="app-detail-reset-btn" data-action="reset">Reset Colors</button>
          </div>
        `;

        panel.innerHTML = generalHtml + logoHtml + wlHtml + previewHtml + actionsHtml;
        td.innerHTML = '';
        td.appendChild(panel);

        // --- Live preview update function ---
        function updatePreview() {
          const getVal = (key) => {
            const ti = panel.querySelector(`input[data-wl-text="${key}"]`);
            const f = WL_FIELDS.find(f => f.key === key);
            return ti ? ti.value.trim() || f.default : f.default;
          };

          panel.querySelectorAll('[data-preview="header"]').forEach(el => {
            el.style.background = getVal('headerBackgroundColor');
          });

          panel.querySelectorAll('[data-preview="textColor2"]').forEach(el => {
            el.style.color = getVal('textColor2');
          });

          const pageBg = panel.querySelector('[data-preview="pageBg"]');
          if (pageBg) pageBg.style.background = getVal('pageBackgroundColor');

          panel.querySelectorAll('[data-preview="textColor1"]').forEach(el => {
            el.style.color = getVal('textColor1');
          });

          panel.querySelectorAll('[data-preview="link"]').forEach(el => {
            el.style.color = getVal('linkColor');
          });

          const primaryBtn = panel.querySelector('[data-preview="primaryBtn"]');
          if (primaryBtn) {
            primaryBtn.style.background = getVal('primaryButtonColor');
            primaryBtn.style.color = getVal('primaryButtonTextColor');
            primaryBtn.onmouseenter = () => {
              primaryBtn.style.background = getVal('primaryButtonColorHover');
              primaryBtn.style.color = getVal('primaryButtonTextColorHover');
            };
            primaryBtn.onmouseleave = () => {
              primaryBtn.style.background = getVal('primaryButtonColor');
              primaryBtn.style.color = getVal('primaryButtonTextColor');
            };
          }

          const secondaryBtn = panel.querySelector('[data-preview="secondaryBtn"]');
          if (secondaryBtn) {
            secondaryBtn.style.background = 'transparent';
            secondaryBtn.style.color = getVal('secondaryButtonTextColor');
            secondaryBtn.style.borderColor = getVal('secondaryButtonTextColor');
            secondaryBtn.onmouseenter = () => {
              secondaryBtn.style.background = getVal('secondaryButtonColorHover');
              secondaryBtn.style.color = getVal('secondaryButtonTextColorHover');
              secondaryBtn.style.borderColor = getVal('secondaryButtonTextColorHover');
            };
            secondaryBtn.onmouseleave = () => {
              secondaryBtn.style.background = 'transparent';
              secondaryBtn.style.color = getVal('secondaryButtonTextColor');
              secondaryBtn.style.borderColor = getVal('secondaryButtonTextColor');
            };
          }
        }

        // Wire color picker <-> text input sync + live preview
        panel.querySelectorAll('input[type="color"][data-wl]').forEach(colorInput => {
          const key = colorInput.dataset.wl;
          const textInput = panel.querySelector(`input[data-wl-text="${key}"]`);
          colorInput.addEventListener('input', () => { textInput.value = colorInput.value; updatePreview(); });
          textInput.addEventListener('input', () => {
            const v = textInput.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(v)) colorInput.value = v;
            updatePreview();
          });
        });

        // Initial preview render
        updatePreview();

        // Reset button — restore defaults + update preview
        panel.querySelector('[data-action="reset"]').addEventListener('click', () => {
          WL_FIELDS.forEach(f => {
            const ci = panel.querySelector(`input[data-wl="${f.key}"]`);
            const ti = panel.querySelector(`input[data-wl-text="${f.key}"]`);
            if (ci) ci.value = f.default;
            if (ti) ti.value = f.default;
          });
          updatePreview();
        });

        // Save button
        panel.querySelector('[data-action="save"]').addEventListener('click', async () => {
          const saveBtn = panel.querySelector('[data-action="save"]');
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving…';

          const formData = new FormData();
          const nameVal = panel.querySelector('[data-field="name"]').value.trim();
          const domainsVal = panel.querySelector('[data-field="domains"]').value.trim();
          const logoFile = panel.querySelector('[data-field="custom_logo_file"]').files[0];

          const canInsertEverywhere = panel.querySelector('[data-field="canInsertEverywhere"]')?.checked || false;
          const resetWhiteLabeling = panel.querySelector('[data-field="reset_white_labeling"]')?.checked || false;

          if (nameVal) formData.append('name', nameVal);
          // Note: callbackUrl is read-only - not sent to backend (we don't handle OAuth callbacks)
          formData.append('canInsertEverywhere', canInsertEverywhere ? '1' : '0');
          if (domainsVal) {
            formData.append('domains', JSON.stringify(domainsVal.split(',').map(d => d.trim()).filter(Boolean)));
          }

          // Collect white labeling options
          const wlOpts = {};
          if (resetWhiteLabeling) {
            // If reset is checked, send reset_to_default flag
            wlOpts.resetToDefault = true;
          } else {
            // Otherwise send color values
            WL_FIELDS.forEach(f => {
              const ti = panel.querySelector(`input[data-wl-text="${f.key}"]`);
              if (ti) wlOpts[f.key] = ti.value.trim() || f.default;
            });
          }
          formData.append('white_labeling_options', JSON.stringify(wlOpts));

          if (logoFile) formData.append('custom_logo_file', logoFile);

          try {
            const res = await fetchWithCsrf(`/api-apps/${clientId}`, { method: 'PUT', body: formData });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Update failed');

            saveBtn.textContent = 'Saved!';
            saveBtn.style.background = '#16a34a';

            // Show warnings if any
            if (data.warnings && data.warnings.length > 0) {
              showToast('⚠️ ' + data.warnings.join('\n'), 'warning');
            } else {
              showSuccessToast('App updated successfully');
            }

            // Invalidate apps cache and force refresh to show changes immediately
            appsLoaded = false;
            await loadAppsTab(true);

            setTimeout(() => {
              saveBtn.textContent = 'Save Changes';
              saveBtn.style.background = '';
              saveBtn.disabled = false;
            }, 1500);
          } catch (err) {
            console.error('Error updating app:', err);
            showErrorToast('Failed to update app: ' + err.message);
            saveBtn.textContent = 'Save Changes';
            saveBtn.style.background = '';
            saveBtn.disabled = false;
          }
        });
      })
      .catch(err => {
        const message = err.message.includes("don't have permission")
          ? `<p style="color:#64748b;font-style:italic;">You can view basic information for this app in the table above, but only the app owner can view and edit detailed settings.</p>`
          : `<p style="color:#dc2626;">Failed to load app details: ${err.message}</p>`;
        td.innerHTML = `<div class="app-detail-panel">${message}</div>`;
      });
  }

  function loadAppsTab(force) {
    const tbody = document.getElementById('appsBody');
    const table = document.getElementById('appsTable');
    const loading = document.getElementById('appsLoading');
    const errorEl = document.getElementById('appsError');

    // Check if onboarding just created apps - force refresh once
    if (sessionStorage.getItem('onboarding_apps_created') === 'true') {
      force = true;
      sessionStorage.removeItem('onboarding_apps_created');
      console.log('[ONBOARDING] Force refreshing API apps after onboarding');
    }

    loading.style.display = 'block';
    loading.textContent = 'Loading API apps...';
    errorEl.style.display = 'none';
    table.style.display = 'none';

    loadAppsOnce(force)
      .then(async apps => {
        loading.style.display = 'none';
        tbody.innerHTML = '';
        appCheckboxes = [];
        appTestModeCheckboxes = [];
        appWebhookCheckboxes = [];

        // Get current user's email for ownership checking
        let currentUserEmail = '';
        try {
          const authRes = await fetchWithCsrf('/auth/status');
          const authData = await authRes.json();
          currentUserEmail = authData.email?.toLowerCase() || '';
        } catch (err) {
          console.warn('Failed to fetch current user email:', err);
        }

        if (apps.length === 0) {
          loading.textContent = 'No API apps found.';
          loading.style.display = 'block';
          return;
        }

        apps.forEach(app => {
          const tr = document.createElement('tr');

          // Expand button (first column)
          const tdExpand = document.createElement('td');
          const expandBtn = document.createElement('button');
          expandBtn.className = 'app-expand-btn';
          expandBtn.innerHTML = '&#9654;'; // ▶
          expandBtn.title = 'Edit app details';

          // Create the expandable detail row (hidden by default)
          const detailRow = document.createElement('tr');
          detailRow.className = 'app-detail-row';
          detailRow.style.display = 'none';
          const detailTd = document.createElement('td');
          detailTd.colSpan = 12; // Updated to 12 for Delete column
          detailRow.appendChild(detailTd);

          let detailLoaded = false;

          expandBtn.addEventListener('click', () => {
            const isOpen = detailRow.style.display !== 'none';
            if (isOpen) {
              detailRow.style.display = 'none';
              expandBtn.classList.remove('open');
            } else {
              detailRow.style.display = '';
              expandBtn.classList.add('open');
              if (!detailLoaded) {
                detailLoaded = true;
                buildAppDetailPanel(app.clientId, detailRow);
              }
            }
          });

          tdExpand.appendChild(expandBtn);
          tr.appendChild(tdExpand);

          // Check if user owns this app (need this early for visibility checkbox)
          const ownerEmail = app.owner?.toLowerCase() || '';
          const userOwnsApp = currentUserEmail && ownerEmail && currentUserEmail === ownerEmail;

          const tdCheck = document.createElement('td');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = app.visible !== false;
          checkbox.style.width = '18px';
          checkbox.style.height = '18px';
          checkbox.setAttribute('data-tooltip', 'visibleCheckbox');

          // Disable visibility checkbox for unowned apps
          if (!userOwnsApp && ownerEmail !== '—') {
            checkbox.disabled = true;
            checkbox.style.cursor = 'not-allowed';
            checkbox.style.opacity = '0.5';
            checkbox.title = `You cannot show apps you don't own in the dropdown (owned by: ${app.owner})`;
          } else {
            checkbox.style.cursor = 'pointer';
            checkbox.title = 'Show this app in the dropdown';
          }

          appCheckboxes.push({ clientId: app.clientId, checkbox });
          tdCheck.appendChild(checkbox);
          tr.appendChild(tdCheck);

          const tdTest = document.createElement('td');
          const testCheckbox = document.createElement('input');
          testCheckbox.type = 'checkbox';
          testCheckbox.setAttribute('data-tooltip', 'testMode');
          testCheckbox.checked = app.testMode === true;
          console.log(`[RENDER] App ${app.clientId} (${app.name}): testMode = ${app.testMode}, checked = ${testCheckbox.checked}`);
          testCheckbox.style.width = '18px';
          testCheckbox.style.height = '18px';

          // Disable test mode checkbox for unowned apps
          if (!userOwnsApp && ownerEmail !== '—') {
            testCheckbox.disabled = true;
            testCheckbox.style.cursor = 'not-allowed';
            testCheckbox.style.opacity = '0.5';
            testCheckbox.title = `You cannot modify test mode for apps you don't own (owned by: ${app.owner})`;
          } else {
            testCheckbox.style.cursor = 'pointer';
            testCheckbox.title = 'Enable test mode for this app';
          }

          appTestModeCheckboxes.push({ clientId: app.clientId, checkbox: testCheckbox });
          tdTest.appendChild(testCheckbox);
          tr.appendChild(tdTest);

          const tdWebhookEnabled = document.createElement('td');
          const webhookCheckbox = document.createElement('input');
          webhookCheckbox.type = 'checkbox';
          webhookCheckbox.setAttribute('data-tooltip', 'enableCallbacks');

          // Webhook enabled checkbox - controls whether this app receives webhook callbacks
          webhookCheckbox.checked = app.webhookEnabled !== false;

          if (!userOwnsApp && ownerEmail !== '—') {
            // User doesn't own this app - disable the checkbox
            webhookCheckbox.disabled = true;
            webhookCheckbox.style.cursor = 'not-allowed';
            webhookCheckbox.style.opacity = '0.5';
            webhookCheckbox.title = `You cannot modify callback settings for apps you don't own (owned by: ${app.owner})`;
          } else {
            webhookCheckbox.style.cursor = 'pointer';
            webhookCheckbox.title = 'Enable webhook callbacks for this API app';
          }

          webhookCheckbox.style.width = '18px';
          webhookCheckbox.style.height = '18px';
          appWebhookCheckboxes.push({ clientId: app.clientId, checkbox: webhookCheckbox, owned: userOwnsApp });
          tdWebhookEnabled.appendChild(webhookCheckbox);
          tr.appendChild(tdWebhookEnabled);

          // Delete checkbox
          const tdDelete = document.createElement('td');
          const deleteCheckbox = document.createElement('input');
          deleteCheckbox.type = 'checkbox';
          deleteCheckbox.checked = false;
          deleteCheckbox.style.width = '18px';
          deleteCheckbox.style.height = '18px';
          deleteCheckbox.dataset.clientId = app.clientId;
          deleteCheckbox.dataset.appName = app.name;
          deleteCheckbox.className = 'delete-app-checkbox';

          // Only allow deleting apps the user owns
          if (!userOwnsApp && ownerEmail !== '—') {
            deleteCheckbox.disabled = true;
            deleteCheckbox.style.cursor = 'not-allowed';
            deleteCheckbox.style.opacity = '0.3';
            deleteCheckbox.title = `You cannot delete apps you don't own (owned by: ${app.owner})`;
          } else {
            deleteCheckbox.style.cursor = 'pointer';
            deleteCheckbox.title = 'Select this app for deletion';
            // Update delete button state when checkbox changes
            deleteCheckbox.addEventListener('change', updateDeleteButtonState);
          }

          tdDelete.appendChild(deleteCheckbox);
          tr.appendChild(tdDelete);

          const tdName = document.createElement('td');
          tdName.textContent = app.name;
          tr.appendChild(tdName);

          const tdId = document.createElement('td');
          tdId.style.fontFamily = "'Courier New', monospace";
          tdId.style.fontSize = '12px';
          tdId.style.color = '#64748b';
          tdId.textContent = app.clientId;
          tr.appendChild(tdId);

          const tdOwner = document.createElement('td');
          tdOwner.textContent = app.owner || '—';
          tdOwner.style.fontSize = '12px';
          tdOwner.style.color = '#64748b';
          tr.appendChild(tdOwner);

          const tdDomains = document.createElement('td');
          tdDomains.textContent = app.domains || '—';
          tdDomains.style.fontSize = '12px';
          tdDomains.style.color = '#64748b';
          tr.appendChild(tdDomains);

          const tdWebhook = document.createElement('td');
          // Always show callback URL (webhookEnabled controls whether callbacks are processed, not displayed)
          tdWebhook.textContent = app.callbackUrl || '(not set)';
          tdWebhook.style.fontSize = '12px';
          tdWebhook.style.color = app.callbackUrl ? '#1e293b' : '#94a3b8';
          tdWebhook.style.fontStyle = app.callbackUrl ? 'normal' : 'italic';
          tr.appendChild(tdWebhook);

          const tdStatus = document.createElement('td');
          const statusBadges = [];

          if (app.isApproved) {
            statusBadges.push('<span style="display: inline-block; background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">Approved</span>');
          } else {
            statusBadges.push('<span style="display: inline-block; background: #fef9c3; color: #854d0e; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">Not Approved</span>');
          }

          if (app.hasWhiteLabeling) {
            statusBadges.push('<span style="display: inline-block; background: #e0e7ff; color: #4338ca; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 4px;" title="Dropbox Sign branding hidden">🎨 White Label</span>');
          }

          tdStatus.innerHTML = statusBadges.join(' ');
          tr.appendChild(tdStatus);

          const tdScopes = document.createElement('td');
          tdScopes.style.position = 'relative';

          if (app.oauthScopes && app.oauthScopes.length > 0) {
            const scopeCount = app.oauthScopes.length;
            const scopeLabel = document.createElement('span');
            scopeLabel.style.cssText = 'display: inline-block; background: #e0e7ff; color: #3730a3; padding: 4px 10px; border-radius: 4px; font-size: 12px; cursor: help; font-weight: 500;';
            scopeLabel.textContent = `${scopeCount} permission${scopeCount > 1 ? 's' : ''}`;

            // Create tooltip content
            const tooltip = document.createElement('div');
            tooltip.style.cssText = 'position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: #1e293b; color: white; padding: 8px 12px; border-radius: 6px; font-size: 11px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.2s; z-index: 1000; margin-bottom: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);';
            tooltip.innerHTML = app.oauthScopes.map(scope => `• ${scope}`).join('<br>');

            // Add arrow
            const arrow = document.createElement('div');
            arrow.style.cssText = 'position: absolute; top: 100%; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 6px solid #1e293b;';
            tooltip.appendChild(arrow);

            // Show/hide tooltip on hover
            scopeLabel.addEventListener('mouseenter', () => {
              tooltip.style.opacity = '1';
            });
            scopeLabel.addEventListener('mouseleave', () => {
              tooltip.style.opacity = '0';
            });

            tdScopes.appendChild(scopeLabel);
            tdScopes.appendChild(tooltip);
          } else {
            tdScopes.textContent = 'No OAuth';
            tdScopes.style.fontSize = '12px';
            tdScopes.style.color = '#94a3b8';
            tdScopes.style.fontStyle = 'italic';
          }
          tr.appendChild(tdScopes);

          tbody.appendChild(tr);
          tbody.appendChild(detailRow);
        });

        table.style.display = 'table';
      })
      .catch(err => {
        loading.style.display = 'none';
        errorEl.textContent = 'Failed to load API apps.';
        errorEl.style.display = 'block';
        console.error('Error fetching API apps:', err);
      });
  }

  function loadApiLogs() {
    const container = document.getElementById('logsContainer');
    const loading = document.getElementById('logsLoading');
    const errorEl = document.getElementById('logsError');

    loading.style.display = 'block';
    loading.textContent = 'Loading API logs...';
    errorEl.style.display = 'none';
    container.style.display = 'none';

    fetchWithCsrf('/api-logs')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(logs => {
        loading.style.display = 'none';

        if (logs.length === 0) {
          container.innerHTML = '';
          loading.textContent = 'No API logs yet. Make some API calls first.';
          loading.style.display = 'block';
          return;
        }

        renderLogCards(container, logs);
        container.style.display = 'block';

        // Also refresh side panel if visible
        if (showLogsOnAllScreens && showLogsOnAllScreens.checked) {
          renderLogCards(document.getElementById('sidePanelLogsContainer'), logs);
        }
      })
      .catch(err => {
        loading.style.display = 'none';
        errorEl.textContent = 'Failed to load API logs.';
        errorEl.style.display = 'block';
        console.error('Error fetching API logs:', err);
      });
  }

  // Expose functions needed by onboarding flow
  window.refreshApiAppsDropdown = function() {
    return loadAppsOnce(true).then(() => populateAppDropdown());
  };
});

// ============================
// THEME MANAGEMENT (Tab 7)
// ============================
document.addEventListener('DOMContentLoaded', function() {
  const refreshThemesBtn = document.getElementById('refreshThemesBtn');
  const themesBody = document.getElementById('themesBody');
  const themesLoading = document.getElementById('themesLoading');
  const themesError = document.getElementById('themesError');
  const themesTable = document.getElementById('themesTable');

  let allThemes = {};
  let templateLabels = {};

  if (refreshThemesBtn) {
    refreshThemesBtn.addEventListener('click', () => loadThemes(true));
  }

  // Load themes when Settings tab is shown
  document.querySelector('[data-tab="tab-settings"]')?.addEventListener('click', () => {
    console.log('[Settings Tab] Clicked - allThemes count:', Object.keys(allThemes).length);
    try {
      // Verify Settings tab content is present
      const settingsPanel = document.getElementById('tab-settings');
      const generalSubTab = document.getElementById('subtab-settings-general');
      const themesBody = document.getElementById('themesBody');
      console.log('[Settings Tab] DOM check:', {
        panel: !!settingsPanel,
        generalTab: !!generalSubTab,
        themesBody: !!themesBody,
        themesBodyVisible: themesBody ? window.getComputedStyle(themesBody.parentElement.parentElement).display : 'N/A'
      });

      if (!settingsPanel || !generalSubTab) {
        console.error('[Settings] Settings tab content missing!', {
          panel: !!settingsPanel,
          generalTab: !!generalSubTab
        });
      }

      if (Object.keys(allThemes).length === 0) {
        console.log('[Settings Tab] Themes empty, loading...');
        loadThemes();
      } else {
        console.log('[Settings Tab] Themes already loaded, re-rendering...');
        renderThemes();
      }

      // Ensure a sub-tab is active (default to General if none active)
      const activeSubTab = document.querySelector('#tab-settings .editor-sub-panel.active');
      if (!activeSubTab) {
        console.warn('[Settings Tab] No active sub-tab found, activating General');
        // Manually activate General sub-tab
        const subTabs = document.querySelectorAll('#tab-settings .editor-sub-tab');
        const subPanels = document.querySelectorAll('#tab-settings .editor-sub-panel');
        subTabs.forEach(t => t.classList.toggle('active', t.dataset.subtab === 'subtab-settings-general'));
        subPanels.forEach(p => p.classList.toggle('active', p.id === 'subtab-settings-general'));
      }
    } catch (err) {
      console.error('[Settings] Error loading settings tab:', err);
    }
  });

  async function loadThemes(force = false) {
    console.log('[loadThemes] Starting themes load, force:', force);
    themesLoading.style.display = 'block';
    themesError.style.display = 'none';
    themesTable.style.display = 'none';

    try {
      // Fetch themes and template labels in parallel
      console.log('[loadThemes] Fetching themes and templates...');
      const [themesResp, templatesResp] = await Promise.all([
        fetchWithCsrf('/themes'),
        fetchWithCsrf('/api-templates?limit=1000')
      ]);

      console.log('[loadThemes] Responses received, themes status:', themesResp.status, 'templates status:', templatesResp.status);

      if (!themesResp.ok) {
        throw new Error(`Themes fetch failed: ${themesResp.status}`);
      }
      if (!templatesResp.ok) {
        throw new Error(`Templates fetch failed: ${templatesResp.status}`);
      }

      allThemes = await themesResp.json();
      const templates = await templatesResp.json();

      console.log('[loadThemes] Parsed data, themes count:', Object.keys(allThemes).length, 'templates count:', templates.length);

      // Build template labels map
      templateLabels = {};
      templates.forEach(t => {
        if (t.labels && t.labels.length > 0) {
          t.labels.forEach(label => {
            if (!templateLabels[label]) templateLabels[label] = [];
            templateLabels[label].push({
              id: t.id,
              title: t.title
            });
          });
        }
      });

      console.log('[loadThemes] Rendering themes...');
      renderThemes();
      console.log('[loadThemes] Themes rendered successfully');
      themesLoading.style.display = 'none';
      themesTable.style.display = 'table';
    } catch (error) {
      console.error('[loadThemes] Error loading themes:', error);
      themesLoading.style.display = 'none';
      themesError.textContent = `Failed to load themes: ${error.message}`;
      themesError.style.display = 'block';
    }
  }

  function buildThemeDetailPanel(themeId, detailRow) {
    const td = detailRow.querySelector('td');
    const theme = allThemes[themeId];
    const attachedTemplates = templateLabels[themeId] || [];

    const panel = document.createElement('div');
    panel.className = 'app-detail-panel';
    panel.dataset.themeId = themeId;

    // Helper to escape HTML
    const escape = (str) => (str || '').replace(/"/g, '&quot;');

    // Basic Information Section (minimal)
    const basicHtml = `
      <div style="background:#f8fafc; padding:12px; border-radius:6px; margin-bottom:16px;">
        <h3 style="margin:0 0 10px 0; font-size:14px; color:#1a1a1a; font-weight:600;">Basic Information</h3>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div>
            <label style="display:block; font-weight:500; margin-bottom:4px; font-size:13px; color:#64748b;">Theme ID</label>
            <input type="text" value="${themeId}" disabled style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:4px; background:#f1f5f9; cursor:not-allowed; font-size:14px;" />
          </div>
          <div>
            <label style="display:block; font-weight:500; margin-bottom:4px; font-size:13px; color:#64748b;">Theme Name</label>
            <input type="text" class="theme-basic-field" data-basic-field="name" value="${escape(theme.name)}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:4px; font-size:14px;" />
          </div>
          <div>
            <label style="display:block; font-weight:500; margin-bottom:4px; font-size:13px; color:#64748b;">Page Title</label>
            <input type="text" class="theme-basic-field" data-basic-field="pageTitle" value="${escape(theme.pageTitle)}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:4px; font-size:14px;" />
          </div>
          <div>
            <label style="display:block; font-weight:500; margin-bottom:4px; font-size:13px; color:#64748b;">Tab Label</label>
            <input type="text" class="theme-basic-field" data-basic-field="tabLabel" value="${escape(theme.tabLabel)}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:4px; font-size:14px;" />
          </div>
          <!-- HIDDEN: Document Template field - Legacy field for referencing external document templates.
               Currently hidden pending review as most themes now use embedded documentContent instead.
               May be removed in future release if not needed.
          <div style="grid-column: 1 / -1;">
            <label style="display:block; font-weight:500; margin-bottom:4px; font-size:13px; color:#64748b;">Document Template</label>
            <input type="text" class="theme-basic-field" data-basic-field="documentTemplate" value="${escape(theme.documentTemplate)}" placeholder="e.g., selling-mandate" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:4px; font-size:14px;" />
          </div>
          -->
        </div>
      </div>
    `;

    // Visual Preview Section (like home page)
    const leftFields = theme.sections?.left?.fields || [];
    const rightFields = theme.sections?.right?.fields || [];

    const visualPreviewHtml = `
      <h3 style="margin:0 0 8px 0; font-size:14px; color:#1a1a1a; font-weight:600;">
        Form Preview
        <span style="font-weight:normal; font-size:12px; color:#64748b;">— Click any label or field to edit ✏️</span>
      </h3>
      <div style="border:2px solid #e2e8f0; border-radius:6px; padding:16px; background:white; margin-bottom:16px; box-sizing:border-box;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
          <!-- Left Pane -->
          <div style="border:1px solid #e2e8f0; border-radius:6px; padding:16px; background:#fafbfc; box-sizing:border-box;">
            <h4 contenteditable="true" data-theme-field="sections.left.title" style="margin:0 0 12px 0; font-size:16px; cursor:text; padding:6px; border-radius:4px; font-weight:600;" spellcheck="false">${escape(theme.sections?.left?.title)}</h4>

            <!-- Name and Email on same row -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
              <div>
                <label contenteditable="true" data-theme-field="sections.left.fields[0].label" style="display:block; font-weight:500; margin-bottom:6px; cursor:text; padding:4px; border-radius:3px; font-size:14px;" spellcheck="false">${escape(leftFields[0]?.label)}</label>
                <input type="text" data-theme-field="sections.left.fields[0].defaultValue" value="${escape(leftFields[0]?.defaultValue)}" placeholder="Click to edit..." style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:4px; cursor:text; font-size:15px; box-sizing:border-box;">
              </div>
              <div>
                <label contenteditable="true" data-theme-field="sections.left.fields[1].label" style="display:block; font-weight:500; margin-bottom:6px; cursor:text; padding:4px; border-radius:3px; font-size:14px;" spellcheck="false">${escape(leftFields[1]?.label)}</label>
                <input type="email" data-theme-field="sections.left.fields[1].defaultValue" data-is-email="true" value="${escape(leftFields[1]?.defaultValue)}" placeholder="Click to edit..." style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:4px; cursor:text; font-size:15px; box-sizing:border-box;">
              </div>
            </div>

            ${theme.sections?.left?.secondSigner ? `
              <div style="border-top:1px dashed #cbd5e1; padding-top:12px; margin-top:12px;">
                <div style="font-size:12px; color:#64748b; margin-bottom:8px; font-weight:600;">Second Signer (Optional)</div>

                <!-- Second signer: Name and Email on same row -->
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                  <div>
                    <label contenteditable="true" data-theme-field="sections.left.fields[2].label" style="display:block; font-weight:500; margin-bottom:6px; cursor:text; padding:4px; border-radius:3px; font-size:14px;" spellcheck="false">${escape(leftFields[2]?.label || 'Name')}</label>
                    <input type="text" data-theme-field="sections.left.secondSigner.name" value="${escape(theme.sections.left.secondSigner.name)}" placeholder="Click to edit..." style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:4px; font-size:15px; cursor:text; box-sizing:border-box;">
                  </div>
                  <div>
                    <label contenteditable="true" data-theme-field="sections.left.fields[3].label" style="display:block; font-weight:500; margin-bottom:6px; cursor:text; padding:4px; border-radius:3px; font-size:14px;" spellcheck="false">${escape(leftFields[3]?.label || 'Email')}</label>
                    <input type="email" data-theme-field="sections.left.secondSigner.email" data-is-email="true" value="${escape(theme.sections.left.secondSigner.email)}" placeholder="Click to edit..." style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:4px; font-size:15px; cursor:text; box-sizing:border-box;">
                  </div>
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Right Pane -->
          <div style="border:1px solid #e2e8f0; border-radius:6px; padding:16px; background:#fafbfc; box-sizing:border-box;">
            <h4 contenteditable="true" data-theme-field="sections.right.title" style="margin:0 0 12px 0; font-size:16px; cursor:text; padding:6px; border-radius:4px; font-weight:600;" spellcheck="false">${escape(theme.sections?.right?.title)}</h4>
            ${rightFields.map((field, idx) => `
              <div style="margin-bottom:12px;">
                <label contenteditable="true" data-theme-field="sections.right.fields[${idx}].label" style="display:block; font-weight:500; margin-bottom:6px; cursor:text; padding:4px; border-radius:3px; font-size:14px;" spellcheck="false">${escape(field.label)}</label>
                <input type="text" data-theme-field="sections.right.fields[${idx}].defaultValue" value="${escape(field.defaultValue)}" placeholder="Click to edit default value..." style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:4px; cursor:text; font-size:15px; box-sizing:border-box;">
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    // Attached Templates Info
    // Attached Templates Info
    let templatesInfoHtml = '';
    if (attachedTemplates.length > 0) {
      const templatesList = attachedTemplates.map(t =>
        `<li style="margin-bottom:4px;">${t.title} <code style="font-size:11px; color:#64748b;">${t.id}</code></li>`
      ).join('');
      templatesInfoHtml = `
        <h3 style="margin:16px 0 8px 0; font-size:14px; color:#1a1a1a; font-weight:600;">Attached Templates</h3>
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:12px; margin-bottom:16px;">
          <p style="margin:0 0 8px; font-size:13px; color:#16a34a; font-weight:500;">${attachedTemplates.length} template(s) attached to this theme:</p>
          <ul style="margin:0; padding-left:20px; font-size:13px; color:#166534;">${templatesList}</ul>
        </div>
      `;
    }

    // Actions
    const actionsHtml = `
      <div class="app-detail-actions" style="justify-content:flex-end; margin-top:16px;">
        <div style="display:flex; gap:8px;">
          <button class="theme-delete-btn" data-theme-id="${themeId}" style="padding:10px 20px; border-radius:6px; border:1px solid #dc2626; background:white; color:#dc2626; cursor:pointer; font-weight:500;">Delete Theme</button>
          <button class="theme-save-as-btn" data-theme-id="${themeId}" style="padding:10px 20px; border-radius:6px; border:1px solid #16a34a; background:white; color:#16a34a; cursor:pointer; font-weight:500;">Save As...</button>
          <button class="theme-save-btn" data-theme-id="${themeId}" style="padding:10px 20px; border-radius:6px; border:none; background:#16a34a; color:white; cursor:pointer; font-weight:500;">Save Changes</button>
        </div>
      </div>
    `;

    panel.innerHTML = basicHtml + visualPreviewHtml + templatesInfoHtml + actionsHtml;
    td.innerHTML = '';
    td.appendChild(panel);

    // Add contenteditable interaction for all fields
    panel.querySelectorAll('[contenteditable="true"]').forEach(el => {
      // Add visual indicator on hover
      el.style.cursor = 'text';
      el.style.transition = 'background-color 0.2s';

      el.addEventListener('mouseenter', function() {
        this.style.backgroundColor = '#eff6ff';
      });

      el.addEventListener('mouseleave', function() {
        if (!this.matches(':focus')) {
          this.style.backgroundColor = '';
        }
      });

      // Visual feedback on focus
      el.addEventListener('focus', function() {
        this.style.backgroundColor = '#dbeafe';
        this.style.outline = '2px solid #3b82f6';
        this.style.outlineOffset = '2px';
      });

      el.addEventListener('blur', function() {
        this.style.backgroundColor = '';
        this.style.outline = '';
        this.style.outlineOffset = '';
      });

      // Prevent Enter from adding newlines (for single-line fields)
      el.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.blur();
        }
      });
    });

    // Make input fields also visually interactive with email validation
    panel.querySelectorAll('input[data-theme-field]').forEach(input => {
      input.style.cursor = 'text';

      input.addEventListener('focus', function() {
        this.style.outline = '2px solid #3b82f6';
        this.style.outlineOffset = '2px';
      });

      input.addEventListener('blur', function() {
        this.style.outline = '';
        this.style.outlineOffset = '';

        // Validate email fields
        if (this.hasAttribute('data-is-email') && this.value.trim()) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(this.value.trim())) {
            this.style.borderColor = '#dc2626';
            this.style.outline = '2px solid #dc2626';
            this.style.outlineOffset = '2px';

            // Show error message
            const errorMsg = document.createElement('div');
            errorMsg.textContent = 'Invalid email format';
            errorMsg.style.cssText = 'color:#dc2626; font-size:12px; margin-top:4px; font-weight:500;';
            errorMsg.className = 'email-error-msg';

            // Remove any existing error message
            const existingError = this.parentElement.querySelector('.email-error-msg');
            if (existingError) existingError.remove();

            this.parentElement.appendChild(errorMsg);

            // Focus back on the field
            setTimeout(() => this.focus(), 100);
          } else {
            // Valid email - remove error styling
            this.style.borderColor = '#cbd5e1';
            const existingError = this.parentElement.querySelector('.email-error-msg');
            if (existingError) existingError.remove();
          }
        }
      });

      // Remove error styling when user starts typing
      input.addEventListener('input', function() {
        if (this.hasAttribute('data-is-email')) {
          this.style.borderColor = '#cbd5e1';
          this.style.outline = '2px solid #3b82f6';
          const existingError = this.parentElement.querySelector('.email-error-msg');
          if (existingError) existingError.remove();
        }
      });
    });

    // Helper function to set nested property
    function setNestedThemeProperty(obj, path, value) {
      // Handle array notation like "sections.left.fields[0].label"
      const arrayRegex = /^(.*?)\[(\d+)\](.*)$/;
      const match = path.match(/^(.*?)(\[.+)$/);

      if (match) {
        const [, basePath, arrayPart] = match;
        const parts = basePath.split('.').filter(p => p);
        let current = obj;

        // Navigate to the base
        for (const part of parts) {
          if (!current[part]) current[part] = {};
          current = current[part];
        }

        // Handle array indices
        const arrayMatches = arrayPart.matchAll(/\[(\d+)\](?:\.(\w+))?/g);
        for (const m of arrayMatches) {
          const idx = parseInt(m[1]);
          const prop = m[2];

          if (prop) {
            if (!Array.isArray(current)) current = [];
            if (!current[idx]) current[idx] = {};
            if (arrayPart.indexOf(`[${idx}].${prop}`) === arrayPart.lastIndexOf(`[${idx}].${prop}`)) {
              // Last property
              current[idx][prop] = value;
            } else {
              current = current[idx];
            }
          }
        }
      } else {
        const parts = path.split('.');
        let current = obj;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!current[parts[i]]) current[parts[i]] = {};
          current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;
      }
    }

    // Wire up Save button
    panel.querySelector('.theme-save-btn').addEventListener('click', async () => {
      const saveBtn = panel.querySelector('.theme-save-btn');

      // Validate all email fields before saving
      const emailInputs = panel.querySelectorAll('input[data-is-email]');
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      let hasInvalidEmail = false;

      emailInputs.forEach(input => {
        if (input.value.trim() && !emailRegex.test(input.value.trim())) {
          hasInvalidEmail = true;
          input.style.borderColor = '#dc2626';
          input.style.outline = '2px solid #dc2626';
          input.style.outlineOffset = '2px';

          // Show error message
          const errorMsg = document.createElement('div');
          errorMsg.textContent = 'Invalid email format';
          errorMsg.style.cssText = 'color:#dc2626; font-size:12px; margin-top:4px; font-weight:500;';
          errorMsg.className = 'email-error-msg';

          const existingError = input.parentElement.querySelector('.email-error-msg');
          if (existingError) existingError.remove();
          input.parentElement.appendChild(errorMsg);
        }
      });

      if (hasInvalidEmail) {
        alert('Please fix invalid email addresses before saving.');
        return;
      }

      saveBtn.textContent = 'Saving...';
      saveBtn.disabled = true;

      try {
        const updatedTheme = JSON.parse(JSON.stringify(theme)); // Deep clone

        // Collect basic fields
        panel.querySelectorAll('.theme-basic-field').forEach(input => {
          const field = input.dataset.basicField;
          updatedTheme[field] = input.value.trim();
        });

        // Collect contenteditable theme fields
        panel.querySelectorAll('[data-theme-field]').forEach(el => {
          const path = el.dataset.themeField;
          let value;

          if (el.tagName === 'INPUT') {
            value = el.value;
          } else if (el.hasAttribute('contenteditable')) {
            value = el.textContent;
          }

          setNestedThemeProperty(updatedTheme, path, value);
        });

        const response = await fetchWithCsrf(`/themes/${themeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedTheme)
        });

        if (!response.ok) throw new Error('Failed to save theme');

        allThemes[themeId] = updatedTheme;
        saveBtn.textContent = 'Saved!';
        saveBtn.style.background = '#16a34a';
        setTimeout(() => {
          saveBtn.textContent = 'Save Changes';
          saveBtn.disabled = false;
          loadThemes(true);
        }, 1500);
      } catch (error) {
        console.error('Error saving theme:', error);
        saveBtn.textContent = 'Save Failed';
        saveBtn.style.background = '#dc2626';
        setTimeout(() => {
          saveBtn.textContent = 'Save Changes';
          saveBtn.style.background = '#16a34a';
          saveBtn.disabled = false;
        }, 2000);
      }
    });

    // Wire up Save As button
    panel.querySelector('.theme-save-as-btn').addEventListener('click', async () => {
      const newThemeId = prompt('Enter a new Theme ID for the copy (letters, numbers, dashes, underscores):');

      if (!newThemeId || !newThemeId.trim()) {
        return; // User cancelled or entered empty ID
      }

      // Validate theme ID format
      if (!/^[a-zA-Z0-9_-]+$/.test(newThemeId)) {
        alert('Invalid Theme ID. Use only letters, numbers, dashes, and underscores.');
        return;
      }

      // Check if theme ID already exists
      if (allThemes[newThemeId]) {
        alert(`Theme ID "${newThemeId}" already exists. Please choose a different ID.`);
        return;
      }

      const saveAsBtn = panel.querySelector('.theme-save-as-btn');
      saveAsBtn.textContent = 'Copying...';
      saveAsBtn.disabled = true;

      try {
        // Collect current field values (in case user made unsaved changes)
        const copiedTheme = { ...theme };

        // Collect basic fields
        panel.querySelectorAll('[data-field]').forEach(input => {
          const field = input.dataset.field;
          const parts = field.split('.');
          let current = copiedTheme;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]]) current[parts[i]] = {};
            current = current[parts[i]];
          }
          current[parts[parts.length - 1]] = input.value;
        });

        // Collect left section fields
        panel.querySelectorAll('[data-left-field]').forEach(input => {
          const idx = parseInt(input.dataset.leftField, 10);
          const prop = input.dataset.prop;
          if (!copiedTheme.sections) copiedTheme.sections = {};
          if (!copiedTheme.sections.left) copiedTheme.sections.left = {};
          if (!copiedTheme.sections.left.fields) copiedTheme.sections.left.fields = [];
          if (!copiedTheme.sections.left.fields[idx]) copiedTheme.sections.left.fields[idx] = {};
          copiedTheme.sections.left.fields[idx][prop] = input.value;
        });

        // Collect right section fields
        panel.querySelectorAll('[data-right-field]').forEach(input => {
          const idx = parseInt(input.dataset.rightField, 10);
          const prop = input.dataset.prop;
          if (!copiedTheme.sections) copiedTheme.sections = {};
          if (!copiedTheme.sections.right) copiedTheme.sections.right = {};
          if (!copiedTheme.sections.right.fields) copiedTheme.sections.right.fields = [];
          if (!copiedTheme.sections.right.fields[idx]) copiedTheme.sections.right.fields[idx] = {};
          copiedTheme.sections.right.fields[idx][prop] = input.value;
        });

        // Update theme name to indicate it's a copy
        copiedTheme.name = `${copiedTheme.name} (Copy)`;

        // Save the copied theme with the new ID
        const response = await fetchWithCsrf(`/themes/${newThemeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(copiedTheme)
        });

        if (!response.ok) throw new Error('Failed to save theme copy');

        allThemes[newThemeId] = copiedTheme;
        saveAsBtn.textContent = 'Copied!';
        saveAsBtn.style.background = '#16a34a';
        saveAsBtn.style.color = 'white';

        setTimeout(() => {
          loadThemes(true);
          showToast(`Theme copied successfully as "${newThemeId}"`, 'success');
        }, 1000);
      } catch (error) {
        console.error('Error copying theme:', error);
        alert('Failed to copy theme. Please try again.');
        saveAsBtn.textContent = 'Save As...';
        saveAsBtn.disabled = false;
      }
    });

    // Wire up Delete button
    panel.querySelector('.theme-delete-btn').addEventListener('click', async () => {
      const attachedTemplates = templateLabels[themeId] || [];

      // First confirmation: Delete the theme?
      const confirmDelete = confirm(`Are you sure you want to delete the theme "${theme.name || themeId}"?\n\nThis action cannot be undone.`);

      if (!confirmDelete) {
        return; // User cancelled
      }

      // If theme has attached templates, ask if they want to delete those too
      let deleteTemplates = false;
      if (attachedTemplates.length > 0) {
        const templatesList = attachedTemplates.map(t => `  • ${t.title}`).join('\n');
        deleteTemplates = confirm(
          `This theme has ${attachedTemplates.length} attached template(s):\n\n${templatesList}\n\n` +
          `Do you want to also DELETE these templates from Dropbox Sign?\n\n` +
          `Click OK to delete templates.\n` +
          `Click Cancel to keep templates (only theme will be deleted).`
        );
      }

      await deleteThemeWithTemplates(themeId, deleteTemplates);
    });
  }

  async function deleteThemeWithTemplates(themeId, deleteTemplates) {
    try {
      const response = await fetchWithCsrf(`/themes/${themeId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteTemplates })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Delete theme failed:', response.status, errorData);
        throw new Error(errorData.error || `Server returned ${response.status}`);
      }

      const result = await response.json();
      console.log('Delete theme result:', result);

      let message = 'Theme deleted successfully!';
      if (result.deletedTemplates && result.deletedTemplates.length > 0) {
        message += `\n\n${result.deletedTemplates.length} template(s) also deleted from Dropbox Sign.`;
      } else if (result.removedLabels && result.removedLabels.length > 0) {
        message += `\n\n${result.removedLabels.length} template(s) kept (labels removed from theme).`;
      }
      showToast(message, 'success');
      loadThemes(true);
    } catch (error) {
      console.error('Error deleting theme:', error);
      alert('Failed to delete theme: ' + error.message);
      // Reload themes anyway in case deletion actually worked
      loadThemes(true);
    }
  }

  function renderThemes() {
    console.log('[renderThemes] Starting render, themesBody exists:', !!themesBody, 'allThemes count:', Object.keys(allThemes).length);

    if (!themesBody) {
      console.error('[renderThemes] themesBody element not found!');
      return;
    }

    // Check Settings sub-tabs visibility
    const settingsPanel = document.getElementById('tab-settings');
    const themesSubPanel = document.getElementById('subtab-settings-themes');
    const generalSubPanel = document.getElementById('subtab-settings-general');
    console.log('[renderThemes] Settings visibility check:', {
      settingsPanelActive: settingsPanel?.classList.contains('active'),
      themesSubPanelActive: themesSubPanel?.classList.contains('active'),
      generalSubPanelActive: generalSubPanel?.classList.contains('active'),
      themesTableDisplay: themesTable?.style.display
    });

    themesBody.innerHTML = '';

    const themeIds = Object.keys(allThemes);
    if (themeIds.length === 0) {
      console.warn('[renderThemes] No themes to render');
      themesBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748b;">No themes found</td></tr>';
      return;
    }

    console.log('[renderThemes] Rendering', themeIds.length, 'themes:', themeIds);

    themeIds.forEach(themeId => {
      const theme = allThemes[themeId];
      const attachedTemplates = templateLabels[themeId] || [];

      const tr = document.createElement('tr');

      // Expand button (first column)
      const tdExpand = document.createElement('td');
      const expandBtn = document.createElement('button');
      expandBtn.className = 'app-expand-btn';
      expandBtn.innerHTML = '&#9654;'; // ▶
      expandBtn.title = 'Edit theme details';

      // Create the expandable detail row (hidden by default)
      const detailRow = document.createElement('tr');
      detailRow.className = 'app-detail-row';
      detailRow.style.display = 'none';
      const detailTd = document.createElement('td');
      detailTd.colSpan = 6;
      detailRow.appendChild(detailTd);

      let detailLoaded = false;

      expandBtn.addEventListener('click', () => {
        const isOpen = detailRow.style.display !== 'none';
        if (isOpen) {
          detailRow.style.display = 'none';
          expandBtn.classList.remove('open');
        } else {
          detailRow.style.display = '';
          expandBtn.classList.add('open');
          if (!detailLoaded) {
            detailLoaded = true;
            buildThemeDetailPanel(themeId, detailRow);
          }
        }
      });

      tdExpand.appendChild(expandBtn);
      tr.appendChild(tdExpand);

      // Theme ID
      const tdId = document.createElement('td');
      tdId.innerHTML = `<code style="font-size:0.85rem;">${themeId}</code>`;
      tr.appendChild(tdId);

      // Theme Name
      const tdName = document.createElement('td');
      tdName.innerHTML = `<strong>${theme.name || 'Untitled'}</strong>`;
      tr.appendChild(tdName);

      // Page Title
      const tdPageTitle = document.createElement('td');
      tdPageTitle.textContent = theme.pageTitle || '-';
      tdPageTitle.style.color = theme.pageTitle ? '#1e293b' : '#94a3b8';
      tr.appendChild(tdPageTitle);

      // Tab Label
      const tdTabLabel = document.createElement('td');
      tdTabLabel.textContent = theme.tabLabel || '-';
      tdTabLabel.style.color = theme.tabLabel ? '#1e293b' : '#94a3b8';
      tr.appendChild(tdTabLabel);

      // Attached Templates
      const tdTemplates = document.createElement('td');
      if (attachedTemplates.length > 0) {
        tdTemplates.innerHTML = `<span style="color:#16a34a; font-weight:500;">${attachedTemplates.length} template(s)</span>`;
      } else {
        tdTemplates.innerHTML = '<span style="color:#94a3b8;">None</span>';
      }
      tr.appendChild(tdTemplates);

      themesBody.appendChild(tr);
      themesBody.appendChild(detailRow);
    });
  }

});

// ========================================
// Onboarding Functions
// ========================================

// Load existing app count for onboarding modal
async function loadExistingAppCount() {
  try {
    const response = await fetchWithCsrf('/api-apps');
    const apps = await response.json();
    const count = apps.filter(app => app.visible !== false).length;
    document.getElementById('existing-app-count').textContent = count;
  } catch (err) {
    document.getElementById('existing-app-count').textContent = '0';
  }
}

// Create demo apps for first-time users
async function createDemoApps() {
  const errorEl = document.getElementById('onboarding-error');
  const loadingEl = document.getElementById('onboarding-loading');

  errorEl.style.display = 'none';
  loadingEl.style.display = 'block';

  try {
    const response = await fetchWithCsrf('/onboarding/create-apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const result = await response.json();

    if (response.ok) {
      // Success - show success message in modal
      loadingEl.style.display = 'none';

      // Update modal content to show success message
      const modal = document.getElementById('onboarding-modal');
      const modalContent = modal.querySelector('div > div');
      modalContent.innerHTML = `
        <div style="text-align:center;">
          <div style="font-size:48px;margin-bottom:16px;">🎉</div>
          <h2 style="margin:0 0 16px;font-size:24px;color:#1e293b;">Your demo apps are ready!</h2>
          <p style="color:#475569;line-height:1.6;margin-bottom:24px;">
            We've created <strong>${result.created} API app(s)</strong> for you to start testing.<br>
            Check the <strong>API Apps</strong> tab to see them in action.
          </p>
          <p style="color:#16a34a;font-weight:500;margin-bottom:24px;">
            Enjoy exploring the Sign Portal! 🚀
          </p>
          <button id="onboardingGetStartedBtn" style="padding:12px 32px;background:#6366f1;color:white;border:none;border-radius:6px;font-weight:500;cursor:pointer;font-size:14px;">
            Get Started
          </button>
        </div>
      `;

      // Add event listener to the "Get Started" button
      setTimeout(() => {
        const getStartedBtn = document.getElementById('onboardingGetStartedBtn');
        if (getStartedBtn) {
          getStartedBtn.addEventListener('click', () => {
            document.getElementById('onboarding-modal').remove();
          });
        }
      }, 100);

      // Refresh API apps dropdown after creating demo apps
      if (typeof window.refreshApiAppsDropdown === 'function') {
        try {
          await window.refreshApiAppsDropdown();
          console.log('[ONBOARDING] API apps dropdown refreshed after creating demo apps');
        } catch (err) {
          console.warn('[ONBOARDING] Failed to refresh API apps dropdown:', err);
        }
      }

      // Set flag to force refresh API Apps tab on first visit
      sessionStorage.setItem('onboarding_apps_created', 'true');

      // Auto-close after 5 seconds
      setTimeout(() => {
        const modal = document.getElementById('onboarding-modal');
        if (modal) modal.remove();
      }, 5000);
    } else {
      // Error - show message but keep modal open
      loadingEl.style.display = 'none';

      // Hide original action buttons when showing error with its own skip button
      const createBtn = document.getElementById('createDemoAppsBtn');
      const skipBtn = document.getElementById('skipOnboardingBtn');
      if (createBtn) createBtn.style.display = 'none';
      if (skipBtn) skipBtn.style.display = 'none';

      // If it's a plan restriction, show friendly message
      if (result.isPlanRestriction) {
        const errorTitle = result.error || 'Unable to create demo apps';
        const explanation = result.message || 'Your account may not have API app creation permissions.';
        const suggestion = result.suggestion || 'You can still use this portal with existing API apps.';

        errorEl.innerHTML =
          `<div style="text-align:left;">` +
          `<strong style="color:#dc2626;font-size:15px;">⚠️ ${errorTitle}</strong><br><br>` +
          `<p style="margin:12px 0;color:#475569;line-height:1.6;">${explanation}</p>` +
          `<p style="margin:12px 0;color:#64748b;font-size:13px;line-height:1.5;">${suggestion}</p>` +
          `<button id="skip-onboarding-btn-1" style="margin-top:16px;padding:10px 20px;background:#6366f1;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:14px;">` +
          `Continue Without Demo Apps</button>` +
          `</div>`;
        errorEl.style.display = 'block';
        // Attach event listener after DOM is updated
        setTimeout(() => {
          const btn = document.getElementById('skip-onboarding-btn-1');
          if (btn) btn.addEventListener('click', skipOnboarding);
        }, 0);
      } else if (result.isConfigError) {
        const errorTitle = result.error || 'Configuration Required';
        const explanation = result.message || 'Required environment variables are not configured.';
        const suggestion = result.suggestion || 'Configure the required variables and restart the server.';

        let detailsHtml = '';
        if (result.details && result.details.length > 0) {
          detailsHtml = `<ul style="margin:12px 0;padding-left:20px;color:#475569;font-size:13px;line-height:1.8;">` +
            result.details.map(e => `<li>${e.error}</li>`).join('') +
            `</ul>`;
        }

        errorEl.innerHTML =
          `<div style="text-align:left;">` +
          `<strong style="color:#b45309;font-size:15px;">⚙️ ${errorTitle}</strong><br><br>` +
          `<p style="margin:12px 0;color:#475569;line-height:1.6;">${explanation}</p>` +
          detailsHtml +
          `<p style="margin:12px 0;color:#64748b;font-size:13px;line-height:1.5;">${suggestion}</p>` +
          `<button id="skip-onboarding-btn-2" style="margin-top:16px;padding:10px 20px;background:#6366f1;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:14px;">` +
          `Skip — Continue Without Demo Apps</button>` +
          `</div>`;
        errorEl.style.display = 'block';
        // Attach event listener after DOM is updated
        setTimeout(() => {
          const btn = document.getElementById('skip-onboarding-btn-2');
          if (btn) btn.addEventListener('click', skipOnboarding);
        }, 0);
      } else {
        // Other errors - show details
        let errorMessage = result.error || 'Failed to create apps. Please try again.';

        if (result.details && result.details.length > 0) {
          const errorList = result.details.map(e => `• ${e.app}: ${e.error}`).join('\n');
          errorMessage += '\n\nDetails:\n' + errorList;
        }

        errorEl.textContent = errorMessage;
        errorEl.style.display = 'block';
      }
    }
  } catch (err) {
    loadingEl.style.display = 'none';
    errorEl.textContent = 'Network error. Please check your connection.';
    errorEl.style.display = 'block';
  }
}

// Skip onboarding - user declined demo apps
async function skipOnboarding() {
  try {
    await fetchWithCsrf('/onboarding/dismiss', { method: 'POST' });
    document.getElementById('onboarding-modal').remove();
  } catch (err) {
    // Even if request fails, remove modal (don't block user)
    document.getElementById('onboarding-modal').remove();
  }
}

async function continueWithExistingData() {
  try {
    await fetchWithCsrf('/onboarding/dismiss', { method: 'POST' });
    document.getElementById('onboarding-modal').remove();
    showToast('Continuing with your existing data', 'info');
  } catch (err) {
    document.getElementById('onboarding-modal').remove();
  }
}

async function startFresh() {
  const confirmFresh = confirm(
    'Are you sure you want to start fresh?\n\n' +
    'This will permanently delete:\n' +
    '• All custom themes\n' +
    '• All settings and preferences\n' +
    '• API activity logs\n' +
    '• Test mode configurations\n\n' +
    'This action cannot be undone.'
  );

  if (!confirmFresh) return;

  const loadingEl = document.getElementById('onboarding-loading');
  const errorEl = document.getElementById('onboarding-error');
  const startFreshBtn = document.getElementById('startFreshBtn');

  loadingEl.textContent = 'Clearing your data...';
  loadingEl.style.display = 'block';
  errorEl.style.display = 'none';
  startFreshBtn.disabled = true;

  try {
    const response = await fetchWithCsrf('/onboarding/reset-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to reset data');
    }

    await fetchWithCsrf('/onboarding/dismiss', { method: 'POST' });
    document.getElementById('onboarding-modal').remove();
    showToast('Data cleared successfully. Starting fresh!', 'info');

    // Reload to reflect fresh state
    setTimeout(() => window.location.reload(), 1000);
  } catch (err) {
    console.error('Error resetting data:', err);
    errorEl.textContent = err.message || 'Failed to clear data. Please try again.';
    errorEl.style.display = 'block';
    loadingEl.style.display = 'none';
    startFreshBtn.disabled = false;
  }
}

// Expose functions globally for inline onclick handlers
window.createDemoApps = createDemoApps;
window.skipOnboarding = skipOnboarding;
window.continueWithExistingData = continueWithExistingData;
window.startFresh = startFresh;

// Auto-load app count when modal is present
if (document.getElementById('onboarding-modal')) {
  loadExistingAppCount();

  // Add escape key handler
  document.addEventListener('keydown', function escapeHandler(e) {
    if (e.key === 'Escape') {
      const modal = document.getElementById('onboarding-modal');
      if (modal) {
        skipOnboarding();
        document.removeEventListener('keydown', escapeHandler);
      }
    }
  });

  // Add click-outside-to-skip handler
  const modal = document.getElementById('onboarding-modal');
  modal.addEventListener('click', function(e) {
    // Only close if clicking the backdrop (not the inner content)
    if (e.target === modal) {
      skipOnboarding();
    }
  });
}

// ===== Team Tab =====
// Team functionality moved to /public/team.js
