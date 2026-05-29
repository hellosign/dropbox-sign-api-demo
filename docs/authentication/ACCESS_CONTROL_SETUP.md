# Access Control Setup Guide

## Overview

The SignPortalDemo application now includes **email domain-based access control**. When a user logs in with their Dropbox Sign API key, the system automatically retrieves their email address and checks if they are allowed to access the application.

## How It Works

### Automatic Email Detection
1. User enters their Dropbox Sign API key
2. System validates the API key with Dropbox Sign
3. System **automatically retrieves the email address** associated with that API key
4. System checks if the email domain or specific email is allowed
5. Access is granted or denied based on the configuration

**Important:** The user never needs to enter their email - it's retrieved automatically from their API key!

---

## Configuration

Access control is configured via environment variables in your `.env`, `.env.development`, or `.env.production` file.

### Environment Variables

#### `ALLOWED_DOMAINS` (Optional)
Comma-separated list of allowed email domains (without the @ symbol).

**Default:** `dropbox.com`

**Example:**
```bash
ALLOWED_DOMAINS=dropbox.com,hellosign.com,example.com
```

This allows any email ending with `@dropbox.com`, `@hellosign.com`, or `@example.com`.

#### `ALLOWED_EMAILS` (Optional)
Comma-separated list of specific email addresses to whitelist.

**Default:** Empty (no specific emails)

**Example:**
```bash
ALLOWED_EMAILS=john@external.com,jane@partner.com,contractor@freelance.io
```

This allows specific individuals even if their domain isn't in `ALLOWED_DOMAINS`.

---

## Access Control Logic

When a user tries to log in:

```
1. User enters API key
2. System validates API key → Gets email (e.g., user@example.com)
3. Extract domain (example.com)
4. Check: Is domain in ALLOWED_DOMAINS? OR Is email in ALLOWED_EMAILS?
5. If YES → Access granted ✅
6. If NO → Access denied with error message ❌
```

---

## Configuration Examples

### Example 1: Single Domain (Default)
```bash
# Only @dropbox.com emails
ALLOWED_DOMAINS=dropbox.com
```

**Result:**
- ✅ `alice@dropbox.com` → Allowed
- ✅ `bob@dropbox.com` → Allowed
- ❌ `charlie@gmail.com` → **Denied** (shows: "Access restricted. Only emails from: @dropbox.com are allowed.")

### Example 2: Multiple Domains
```bash
# Multiple company domains
ALLOWED_DOMAINS=dropbox.com,hellosign.com,acme.com
```

**Result:**
- ✅ `user@dropbox.com` → Allowed
- ✅ `user@hellosign.com` → Allowed
- ✅ `user@acme.com` → Allowed
- ❌ `user@gmail.com` → **Denied**

### Example 3: Specific Emails Only
```bash
# No domains, only specific emails
ALLOWED_DOMAINS=
ALLOWED_EMAILS=contractor1@freelance.com,partner@external.com
```

**Result:**
- ✅ `contractor1@freelance.com` → Allowed
- ✅ `partner@external.com` → Allowed
- ❌ `other@freelance.com` → **Denied** (not in specific list)
- ❌ `user@dropbox.com` → **Denied** (no domains allowed)

### Example 4: Mixed Approach (Recommended)
```bash
# Company domains + specific external users
ALLOWED_DOMAINS=dropbox.com,hellosign.com
ALLOWED_EMAILS=consultant@external.com,vendor@partner.com
```

**Result:**
- ✅ `employee@dropbox.com` → Allowed (domain match)
- ✅ `employee@hellosign.com` → Allowed (domain match)
- ✅ `consultant@external.com` → Allowed (specific email)
- ✅ `vendor@partner.com` → Allowed (specific email)
- ❌ `other@external.com` → **Denied**

### Example 5: Wide Open (For Testing Only)
```bash
# Allow many domains (not recommended for production)
ALLOWED_DOMAINS=dropbox.com,hellosign.com,gmail.com,yahoo.com,outlook.com
```

---

## Setup Instructions

### For Development (.env.development)

1. Open your `.env.development` file:
   ```bash
   nano .env.development
   ```

2. Add or update these lines:
   ```bash
   # Access Control
   ALLOWED_DOMAINS=dropbox.com,hellosign.com
   ALLOWED_EMAILS=contractor@external.com
   ```

3. Save the file

4. Restart the server:
   ```bash
   npm start
   ```

### For Production (.env.production)

1. Open your `.env.production` file (or `.env` on EC2):
   ```bash
   nano .env.production
   ```

2. Add access control:
   ```bash
   # Access Control - Production
   ALLOWED_DOMAINS=dropbox.com
   ALLOWED_EMAILS=
   ```

3. Save and restart:
   ```bash
   pm2 restart server
   ```

---

## Verification

### Check Configuration on Startup

When the server starts, you'll see:
```
[ACCESS CONTROL] Allowed domains: [ 'dropbox.com', 'hellosign.com' ]
[ACCESS CONTROL] Allowed emails: 2 specific emails
```

