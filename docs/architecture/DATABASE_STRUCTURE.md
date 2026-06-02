# Database Structure Documentation

## Overview

The Sign Portal uses **Redis** as its primary data store for:
- Session management (with automatic expiration)
- Per-user data isolation (multi-tenant architecture)
- Runtime configuration and state

**Key Design Principles:**
- Multi-tenant: Each user's data is isolated by `account_id`
- Session-based: Authentication via session (API key stored in browser only, not in Redis)
- TTL-managed: Sessions auto-expire after 30 days of inactivity
- No persistent relational data: All data in Redis with optional memory fallback

---

## Redis Key Patterns

### 1. Session Keys

**Pattern:** `sess:{sessionId}`

**Purpose:** Express-session storage with user authentication and runtime state

**Structure:**
```json
{
  "cookie": {
    "originalMaxAge": 2592000000,
    "expires": "2026-05-22T10:30:00.000Z",
    "secure": false,
    "httpOnly": true,
    "sameSite": "lax"
  },
  "accountInfo": {
    "account_id": "9db283babedc87ea379d5327641c60222cb4a2c8",
    "email_address": "user@example.com",
    "role_code": "a"
  },
  "signatureRequests": [
    {
      "signature_request_id": "abc123...",
      "title": "Document Title",
      "status": "awaiting_signature",
      "created_at": 1234567890,
      "signers": [...],
      "test_mode": true
    }
  ],
  "webhookEvents": {
    "event_hash_1": { "event": {...}, "timestamp": 1234567890 },
    "event_hash_2": { "event": {...}, "timestamp": 1234567891 }
  },
  "preferences": {},
  "appTestMode": {
    "client_id_1": true,
    "client_id_2": false
  }
}
```

**TTL:** 30 days (2,592,000 seconds)

**Expiration:** Rolling - extends on each activity

**Relationships:**
- One session per browser/device
- Multiple sessions per user (different browsers/devices)
- Links to per-user data via `accountInfo.account_id`

**Cleanup:**
- Automatic: Redis expires after TTL
- Manual: Admin can force logout (deletes session key)
- Complete user deletion: All sessions deleted

---

### 2. Per-User Data Keys

**Pattern:** `user:{account_id}:{resource_type}`

**Purpose:** Store user-specific configuration and data across sessions

**TTL:** None (permanent until explicitly deleted)

**Isolation:** Each user's data is completely isolated by their `account_id`

#### 2.1 Document Templates

**Key:** `user:{account_id}:document_templates`

**Structure:**
```json
[
  {
    "id": "template_1",
    "name": "Listing Agreement",
    "description": "Real estate listing template",
    "file_path": "/path/to/file.pdf",
    "created_at": 1234567890
  }
]
```

**Usage:** User's custom document templates for the Document Editor

**Cleanup:** Deleted when user is completely removed

#### 2.2 Themes

**Key:** `user:{account_id}:themes`

**Structure:**
```json
{
  "theme_id_1": {
    "id": "theme_id_1",
    "name": "Real Estate Blue",
    "pageTitle": "Property Listing Portal",
    "tabLabel": "New Listing",
    "sections": {
      "left": {
        "title": "Client Information",
        "fields": [
          { "label": "Client Name", "defaultValue": "John Doe" }
        ]
      },
      "right": {
        "title": "Property Details",
        "fields": [...]
      }
    },
    "buttons": {
      "send": "Send for Signature",
      "preview": "Preview",
      "embed": "Embedded Sign"
    }
  }
}
```

**Usage:** UI customization and white-labeling per user

**Cleanup:** Deleted when user is completely removed

#### 2.3 Settings

**Key:** `user:{account_id}:settings`

**Structure:**
```json
{
  "defaultTheme": "theme_id_1",
  "selectedApiApp": "client_id_abc123",
  "notifications": {
    "email": true,
    "browser": false
  }
}
```

