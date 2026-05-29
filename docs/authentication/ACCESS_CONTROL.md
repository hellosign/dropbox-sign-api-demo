# Access Control Configuration

This document explains how to whitelist domains and email addresses for OAuth access.

## Configuration

Access control is configured via environment variables in your `.env` file.

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

## How It Works

When a user authenticates via OAuth:

1. The app retrieves their email address from Dropbox Sign
2. It checks if the email domain is in `ALLOWED_DOMAINS`
3. OR if the specific email is in `ALLOWED_EMAILS`
4. If either check passes, access is granted
5. Otherwise, the user sees an "Access Restricted" error

## Examples

### Example 1: Single Domain (Default)
```bash
# Only @dropbox.com emails
ALLOWED_DOMAINS=dropbox.com
```

**Result:**
- ✅ `alice@dropbox.com` - Allowed
- ✅ `bob@dropbox.com` - Allowed
- ❌ `charlie@gmail.com` - Denied

### Example 2: Multiple Domains
```bash
# Multiple company domains
ALLOWED_DOMAINS=dropbox.com,hellosign.com,acme.com
```

**Result:**
- ✅ `user@dropbox.com` - Allowed
- ✅ `user@hellosign.com` - Allowed
- ✅ `user@acme.com` - Allowed
- ❌ `user@gmail.com` - Denied

### Example 3: Specific Emails Only
```bash
# No domains, only specific emails
ALLOWED_DOMAINS=
ALLOWED_EMAILS=contractor1@freelance.com,partner@external.com
```

**Result:**
- ✅ `contractor1@freelance.com` - Allowed
- ✅ `partner@external.com` - Allowed
- ❌ `other@freelance.com` - Denied (not in list)
- ❌ `user@dropbox.com` - Denied (no domains allowed)

### Example 4: Mixed Approach (Recommended)
```bash
# Company domains + specific external users
ALLOWED_DOMAINS=dropbox.com,hellosign.com
ALLOWED_EMAILS=consultant@external.com,vendor@partner.com
```

**Result:**
- ✅ `employee@dropbox.com` - Allowed (domain)
- ✅ `employee@hellosign.com` - Allowed (domain)
- ✅ `consultant@external.com` - Allowed (specific email)
- ✅ `vendor@partner.com` - Allowed (specific email)
- ❌ `other@external.com` - Denied

### Example 5: Open Access (Not Recommended)
```bash
# Allow all domains (effectively no restriction)
# Leave both empty or don't set them
ALLOWED_DOMAINS=
ALLOWED_EMAILS=
```

**Warning:** This will deny ALL users since there are no allowed domains or emails. To allow anyone, you'd need to remove the access control check from the code.

## Quick Setup

### Step 1: Edit your `.env` file

```bash
nano .env
```

### Step 2: Add/modify the access control lines

```bash
# For Dropbox Sign employees + specific partners
ALLOWED_DOMAINS=dropbox.com,hellosign.com
ALLOWED_EMAILS=partner@acme.com,consultant@external.com
```

### Step 3: Restart the server

```bash
npm start
```

## Testing Access Control

### Test 1: Check Current Configuration

When the server starts, it loads these values. You can verify by checking the OAuth callback code or adding a console.log.

### Test 2: Try Different Emails

1. Authenticate with an allowed email → Should succeed
2. Authenticate with a disallowed email → Should see "Access Restricted" error

### Test 3: View Access Denied Message

The access denied page shows which domains are allowed, helping users understand why they were blocked.

## Security Notes

1. **Case Insensitive**: Email and domain matching is case-insensitive
   - `User@Dropbox.Com` matches `dropbox.com`

2. **Exact Domain Match**: Must match the entire domain
   - `dropbox.com` matches `@dropbox.com`
   - But NOT `@subdomain.dropbox.com`

3. **Whitespace Trimmed**: Spaces around domains/emails are automatically removed
   - `dropbox.com, hellosign.com` works fine

4. **Empty Values**: Empty strings are filtered out
   - `ALLOWED_EMAILS=,,,` is treated as no emails

## Troubleshooting

### Issue: All users are denied access

**Check:**
1. Make sure `ALLOWED_DOMAINS` or `ALLOWED_EMAILS` is set in `.env`
2. Verify the format: `ALLOWED_DOMAINS=dropbox.com` (no @ symbol)
3. Restart the server after changing `.env`

### Issue: Specific email not working

**Check:**
1. Email must be exact match (including case after lowercase conversion)
2. No spaces: `user@example.com` not ` user@example.com `
3. Full email required: `user@example.com` not just `user`

### Issue: Domain not matching

**Check:**
1. Domain only, no @ symbol: `dropbox.com` not `@dropbox.com`
2. Exact domain match: `dropbox.com` doesn't match `mail.dropbox.com`

## Advanced: Modify Access Control Logic

If you need more complex access control (e.g., subdomain matching, regex patterns), edit the check in `server.js` around line 3140:

```javascript
// Current logic (server.js ~line 3140)
const emailLower = accountEmail.toLowerCase();
const emailDomain = emailLower.split('@')[1];
const isAllowedDomain = ALLOWED_DOMAINS.includes(emailDomain);
const isAllowedEmail = ALLOWED_EMAILS.includes(emailLower);

if (!isAllowedDomain && !isAllowedEmail) {
  // Access denied
}
```

You can customize this logic to support:
- Wildcard subdomains
- Regex patterns
- Database lookups
- External API validation

## Summary

**Quick Reference:**

| Variable | Purpose | Example |
|----------|---------|---------|
| `ALLOWED_DOMAINS` | Whitelist email domains | `dropbox.com,hellosign.com` |
| `ALLOWED_EMAILS` | Whitelist specific emails | `user@example.com,partner@acme.com` |

**Default Behavior:** Only `@dropbox.com` emails allowed (if not configured)

**Location:** `.env` file in the project root