### Test Access Control

#### Test 1: Allowed Domain
1. Get an API key for a `@dropbox.com` email
2. Enter the API key on the login page
3. Should successfully log in ✅

#### Test 2: Disallowed Domain
1. Get an API key for a `@gmail.com` email (or other non-allowed domain)
2. Enter the API key on the login page
3. Should see error: "Access restricted. Only emails from: @dropbox.com are allowed." ❌

#### Test 3: Specific Email
1. Add a specific email to `ALLOWED_EMAILS`
2. Use that email's API key
3. Should log in successfully even if domain isn't in `ALLOWED_DOMAINS` ✅

---

## Security Features

### ✅ Case Insensitive
Email and domain matching is case-insensitive:
- `User@Dropbox.Com` matches `dropbox.com` ✅

### ✅ Exact Domain Match
Must match the entire domain:
- `dropbox.com` matches `user@dropbox.com` ✅
- But NOT `user@mail.dropbox.com` ❌

### ✅ Whitespace Handling
Spaces are automatically trimmed:
- `dropbox.com, hellosign.com` works correctly ✅

### ✅ Empty Value Filtering
Empty strings are automatically filtered:
- `ALLOWED_EMAILS=,,,` is treated as no specific emails ✅

### ✅ Automatic Email Retrieval
Users don't enter their email - it's retrieved from their API key:
- Prevents email spoofing ✅
- Always accurate ✅

---

## Troubleshooting

### Issue: All users are denied access

**Symptoms:**
- Everyone gets "Access restricted" message
- Even @dropbox.com users can't log in

**Solutions:**
1. Check `.env.development` or `.env.production` has `ALLOWED_DOMAINS` set
2. Verify format: `ALLOWED_DOMAINS=dropbox.com` (no @ symbol)
3. Check server startup logs for `[ACCESS CONTROL]` lines
4. Restart the server after changing `.env`

### Issue: Specific email not working

**Symptoms:**
- User's email should be allowed but gets denied
- Email is in `ALLOWED_EMAILS` list

**Solutions:**
1. Check for exact match (case doesn't matter, but spelling does)
2. No extra spaces: `user@example.com` not ` user@example.com `
3. Full email required: `user@example.com` not just `user`
4. Check server logs for actual email retrieved

### Issue: Domain not matching

**Symptoms:**
- Domain is in list but users are denied
- Subdomains not working

**Solutions:**
1. Domain only, no @ symbol: `dropbox.com` not `@dropbox.com`
2. Exact domain match: `dropbox.com` doesn't match `mail.dropbox.com`
3. For subdomains, add each separately: `ALLOWED_DOMAINS=dropbox.com,mail.dropbox.com`

### Issue: Wrong email being checked

**Symptoms:**
- User claims they have @dropbox.com but system says different

**Solutions:**
1. Check the API key - it might be for a different account
2. Look at server logs: `[AUTH] User authenticated: actual.email@domain.com`
3. The email comes from Dropbox Sign API, not user input

---

## Logging

The server logs access control decisions:

### Successful Login:
```
[AUTH] User authenticated: alice@dropbox.com (account_id_123)
[ACCESS CONTROL] Access granted for alice@dropbox.com
```

### Denied Login:
```
[AUTH] User authenticated: bob@gmail.com (account_id_456)
[ACCESS CONTROL] Access denied for bob@gmail.com (domain: gmail.com)
```

Monitor these logs to troubleshoot access issues.

---

## Default Behavior

If you don't set `ALLOWED_DOMAINS` or `ALLOWED_EMAILS`:

**Default:** `ALLOWED_DOMAINS=dropbox.com`

This means **only @dropbox.com emails are allowed by default**.

To change this, you must explicitly set the environment variables.

---

## Migration Notes

### From OAuth Version
If you previously used the OAuth version with `ALLOWED_DOMAINS` and `ALLOWED_EMAILS`, the behavior is the same - just now it works with API keys instead of OAuth.

### From No Access Control
If your application previously had no access control, adding these environment variables will start enforcing restrictions. Plan accordingly:

1. Add `ALLOWED_DOMAINS` with broad access initially
2. Test with various users
3. Gradually tighten restrictions
4. Communicate with users about the change

---

## Summary

**Quick Reference:**

| Variable | Purpose | Example | Default |
|----------|---------|---------|---------|
| `ALLOWED_DOMAINS` | Whitelist email domains | `dropbox.com,hellosign.com` | `dropbox.com` |
| `ALLOWED_EMAILS` | Whitelist specific emails | `user@example.com,partner@acme.com` | Empty |

**Key Points:**
- ✅ Email is retrieved automatically from API key
- ✅ Users never enter their email manually
- ✅ Access control is enforced at login
- ✅ Clear error messages for denied access
- ✅ Case-insensitive matching
- ✅ Default: Only @dropbox.com allowed

---

**Last Updated:** 2026-04-22