**Usage:** User preferences and portal configuration

**Cleanup:** Deleted when user is completely removed

#### 2.4 User Profile

**Key:** `user:{account_id}:profile`

**Structure:**
```json
{
  "account_id": "9db283babedc87ea379d5327641c60222cb4a2c8",
  "email_address": "user@example.com",
  "role_code": "a",
  "last_login": 1234567890
}
```

**Usage:** Persistent user profile information stored on each login. Used by admin panel to display user email even when logged out.

**Created:** On every login (overwritten with latest data)

**TTL:** None (permanent until user deletion)

**Cleanup:** Deleted when user is completely removed

**Why this exists:** Session data is ephemeral and expires after 30 days. The profile key ensures admins can always see user email/role even for inactive accounts.

#### 2.5 Form Field Defaults

**Key:** `user:{account_id}:form_field_defaults`

**Structure:**
```json
{
  "clientName": "John Doe",
  "clientEmail": "john@example.com",
  "propertyAddress": "123 Main St",
  "propertyType": "Residential",
  "listingPrice": "$500,000"
}
```

**Usage:** Pre-fill form values for faster workflow

**Cleanup:** Deleted when user is completely removed

#### 2.6 API Apps Configuration

**Key:** `user:{account_id}:api_apps`

**Structure:**
```json
{
  "client_id_1": {
    "name": "Production App",
    "client_id": "client_id_1",
    "test_mode": false,
    "visible": true,
    "last_used": 1234567890
  }
}
```

**Usage:** Store visibility and metadata for user's API apps

**Cleanup:** Deleted when user is completely removed

#### 2.7 Template Cache

**Key:** `user:{account_id}:template_cache`

**Structure:**
```json
{
  "template_id_1": {
    "template_id": "abc123...",
    "title": "Listing Agreement",
    "reusable_form_id": "form_123",
    "signer_roles": ["Client", "Agent"],
    "custom_fields": ["address", "propertyType", "listingPrice"],
    "cached_at": 1234567890
  }
}
```

**Usage:** Cache template metadata to reduce API calls

**TTL:** None (refreshed on demand)

**Cleanup:** Deleted when user is completely removed

---

## Data Relationships

### User → Sessions (One-to-Many)

```
User (account_id)
  └─ Session 1 (sess:xyz...)
  └─ Session 2 (sess:abc...)
  └─ Session N (sess:def...)
```

- One user can have multiple active sessions (different devices/browsers)
- Each session contains full user state for that device
- Sessions are independent but share the same `account_id`

### User → Per-User Data (One-to-Many)

```
User (account_id)
  ├─ user:{account_id}:document_templates
  ├─ user:{account_id}:themes
  ├─ user:{account_id}:settings
  ├─ user:{account_id}:form_field_defaults
  ├─ user:{account_id}:api_apps
  └─ user:{account_id}:template_cache
```

- All per-user data keys share the same `account_id` prefix
- Data persists across sessions
- Data is shared across all user's sessions

### Session → Per-User Data (Many-to-One)

```
Session A (device 1) ─┐
Session B (device 2) ─┼─> user:{account_id}:themes
Session C (device 3) ─┘
```

- Multiple sessions can read/write the same per-user data
- Changes in one session are visible in other sessions after page reload

---

## Access Patterns

### User Login
1. Validate API key via Dropbox Sign API
2. Create session: `sess:{sessionId}`
3. Store `accountInfo` in session (API key returned to browser, stored in `sessionStorage`)
4. Load per-user data: `user:{account_id}:*`

### User Activity
1. Middleware checks `req.session.accountInfo` (session-only routes) or `req.session.accountInfo` + `X-Api-Key` header (API routes)
2. If valid, allow access
3. Activity updates session expiration (rolling)

### User Logout
1. Destroy session: `DELETE sess:{sessionId}`
2. Per-user data remains in Redis

