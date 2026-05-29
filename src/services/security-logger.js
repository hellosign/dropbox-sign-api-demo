// src/services/security-logger.js
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGS_DIR = path.join(__dirname, '../../logs');
const SECURITY_LOG_FILE = path.join(LOGS_DIR, 'security.log');
const MAX_LOG_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_LOG_FILES = 5;

let redisClient = null;

/**
 * Initialize security logger with Redis client
 */
export function initSecurityLogger(redis) {
  redisClient = redis;
}

/**
 * Log a security event to both Redis and file
 */
export async function logSecurityEvent(event) {
  const eventId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const timestamp = new Date().toISOString();

  const logEntry = {
    id: eventId,
    timestamp,
    ...event
  };

  // 1. Write to file (sync for reliability)
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    // Check if rotation needed
    if (fs.existsSync(SECURITY_LOG_FILE)) {
      const stats = fs.statSync(SECURITY_LOG_FILE);
      if (stats.size >= MAX_LOG_SIZE) {
        rotateLogFile(SECURITY_LOG_FILE, MAX_LOG_FILES);
      }
    }

    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(SECURITY_LOG_FILE, logLine);
  } catch (err) {
    console.error('[SECURITY LOGGER] File write error:', err);
  }

  // 2. Store in Redis (async, non-blocking)
  if (redisClient) {
    (async () => {
      try {
        const ip = event.ip || 'unknown';

        // Per-IP storage
        const ipKey = `security:login_attempts:${ip}`;
        const ipLogs = await redisClient.get(ipKey);
        const ipLogArray = ipLogs ? JSON.parse(ipLogs) : [];
        ipLogArray.unshift(logEntry);

        // Keep max 1000 per IP
        if (ipLogArray.length > 1000) {
          ipLogArray.length = 1000;
        }

        await redisClient.set(ipKey, JSON.stringify(ipLogArray), {
          EX: 7 * 24 * 60 * 60 // 7 days
        });

        // Global storage
        const allKey = 'security:all_attempts';
        const allLogs = await redisClient.get(allKey);
        const allLogArray = allLogs ? JSON.parse(allLogs) : [];
        allLogArray.unshift(logEntry);

        // Keep max 5000 globally
        if (allLogArray.length > 5000) {
          allLogArray.length = 5000;
        }

        await redisClient.set(allKey, JSON.stringify(allLogArray), {
          EX: 30 * 24 * 60 * 60 // 30 days
        });

        // Increment counter for event type
        const counterKey = `security:counters:${event.eventType}`;
        await redisClient.incr(counterKey);
        await redisClient.expire(counterKey, 30 * 24 * 60 * 60);

      } catch (err) {
        console.error('[SECURITY LOGGER] Redis write error:', err);
      }
    })();
  }
}

/**
 * Get security events (for admin dashboard)
 */
export async function getSecurityEvents(options = {}) {
  if (!redisClient) return [];

  const { ip = null, limit = 100, eventType = null } = options;

  try {
    let events;

    if (ip) {
      const key = `security:login_attempts:${ip}`;
      const data = await redisClient.get(key);
      events = data ? JSON.parse(data) : [];
    } else {
      const key = 'security:all_attempts';
      const data = await redisClient.get(key);
      events = data ? JSON.parse(data) : [];
    }

    // Filter by event type if specified
    if (eventType) {
      events = events.filter(e => e.eventType === eventType);
    }

    // Apply limit
    return events.slice(0, limit);
  } catch (err) {
    console.error('[SECURITY LOGGER] Error fetching events:', err);
    return [];
  }
}

/**
 * Get aggregated security statistics
 */
export async function getSecurityStats(options = {}) {
  if (!redisClient) return {};

  try {
    const eventTypes = [
      'login_validation_failed',
      'honeypot_triggered',
      'login_format_rejected',
      'login_suspicious',
      'login_failed',
      'login_access_denied',
      'rate_limit_exceeded'
    ];

    const stats = {};

    for (const type of eventTypes) {
      const key = `security:counters:${type}`;
      const count = await redisClient.get(key);
      stats[type] = count ? parseInt(count, 10) : 0;
    }

    // Get top IPs
    const allKey = 'security:all_attempts';
    const allData = await redisClient.get(allKey);
    const allEvents = allData ? JSON.parse(allData) : [];

    const ipCounts = {};
    for (const event of allEvents) {
      const ip = event.ip || 'unknown';
      ipCounts[ip] = (ipCounts[ip] || 0) + 1;
    }

    const topIPs = Object.entries(ipCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ip, count]) => ({ ip, count }));

    stats.topIPs = topIPs;
    stats.totalAttempts = allEvents.length;

    return stats;
  } catch (err) {
    console.error('[SECURITY LOGGER] Error fetching stats:', err);
    return {};
  }
}

/**
 * Manually block an IP address
 */
export async function blockIP(ip, durationSeconds = 24 * 60 * 60) {
  if (!redisClient) return false;

  try {
    const key = `security:blocked_ips:${ip}`;
    await redisClient.set(key, Date.now().toString(), {
      EX: durationSeconds
    });

    console.log(`[SECURITY] Blocked IP ${ip} for ${durationSeconds} seconds`);
    return true;
  } catch (err) {
    console.error('[SECURITY] Error blocking IP:', err);
    return false;
  }
}

/**
 * Check if an IP is blocked
 */
export async function isIPBlocked(ip) {
  if (!redisClient) return false;

  try {
    const key = `security:blocked_ips:${ip}`;
    const blocked = await redisClient.get(key);
    return !!blocked;
  } catch (err) {
    console.error('[SECURITY] Error checking IP block:', err);
    return false;
  }
}

/**
 * Rotate log file when it exceeds max size
 */
function rotateLogFile(logFile, maxFiles) {
  for (let i = maxFiles - 1; i >= 1; i--) {
    const oldPath = i === 1 ? logFile : `${logFile}.${i - 1}`;
    const newPath = `${logFile}.${i}`;
    if (fs.existsSync(oldPath)) {
      if (fs.existsSync(newPath)) {
        fs.unlinkSync(newPath);
      }
      fs.renameSync(oldPath, newPath);
    }
  }
}
