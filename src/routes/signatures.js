// src/routes/signatures.js
import { Router } from 'express';
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { csrfProtection as doubleCsrfProtection } from '../middleware/security.js';
import { apiCall } from '../services/dropbox-sign.js';
import { loadWarnings } from '../services/events.js';
import { VERBOSE_LOGGING } from '../config/security.js';
import * as DropboxSign from '@dropbox/sign';

const router = Router();

// Server-side cache for signature list (avoids hammering the API)
let signaturesServerCache = { data: null, pageSize: null, timestamp: 0 };
const SIGNATURES_CACHE_TTL = 5000; // 5 seconds

/**
 * GET /signatures - Get signature requests list
 * Returns list of signature requests with caching
 */
router.get('/', requireAuth, async (req, res) => {
  const { lookupSignatureRequestOwner } = req.app.locals.redisHelpers;
  const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 25, 100);

  // Return cached response if fresh enough
  const now = Date.now();
  if (signaturesServerCache.data && signaturesServerCache.pageSize === pageSize &&
      (now - signaturesServerCache.timestamp) < SIGNATURES_CACHE_TTL) {
    return res.json(signaturesServerCache.data);
  }

  // Get user's account ID to filter signatures to only their own
  const accountId = req.session.accountInfo?.account_id;

  // Retry with backoff for rate limiting
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await apiCall(req, 'SignatureRequestApi', 'signatureRequestList', [accountId, 1, pageSize], {
        method: 'GET',
        endpoint: '/signature_request/list'
      });

    const signatureRequests = response.body?.signatureRequests || [];
    const allWarnings = loadWarnings();

    // Build a map of clientId -> app name from session cache
    const appsMap = {};
    if (req.session.appsCache?.data) {
      req.session.appsCache.data.forEach(app => {
        appsMap[app.clientId] = app.name;
      });
    }

    // Fetch API app info for each signature request
    const sigRequestOwners = await Promise.all(
      signatureRequests.map(sr =>
        sr?.signatureRequestId ? lookupSignatureRequestOwner(sr.signatureRequestId) : Promise.resolve(null)
      )
    );

    const results = signatureRequests
      .filter((sr) => sr && sr.signatureRequestId)
      .map((sr, index) => {
        const signatures = sr.signatures || [];
        const signerCount = signatures.length;

        // Debug: log available fields
        if (signatureRequests.indexOf(sr) === 0) {
          if (VERBOSE_LOGGING) console.log('[SIGNATURES] First signature request - Title:', sr.title);
          if (VERBOSE_LOGGING) console.log('[SIGNATURES] SR fields:', Object.keys(sr));
          if (VERBOSE_LOGGING) console.log('[SIGNATURES] First signature fields:', signatures.length > 0 ? Object.keys(signatures[0]) : 'no signatures');
          if (VERBOSE_LOGGING) console.log('[SIGNATURES] Has signUrl?:', signatures.length > 0 ? !!signatures[0].signUrl : 'N/A');
          if (VERBOSE_LOGGING) console.log('[SIGNATURES] signUrl value:', signatures.length > 0 ? signatures[0].signUrl : 'N/A');
        }

        let overallStatus;
        if (sr.isDeclined) {
          overallStatus = "Declined";
        } else if (sr.hasError) {
          overallStatus = "Error";
        } else if (sr.isComplete) {
          overallStatus = "Complete";
        } else {
          const signedCount = signatures.filter(
            (s) => s.statusCode === "signed"
          ).length;
          if (signedCount === 0) {
            overallStatus = "Awaiting Signatures";
          } else {
            overallStatus = `${signedCount}/${signerCount} Signed`;
          }
        }

        // Compute latest activity timestamp
        const timestamps = [
          sr.createdAt || 0,
          ...signatures.map((s) => s.signedAt || 0),
          ...signatures.map((s) => s.lastViewedAt || 0),
        ];
        const updatedAt = timestamps.length > 0 ? Math.max(...timestamps) : 0;

        // Collect error/decline reasons from individual signers
        const errorMessages = signatures
          .map((s) => s.error)
          .filter(Boolean);
        const declineReasons = signatures
          .map((s) => s.declineReason)
          .filter(Boolean);

        // Build per-signer progress from API data
        const signers = signatures.map((s, idx) => {
          const steps = [];

          // Determine if this signer has actually been sent the email
          // If order is null/undefined, it means parallel signing (all get emails immediately)
          // If order is a number, it means sequential signing
          const signerOrder = s.order;
          const isParallelSigning = signerOrder === null || signerOrder === undefined;

          // Calculate previous signers (only relevant for sequential signing)
          const previousSigners = isParallelSigning ? [] : signatures.filter(sig => {
            const prevOrder = sig.order;
            return prevOrder !== null && prevOrder !== undefined && prevOrder < signerOrder;
          });

          let hasBeenSent;
          if (isParallelSigning) {
            // Parallel signing: everyone gets email immediately
            hasBeenSent = true;
          } else {
            // Sequential signing: only sent if all previous signers (lower order) have signed
            const allPreviousSignersSigned = previousSigners.every(sig => sig.statusCode === 'signed');
            hasBeenSent = previousSigners.length === 0 || allPreviousSignersSigned;
          }

          if (hasBeenSent) {
            // Sent step — use request createdAt for first signer, or last previous signer's signedAt
            let sentTimestamp = sr.createdAt || 0;
            if (previousSigners.length > 0) {
              const lastPreviousSignedAt = Math.max(...previousSigners.map(sig => sig.signedAt || 0));
              if (lastPreviousSignedAt > 0) {
                sentTimestamp = lastPreviousSignedAt;
              }
            }
            steps.push({ step: 'Sent', timestamp: sentTimestamp });
          } else {
            // Still waiting for previous signer(s) to complete
            steps.push({ step: 'Pending', timestamp: sr.createdAt || 0 });
          }

          if (s.lastViewedAt) {
            steps.push({ step: 'Viewed', timestamp: s.lastViewedAt });
          }
          if (s.statusCode === 'signed' && s.signedAt) {
            steps.push({ step: 'Signed', timestamp: s.signedAt });
          }
          if (s.declineReason) {
            steps.push({ step: 'Declined', timestamp: s.lastViewedAt || sr.createdAt || 0, reason: s.declineReason });
          }
          if (s.error) {
            steps.push({ step: 'Error', timestamp: 0, reason: s.error });
          }
          return {
            name: s.signerName || s.signerEmailAddress || 'Signer',
            email: s.signerEmailAddress || '',
            statusCode: s.statusCode,
            order: signerOrder,
            hasPin: !!s.hasPin,
            hasSms: !!(s.smsPhoneNumber),
            steps,
          };
        });

        // Append overall "Complete" if all signed
        if (sr.isComplete) {
          const lastSigned = Math.max(...signatures.map(s => s.signedAt || 0));
          signers.forEach(signer => {
            if (signer.statusCode === 'signed') {
              signer.steps.push({ step: 'Complete', timestamp: lastSigned });
            }
          });
        }

        // Add API app name to metadata if available
        const ownerInfo = sigRequestOwners[index];
        const metadata = { ...(sr.metadata || {}) };
        if (ownerInfo?.api_app_id && appsMap[ownerInfo.api_app_id]) {
          metadata.app = appsMap[ownerInfo.api_app_id];
        }

        // Check if embedded: Check metadata for our custom embedded flag
        const isEmbedded = metadata.embedded === 'true';

        // Debug logging for isEmbedded flag
        if (signatureRequests.indexOf(sr) < 3) {
          if (VERBOSE_LOGGING) console.log(`[SIGNATURES] Request "${sr.title}" - isEmbedded: ${isEmbedded}, metadata:`, metadata);
        }

        return {
          id: sr.signatureRequestId,
          title: sr.title || sr.subject || "(Untitled)",
          sender: sr.requesterEmailAddress || '',
          signerCount,
          status: overallStatus,
          isComplete: !!sr.isComplete,
          updatedAt,
          errorMessages,
          declineReasons,
          signers,
          hasEid: !!sr.isEid,
          hasAttachments: !!(sr.attachments && sr.attachments.length > 0),
          isEmbedded,
          warnings: allWarnings[sr.signatureRequestId] || [],
          metadata,
        };
      });

    // Cache and return
    signaturesServerCache = { data: results, pageSize, timestamp: Date.now() };
    return res.json(results);

    } catch (err) {
      lastErr = err;
      const isRateLimit = err?.statusCode === 429 || err?.body?.error?.errorName === 'exceeded_rate';
      if (isRateLimit && attempt < 2) {
        const delay = (attempt + 1) * 2000;
        console.warn(`[/signatures] Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/3)`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      // Not rate-limited or last attempt — return cached data if available, else error
      if (signaturesServerCache.data && signaturesServerCache.pageSize === pageSize) {
        console.warn("[/signatures] API error, returning stale cache");
        return res.json(signaturesServerCache.data);
      }
      if (isRateLimit) {
        return res.status(429).json({ error: "Rate limited by Dropbox Sign API", rateLimited: true });
      }
      console.error("Error in /signatures:", err?.message || err, err?.body || "");
      return res.status(500).json({ error: "Failed to fetch signature list" });
    }
  }
});

