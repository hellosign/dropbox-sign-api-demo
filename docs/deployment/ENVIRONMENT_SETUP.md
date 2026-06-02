# Environment Configuration Guide

This guide explains how to set up and switch between development and production environments for the Sign Portal application.

## Overview

The application uses environment-specific `.env` files that are automatically loaded based on the `NODE_ENV` environment variable:

- **Development**: Uses `.env.development` (localhost + ngrok)
- **Production**: Uses `.env.production` (EC2 + custom domain)
- **Fallback**: Uses `.env` if environment-specific file doesn't exist

## Quick Start

### Development Setup

1. Copy the example file:

```bash
cp .env.example .env.development
```

2. Edit `.env.development` with your development OAuth credentials and ngrok URL:

```bash
NODE_ENV=development
BASE_URL=https://your-ngrok-url.ngrok.app
OAUTH_CLIENT_ID=your_dev_oauth_client_id
OAUTH_CLIENT_SECRET=your_dev_oauth_client_secret
SESSION_SECRET=dev-secret-key
```

3. Start the development server:

```bash
export NODE_ENV=development
npm run dev
```

### Production Setup

1. Copy the example file:

```bash
cp .env.example .env.production
```

2. Edit `.env.production` with your production OAuth credentials and domain:

```bash
NODE_ENV=production
BASE_URL=https://yourdomain.com
OAUTH_CLIENT_ID=your_prod_oauth_client_id
OAUTH_CLIENT_SECRET=your_prod_oauth_client_secret
SESSION_SECRET=strong-random-32-character-secret
REDIS_URL=redis://localhost:6379
```

3. Deploy to production:

```bash
# deploy.sh (REMOVED - use /deploy-to-production skill)
```

## Environment Variables

### Required in All Environments

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment name | `development` or `production` |
| `BASE_URL` | Base URL for the application | `https://yourdomain.com` |
| `OAUTH_CLIENT_ID` | Dropbox Sign OAuth Client ID | `abc123...` |
| `OAUTH_CLIENT_SECRET` | Dropbox Sign OAuth Client Secret | `xyz789...` |
| `SESSION_SECRET` | Session encryption key | Random 32+ char string |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `OAUTH_REDIRECT_URI` | OAuth callback URL | Auto-constructed from `BASE_URL` |
| `REDIS_URL` | Redis connection URL | None (uses memory store) |
| `ALLOWED_DOMAINS` | Allowed email domains | `dropbox.com` |
| `API_KEY` | API key for callback validation | None |
| `VERBOSE_LOGGING` | Enable verbose logging | `false` |

## Automatic OAuth Redirect URI Construction

The OAuth redirect URI is automatically constructed from the `BASE_URL`:

```
BASE_URL + /oauth/callback
```

Examples:
- Development: `https://your-ngrok-url.ngrok.app/oauth/callback`
- Production: `https://yourdomain.com/oauth/callback`

You can override this by setting `OAUTH_REDIRECT_URI` explicitly in your `.env` file.

## Startup Validation

On startup, the server validates your configuration and will exit if critical errors are found:

### Production Checks

