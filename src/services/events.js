// src/services/events.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Webhook event persistence (JSON file)
const EVENTS_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(EVENTS_DIR)) fs.mkdirSync(EVENTS_DIR);
const EVENTS_FILE = path.join(EVENTS_DIR, 'webhook-events.json');
const WARNINGS_FILE = path.join(EVENTS_DIR, 'sig-warnings.json');

/**
 * Load webhook events from file storage
 */
export function loadWebhookEvents() {
  try {
    return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Save webhook events to file storage
 */
export function saveWebhookEvents(events) {
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

/**
 * Record a webhook event (session-based or file-based)
 */
export function recordEvent(sigReqId, eventType, signerEmail, session = null) {
  if (!sigReqId) return;

  // If session provided, use session storage (API key mode)
  if (session) {
    if (!session.webhookEvents) session.webhookEvents = {};
    if (!session.webhookEvents[sigReqId]) session.webhookEvents[sigReqId] = [];
    const key = signerEmail ? `${eventType}:${signerEmail}` : eventType;
    if (!session.webhookEvents[sigReqId].some(e => e.key === key)) {
      session.webhookEvents[sigReqId].push({
        event: eventType,
        key,
        signer: signerEmail || null,
        timestamp: Math.floor(Date.now() / 1000)
      });
    }
    return;
  }

  // Fallback to file storage (legacy mode)
  const events = loadWebhookEvents();
  if (!events[sigReqId]) events[sigReqId] = [];
  const key = signerEmail ? `${eventType}:${signerEmail}` : eventType;
  if (!events[sigReqId].some(e => e.key === key)) {
    events[sigReqId].push({ event: eventType, key, signer: signerEmail || null, timestamp: Math.floor(Date.now() / 1000) });
  }
  // Cap at 1000 requests — remove oldest
  const keys = Object.keys(events);
  if (keys.length > 1000) {
    delete events[keys[0]];
  }
  saveWebhookEvents(events);
}

/**
 * Load signature request warnings from file storage
 */
export function loadWarnings() {
  try {
    return JSON.parse(fs.readFileSync(WARNINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Save signature request warnings to file storage
 */
export function saveWarnings(sigReqId, warnings) {
  if (!sigReqId || !warnings || warnings.length === 0) return;
  const all = loadWarnings();
  all[sigReqId] = warnings;
  // Cap at 500 entries
  const keys = Object.keys(all);
  if (keys.length > 500) delete all[keys[0]];
  fs.writeFileSync(WARNINGS_FILE, JSON.stringify(all, null, 2));
}
