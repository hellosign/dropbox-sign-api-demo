# Environment Configuration Guide

## Overview

The application uses environment-specific configuration files to manage settings for different deployment environments (development vs production).

## How Environment Selection Works

The application **automatically selects** the correct `.env` file based on the `NODE_ENV` variable:

```javascript
// Automatic selection logic (server.js)
NODE_ENV=production  → loads .env.production
NODE_ENV=development → loads .env.development  (default)
No specific file     → fallback to .env
```

### Selection Priority:

1. If `NODE_ENV=production` exists → load `.env.production`
2. If `NODE_ENV=development` exists (or `NODE_ENV` not set) → load `.env.development`
3. If specific file doesn't exist → fallback to `.env`
4. If no files exist → use hardcoded defaults in code

## File Structure

```
dbx-sign-api-demo/
├── .env                    ← Generic fallback (not in git)
├── .env.development        ← Development config (not in git)
├── .env.production         ← Production config (not in git)
└── .env.example            ← Template (IN git, safe to commit)
```

**Important:** Only `.env.example` should be committed to git. All other `.env*` files contain secrets and should be in `.gitignore`.

---

## Configuration Files

### Local Development (`.env.development`)

Used when running locally with `npm start` (NODE_ENV defaults to 'development').

**Location:** `/path/to/dropbox-sign-demo-portal/.env.development`

**Typical settings:**
- `NODE_ENV=development`
- Development API keys
- Ngrok URLs for OAuth
- Relaxed access control (more domains allowed for testing)
- `VERBOSE_LOGGING=true`

### Production (`.env.production`)

Used on EC2 server when `NODE_ENV=production` is set.

**Locations:**
- Local: `/path/to/dropbox-sign-demo-portal/.env.production`
- Server: `/path/to/dropbox-sign-demo-portal/.env` (or `.env.production`)

**Typical settings:**
- `NODE_ENV=production`
- Production API keys
- Production domain URLs
- Strict access control (only company domains)
- `VERBOSE_LOGGING=false`

---

## Current Configuration

### ✅ Local Machine:
```
.env                ✓ EXISTS (356B) - Fallback
.env.development    ✓ EXISTS (527B) - Development config
.env.production     ✓ EXISTS (895B) - Production template
.env.example        ✓ EXISTS (591B) - Template
```

### ✅ EC2 Server:
```
.env                ✓ EXISTS (746B) - Production config
.env.example        ✓ EXISTS (591B) - Template
```

---

## Configuration Variables

### Required Variables

#### `API_KEY`
Your Dropbox Sign API key (used only for initial validation during login).

**Note:** The API key is validated on login, then returned to the browser for client-side storage. It is never persisted on the server.

**Find it at:** https://app.hellosign.com/home/myAccount#api

```bash
API_KEY=your_api_key_here
```

#### `REDIS_URL`
Redis connection URL for session storage and multi-user data.

```bash
REDIS_URL=redis://localhost:6379
```

### Access Control Variables

#### `ALLOWED_DOMAINS`
Comma-separated list of allowed email domains (without @).

**Default:** `dropbox.com`

```bash
# Single domain
ALLOWED_DOMAINS=dropbox.com

# Multiple domains
ALLOWED_DOMAINS=dropbox.com,hellosign.com,acme.com
```

#### `ALLOWED_EMAILS`
Comma-separated list of specific email addresses to whitelist.

**Default:** Empty

```bash
ALLOWED_EMAILS=contractor@external.com,partner@acme.com
```

### Optional Variables

#### `NODE_ENV`
Environment mode (development or production).

```bash
NODE_ENV=production
```

#### `PORT`
Server port (default: 3001).

```bash
PORT=3001
```

#### `SESSION_SECRET`
Secret key for session signing (CHANGE IN PRODUCTION!).

```bash
SESSION_SECRET=your-secure-random-secret-key-here
```

#### `VERBOSE_LOGGING`
Enable detailed logging (true/false).

```bash
# Development
VERBOSE_LOGGING=true

# Production
VERBOSE_LOGGING=false
```

---

## How to Configure

### On Local Machine (Development)

1. **Edit `.env.development`:**
   ```bash
   nano /path/to/dropbox-sign-demo-portal/.env.development
   ```

2. **Set your development values:**
   ```bash
   NODE_ENV=development
   API_KEY=your_dev_api_key
   ALLOWED_DOMAINS=dropbox.com,gmail.com  # More relaxed for testing
   VERBOSE_LOGGING=true
   ```

3. **Start the server:**
   ```bash
   npm start
   # Automatically loads .env.development
   ```

### On EC2 (Production)

1. **SSH to EC2:**
   ```bash
   ssh <production-host>
   ```

2. **Edit the `.env` file:**
   ```bash
   cd /path/to/dropbox-sign-demo-portal
   nano .env
   ```

