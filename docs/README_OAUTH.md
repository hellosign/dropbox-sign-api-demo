# SignPortalDemo - Public OAuth Version

**OAuth-based Dropbox Sign API demo portal**

This is an OAuth-based version of the demo portal. It authenticates users with Dropbox Sign OAuth and can restrict access by allowed email domains.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure OAuth

Copy the example environment file for your environment:

**Development (localhost + ngrok):**

```bash
cp .env.example .env.development
```

**Production (EC2 + domain):**

```bash
cp .env.example .env.production
```

Edit the appropriate `.env` file and add your OAuth credentials:

```bash
NODE_ENV=development  # or production
BASE_URL=https://your-ngrok-url.ngrok.app  # or your production domain
OAUTH_CLIENT_ID=your_oauth_client_id
OAUTH_CLIENT_SECRET=your_oauth_client_secret
SESSION_SECRET=generate-a-random-secret-key
```

The OAuth redirect URI is automatically constructed from `BASE_URL`.

### 3. Start the Server

**Development:**

```bash
export NODE_ENV=development
npm start
```

**Production:**

```bash
export NODE_ENV=production
npm start
```

### 4. Access the Portal

Visit `http://localhost:3001` - you'll be redirected to authenticate with your Dropbox Sign account.

## Key Features

✅ **OAuth Authentication**: Secure authentication using Dropbox Sign OAuth
✅ **Domain Restriction**: Optional allowlist for approved email domains
✅ **30-Day Sessions**: Sessions persist for 30 days with activity
✅ **Automatic Cleanup**: Old sessions automatically removed
✅ **No Database Required**: Uses session-based storage
✅ **Simple Deployment**: Single server, minimal configuration

## Architecture

### Authentication Flow

1. User visits portal → Redirected to `/oauth/connect`
2. OAuth authorization with Dropbox Sign
3. Domain check: Must be @dropbox.com email
4. Session created with OAuth token
5. Access granted to portal for 30 days

### Session Storage

Each user session contains:
- OAuth tokens (access + refresh)
- Signature requests list
- Webhook events
- User preferences (including last selected API App)

Sessions automatically expire after 30 days of inactivity.

**Note**: Your last selected API App is automatically remembered between sessions, so you don't need to re-select it each time you visit the portal.

## Environment Configuration

The application supports separate configurations for development and production environments.

### Environment Detection

Configuration is automatically loaded based on the `NODE_ENV` environment variable:

- **Development mode** (`NODE_ENV=development`): Loads `.env.development`
- **Production mode** (`NODE_ENV=production`): Loads `.env.production`
- Falls back to `.env` if environment-specific file doesn't exist (backward compatible)

### Base URL Auto-Construction

The `BASE_URL` variable is used to automatically construct OAuth redirect URIs:

```bash
# Development
BASE_URL=https://your-ngrok-url.ngrok.app
# Creates: https://your-ngrok-url.ngrok.app/oauth/callback

# Production
BASE_URL=https://yourdomain.com
# Creates: https://yourdomain.com/oauth/callback
```

### Startup Validation

On startup, the server validates critical configuration:

- ✅ Required OAuth credentials present
- ✅ Production uses HTTPS for OAuth redirect
- ✅ Production has strong SESSION_SECRET
- ⚠️ Warns if Redis not configured in production
- ⚠️ Warns if using localhost in development

If validation fails, the server exits with clear error messages.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | ✅ Yes | Environment (development/production) |
| `BASE_URL` | ✅ Yes | Base URL for OAuth redirects |
| `OAUTH_CLIENT_ID` | ✅ Yes | OAuth app client ID |
| `OAUTH_CLIENT_SECRET` | ✅ Yes | OAuth app client secret |
| `OAUTH_REDIRECT_URI` | No | OAuth callback URL (auto-constructed from BASE_URL) |
| `SESSION_SECRET` | ✅ Yes | Session encryption key (must be strong in production) |
| `PORT` | No | Server port (default: 3001) |
| `REDIS_URL` | No | Redis URL (recommended for production) |

