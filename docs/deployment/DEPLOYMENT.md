# Deployment Guide

This guide covers deploying the Dropbox Sign Demo Portal to a production environment.

---

## Prerequisites

### System Requirements
- Ubuntu 20.04+ or similar Linux distribution
- Node.js 18+ and npm
- Redis server (recommended for production)
- Domain name with SSL certificate (recommended)
- Minimum 2GB RAM, 2 CPU cores

### Required Accounts & Credentials
- **Dropbox Sign API Key** - Get one at [developers.hellosign.com](https://developers.hellosign.com)
- **OAuth App** (optional) - For OAuth authentication flow
- **Domain/Server** - For hosting the application

---

## Installation Steps

### 1. Prepare the Server

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install Redis (optional but recommended)
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Install PM2 for process management
sudo npm install -g pm2
```

### 2. Clone and Install Application

```bash
# Clone the repository
cd /opt  # or your preferred directory
git clone https://github.com/dbx-solutions/dropbox-sign-demo-portal.git
cd dropbox-sign-demo-portal

# Install dependencies
npm install --production
```

### 3. Configure Environment

```bash
# Create production environment file
cp .env.example .env

# Edit with your credentials
nano .env
```

**Required environment variables:**
```bash
# Dropbox Sign API
API_KEY=your_api_key_here
CLIENT_ID=your_client_id_here  # if using OAuth

# Server
NODE_ENV=production
PORT=3001

# Security (generate strong random strings)
SESSION_SECRET=your_random_session_secret
ENCRYPTION_KEY=your_32_character_encryption_key
CSRF_SECRET=your_random_csrf_secret

# Redis (if using)
REDIS_URL=redis://localhost:6379
REDIS_DB=0

# Optional: Custom branding
CUSTOM_LOGO_URL=
CUSTOM_PRIMARY_COLOR=#1E40AF
```

**Generate secure secrets:**
```bash
# Generate random secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Start the Application

#### Option A: Using PM2 (Recommended)

```bash
# Start with PM2 using the provided config
pm2 start config/ecosystem.production.config.cjs

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the command it outputs

# Monitor the application
pm2 status
pm2 logs sign-portal-production
```

#### Option B: Simple Start

```bash
# Start directly
npm start

# Or with nohup for background process
nohup npm start > logs/server.log 2>&1 &
```

### 5. Configure Reverse Proxy (Nginx)

**Install Nginx:**
```bash
sudo apt install -y nginx
```

**Create Nginx configuration:**
```bash
sudo nano /etc/nginx/sites-available/sign-portal
```

**Add configuration:**
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect to HTTPS (after SSL setup)
    # return 301 https://$server_name$request_uri;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Enable site:**
```bash
sudo ln -s /etc/nginx/sites-available/sign-portal /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 6. Setup SSL with Let's Encrypt (Recommended)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal is set up automatically
# Test renewal:
sudo certbot renew --dry-run
```

---

## Environment Variables Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `API_KEY` | Dropbox Sign API key | `abc123...` |
| `CLIENT_ID` | OAuth client ID (if using OAuth) | `xyz789...` |
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Server port | `3001` |
| `SESSION_SECRET` | Express session secret | `random_string` |
| `ENCRYPTION_KEY` | API key encryption key (32 chars) | `32_character_string` |
| `CSRF_SECRET` | CSRF protection secret | `random_string` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `REDIS_DB` | Redis database number | `0` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `CUSTOM_LOGO_URL` | Custom logo URL | `` |
| `CUSTOM_PRIMARY_COLOR` | Custom primary color | `#1E40AF` |

---

## Post-Deployment

### 1. Verify Installation

```bash
# Check application is running
curl http://localhost:3001

# Check PM2 status
pm2 status

# View logs
pm2 logs sign-portal-production --lines 100
```

### 2. Test Functionality

1. Access the application at `https://your-domain.com`
2. Complete OAuth login (if configured)
3. Test creating a signature request
4. Verify webhook reception (if configured)
5. Check API logs in the admin panel

### 3. Setup Monitoring

```bash
# PM2 Monitoring
pm2 install pm2-logrotate

# Configure log rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

---

## Maintenance

### Updating the Application

```bash
# Pull latest changes
cd /path/to/dropbox-sign-demo-portal
git pull origin main

# Install any new dependencies
npm install --production

# Restart the application
pm2 restart sign-portal-production
```

### Viewing Logs

```bash
# PM2 logs
pm2 logs sign-portal-production

# Application logs (if using file logging)
tail -f logs/server-out.log
tail -f logs/server-error.log

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Backup

**Important files to backup:**
- `.env` - Environment configuration
- `data/` - Application data (if using file-based storage)
- Redis data - If using Redis for persistent sessions

```bash
# Backup Redis data
redis-cli SAVE

# Backup data directory
tar -czf backup-$(date +%Y%m%d).tar.gz .env data/
```

---

## Troubleshooting

### Application Won't Start

1. **Check environment variables:**
   ```bash
   cat .env
   # Ensure all required variables are set
   ```

2. **Check logs:**
   ```bash
   pm2 logs sign-portal-production --lines 50
   ```

3. **Check port availability:**
   ```bash
   sudo lsof -i :3001
   # Kill process if port is in use
   ```

### Redis Connection Issues

1. **Verify Redis is running:**
   ```bash
   sudo systemctl status redis-server
   redis-cli ping  # Should return PONG
   ```

2. **Check Redis configuration in `.env`:**
   ```bash
   echo $REDIS_URL
   ```

### Nginx Configuration Issues

1. **Test Nginx configuration:**
   ```bash
   sudo nginx -t
   ```

2. **Check Nginx logs:**
   ```bash
   sudo tail -f /var/log/nginx/error.log
   ```

### High Memory Usage

1. **Check PM2 configuration:**
   ```bash
   cat config/ecosystem.production.config.cjs
   # max_memory_restart should be set
   ```

2. **Monitor resource usage:**
   ```bash
   pm2 monit
   ```

---

## Security Recommendations

1. **Firewall Configuration:**
   ```bash
   # Allow HTTP/HTTPS and SSH only
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```

2. **Regular Updates:**
   ```bash
   # Update system packages regularly
   sudo apt update && sudo apt upgrade -y
   ```

3. **Secure Environment Files:**
   ```bash
   # Restrict .env file permissions
   chmod 600 .env
   ```

4. **Enable Redis Authentication:**
   ```bash
   # Edit Redis config
   sudo nano /etc/redis/redis.conf
   # Add: requirepass your_redis_password
   sudo systemctl restart redis-server
   ```

5. **Monitor Logs:**
   - Set up log monitoring/alerting
   - Regularly review access logs
   - Monitor for suspicious activity

---

## Support

- **Documentation:** Check the `/docs` folder for more guides
- **Issues:** [GitHub Issues](https://github.com/dbx-solutions/dropbox-sign-demo-portal/issues)
- **Dropbox Sign API:** [Official API Docs](https://developers.hellosign.com/)

---

## Additional Resources

- [PM2 Documentation](https://pm2.keymetrics.io/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [Let's Encrypt](https://letsencrypt.org/)
- [Redis Documentation](https://redis.io/documentation)