3. **Set production values:**
   ```bash
   NODE_ENV=production
   API_KEY=your_production_api_key
   ALLOWED_DOMAINS=dropbox.com,hellosign.com
   ALLOWED_EMAILS=contractor@external.com
   SESSION_SECRET=generate-a-secure-random-key-here
   VERBOSE_LOGGING=false
   ```

4. **Restart the application:**
   ```bash
   pm2 restart server
   # Or
   npm start
   ```

---

## Setting NODE_ENV

### Development (Automatic)
By default, if `NODE_ENV` is not set, it defaults to 'development':

```bash
npm start
# Uses .env.development
```

### Production (Explicit)

**Option 1: Set in `.env` file (Recommended)**
```bash
# In .env file
NODE_ENV=production
```

**Option 2: Set as environment variable**
```bash
export NODE_ENV=production
npm start
```

**Option 3: Inline when starting**
```bash
NODE_ENV=production npm start
```

**Option 4: With PM2 (Recommended for EC2)**
```bash
pm2 start server.js --name "signportal" --env production
# Or in ecosystem.config.js
```

---

## Verification

### Check Which File Is Loaded

When the server starts, check the console output:

```bash
# If you see this, it loaded the environment file
✓ Redis connected for session persistence
[ACCESS CONTROL] Allowed domains: [ 'dropbox.com', 'hellosign.com' ]
```

### Check Current Configuration

**On the production server:**
```bash
ssh <production-host>
cd /path/to/dropbox-sign-demo-portal
cat .env.production | grep -E "NODE_ENV|ALLOWED"
```

**Expected output:**
```
NODE_ENV=production
ALLOWED_DOMAINS=dropbox.com,hellosign.com
ALLOWED_EMAILS=
```

---

## Troubleshooting

### Issue: Access control not working (everyone allowed)

**Cause:** `.env` file doesn't exist or `ALLOWED_DOMAINS` not set.

**Solution:**
1. Check if `.env` file exists: `ls -la .env`
2. Check if `ALLOWED_DOMAINS` is in the file: `grep ALLOWED_DOMAINS .env`
3. Restart the server after adding it

### Issue: Wrong environment file loaded

**Cause:** `NODE_ENV` not set correctly.

**Solution:**
```bash
# Check current NODE_ENV
echo $NODE_ENV

# Set it explicitly
export NODE_ENV=production

# Or add to .env file
echo "NODE_ENV=production" >> .env
```

### Issue: Changes not taking effect

**Cause:** Server not restarted after changing `.env`.

**Solution:**
```bash
# Restart with PM2
pm2 restart server

# Or kill and restart
pm2 stop server
npm start
```

### Issue: Redis not connecting

**Cause:** `REDIS_URL` not set or Redis not running.

**Solution:**
```bash
# Check Redis is running
redis-cli ping
# Should return: PONG

# Check REDIS_URL in .env
grep REDIS_URL .env

# Start Redis if not running
redis-server
```

---

## Security Best Practices

### ✅ DO:
- Keep production `.env` files secure
- Use strong `SESSION_SECRET` in production
- Restrict `ALLOWED_DOMAINS` to company domains
- Use `VERBOSE_LOGGING=false` in production
- Regularly rotate API keys

### ❌ DON'T:
- Commit `.env`, `.env.development`, or `.env.production` to git
- Share API keys or secrets in chat/email
- Use development keys in production
- Allow all domains (`*`) in production
- Leave `SESSION_SECRET` as default value

---

## Template: Production .env File

Copy this template to your EC2 `.env` file and fill in the values:

```bash
# Production Environment Configuration
NODE_ENV=production

# Dropbox Sign API Key (REQUIRED)
API_KEY=your_production_api_key_here

# Redis (REQUIRED for multi-user sessions)
REDIS_URL=redis://localhost:6379

# Server Configuration
PORT=3001
SESSION_SECRET=change-this-to-a-secure-random-string

# Access Control (IMPORTANT!)
ALLOWED_DOMAINS=dropbox.com,hellosign.com
ALLOWED_EMAILS=contractor@external.com,partner@acme.com

# Logging
VERBOSE_LOGGING=false
```

---

## Summary

**Key Points:**
- ✅ Environment automatically selected based on `NODE_ENV`
- ✅ `.env.development` for local development
- ✅ `.env` or `.env.production` for EC2 production
- ✅ `.env.example` is the template (safe to commit to git)
- ✅ Access control configured via `ALLOWED_DOMAINS` and `ALLOWED_EMAILS`
- ✅ Always restart server after changing `.env` files

**Default Behavior:**
- No `NODE_ENV` set → Uses `.env.development` (development mode)
- `NODE_ENV=production` → Uses `.env.production` or `.env` (production mode)
- No matching file → Uses `.env` as fallback
- No `.env` files → Uses hardcoded defaults in code

---

**Last Updated:** 2026-04-22