### Admin: Force Logout
1. Find session by `sessionId`
2. Delete: `DELETE sess:{sessionId}`
3. User is logged out on next request

### Admin: Delete User Completely
1. Find all sessions where `accountInfo.account_id === target`
2. Delete all sessions: `DELETE sess:{sessionId}` (may be multiple)
3. Find all per-user keys: `KEYS user:{account_id}:*`
4. Delete all per-user data: `DELETE user:{account_id}:*`
5. User is completely removed from database

---

## Multi-Tenancy Architecture

### Data Isolation

**Per-Session Isolation:**
- Each session has independent `signatureRequests` array
- Each session has independent `webhookEvents` object

**Per-User Isolation:**
- All `user:{account_id}:*` keys are scoped to one account
- No cross-user data access possible
- Admin panel can see all users but not modify other users' data

**Security:**
- API key stored in browser `sessionStorage` only (never persisted server-side)
- API key sent per-request via `X-Api-Key` header for routes that call Dropbox Sign API
- Session cookie is `httpOnly` (no JavaScript access to session ID)
- Session cookie is `sameSite: lax` (CSRF protection)
- Admin access controlled by `ADMIN_EMAILS` whitelist

### Shared vs. Isolated Data

| Data Type | Scope | Storage | Shared Across Sessions? |
|-----------|-------|---------|------------------------|
| API Key | Browser | `sessionStorage` (browser only) | ❌ No |
| Account Info | Session | `sess:{sessionId}.accountInfo` | ✅ Yes (same user) |
| Signature Requests | Session | `sess:{sessionId}.signatureRequests` | ❌ No |
| Webhook Events | Session | `sess:{sessionId}.webhookEvents` | ❌ No |
| User Profile | User | `user:{account_id}:profile` | ✅ Yes |
| Themes | User | `user:{account_id}:themes` | ✅ Yes |
| Settings | User | `user:{account_id}:settings` | ✅ Yes |
| Document Templates | User | `user:{account_id}:document_templates` | ✅ Yes |

---

## Expiration & Cleanup

### Automatic Cleanup (Redis)

| Key Pattern | TTL | Cleanup Method |
|-------------|-----|----------------|
| `sess:*` | 30 days | Redis auto-expire |
| `user:*:*` | None | Manual only |

### Manual Cleanup

**1. Force Logout (Single Session)**
```javascript
// Deletes one session
await redisClient.del(`sess:${sessionId}`);
```

**2. Delete User Completely**
```javascript
// Deletes ALL sessions for user
const sessions = await getAllActiveSessions();
sessions.filter(s => s.data.accountInfo.account_id === accountId)
  .forEach(s => redisClient.del(`sess:${s.sessionId}`));

// Deletes ALL per-user data
const keys = await redisClient.keys(`user:${accountId}:*`);
await redisClient.del(keys);
```

---

## Database Operations

### Read Operations

**Get Active Sessions:**
```javascript
// Uses SCAN to avoid blocking
const sessions = await getAllActiveSessions();
// Returns: [{ sessionId, data: {...} }, ...]
```

**Get Active Users:**
```javascript
// Extracts user info from sessions
const users = await getActiveUsers();
// Returns: [{ email, accountId, roleCode, ... }, ...]
```

**Get User Data:**
```javascript
// Gets all keys for one user
const userData = await getUserDataKeys(accountId);
// Returns: { themes: {...}, settings: {...}, ... }
```

### Write Operations

**Create Session:**
```javascript
req.session.accountInfo = { account_id, email_address, role_code };
await req.session.save();
// API key returned to browser via JSON response (stored in sessionStorage)
```

**Update Per-User Data:**
```javascript
const key = `user:${accountId}:themes`;
await redisClient.set(key, JSON.stringify(themes));
```

**Delete Session:**
```javascript
await redisClient.del(`sess:${sessionId}`);
```

