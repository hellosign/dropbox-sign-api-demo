# OAuth Authentication Setup Guide

This guide explains how to configure and use the OAuth authentication feature in the Sign Portal Demo.

## What is OAuth Authentication?

OAuth allows external users to authenticate with their own Dropbox Sign accounts and send signature requests through your application. Instead of using your API key for all requests, each user authenticates with their own credentials.

---

## ⚠️ Important: Audit Trail Attribution

**After extensive testing, we confirmed the following:**

All OAuth-authenticated signature requests using API Apps show:
```
Sent by [your-app-owner@example.com] acting on behalf of [oauth-user@example.com]
```

**This cannot be removed** with standard Dropbox Sign OAuth applications. The "acting on behalf of" attribution is:
- ✅ By design for legal accountability
- ✅ Shows the complete chain of custody
- ✅ Required for compliance and billing tracking
- ✅ Standard for embedded signing platforms

**To completely remove your company name from audit trails**, you would need:
- Enterprise/white-label solution from Dropbox Sign (contact sales)
- Each user to have their own templates in their own accounts (not practical for most SaaS apps)
- Alternative e-signature provider with different attribution model

---

## Configuration Steps

### 1. Register OAuth Application

1. Go to: https://app.hellosign.com/home/myApiApps
2. Click "Create OAuth App" or edit an existing OAuth application
3. Fill in the details:
   - **App Name**: Your application name
   - **Domain**: Your domain (e.g., `your-ngrok-url.ngrok.app`)
   - **Callback URL**: `https://your-domain.com/oauth/callback`
     - For development with ngrok: `https://your-ngrok-url.ngrok.app/oauth/callback`
     - For production: `https://yourdomain.com/oauth/callback`

### 2. Choose OAuth Billing Model

**Option A: "Charge me for API requests made"** (Recommended)
- ✅ You pay for all API requests
- ✅ Users don't need paid Dropbox Sign accounts
- ✅ Predictable costs
- ⚠️ Limited OAuth scopes (no template access via OAuth)
- Audit trail: "Sent by you acting on behalf of user"

**Option B: "Charge users for API requests made"**
- ✅ Full OAuth scopes (including template access)
- ✅ Users pay for their own requests
- ❌ Each user needs a paid Dropbox Sign account
- ❌ Users can only access their own templates
- Audit trail: "Sent by you acting on behalf of user"

**Note:** Both options show "acting on behalf of" in audit trails.

### 3. Configure OAuth Scopes

Enable the scopes your application needs:
- **Basic account info (limited)** - Get user's email and name
- **Send signature requests (limited)** - Send signature requests
- **Account access** - Full account management (requires "Charge users")
- **Template access** - Access templates (requires "Charge users")

### 4. Get OAuth Credentials

After creating the OAuth app, copy:
- **OAuth Client ID**: Long hexadecimal string
- **OAuth Client Secret**: Long hexadecimal string

### 5. Update Environment Variables

Edit your `.env` file and add:

```env
OAUTH_CLIENT_ID=your_oauth_client_id_here
OAUTH_CLIENT_SECRET=your_oauth_client_secret_here
OAUTH_REDIRECT_URI=https://your-domain.com/oauth/callback
```

For ngrok development:
```env
OAUTH_CLIENT_ID=your_oauth_client_id_here
OAUTH_CLIENT_SECRET=your_oauth_client_secret_here
OAUTH_REDIRECT_URI=https://your-ngrok-url.ngrok.app/oauth/callback
```

### 6. Restart Server

```bash
npm start
```

---

## Using OAuth Authentication

### Accessing the OAuth Test Page

1. Start your server: `npm start`
2. Go to: `https://your-domain.com/oauth-test`
3. Or from the main app: **Settings tab → OAuth Authentication section → "Open OAuth Test Page"**

### OAuth Flow

**Step 1: Connect**
1. User clicks "Connect with Dropbox Sign OAuth"
2. Redirected to Dropbox Sign login page
3. User logs in with their Dropbox Sign account
4. User authorizes your application
5. Redirected back to your app with access token

**Step 2: Send Signature Requests**
Once connected, users can:
- **Send with Uploaded Document**: Upload a PDF and send for signature
- **Send with Template**: Use a template (only works with "Charge users" billing)
- **Create Unclaimed Draft**: Create a draft that can be claimed and sent

---

## OAuth vs API Key Comparison

| Feature | API Key | OAuth "Charge Me" | OAuth "Charge Users" |
|---------|---------|-------------------|---------------------|
| **Authentication** | Your account | User's account | User's account |
| **Who Pays** | You | You | Each user |
| **Templates** | Your templates | Your templates | User's templates only |
| **Audit Trail** | Sent by you | Sent by you acting on behalf of user | Sent by you acting on behalf of user |
| **User Setup** | None | Authenticate once | Authenticate + paid account |

