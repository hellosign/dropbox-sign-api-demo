# OAuth-Based Public Deployment

This document describes the changes made to convert the demo portal to an OAuth-based deployment.

## Overview

The application has been converted from a file-based multi-user system to an OAuth-only session-based system with configurable domain and email access controls.

## Key Changes

### 1. Session Management
- **Added**: `express-session` middleware with 30-day rolling sessions
- **Configuration**: Sessions automatically extend on each activity
- **Storage**: OAuth tokens and user data now stored in sessions (not files)
- **Cookie settings**: 
  - 30-day expiration
  - HttpOnly and secure (in production)
  - SameSite protection

### 2. OAuth-Only Authentication
- **Main route** (`/`): Now requires OAuth authentication via `requireAuth` middleware
- **Redirect behavior**: Unauthenticated users automatically redirected to `/oauth/connect`
- **Token storage**: Moved from in-memory `Map` to `req.session.oauthToken`
- **Domain restriction**: Only `@dropbox.com` email addresses allowed

### 3. Domain Restriction
Added security check in OAuth callback to restrict access:
```javascript
if (!accountEmail.endsWith('@dropbox.com')) {
  // Show access denied message
}
```

### 4. Updated OAuth Endpoints

#### `/oauth/callback`
- Validates user email domain (@dropbox.com only)
- Stores tokens in session instead of Map
- Initializes session data structures
- Redirects to main portal after successful authentication

#### `/oauth/status`
- Now reads from `req.session.oauthToken` instead of `userTokens.get()`

#### `/oauth/disconnect`
- Destroys entire session using `req.session.destroy()`

#### OAuth API endpoints updated:
- `/oauth/send-signature-request`
- `/oauth/create-unclaimed-draft`
- `/oauth/send-with-document`
- All now use `getUserApiClient(req, ApiClass)` instead of `getUserApiClient(userId, ApiClass)`

### 5. API Client Changes

**Updated function signature:**
```javascript
// Old: getUserApiClient(userId, ApiClass)
// New: getUserApiClient(req, ApiClass)
```

The function now reads OAuth token from `req.session.oauthToken` instead of looking up userId in a Map.

### 6. Session Data Structure

Each authenticated user's session contains:
```javascript
{
  oauthToken: {
    access_token: string,
    refresh_token: string,
    expires_at: number,
    account_email: string
  },
  signatureRequests: [],    // Lightweight list of sent requests
  webhookEvents: {},         // Webhook events by signature request ID
  preferences: {}            // User preferences
}
```

### 7. Protected Routes

Added `requireAuth` middleware to critical routes:
- `GET /` - Main portal
- `POST /embedded` - Create embedded signature request
- `GET /templates` - List templates
- `GET /api-templates` - Fetch templates from API
- `GET /signatures` - List signature requests

### 8. Removed Legacy Code

- Removed `const userTokens = new Map()` declaration
- Removed `userId` parameters from OAuth endpoints
- Removed file-based API user management for OAuth flow

## Environment Variables

### Required for OAuth Deployment

Create a `.env` file based on `.env.example.oauth`:

```bash
# OAuth Configuration (Required)
OAUTH_CLIENT_ID=your_oauth_client_id_here
OAUTH_CLIENT_SECRET=your_oauth_client_secret_here
OAUTH_REDIRECT_URI=http://localhost:3001/oauth/callback

# Session Secret (Required - use strong random string in production)
SESSION_SECRET=your-secret-key-change-in-production

# Server Configuration
PORT=3001
NODE_ENV=development

# Optional
CLIENT_ID=your_api_app_client_id_optional
TEMPLATE_IDS=template_id_1,template_id_2
```

## Deployment Architecture

### Recommended Setup for Controlled Demos

**Authentication:**
- OAuth-only (no API key entry)
- Domain/email restriction configured through `ALLOWED_DOMAINS` and `ALLOWED_EMAILS`
- 30-day rolling sessions (perfect for recurring demos)

**Data Persistence:**
- Session-based storage (no database needed)
- Keep: signature requests, webhook events, preferences
- Drop: full API logs (too large, not needed for demos)
- Auto-cleanup after 30 days of inactivity

**Deployment:**
- Single server (VM or cloud)
- Memory-based sessions OR Redis (if you want persistence across restarts)
- Simple, lightweight (~50KB per active demo user)

