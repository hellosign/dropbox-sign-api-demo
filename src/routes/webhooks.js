// src/routes/webhooks.js
import { Router } from 'express';
import multer from 'multer';
import * as DropboxSign from '@dropbox/sign';
import { buildRequestDetail } from '../utils/logging.js';
import { API_KEY } from '../config/constants.js';

const router = Router();
const upload = multer();

/**
 * POST /events/callback - Handle Dropbox Sign webhook callbacks
 * Receives and processes signature request events from Dropbox Sign
 */
router.post('/events/callback', upload.none(), async (req, res) => {
  const { lookupSignatureRequestOwner, isAppWebhookEnabled, addWebhookEvent, addApiLog } = req.app.locals.redisHelpers;
  const broadcastStatus = req.app.locals.broadcastStatus;

  console.log(`[CALLBACK RECEIVED] Timestamp: ${new Date().toISOString()}`);

  try {
    const data = JSON.parse(req.body.json);
    console.log(`[CALLBACK DATA] Event type: ${data.event?.event_type}, SigReq ID: ${data.signature_request?.signature_request_id || data.event?.signature_request_id}`);
    const cb = DropboxSign.EventCallbackRequest.init(data);

    // Validate webhook signature using API key (configured in Dropbox Sign dashboard)
    // Skip validation if API_KEY is not configured (optional for development)
    if (API_KEY && !DropboxSign.EventCallbackHelper.isValid(API_KEY, cb)) {
      return res.status(403).end("Invalid signature");
    }

    // Event type, e.g. 'signature_request_signed' or 'signature_request_all_signed'
    const status = cb.event?.eventType || data.event?.event_type;

    // Grab signature_request_id
    const sigReqId =
      cb.event?.signature_request_id ||
      data.signature_request?.signature_request_id ||
      cb.event?.signatureRequestId ||
      data.event?.signature_request_id ||
      data.signatureRequestId ||
      null;

    // Grab the direct files_url if available
    const filesUrl = data.signature_request?.files_url || null;

    // Extract document title and signer info for live notifications
    const docTitle = data.signature_request?.title || data.signature_request?.subject || '';
    const webhookSignatures = data.signature_request?.signatures || [];

    // Identify which signer triggered this event using event metadata or by finding
    // the most recently active signer matching the event type
    const relatedSignerId = data.event?.event_metadata?.related_signature_id || null;
    let eventSigner = null;
    if (relatedSignerId) {
      eventSigner = webhookSignatures.find(s => s.signature_id === relatedSignerId);
    }
    if (!eventSigner) {
      // Fallback: find the signer with the most recent relevant timestamp
      if (status === 'signature_request_signed') {
        eventSigner = [...webhookSignatures]
          .filter(s => s.status_code === 'signed')
          .sort((a, b) => (b.signed_at || 0) - (a.signed_at || 0))[0];
      } else if (status === 'signature_request_viewed') {
        eventSigner = [...webhookSignatures]
          .filter(s => s.last_viewed_at)
          .sort((a, b) => (b.last_viewed_at || 0) - (a.last_viewed_at || 0))[0];
      } else if (status === 'signature_request_declined') {
        eventSigner = webhookSignatures.find(s => s.decline_reason);
      }
    }
    const signerName = eventSigner?.signer_name || '';
    const signerEmail = eventSigner?.signer_email_address || '';

    // Look up which user created this signature request (multi-tenant routing)
    const owner = await lookupSignatureRequestOwner(sigReqId);

    if (owner) {
      // Check if callbacks are enabled for this API App
      const webhookEnabled = await isAppWebhookEnabled(owner.account_id, owner.api_app_id);

      console.log(`[CALLBACK] sigReqId: ${sigReqId}, apiAppId: ${owner.api_app_id}, accountId: ${owner.account_id}, callbackEnabled: ${webhookEnabled}, status: ${status}`);

      if (webhookEnabled) {
        // Route to user-specific Redis storage
        await addWebhookEvent(owner.account_id, sigReqId, {
          event: status,
          key: signerEmail ? `${status}:${signerEmail}` : status,
          signer: signerEmail || null,
          timestamp: Math.floor(Date.now() / 1000)
        });

        // Log API call for this specific user
        // Format event type for display (e.g., "signature_request_sent" -> "Sent")
        const eventTypeDisplay = status
          .replace('signature_request_', '')
          .replace('_', ' ')
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');

        addApiLog({
          type: 'callback',
          method: 'POST',
          endpoint: `/events/callback (${eventTypeDisplay})`,
          requestBody: buildRequestDetail({ method: 'POST', apiPath: '/events/callback', body: data, contentType: 'multipart/form-data' }),
          response: data,
        }, owner.account_id);

        // Broadcast status update ONLY to the user who owns this signature request
        broadcastStatus(status, sigReqId, filesUrl, {
          docTitle,
          signerName,
          signerEmail,
          source: 'callback',
          accountId: owner.account_id
        });
      } else {
        console.log(`[CALLBACK] Callbacks disabled for app ${owner.api_app_id} - event not saved`);
      }
    } else {
      // No owner found - log to global and broadcast to all
      console.log(`[CALLBACK] No owner found for sigReqId ${sigReqId}, logging to global and broadcasting to all`);

      addApiLog({
        type: 'callback',
        method: 'POST',
        endpoint: `/events/callback (${status})`,
        requestBody: buildRequestDetail({ method: 'POST', apiPath: '/events/callback', body: data, contentType: 'multipart/form-data' }),
        response: data,
      }, 'global');

      // Fallback: broadcast to all (for old signature requests)
      broadcastStatus(status, sigReqId, filesUrl, { docTitle, signerName, source: 'callback' });
    }

    return res.json({ message: "Hello API Event Received" });
  } catch (err) {
    console.error("Error in /events/callback:", err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