---

## Technical Details

### Endpoints

The following endpoints are available:

- `GET /oauth-test` - OAuth test page UI
- `GET /oauth/connect` - Initiate OAuth flow
- `GET /oauth/callback` - OAuth redirect handler
- `GET /oauth/status` - Check OAuth connection status
- `POST /oauth/disconnect` - Disconnect OAuth
- `POST /oauth/send-signature-request` - Send with template (OAuth token)
- `POST /oauth/send-with-document` - Send with uploaded document (OAuth token)
- `POST /oauth/create-unclaimed-draft` - Create unclaimed draft (OAuth token)
- `GET /oauth/debug` - Debug OAuth configuration

### Token Storage

**Current Implementation (Demo):**
- Tokens stored in memory using `Map<userId, tokenData>`
- Tokens lost on server restart
- Not suitable for production

**For Production:**
You should implement:
1. Database storage (PostgreSQL, MySQL, MongoDB, etc.)
2. Encrypted token storage
3. Token refresh logic (tokens expire)
4. User management system
5. Proper error handling

---

## Troubleshooting

### "Invalid Client" Error

**Cause:** Wrong OAuth Client ID or Client Secret

**Fix:**
1. Verify credentials in Dropbox Sign OAuth app settings
2. Check `.env` file has correct values (no extra characters)
3. Restart server after updating `.env`

### "Wrong client secret" Error

**Cause:** Incorrect Client Secret in `.env`

**Fix:**
1. Go to Dropbox Sign OAuth app settings
2. Copy the OAuth Secret (not API key secret)
3. Update `OAUTH_CLIENT_SECRET` in `.env`
4. Remove any extra characters (like "Use" at the end)

### "This action is not allowed by the granted scopes" Error

**Cause:** OAuth token doesn't have permission for the action

**Fix:**
1. Check OAuth billing model ("Charge me" vs "Charge users")
2. Verify OAuth scopes are enabled in app settings
3. Disconnect and reconnect OAuth to get new token with updated scopes
4. For template access, switch to "Charge users" billing

### Redirect URI Mismatch

**Cause:** Callback URL doesn't match OAuth app settings

**Fix:**
1. Verify callback URL in Dropbox Sign matches exactly: `https://your-domain.com/oauth/callback`
2. No trailing slash
3. Must use HTTPS (except localhost)
4. Update `.env` OAUTH_REDIRECT_URI to match

---

## Security Best Practices

### For Production Deployment:

1. **Encrypt Token Storage**
   - Use encryption at rest for refresh tokens
   - Store in secure database with proper access controls

2. **Use HTTPS**
   - Always use HTTPS in production
   - Validate SSL certificates

3. **Validate State Parameter**
   - Implement CSRF protection using state parameter
   - Verify state on callback

4. **Secure Client Secret**
   - Never expose client secret in client-side code
   - Use environment variables
   - Rotate secrets periodically

5. **Handle Token Expiration**
   - Implement automatic token refresh
   - Handle expired token errors gracefully
   - Re-prompt for authentication when needed

6. **Scope Minimization**
   - Only request OAuth scopes you actually need
   - Review scopes periodically

---

## FAQ

**Q: Can I remove "acting on behalf of" from audit trails?**  
A: No, not with standard Dropbox Sign OAuth applications. This is by design for legal accountability. Contact Dropbox Sign enterprise sales for white-label solutions.

**Q: Do users need Dropbox Sign accounts?**  
A: With "Charge me" billing, users just need to authenticate (free Dropbox Sign account works). With "Charge users" billing, users need paid accounts.

**Q: Can OAuth users access my templates?**  
A: With "Charge me" billing, no (via OAuth). With "Charge users" billing, no - they can only access their own templates.

**Q: How do I test OAuth locally?**  
A: Use ngrok to expose localhost over HTTPS: `ngrok http --url=your-ngrok-url.ngrok.app 3001`

**Q: What happens when tokens expire?**  
A: Access tokens expire after a period. Use the refresh token to get a new access token without re-authentication. In this demo, users need to reconnect after server restart.

---

## Contact & Support

For enterprise features, white-labeling, or custom attribution options:
- **Dropbox Sign Sales**: https://www.dropbox.com/sign/contact-sales
- **API Documentation**: https://developers.hellosign.com/
- **OAuth Guide**: https://app.hellosign.com/api/oauthWalkthrough

---

## Summary

OAuth authentication is now configured and ready to use at `/oauth-test`. Remember that audit trails will always show "acting on behalf of" when using API Apps - this is standard for embedded signing platforms and ensures legal accountability.
