# Redis Requirement Changes

## Summary

Redis is now **required by default** for the Dropbox Sign API Demo Portal. This change ensures reliable persistence of sessions, themes, settings, and other application data.

## What Changed

### 1. Server Startup Check
- Application now exits on startup if `REDIS_URL` is not configured
- Clear error message with installation instructions
- Override available via `ALLOW_NO_REDIS=true` environment variable (not recommended)

### 2. Documentation Updates
- **README.md**: Redis added as required prerequisite with installation instructions
- **WINDOWS_SETUP.md**: Added Redis installation steps for Windows (Docker and WSL2 methods)
- Setup flow documentation updated to reflect Redis requirement

### 3. Warning Messages
When running with `ALLOW_NO_REDIS=true`:
```
⚠️  WARNING: Running without Redis (ALLOW_NO_REDIS=true)
⚠️  Sessions, themes, settings will NOT persist across:
⚠️    - Server restarts
⚠️    - Browser hard refreshes
⚠️    - Cookie expiration
⚠️  This mode is for testing only. Install Redis for production use.
```

## Why This Change?

Without Redis, the application uses Node.js MemoryStore for sessions, which:
- ❌ Does not persist data across server restarts
- ❌ Is unreliable even for regular browser refreshes (Cmd+R / F5)
- ❌ Loses all theme customizations and settings
- ❌ Breaks onboarding flow
- ❌ Cannot store webhook events or API logs persistently

With Redis:
- ✅ Data persists across server restarts
- ✅ Reliable session management
- ✅ Themes and settings survive refreshes
- ✅ Onboarding flow works correctly
- ✅ Multi-tenant data isolation
- ✅ Production-ready persistence

## Installation

### Quick Start

**macOS (Homebrew):**
```bash
brew install redis
brew services start redis
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server
```

**Windows (Docker - Recommended):**
```bash
docker run -d -p 6379:6379 --name redis --restart unless-stopped redis:alpine
```

**Windows (WSL2):**
```bash
sudo apt update
sudo apt install redis-server
sudo service redis-server start
```

### Configuration

Add to your `.env` file:
```
REDIS_URL=redis://127.0.0.1:6379
```

### Verify

```bash
redis-cli ping
# Should return: PONG
```

## Testing Without Redis (Not Recommended)

For testing purposes only, you can run without Redis:

```bash
# Add to .env
ALLOW_NO_REDIS=true
```

**Warning:** Data will not persist. Use only for:
- Quick local testing
- CI environments where persistence isn't needed
- Development experiments

## Migration Guide

If you were running without Redis:

1. **Install Redis** (see instructions above)
2. **Add `REDIS_URL` to `.env`**:
   ```
   REDIS_URL=redis://127.0.0.1:6379
   ```
3. **Restart the application**
4. **Log in again** - Your previous session data will be gone (expected)
5. **Reconfigure themes/settings** - These will now persist properly

## Docker Users

No action needed! Docker Compose already includes Redis:
```yaml
services:
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
```

## Commits

1. `56f6eaf` - feat: Make Redis required for proper application functionality
2. `be31a6a` - docs: Add Redis installation instructions for Windows

## Questions?

- **Q: Why not use a file-based session store?**
  - A: Redis is more reliable, faster, and production-ready. File-based stores have their own reliability issues.

- **Q: Can I use a remote Redis instance?**
  - A: Yes! Set `REDIS_URL` to your remote Redis URL (e.g., Redis Cloud, AWS ElastiCache)

- **Q: What about production deployments?**
  - A: Production environments should already have Redis (Heroku, AWS, Azure all provide managed Redis)

- **Q: Is my data secure?**
  - A: API keys are still stored in browser sessionStorage only (never in Redis). Redis only stores themes, settings, and session IDs.