## Security

- ✅ Domain restriction (@dropbox.com only)
- ✅ HttpOnly cookies (XSS prevention)
- ✅ Secure cookies in production (HTTPS only)
- ✅ SameSite protection (CSRF prevention)
- ✅ 30-day session expiration
- ✅ Session-based token storage

## Use Cases

Perfect for:
- **Sales Demos**: Sales team can prepare demos in advance
- **Product Demos**: Persist demo data for recurring presentations
- **Testing**: Approved users can test features with their own accounts
- **Training**: Onboarding new team members with hands-on experience

## Differences from Local Version

| Feature | Local Version | OAuth Public Version |
|---------|--------------|---------------------|
| **Authentication** | API key in .env | OAuth with allowed domains |
| **User Management** | File-based (api-users.json) | Session-based |
| **Data Storage** | Permanent files | 30-day sessions |
| **User Switching** | Manual via Settings | Automatic via OAuth |
| **Access Control** | Anyone with .env | Configurable domain/email allowlist |
| **Deployment** | Local machine | Web server |

## Production Deployment

### Automated Deployment Script

Use the included deployment script for production:

```bash
# deploy.sh (REMOVED - use /deploy-to-production skill)
```

This script:
- Checks that `.env.production` exists
- Installs production dependencies
- Starts the app with PM2 process manager
- Saves PM2 configuration for auto-restart

### Manual Deployment Steps

#### 1. Configure environment

```bash
cp .env.example .env.production
# Edit .env.production with your production values
```

#### 2. Install Redis (recommended for session persistence)

```bash
sudo apt install redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

#### 3. Deploy with PM2

```bash
export NODE_ENV=production
npm install --production
pm2 start server.js --name sign-portal
pm2 save
```

#### 4. Or deploy with systemd

Create `/etc/systemd/system/sign-portal.service`:

```ini
[Unit]
Description=Sign Portal Demo
After=network.target redis-server.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/path/to/dbx-sign-api-demo
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable sign-portal
sudo systemctl start sign-portal
```

### Recommended Setup

1. **Deploy to**: VM, AWS EC2, Heroku, or similar
2. **Session Store**: Use Redis for persistence across restarts
3. **HTTPS**: Required for secure cookies
4. **Environment**: Set `NODE_ENV=production`
5. **Secret**: Use strong random SESSION_SECRET (32+ chars)
6. **BASE_URL**: Set to your production domain

### Redis Session Store (Optional)

For production deployments, use Redis to persist sessions:

```bash
npm install connect-redis redis
```

Update server.js:
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

## Troubleshooting

### "Access Restricted" Error
- **Issue**: Email is not @dropbox.com
- **Solution**: Use Dropbox Sign employee account

### Session Lost After Restart
- **Issue**: Using memory sessions (default)
- **Solution**: Use Redis session store

### OAuth Callback Fails
- **Issue**: Incorrect OAUTH_REDIRECT_URI
- **Solution**: Match URI with OAuth app settings

## Documentation

- [Full OAuth Deployment Guide](./authentication/OAUTH_DEPLOYMENT.md)
- [Access Control Configuration](./authentication/ACCESS_CONTROL.md)
- [Data Isolation Details](./architecture/OAUTH_DATA_ISOLATION.md)
- [OAuth Setup Guide](./authentication/OAUTH_SETUP.md)
- [Troubleshooting: Text Tags](./features/TEXT_TAGS_LIMITATION.md)
- [OAuth Test Page](http://localhost:3001/oauth-test)

## Support

For issues or questions:
1. Check [docs/OAUTH_DEPLOYMENT.md](./docs/OAUTH_DEPLOYMENT.md) for detailed information
2. Review OAuth test page: `/oauth-test`
3. Check OAuth debug endpoint: `/oauth/debug`

---

**Note**: Configure `ALLOWED_DOMAINS` and `ALLOWED_EMAILS` in the environment for your deployment.