- ✅ OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET are set
- ✅ OAUTH_REDIRECT_URI uses HTTPS
- ✅ SESSION_SECRET is not the default value
- ⚠️ Warning if REDIS_URL is not set (sessions won't persist)

### Development Checks

- ✅ OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET are set
- ⚠️ Warning if using localhost (ngrok URL recommended for callback testing)

### Example Success Output

```
✓ Environment: DEVELOPMENT
✓ Base URL: https://your-ngrok-url.ngrok.app
✓ OAuth Redirect: https://your-ngrok-url.ngrok.app/oauth/callback
✓ Redis: Memory (sessions not persisted)

Server listening on http://localhost:3001
```

### Example Error Output

```
❌ CONFIGURATION ERRORS:
  - OAUTH_CLIENT_ID is required
  - OAUTH_REDIRECT_URI must use HTTPS in production

Server cannot start. Fix errors in .env.production file.
```

## Switching Environments

### Method 1: Environment Variable

Set `NODE_ENV` before starting the server:

```bash
# Development
export NODE_ENV=development
npm start

# Production
export NODE_ENV=production
npm start
```

### Method 2: Shell Profile

Add to your shell profile (`~/.bashrc`, `~/.zshrc`):

```bash
# Default to development
export NODE_ENV=development
```

### Method 3: Process Manager (PM2)

```bash
# Start with specific environment
pm2 start server.js --name sign-portal --env production

# View environment
pm2 env 0
```

### Method 4: Systemd Service

Set in the systemd unit file:

```ini
[Service]
Environment=NODE_ENV=production
```

## OAuth Application Setup

You should create separate OAuth applications for development and production:

### Development OAuth App

1. Go to [Dropbox Sign API Settings](https://app.hellosign.com/home/myAccount#api)
2. Create new OAuth app: "Sign Portal - Development"
3. Set Callback URL: `https://your-ngrok-url.ngrok.app/oauth/callback`
4. Copy Client ID and Secret to `.env.development`

### Production OAuth App

1. Create new OAuth app: "Sign Portal - Production"
2. Set Callback URL: `https://yourdomain.com/oauth/callback`
3. Copy Client ID and Secret to `.env.production`

**Why separate apps?**
- Different callback URLs
- Separate usage tracking
- Ability to revoke one without affecting the other
- Clear separation of dev/prod OAuth tokens

## Redis Setup

### Development

Redis is optional in development. If not configured, sessions are stored in memory:

- ✅ Fast and simple
- ❌ Sessions lost on server restart
- ❌ Won't work with multiple server instances

### Production

Redis is strongly recommended for production:

**Install Redis:**

```bash
# Ubuntu/Debian
sudo apt install redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server

# macOS
brew install redis
brew services start redis
```

**Configure in .env.production:**

```bash
REDIS_URL=redis://localhost:6379
```

**Benefits:**
- ✅ Sessions persist across restarts
- ✅ Supports multiple server instances
- ✅ Better performance at scale

## Migration from Single .env

If you have an existing `.env` file:

1. **Backup current configuration:**

```bash
cp .env .env.backup
```

2. **Create development config:**

```bash
cp .env .env.development
```

3. **Create production config:**

```bash
cp .env.example .env.production
# Edit with production values
```

4. **Test both environments:**

```bash
NODE_ENV=development npm start  # Should work with dev config
NODE_ENV=production npm start   # Should work with prod config
```

5. **Remove old .env** (optional - kept as fallback):

```bash
rm .env
```

## Troubleshooting

### Server won't start

**Check validation errors:**
- Read the error message on startup
- Verify required variables are set in the correct `.env` file
- Ensure HTTPS in production

### Wrong environment loading

**Verify NODE_ENV:**

```bash
echo $NODE_ENV
```

**Check which file is loaded:**

```bash
NODE_ENV=development node -e "require('dotenv').config({ path: '.env.development' }); console.log(process.env.BASE_URL)"
```

### OAuth callback fails

**Verify redirect URI matches:**
1. Check startup output for OAuth Redirect URL
2. Compare with OAuth app settings in Dropbox Sign
3. Ensure ngrok URL is up-to-date in development

### Sessions not persisting

**Check Redis connection:**

```bash
redis-cli ping
# Should return: PONG
```

**Verify REDIS_URL in environment file:**

```bash
grep REDIS_URL .env.production
```

## Security Best Practices

### Development

- ✅ Use separate OAuth app from production
- ✅ Don't commit `.env.development` to git
- ✅ Use temporary ngrok URLs (rotate regularly)
- ✅ Use simple SESSION_SECRET (not critical in dev)

### Production

- ✅ Use strong random SESSION_SECRET (32+ characters)
- ✅ Always use HTTPS
- ✅ Enable Redis for session persistence
- ✅ Restrict to production domain only
- ✅ Rotate secrets regularly
- ✅ Never commit `.env.production` to git

### Generate Strong Secrets

```bash
# Generate a random 32-character secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## File Structure

```
dbx-sign-api-demo/
├── .env.example          # Template for new environments
├── .env.development      # Development config (not in git)
├── .env.production       # Production config (not in git)
├── .gitignore            # Excludes .env* files
├── server.js             # Loads environment-specific config
├── deploy.sh             # Production deployment script
└── ENVIRONMENT_SETUP.md  # This guide
```

## Next Steps

1. ✅ Create `.env.development` with your dev OAuth app credentials
2. ✅ Create `.env.production` with your prod OAuth app credentials
3. ✅ Test locally with `NODE_ENV=development npm start`
4. ✅ Deploy to EC2 with `# deploy.sh (REMOVED - use /deploy-to-production skill)`
5. ✅ Monitor startup validation messages
6. ✅ Set up Redis in production for session persistence

## Support

For issues:
- Check startup validation messages (most common issues are caught here)
- Verify OAuth app callback URLs match environment configuration
- Check server logs for detailed error messages
