# Dropbox Sign API Demo Portal

**Bringing Sign APIs to Life** - A comprehensive demo platform for exploring and showcasing Dropbox Sign API capabilities.

---

## ⚠️ Important Notice

**This software is intended for demonstration and testing purposes only.**

This demo portal is designed for use within controlled environments such as:
- Partner demonstrations and testing
- Proof-of-concept deployments
- API feature exploration and integration planning

**⚠️ NOT RECOMMENDED for public internet deployment.** This application is not hardened for public-facing production use and should only be deployed in trusted, internal environments.

For production-grade implementations, please consult the [Dropbox Sign API documentation](https://developers.hellosign.com/) and follow security best practices for public-facing applications.

---

## 🎯 Purpose

This demo portal lets you experience the full power of Dropbox Sign APIs in real-time. Instead of reading documentation alone, see exactly how signature workflows integrate into applications - from template creation to embedded signing to webhook notifications.

**Built for:**
- Live demonstrations and presentations
- Proof-of-concept development
- API feature exploration and testing
- Integration planning

---

## ✨ Key Features

### Core Capabilities
- **Template Management** - Create, edit, and manage signature templates
- **Signature Requests** - Send documents for signature with real-time status tracking
- **Embedded Signing** - Demonstrate in-app signing experiences
- **Webhook Integration** - Show real-time event notifications
- **API App Management** - View and configure API apps (test mode, webhooks)
- **Team Collaboration** - Template sharing and team workflows

### Demo-Friendly Features
- **Custom Branding** - Apply customer colors and themes on-the-fly
- **Multi-language Support** - English, Spanish, and Japanese
- **Access Control** - Domain and email whitelisting for secure demos
- **API Logging** - View all API calls and responses in real-time
- **Workflow Visibility** - Real-time API logs and webhook events showing data flow

---

## 🚀 Quick Start

**Choose your setup method:**
- **🐳 [Docker Setup](#docker-setup-recommended)** (Recommended) - One command, includes Redis, works everywhere
- **💻 [Native Setup](#native-setup)** - Run directly on your machine (Node.js required)

---

## 🐳 Docker Setup (Recommended)

**Why Docker?**
- ✅ One command to start everything (app + Redis)
- ✅ No Node.js or Redis installation needed
- ✅ Works identically on Windows, Mac, and Linux
- ✅ Easy cleanup and isolation

### Prerequisites

- **Docker Desktop** - [Download here](https://www.docker.com/products/docker-desktop/)
- **Dropbox Sign Account** - [Sign up here](https://www.hellosign.com) (free account works)

> **Note:** Docker setup requires NO Node.js installation! Everything runs in containers.

### Quick Start with Docker

#### 1. Clone the Repository

```bash
git clone https://github.com/hellosign/dropbox-sign-api-demo.git
cd dropbox-sign-api-demo
```

#### 2. Configure Admin Email

Open the `docker-compose.yml` file (in the project root) with any text editor:

```bash
# Using your preferred editor:
nano docker-compose.yml
# or
code docker-compose.yml
# or
vim docker-compose.yml
```

Find this line (around line 39):
```yaml
- ADMIN_EMAILS=admin@example.com
```

Replace `admin@example.com` with your Dropbox Sign account email:
```yaml
- ADMIN_EMAILS=your-email@example.com
```

Save and close the file.

> **Important:** Use the email address associated with your Dropbox Sign account.

#### 3. Start with Docker Compose

```bash
docker compose up
```

This will:
- Download and start Redis automatically
- Build and start the application
- Auto-generate security keys (SESSION_SECRET, ENCRYPTION_KEY, CSRF_SECRET)
- Use your configured admin email

**First startup may take 1-2 minutes** while Docker downloads images and builds the app.

#### 4. Access the Portal

Open your browser to: **http://localhost:3001**

**Login** with your Dropbox Sign credentials (using the admin email you configured).

#### Docker Management Commands

```bash
# Stop the application
docker compose down

# Restart the application
docker compose up

# Run in background (detached mode)
docker compose up -d

# View logs
docker compose logs -f

# Rebuild after code changes
docker compose up --build

# Complete cleanup (removes containers and data)
docker compose down -v
```

#### Docker Configuration Notes

**Environment Variables:**
All configuration is done via `docker-compose.yml`. No `.env` file needed!

- **ADMIN_EMAILS** - Required. Set your Dropbox Sign account email
- **SESSION_SECRET, ENCRYPTION_KEY, CSRF_SECRET** - Auto-generated if empty
- **ALLOWED_DOMAINS** - Optional. Restrict access by email domain
- **ALLOWED_EMAILS** - Optional. Whitelist specific emails

**Data Persistence:**
- Redis data stored in Docker volume `redis-data`
- Application data stored in `./data` directory
- Both persist across container restarts

---

## 💻 Native Setup

**Prerequisites:**
- **Node.js 22+** and npm
- **Dropbox Sign Account** - [Sign up here](https://www.hellosign.com) (free account works)

**📘 Windows Users:** See [WINDOWS_SETUP.md](./WINDOWS_SETUP.md) for complete step-by-step installation guide.

### Step-by-Step Setup

#### 1. Clone the Repository

```bash
git clone https://github.com/hellosign/dropbox-sign-api-demo.git
cd dropbox-sign-api-demo
```

#### 2. Install Dependencies

```bash
npm install
```

#### 3. Start the Application

```bash
npm start
```

**First-time setup:** When you run `npm start` for the first time, an interactive setup wizard will guide you through:

1. ✅ **Automatic .env creation** - Creates configuration file from template
2. ✅ **Security key generation** - Generates SESSION_SECRET, ENCRYPTION_KEY, and CSRF_SECRET
3. ✅ **Admin email configuration** - Sets up your admin access

The setup takes less than 30 seconds and ensures secure defaults.

**Example setup flow:**
```
╔════════════════════════════════════════════════════════╗
║        Welcome to Dropbox Sign API Demo Portal!       ║
╚════════════════════════════════════════════════════════╝

⚠️  No .env file detected - first-time setup required

This setup will:
  1. Create your .env configuration file
  2. Generate secure session and encryption keys
  3. Configure your admin email for login access

Run automatic setup? (yes/no): yes

📋 Step 1: Creating .env file...
  ✓ Template loaded

🔐 Step 2: Generating security keys...
  ✓ SESSION_SECRET generated
  ✓ ENCRYPTION_KEY generated
  ✓ CSRF_SECRET generated

👤 Step 3: Configure admin access...

ℹ️  Enter the email address that will have admin access.
   This should match your Dropbox Sign account email.

Admin email address: demo@example.com
  ✓ Admin email set: demo@example.com

╔════════════════════════════════════════════════════════╗
║            ✅ Setup Complete!                          ║
╚════════════════════════════════════════════════════════╝

Starting the application...
```

#### 4. Access the Portal

Open your browser and navigate to:
```
http://localhost:3001
```

You should see the Dropbox Sign Demo Portal login page!

**Login** with your Dropbox Sign account credentials using the email you configured as admin.

### Post-Setup Configuration

After your first login, you can add optional features:

1. **Add API Key** (required for API features):
   - Go to [Dropbox Sign API Settings](https://app.hellosign.com/api/createApiKey)
   - Click **"Reveal"** to see your API key
   - Add it to your `.env` file as `DROPBOX_SIGN_API_KEY=your_key_here`
   - Restart the application: `npm start`

2. **Additional Configuration** (all optional):
   - **Access Control** - Add more admin emails or restrict by domain in `.env`:
     ```bash
     ADMIN_EMAILS=admin1@example.com,admin2@example.com
     ALLOWED_DOMAINS=example.com,company.com
     ```
   - **Redis** (for production) - See [Redis Setup](#redis-setup-optional) below
   - **Webhooks** - Use ngrok for local webhook testing (see docs)

3. **Customize in the UI**:
   - **Themes** - Settings → Themes (custom colors and logo)
   - **API Apps** - View and configure existing API apps
   - **Translations** - Settings → Translations (English, Spanish, Japanese)

### Manual Setup (Alternative)

If you prefer manual configuration or the automatic setup fails:

```bash
# 1. Copy the example file
cp .env.example .env

# 2. Generate secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Edit .env and add:
#    - SESSION_SECRET (use generated value)
#    - ENCRYPTION_KEY (use generated value, max 32 chars)
#    - CSRF_SECRET (use generated value)
#    - ADMIN_EMAILS (your email address)

# 4. Start the application
npm start
```

**Note:** Once your `.env` file exists, the setup wizard won't run again. To reconfigure, delete `.env` and run `npm start` to trigger the wizard, or manually edit the `.env` file.

### What You Can Do Next

- ✅ **Create Templates** - Build reusable signature templates
- ✅ **Send Signature Requests** - Send documents for signature
- ✅ **View API Logs** - See all API calls in real-time
- ✅ **Test Webhooks** - Configure webhook endpoints (use ngrok for local testing)
- ✅ **Customize Branding** - Apply custom themes for demos

See [Demo Script](./docs/DEMO_SCRIPT.md) for a complete walkthrough!

---

## ⚙️ Advanced Configuration

### Redis Setup (For Native Installation Only)

> **📝 Note:** If you're using Docker, Redis is already included and configured automatically. This section is only for native installations.

#### Do I Need Redis?

**Use in-memory storage (no Redis) if:**
- ✅ Quick testing or demo (5-10 minutes)
- ✅ Single-user exploration
- ✅ Don't mind re-logging in after server restarts
- ✅ Don't need to keep API logs history

**Install Redis if:**
- ✅ Multi-user environment or production deployment
- ✅ Want to preserve sessions across server restarts
- ✅ Want to keep API logs history permanently
- ✅ Need to scale to multiple server instances

#### What You Lose Without Redis

By default, the application uses **in-memory storage** which works fine for development and testing. However, in-memory storage means:
- ⚠️ **Sessions are lost when the server restarts** (need to log in again)
- ⚠️ **API logs are lost when the server restarts**
- ⚠️ **Theme-to-template mappings are reset** (need to reassign templates to themes after each restart)
- ⚠️ **Cannot scale to multiple server instances**

> **💡 Tip:** If you find yourself reassigning templates to themes after every restart, it's time to install Redis!

#### Installing Redis (Native Setup)

Choose the method that works best for your platform:

**Option 1: Docker (Easiest for Windows)**

```bash
# Start Redis in Docker
docker run -d --name redis -p 6379:6379 redis:7-alpine

# Verify it's running
docker ps | grep redis

# To start after system restart
docker start redis
```

**Option 2: Native Install**

```bash
# Mac (using Homebrew)
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt install redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Windows WSL
sudo service redis-server start
```

#### Configure Redis

**Step 1: Verify Redis is Running**

```bash
redis-cli ping
# Should return: PONG
```

**Step 2: Add Redis URL to `.env`**

```bash
# Add this line to your .env file
REDIS_URL=redis://localhost:6379
```

**Step 3: Restart the Application**

```bash
# Stop the server (Ctrl+C if running)
npm start
```

**Step 4: Verify It's Working**

After restarting, check the server logs for:
```
✓ Redis connected for session persistence
```

That's it! Your sessions, API logs, and theme settings will now persist across restarts.

### API App Configuration (Optional)

To associate signature requests with a specific API app for webhook callbacks:

1. **Create API App** at [Dropbox Sign API Apps](https://app.hellosign.com/api/apiAppManagement)
2. **Get the Client ID** from your API app settings
3. **Add to `.env`:**
   ```bash
   CLIENT_ID=your_api_app_client_id_here
   ```

This allows you to configure webhook URLs and receive callback notifications for signature events.

### Custom Branding (Optional)

Customize the portal appearance in `.env`:

```bash
# Custom Branding
CUSTOM_LOGO_URL=https://your-domain.com/logo.png
CUSTOM_PRIMARY_COLOR=#1E40AF
CUSTOM_COMPANY_NAME=Your Company Name
```

### Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_KEY` | ❌ No | - | Your Dropbox Sign API key (needed for API calls) |
| `SESSION_SECRET` | ⚠️ Recommended | Auto-generated | Session encryption secret (min 32 chars recommended) |
| `ENCRYPTION_KEY` | ❌ No | Auto-generated | API key encryption key (exactly 32 chars) |
| `CSRF_SECRET` | ❌ No | Auto-generated | CSRF protection secret |
| `PORT` | ❌ No | `3001` | Server port |
| `NODE_ENV` | ❌ No | `development` | Environment mode |
| `CLIENT_ID` | ❌ No | - | API app client ID (for webhook callbacks) |
| `REDIS_URL` | ❌ No | - | Redis connection URL |
| `REDIS_DB` | ❌ No | `0` | Redis database number |
| `CUSTOM_LOGO_URL` | ❌ No | - | Custom logo URL |
| `CUSTOM_PRIMARY_COLOR` | ❌ No | `#1E40AF` | Custom theme color |

---

## 📚 Documentation

### Getting Started
- **[Deployment Guide](./docs/deployment/DEPLOYMENT.md)** - Deploy to production
- **[Demo Script](./docs/DEMO_SCRIPT.md)** - Presenter guide for live demos
- **[Complete Documentation](./docs/README.md)** - Full documentation index

### Documentation by Topic
- **[Architecture & Design](./docs/architecture/)** - System design, data isolation, and database structure
- **[Authentication & Security](./docs/authentication/)** - Access control and security configuration
- **[Deployment & Environment](./docs/deployment/)** - Environment configuration, deployment guides
- **[Development Notes](./docs/development/)** - Development notes and migration references
- **[Features & Guides](./docs/features/)** - Template sharing, troubleshooting, feature docs
- **[Security & Compliance](./docs/security/)** - Security reviews, compliance documentation

### Quick Links
- [Release Notes](./docs/RELEASE_NOTES.md) - Latest features and updates
- [Access Control](./docs/authentication/ACCESS_CONTROL.md) - Whitelist domains/emails
- [Template Sharing](./docs/features/TEMPLATE_SHARING.md) - Share templates with teams
- [Security Documentation](./docs/security/SECURITY.md) - Security best practices

---

## 🛠️ Tech Stack

### Backend
- **Node.js** - Server runtime
- **Express** - Web framework
- **Handlebars** - Template engine
- **Redis** - Session storage and caching (optional)

### Frontend
- **Vanilla JavaScript** - Interactive UI
- **Bootstrap** - Responsive design
- **i18next** - Internationalization

### APIs & Services
- **Dropbox Sign API** - Signature and document workflows
- **ngrok** - Local development webhooks

### Infrastructure
- **PM2** - Process management (optional for production)
- Standard server or cloud hosting (AWS, Azure, GCP, etc.)

---

## 🎬 Demo Workflow

1. **Setup** - Configure branding and access control for the prospect
2. **Templates** - Show how to create reusable signature templates
3. **Sending** - Demonstrate signature request workflow
4. **Signing** - Walk through embedded signing experience
5. **Webhooks** - Show real-time event notifications
6. **API Logs** - Review API calls and responses together

See [DEMO_SCRIPT.md](./docs/DEMO_SCRIPT.md) for the complete presenter script.

---

## 🔐 Security

- **Domain Whitelisting** - Restrict access by email domain
- **Session Isolation** - Multi-tenant data separation
- **API Key Encryption** - Secure credential storage
- **CSRF Protection** - Built-in CSRF token validation
- **Rate Limiting** - Protect against abuse

For details, see [Security Documentation](./docs/security/SECURITY.md).

---

## 📝 Development

### Running the Application

```bash
npm start
```

The application will be available at `http://localhost:3001`

### Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on contributing to this project.

---

## 🆘 Troubleshooting

### Common Setup Issues

**Problem: "API_KEY is not set" error**
- Solution: Make sure you created `.env` file and added your API key
- Check: Open `.env` and verify `API_KEY=your_actual_key_here`

**Problem: "Invalid API key" error**
- Solution: Verify your API key is correct at [Dropbox Sign API Settings](https://app.hellosign.com/api/createApiKey)
- Check: Make sure you copied the entire key (no extra spaces)

**Problem: Application won't start or crashes**
- Check: All required environment variables are set in `.env`
- Check: Port 3001 is not already in use (`lsof -i :3001` on Mac/Linux)
- Solution: Change `PORT=3002` in `.env` to use a different port

**Problem: "Session secret must be at least 32 characters" warning**
- Solution: Generate a longer random string for `SESSION_SECRET`
- Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

**Problem: "ENCRYPTION_KEY must be exactly 32 characters"**
- Solution: Use exactly 32 characters for `ENCRYPTION_KEY`
- Example: `ENCRYPTION_KEY=your-32-character-key-here-now`

**Problem: npm install fails**
- Solution: Make sure you have Node.js 18+ installed
- Check version: `node --version`
- Update Node.js if needed: [nodejs.org](https://nodejs.org)

### Getting Help

For additional support:
- **API Issues:** [Dropbox Sign API Documentation](https://developers.hellosign.com/)
- **Account Help:** [Dropbox Sign Support](https://help.hellosign.com/)
- **Bug Reports:** [GitHub Issues](https://github.com/hellosign/dropbox-sign-api-demo/issues)
- **Feature Requests:** [GitHub Issues](https://github.com/hellosign/dropbox-sign-api-demo/issues)

---

## 📄 License

```
Copyright (c) 2026 Dropbox, Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

**Ready to demo?** Start with the [Demo Script](./docs/DEMO_SCRIPT.md) and show prospects how easy it is to integrate e-signatures into their applications.
