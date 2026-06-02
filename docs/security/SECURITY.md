# Security Documentation

## Overview

This document outlines the security measures, known risks, and recommendations for the Sign Portal application.

## Current Security Measures

### Authentication & Authorization
- ✅ **Session-based authentication** using express-session with Redis store
- ✅ **API key validation** against Dropbox Sign API on login
- ✅ **Role-based access control** for admin functions (ADMIN_EMAILS whitelist)
- ✅ **Domain/email whitelisting** (ALLOWED_DOMAINS, ALLOWED_EMAILS)
- ✅ **API key rotation detection** with automatic session invalidation

### Network Security
- ✅ **Helmet.js** for security headers (CSP, HSTS, etc.)
- ✅ **Rate limiting** on authentication endpoints (5 attempts per 15 min in prod)
- ✅ **Rate limiting** on API endpoints (100 req/min)
- ✅ **Request size limits** (10MB max)
- ✅ **CORS** disabled (same-origin policy)

### Data Protection
- ✅ **Browser-only API key storage** (sessionStorage — never persisted server-side)
- ✅ **Session cookies** with httpOnly, secure (in prod), and sameSite flags
- ✅ **Redis for session storage** (not in-memory)
- ✅ **Hashed API keys** for rotation detection (SHA-256)

### Input Validation
- ✅ **Express body parser** with size limits
- ✅ **Multer** for file upload validation
- ✅ **Handlebars** template escaping (default `{{` escapes HTML)

### Logging & Monitoring
- ✅ **API request/response logging** (capped at 20 per user)
- ✅ **Admin audit trail** for user management actions
- ✅ **Error logging** with sanitized messages

---

## Known Security Risks & Mitigations

### Critical

#### 1. Dependency Vulnerabilities
**Status:** ✅ FIXED  
**Previous Risk:** Multiple npm vulnerabilities  
**Resolution:** All vulnerabilities fixed via `npm audit fix`
**Current Status:** 0 vulnerabilities  
**Recommendation:** Run `npm audit` weekly and before deployments to maintain security posture.

#### 2. CSRF Protection
**Status:** ✅ IMPLEMENTED  
**Implementation:** Using csrf-csrf (modern replacement for deprecated csurf)
- Double-submit cookie pattern
- Tokens required for POST, PUT, PATCH, DELETE requests
- Automatic token injection in all views
- Frontend helper function for AJAX requests
**Configuration:** Set CSRF_SECRET environment variable for production

#### 3. API Key Storage (Browser-Only Architecture)
**Status:** ✅ IMPLEMENTED  
**Implementation:** API keys are stored exclusively in the browser's `sessionStorage` and are never persisted on the server.
- On login, server validates the API key against Dropbox Sign API and returns it to the browser
- Browser stores the key in `sessionStorage` (cleared when tab/window closes)
- Each API request includes the key via `X-Api-Key` header
- Server session stores only `accountInfo` (email, account_id, role) — no secrets
- No `ENCRYPTION_KEY` environment variable needed
**Additional Protection:** Redis should still be:
- Behind firewall (not public)
- Password protected
- TLS encrypted if remote
- Backed up securely

### High

#### 4. No HTTPS Enforcement
**Risk:** HTTP traffic can be intercepted (MITM attacks)  
**Impact:** Session hijacking, API key theft  
**Mitigation:** Add HTTPS redirect in production:
```javascript
if (IS_PRODUCTION && req.headers['x-forwarded-proto'] !== 'https') {
  return res.redirect(301, 'https://' + req.headers.host + req.url);
}
```
**Status:** ⚠️ Relies on reverse proxy (ngrok, nginx)

#### 5. Sensitive Data in Logs
**Status:** ✅ IMPLEMENTED  
**Implementation:** Automatic PII redaction in API logs
- `redactSensitiveData()` function redacts email_address, phone_number, ssn, password, token, api_key
- Applied automatically before storing logs in Redis
- Recursive redaction for nested objects
- Reduced log retention from 50 to 20 entries per user
**Coverage:** All API request/response logs are redacted

#### 6. Admin Role via Email List
**Risk:** Simple email list for admin access control  
**Impact:** Easy to misconfigure, no granular permissions  
**Current State:** Acceptable for small teams  
**Recommendation:** Implement RBAC with roles stored in Redis

### Medium

#### 7. Session Fixation
**Status:** ✅ IMPLEMENTED  
**Implementation:** Session is regenerated after successful login:
```javascript
req.session.regenerate((err) => {
  req.session.accountInfo = accountInfo;
});
```

#### 8. Input Validation
**Status:** ✅ IMPLEMENTED  
**Implementation:** express-validator library integrated
- Validation on login endpoint (API key format)
- Validation middleware helpers available (body, query, param)
- Validation results checked before processing requests
**Example Usage:** Login validates API key length and format