### Session Behavior

**User Journey:**
1. Visit portal URL
2. Redirected to `/oauth/connect`
3. Authorize with Dropbox Sign account (@dropbox.com email)
4. Redirected back to portal
5. Session lasts 30 days with activity
6. After 30 days of inactivity, must re-authenticate

**Data Retention:**
- Session data persists for 30 days with activity
- Sessions automatically extend on each request (rolling)
- Old sessions cleaned up automatically
- No manual maintenance required

## Testing

### Local Testing

1. Configure OAuth credentials in `.env`
2. Start server: `npm start`
3. Visit `http://localhost:3001`
4. Should redirect to `/oauth/connect`
5. Complete OAuth flow with @dropbox.com account
6. Verify access to main portal

### Test Domain Restriction

1. Try authenticating with non-@dropbox.com email
2. Should see "Access Restricted" error
3. Should not gain access to portal

### Test Session Persistence

1. Authenticate with OAuth
2. Close browser
3. Reopen browser and visit portal
4. Should remain logged in (session persists)
5. After 30 days of inactivity, should require re-auth

## Migration from File-Based System

### What Changed

**Before (File-Based):**
- API keys stored in `data/api-users.json`
- User switching via Settings tab
- Permanent file-based storage
- Manual data cleanup
- Multi-user support with shared server

**After (OAuth Session-Based):**
- OAuth tokens stored in sessions
- Automatic user identification via OAuth email
- 30-day session-based storage
- Automatic data cleanup
- Per-user isolated sessions

### Backwards Compatibility

The file-based system (`data/api-users.json`) is still used for:
- Legacy API routes (non-OAuth)
- Fallback if OAuth not configured
- Local development with API keys

For pure OAuth deployment, you can ignore `data/api-users.json`.

## Security Considerations

### Implemented

✅ Domain restriction (@dropbox.com only)
✅ HttpOnly cookies (prevent XSS)
✅ Secure cookies in production (HTTPS only)
✅ SameSite cookie protection (CSRF)
✅ Session-based token storage (no localStorage)
✅ 30-day session expiration

### Recommendations for Production

- Use strong random `SESSION_SECRET` (32+ characters)
- Enable HTTPS (required for secure cookies)
- Use Redis for session storage (survives server restarts)
- Set `NODE_ENV=production` in environment
- Consider adding rate limiting for OAuth endpoints
- Monitor OAuth token refresh failures
- Set up logging for authentication events

## Future Enhancements

### Potential Improvements

1. **Redis Session Store**: Persist sessions across server restarts
   ```javascript
   import RedisStore from 'connect-redis';
   import { createClient } from 'redis';
   
   const redisClient = createClient();
   await redisClient.connect();
   
   app.use(session({
     store: new RedisStore({ client: redisClient }),
     // ... other options
   }));
   ```

2. **Session Management UI**: Allow users to view/revoke their sessions

3. **Activity Logging**: Track user activity for analytics

4. **Multi-Domain Support**: Allow multiple allowed domains (e.g., @hellosign.com)

5. **Remember Me**: Optional longer session duration

6. **Graceful Degradation**: Better error messages for expired sessions

## Troubleshooting

### Common Issues

**Issue: "Access Restricted" error**
- **Cause**: Email address is not @dropbox.com
- **Solution**: Use a Dropbox Sign employee account

**Issue: Session lost after server restart**
- **Cause**: Using memory-based sessions (default)
- **Solution**: Use Redis session store for persistence

**Issue: OAuth callback fails**
- **Cause**: Incorrect `OAUTH_REDIRECT_URI` in .env
- **Solution**: Ensure URI matches OAuth app configuration

**Issue: "User not authenticated with OAuth" error**
- **Cause**: Session expired or OAuth token missing
- **Solution**: Redirect to `/oauth/connect` to re-authenticate

## Support

For questions or issues:
- Review the deployment plan for the target environment before rollout.
- Check OAuth test page: `http://localhost:3001/oauth-test`
- Review OAuth debug endpoint: `http://localhost:3001/oauth/debug`

## Summary

The application is now configured as an OAuth-only demo portal. Key features:
- ✅ OAuth authentication with domain restriction
- ✅ 30-day session-based storage
- ✅ Automatic cleanup and session management
- ✅ Simple deployment (no database required)
- ✅ Suitable for 50-100 concurrent demo users