/**
 * POST /signatures/remind - Send reminders for selected signature requests
 * Sends email reminders to all signers who haven't signed yet
 */
router.post('/remind', requireAuth, express.json(), doubleCsrfProtection, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "No signature request IDs provided" });
  }

  // Get user's account ID to filter signatures
  const accountId = req.session.accountInfo?.account_id;

  const results = [];
  for (const signatureRequestId of ids) {
    try {
      // First, get the signature request details to find signers who need reminders
      const sigReqResponse = await apiCall(req, 'SignatureRequestApi', 'signatureRequestGet', [signatureRequestId], {
        method: 'GET',
        endpoint: `/signature_request/${signatureRequestId}`
      });

      const signatureRequest = sigReqResponse.body?.signatureRequest;
      if (!signatureRequest) {
        results.push({ id: signatureRequestId, success: false, error: 'Signature request not found' });
        continue;
      }

      // Check if this is an embedded signature request
      const signatures = signatureRequest.signatures || [];
      const isEmbedded = signatures.some(s => s.signUrl);

      if (isEmbedded) {
        results.push({
          id: signatureRequestId,
          success: false,
          error: 'Cannot send reminders for embedded signatures',
          remindersSent: 0
        });
        continue;
      }

      // Find signers who haven't signed yet (status is 'awaiting_signature')
      const pendingSigners = signatures.filter(
        sig => sig.statusCode === 'awaiting_signature'
      );

      if (pendingSigners.length === 0) {
        results.push({
          id: signatureRequestId,
          success: true,
          message: 'No pending signers to remind',
          remindersSent: 0
        });
        continue;
      }

      // Send reminders to each pending signer
      const reminderResults = [];
      for (const signer of pendingSigners) {
        try {
          const remindRequest = new DropboxSign.SignatureRequestRemindRequest();
          remindRequest.emailAddress = signer.signerEmailAddress;

          // Include name if available (required if multiple signers share same email)
          if (signer.signerName) {
            remindRequest.name = signer.signerName;
          }

          await apiCall(req, 'SignatureRequestApi', 'signatureRequestRemind', [signatureRequestId, remindRequest], {
            method: 'POST',
            endpoint: `/signature_request/remind/${signatureRequestId}`
          });

          reminderResults.push({
            email: signer.signerEmailAddress,
            name: signer.signerName,
            success: true
          });
        } catch (err) {
          // Extract detailed error message from various possible error structures
          let errorMsg = err.message || 'Unknown error';

          // Try different error structures used by Dropbox Sign SDK
          if (err.body && err.body.error) {
            errorMsg = err.body.error.error_msg || err.body.error.errorMsg || err.body.error.error_name || err.body.error.errorName || errorMsg;
          } else if (err.error) {
            errorMsg = err.error.error_msg || err.error.errorMsg || err.error.error_name || err.error.errorName || errorMsg;
          }

          console.error(`Error sending reminder to ${signer.signerEmailAddress}:`, errorMsg, err);
          reminderResults.push({
            email: signer.signerEmailAddress,
            name: signer.signerName,
            success: false,
            error: errorMsg
          });
        }
      }

      const successCount = reminderResults.filter(r => r.success).length;
      results.push({
        id: signatureRequestId,
        success: successCount > 0,
        remindersSent: successCount,
        totalPending: pendingSigners.length,
        details: reminderResults
      });

    } catch (err) {
      console.error(`Error processing reminder for ${signatureRequestId}:`, err.message);
      results.push({ id: signatureRequestId, success: false, error: err.message });
    }
  }

  return res.json({ results });
});

