# OAuth Data Isolation - Fixed Issues

## Problem Identified

After authenticating with OAuth, users were seeing **the same API Apps and Templates** as other users on the same machine. This was because the application was still using:

1. **File-based cache** - Shared across all users
2. **Global API clients** - Using legacy API keys instead of OAuth tokens

## Root Cause

### Before Fix

```javascript
// Global API client using legacy API key
const apiAppApi = new DropboxSign.ApiAppApi();
apiAppApi.username = API_KEY; // ❌ Same for all users

// File-based cache shared across users
let appsServerCache = loadDiskCache(APPS_CACHE_FILE); // ❌ Shared file
```

When User A and User B authenticated with OAuth on the same machine:
- Both saw User A's API apps (whoever logged in first)
- Data was cached to disk and shared
- OAuth tokens weren't being used for API calls

## Solution Implemented

### 1. Use OAuth User's API Client

**Changed from:**
```javascript
app.get("/api-apps", async (req, res) => {
  const response = await apiAppApi.apiAppList(1, 20); // ❌ Global client
```

**Changed to:**
```javascript
app.get("/api-apps", requireAuth, async (req, res) => {
  const userApiAppApi = getUserApiClient(req, DropboxSign.ApiAppApi); // ✅ OAuth client
  const response = await userApiAppApi.apiAppList(1, 20);
```

### 2. Session-Based Cache (Per User)

**Changed from:**
```javascript
// Shared file cache
let appsServerCache = loadDiskCache(APPS_CACHE_FILE); // ❌ Shared
```

**Changed to:**
```javascript
// Session-based cache
if (!req.session.appsCache) {
  req.session.appsCache = { data: null, timestamp: 0 }; // ✅ Per-user
}
```

### 3. Session-Based Settings

**Changed from:**
```javascript
// Global settings
const visible = appVisibility[app.clientId]; // ❌ Shared
```

**Changed to:**
```javascript
// Session settings
const sessionAppVisibility = req.session.appVisibility || {}; // ✅ Per-user
const visible = sessionAppVisibility[app.clientId];
```

## Endpoints Fixed

### `/api-apps` - List API Apps
- ✅ Now uses OAuth user's token
- ✅ Cache stored in session (per-user)
- ✅ App visibility settings per-user

### `/api-templates` - List Templates
- ✅ Now uses OAuth user's token
- ✅ Cache stored in session (per-user)
- ✅ Template labels per-user

## Data Isolation Now Guaranteed

Each OAuth user now has:

| Data Type | Storage | Isolation |
|-----------|---------|-----------|
| **API Apps** | `req.session.appsCache` | ✅ Per-user |
| **Templates** | `req.session.templatesCache` | ✅ Per-user |
| **App Visibility** | `req.session.appVisibility` | ✅ Per-user |
| **App Test Mode** | `req.session.appTestMode` | ✅ Per-user |
| **Template Labels** | Redis `user:{account_id}:template_labels` | ✅ Per-user |
| **Selected API App** | Redis `user:{account_id}:settings.selectedApiApp` | ✅ Per-user |
| **Themes** | Redis `user:{account_id}:themes` | ✅ Per-user |
| **Portal Settings** | Redis `user:{account_id}:settings` | ✅ Per-user |
| **OAuth Token** | `req.session.oauthToken` | ✅ Per-user |
| **Signature Requests** | `req.session.signatureRequests` | ✅ Per-user |
| **Webhook Events** | `req.session.webhookEvents` | ✅ Per-user |

**Note**: Configuration data (themes, template labels, portal settings, selected API app) is stored in Redis and persists across sessions. Your preferences are remembered even after logging out and back in.

## Testing Data Isolation

### Test Scenario

1. **User A** authenticates with `alice@dropbox.com`
   - Sees their own API apps
   - Sees their own templates

2. **User B** authenticates with `bob@dropbox.com` (different browser/session)
   - Sees their own API apps (NOT Alice's)
   - Sees their own templates (NOT Alice's)

3. Both users can work independently without seeing each other's data

### How to Verify

1. Open two different browsers (e.g., Chrome and Firefox)
2. Authenticate User A in Chrome
3. Authenticate User B in Firefox
4. Compare the API Apps and Templates shown
5. They should be **different** (based on each user's Dropbox Sign account)

## Legacy File-Based Data

The following files are **no longer used** for OAuth sessions:

- ❌ `data/cache-apps.json` - Replaced by session cache
- ❌ `data/cache-templates.json` - Replaced by session cache
- ❌ `data/api-users.json` - Only used for legacy API key mode

These files may still exist but won't affect OAuth users.

## Migration Impact

### What Changed

| Aspect | Before (File-Based) | After (OAuth Session) |
|--------|---------------------|----------------------|
| **Data Source** | Shared file cache | Per-user OAuth API calls |
| **API Client** | Global with API key | Per-request with OAuth token |
| **Cache Location** | Disk files | Session memory |
| **Data Visibility** | Shared across users | Isolated per session |
| **Requires Auth** | No | Yes (requireAuth middleware) |

### Backwards Compatibility

- Legacy API key mode still works (for local development)
- File-based cache still used if not authenticated via OAuth
- OAuth mode completely isolated from file-based mode

## Security Benefits

1. ✅ **Data Isolation** - Users can't see each other's data
2. ✅ **OAuth Security** - Uses OAuth tokens, not shared API keys
3. ✅ **Session-Based** - Data expires with session (30 days)
4. ✅ **No Disk Leakage** - OAuth data not written to shared files
5. ✅ **Per-User Permissions** - Each user has their own Dropbox Sign permissions

## Summary

**Problem:** OAuth users saw shared data from file cache and global API clients

**Solution:** 
- Use OAuth user's API client for all API calls
- Store cache and settings in session (per-user)
- Remove dependency on shared file cache

**Result:** Complete data isolation between OAuth users ✅

Each user now sees only their own:
- API apps from their Dropbox Sign account
- Templates from their Dropbox Sign account
- Signature requests they created
- Webhook events for their requests