#### 9. Error Messages Expose Stack Traces
**Risk:** Detailed errors sent to client in dev mode  
**Impact:** Information disclosure  
**Current Mitigation:** Only in development mode  
**Recommendation:** Ensure `NODE_ENV=production` in prod

#### 10. Webhook Signature Verification
**Status:** ✅ HELPER FUNCTION READY  
**Implementation:** `verifyWebhookSignature()` helper function created
- HMAC-SHA256 signature verification
- Timing-safe comparison to prevent timing attacks
- Ready to use when webhook POST endpoint is implemented
**Usage Example:**
```javascript
if (!verifyWebhookSignature(apiKey, req.body, req.headers['x-hellosign-signature'])) {
  return res.status(401).send('Invalid signature');
}
```
**Note:** Application currently records webhook events but doesn't receive them via POST endpoint

### Low

#### 11. Redis Without Persistence
**Risk:** Redis data loss on restart  
**Impact:** All sessions invalidated, API logs lost  
**Recommendation:** Enable Redis persistence (RDB or AOF)

#### 12. No Backup Strategy
**Risk:** No documented backup/restore procedures  
**Recommendation:** Document backup strategy for Redis and code

---

## Security Checklist for Production

### Before Deployment
- [ ] Run `npm audit` and fix critical/high vulnerabilities
- [ ] Set `NODE_ENV=production`
- [ ] Enable HTTPS and force redirect
- [ ] Configure secure Redis (password, TLS, firewall)
- [ ] Review and limit ADMIN_EMAILS, ALLOWED_EMAILS
- [ ] Enable Redis persistence (RDB/AOF)
- [ ] Set up log rotation and monitoring
- [x] Add CSRF protection (implemented via csrf-csrf)
- [x] Test session regeneration after login (implemented)
- [ ] Verify webhook signature validation
- [ ] Review CSP headers are not too permissive

### Ongoing
- [ ] Weekly `npm audit`
- [ ] Monthly security review
- [ ] Monitor admin actions
- [ ] Review API logs for anomalies
- [ ] Rotate admin API keys quarterly
- [ ] Update dependencies regularly

---

## Incident Response

### Session Compromise
1. Identify affected sessions in Redis: `redis-cli KEYS "sess:*"`
2. Clear sessions: `redis-cli DEL sess:<id>`
3. Force re-authentication for all users
4. Review logs for unauthorized actions

### API Key Leak
1. Rotate API key at Dropbox Sign console
2. Invalidate all sessions: `redis-cli FLUSHDB`
3. Notify affected users
4. Review API logs for unauthorized requests

### Redis Compromise
1. Shut down Redis
2. Rotate all API keys
3. Restore from backup
4. Enable Redis AUTH and TLS
5. Firewall Redis to app server only

---

## Threat Model

### Assets
1. User API keys (stored in browser sessionStorage only)
2. User data (themes, templates, settings)
3. Signature requests metadata
4. Admin access

### Threats
1. **Unauthorized access** → Mitigated by authentication, rate limiting
2. **Session hijacking** → Mitigated by httpOnly cookies, HTTPS
3. **CSRF attacks** → ✅ Mitigated by csrf-csrf (double-submit cookie pattern)
4. **XSS attacks** → Mitigated by CSP, Handlebars escaping
5. **Redis compromise** → Low risk (no secrets stored — only account metadata and session state)
6. **Dependency vulnerabilities** → Ongoing maintenance required

### Trust Boundaries
- **User ↔ Application**: Authenticated via API key
- **Application ↔ Redis**: Assumed secure (same network)
- **Application ↔ Dropbox Sign API**: API key authentication
- **Admin ↔ Application**: Email whitelist

---

## Security Testing

### Automated Tools
```bash
# Dependency scanning
npm audit

# Security audit script
./scripts/security-audit.sh

# Static analysis (optional)
npm install -g eslint-plugin-security
```

### Manual Testing
1. **Authentication bypass**: Try accessing admin without login
2. **CSRF**: Submit forms from external origin
3. **XSS**: Test input fields with `<script>alert(1)</script>`
4. **Session fixation**: Check session ID changes after login
5. **Rate limiting**: Attempt >5 logins in 15 minutes

---

## Security Contacts

- **Primary**: [Your Team Email]
- **Security Team**: [Security Team Email]
- **Dropbox Sign Security**: security@dropboxsign.com

---

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Dropbox Sign API Security](https://developers.hellosign.com/api/reference/security/)

---

**Last Updated:** 2026-06-02  
**Version:** 2.0  
**Status:** Updated for browser-only API key architecture