/**
 * DELETE /signatures - Cancel selected signature requests
 * Cancels multiple signature requests by ID
 */
router.delete('/', requireAuth, express.json(), doubleCsrfProtection, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "No signature request IDs provided" });
  }

  const results = [];
  for (const id of ids) {
    try {
      // Use API abstraction - automatic logging
      await apiCall(req, 'SignatureRequestApi', 'signatureRequestCancel', [id], {
        method: 'POST',
        endpoint: `/signature_request/cancel/${id}`
      });
      results.push({ id, success: true });
    } catch (err) {
      console.error(`Error cancelling ${id}:`, err.message);
      results.push({ id, success: false, error: err.message });
    }
  }
  return res.json({ results });
});

/**
 * GET /signatures/download/:id - Download signature request files
 * Downloads the PDF files for a signature request (at any stage)
 */
router.get('/download/:id', requireAuth, async (req, res) => {
  const signatureRequestId = req.params.id;

  try {
    // Download the files using the Dropbox Sign API
    // Note: The API allows downloading files at any stage, not just when complete
    const filesResponse = await apiCall(req, 'SignatureRequestApi', 'signatureRequestFiles', [signatureRequestId, 'pdf'], {
      method: 'GET',
      endpoint: `/signature_request/files/${signatureRequestId}`
    });

    // Get the file data (it's a Buffer)
    const fileData = filesResponse.body;

    // Generate a filename (we don't have the title without an extra API call, so use the ID)
    const fileName = `signature_request_${signatureRequestId}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', fileData.length);

    // Send the file
    res.send(fileData);

  } catch (err) {
    console.error(`Error downloading signature request ${signatureRequestId}:`, err.message, err.body || '');
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
      error: err.body?.error?.error_msg || err.message || 'Failed to download file'
    });
  }
});

export default router;