**Delete User Completely:**
```javascript
const result = await deleteUserCompletely(accountId);
// Returns: { sessionsDeleted, dataKeysDeleted, totalKeysDeleted, keys: [...] }
```

---

## Migration & Versioning

### Current Version: v1.0

**Schema Version:** No explicit versioning yet

**Migration Strategy:**
- Redis data has no fixed schema
- Backward compatible: Missing keys return `undefined`
- Forward compatible: Extra keys are ignored

**Future Considerations:**
- Add schema version to session: `session.schema_version = 1`
- Implement migration on session read
- Document breaking changes in this file

---

## Performance Considerations

### Redis Memory Usage

**Estimated Size Per User:**
- Session: ~2-10 KB (depends on signature requests)
- Themes: ~5-20 KB (depends on number of themes)
- Settings: ~1 KB
- Templates: ~2-10 KB (depends on number of templates)
- **Total: ~10-50 KB per active user**

**Scaling:**
- 1,000 active users: ~10-50 MB
- 10,000 active users: ~100-500 MB
- 100,000 active users: ~1-5 GB

### Query Patterns

**Fast Operations (O(1)):**
- Get session by ID: `GET sess:{sessionId}`
- Get user data by key: `GET user:{account_id}:themes`
- Delete specific key: `DEL key`

**Slow Operations (O(N)):**
- List all sessions: `SCAN 0 MATCH sess:*`
- List user's keys: `KEYS user:{account_id}:*`
- Count active users: Scan all sessions

**Optimization:**
- Use `SCAN` with `COUNT` to paginate
- Cache active user count in separate key
- Limit admin queries with debouncing

---

## Backup & Recovery

### Current State: No Automatic Backups

**Recommendations:**
1. Enable Redis persistence (RDB or AOF)
2. Schedule daily backups of Redis dump
3. Store backups in S3 or similar
4. Test restore procedure quarterly

### Data Loss Scenarios

**Session Loss (Redis crash):**
- Impact: All users logged out
- Recovery: Users re-login with API key
- Data Loss: In-session signature requests & webhooks

**Per-User Data Loss:**
- Impact: Themes, settings, templates lost
- Recovery: Manual recreation or restore from backup
- Mitigation: Enable Redis persistence

---

## Future Enhancements

### Planned Changes

1. **Schema Versioning**
   - Add `schema_version` to sessions
   - Implement migration logic
   - Document version history

2. **Audit Trail**
   - Store admin actions: `audit:{timestamp}:{action}`
   - Track user login history: `user:{account_id}:login_history`
   - Keep deletion records: `deleted_users:{account_id}`

3. **Analytics Keys**
   - Track usage: `stats:daily:{date}:signature_requests`
   - Count active users: `stats:active_users_count`
   - Monitor API calls: `stats:api_calls:{account_id}`

4. **Webhook Queue**
   - Store pending webhooks: `webhook_queue:{event_id}`
   - Retry failed webhooks
   - Track delivery status

---

## Reference: Key Prefixes Summary

| Prefix | Purpose | TTL | Cleanup |
|--------|---------|-----|---------|
| `sess:` | User sessions | 30 days | Auto-expire |
| `user:` | Per-user data | None | Manual |
| `audit:` | Admin actions (future) | 90 days | Auto-expire |
| `stats:` | Analytics (future) | 7 days | Auto-expire |
| `webhook_queue:` | Pending webhooks (future) | 24 hours | Auto-expire |

---

## Document Changelog

| Date       | Version | Changes                                                                   | Author |
|------------|---------|---------------------------------------------------------------------------|--------|
| 2026-06-02 | 2.0     | Updated for browser-only API key architecture (removed apiKey from session structure) | Project maintainers |
| 2026-04-23 | 1.1     | Added `user:{account_id}:profile` key for persistent user profile storage | Project maintainers |
| 2026-04-23 | 1.0     | Initial database structure documentation                                  | Project maintainers |

---

**This is a living document. Update whenever the database structure changes.**
