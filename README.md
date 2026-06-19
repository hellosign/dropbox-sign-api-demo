# Dropbox Sign API Demo Portal

**Bringing Sign APIs to Life** - A comprehensive demo platform for exploring and showcasing Dropbox Sign API capabilities.

---

## ⚠️ Important Notice

**This software is intended for demonstration and testing purposes only.**

> **Do NOT use production API keys or process sensitive/confidential data with this application.** This portal has not undergone a full security compliance review and is not approved for handling production credentials or real customer data.

This demo portal is designed for use within controlled environments such as:
- Partner demonstrations and testing
- Proof-of-concept deployments
- API feature exploration and integration planning

**Use a dedicated test account.** Create a separate Dropbox Sign account exclusively for this demo portal. Do not use an account that contains real contracts, customer documents, or personally identifiable information. If an API key were ever compromised, a dedicated test account with only fictional data ensures zero business impact.

**Security model:** API keys are stored exclusively in your browser's session storage and are **never persisted on the server**. When you close the browser tab, the key is gone. The server validates your key on login but does not retain it — similar to how the [Dropbox Sign API documentation](https://developers.hellosign.com/) "Try It" pages work.

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
- **💻 [Native Setup](#native-setup)** - Run directly on your machine (Node.js + Redis required)

---

## Docker Setup (Recommended)

**Why Docker?**
- ✅ One command to start everything (app + Redis)
- ✅ No Node.js or Redis installation needed
- ✅ Works identically on Windows, Mac, and Linux
- ✅ Easy cleanup and isolation

### Prerequisites

- **Docker Desktop** - [Download here](https://www.docker.com/products/docker-desktop/)
- **Git** - [Download here](https://git-scm.com/downloads) (or download the project as a [ZIP file](https://github.com/hellosign/dropbox-sign-api-demo/archive/refs/heads/main.zip))
- **Dropbox Sign Account** - [Sign up here](https://www.hellosign.com) (free account works)
  
  **⚠️ Important:** Your account must be either:
  - A **Developer account** (has API access enabled), OR
  - An **Administrator account** on a team
  
  Regular team members without admin privileges cannot access API features. If you're on a team, ask your administrator to grant you API access or create a separate free developer account for testing.

> **Note:** Docker setup requires NO Node.js installation! Everything runs in containers.

### Quick Start with Docker

#### 1. Get the Code

**Option A: Clone with Git**
```bash
git clone https://github.com/hellosign/dropbox-sign-api-demo.git
cd dropbox-sign-api-demo
```

**Option B: Download ZIP** (no Git required)
1. Download the [ZIP file](https://github.com/hellosign/dropbox-sign-api-demo/archive/refs/heads/main.zip)
2. Extract the ZIP to a folder of your choice
3. Open a terminal and `cd` into the extracted folder

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
- Auto-generate security keys (SESSION_SECRET, CSRF_SECRET)
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
- **SESSION_SECRET, CSRF_SECRET** - Auto-generated if empty
- **ALLOWED_DOMAINS** - Optional. Restrict access by email domain
- **ALLOWED_EMAILS** - Optional. Whitelist specific emails

**Data Persistence:**
- Redis data stored in Docker volume `redis-data`
- Application data stored in `./data` directory
- Both persist across container restarts

---

## Native Setup

**Prerequisites:**
- **Node.js 22+** and npm
- **Redis** - Required for session and data persistence
- **Git** - [Download here](https://git-scm.com/downloads) (or download the project as a [ZIP file](https://github.com/hellosign/dropbox-sign-api-demo/archive/refs/heads/main.zip))
- **Dropbox Sign Account** - [Sign up here](https://www.hellosign.com) (free account works)
  
  **⚠️ Important:** Your account must be either:
  - A **Developer account** (has API access enabled), OR
  - An **Administrator account** on a team
  
  Regular team members without admin privileges cannot access API features. If you're on a team, ask your administrator to grant you API access or create a separate free developer account for testing.

**📘 Windows Users:** See [WINDOWS_SETUP.md](./WINDOWS_SETUP.md) for complete step-by-step installation guide.

### Step-by-Step Setup

#### 1. Install Redis

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

**Windows:**
- Use [WSL2](https://docs.microsoft.com/en-us/windows/wsl/install) with Ubuntu, then follow Ubuntu instructions above
- Or use Docker: `docker run -d -p 6379:6379 redis:alpine`

**Verify Redis is running:**
```bash
redis-cli ping
# Should return: PONG
```

#### 2. Get the Code

**Option A: Clone with Git**
```bash
git clone https://github.com/hellosign/dropbox-sign-api-demo.git
cd dropbox-sign-api-demo
```

**Option B: Download ZIP** (no Git required)
1. Download the [ZIP file](https://github.com/hellosign/dropbox-sign-api-demo/archive/refs/heads/main.zip)
2. Extract the ZIP to a folder of your choice
3. Open a terminal and `cd` into the extracted folder

#### 3. Install Dependencies

```bash
npm install
```

#### 4. Start the Application

```bash
npm start
```

**First-time setup:** When you run `npm start` for the first time, an interactive setup wizard will guide you through:

1. ✅ **Automatic .env creation** - Creates configuration file from template
2. ✅ **Security key generation** - Generates SESSION_SECRET and CSRF_SECRET
3. ✅ **Admin email configuration** - Sets up your admin access
4. ✅ **Redis configuration** - Optional, for session persistence across restarts

The setup takes less than 30 seconds and ensures secure defaults.

**Example setup flow:**
```
╔════════════════════════════════════════════════════════╗
║        Welcome to Dropbox Sign API Demo Portal!       ║
╚════════════════════════════════════════════════════════╝

⚠️  No .env file detected - first-time setup required

This setup will:
  1. Create your .env configuration file
  2. Generate secure session and CSRF keys
  3. Configure your admin email for login access
  4. Configure Redis connection

Run automatic setup? (yes/no): yes

📋 Step 1: Creating .env file...
  ✓ Template loaded

🔐 Step 2: Generating security keys...
  ✓ SESSION_SECRET generated
  ✓ CSRF_SECRET generated

👤 Step 3: Configure admin access...

ℹ️  Enter the email address that will have admin access.
   This should match your Dropbox Sign account email.

Admin email address: demo@example.com
  ✓ Admin email set: demo@example.com

💾 Step 4: Redis configuration (required)...

   Redis is required for session persistence, API log history,
   and theme-to-template mappings. Make sure Redis is running
   before continuing (see Step 1 above).

Redis URL (default: redis://127.0.0.1:6379): 
  ✓ Redis URL set: redis://127.0.0.1:6379

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

**Option 2: Native Install (Mac/Linux)**

```bash
# Mac (using Homebrew)
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt install redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

**Option 3: Windows Native**

Install Redis using one of these methods:

- **Chocolatey:** `choco install redis-64` (then start with `redis-server`)
- **Scoop:** `scoop install redis` (then start with `redis-server`)
- **Manual download:** Get the latest `.msi` or `.zip` from [github.com/tporadowski/redis/releases](https://github.com/tporadowski/redis/releases)

After installing, start the Redis server:
```powershell
# If installed via MSI, Redis runs as a Windows service automatically.
# Otherwise, start it manually:
redis-server
```

> **Note:** On Windows, `redis-cli` may not be in your PATH by default. You can find it in the Redis installation folder (e.g., `C:\Program Files\Redis\redis-cli.exe`) or verify the connection directly by starting the application — it will confirm Redis connectivity in the console output.

#### Configure Redis

**Step 1: Verify Redis is Running**

```bash
# Mac/Linux
redis-cli ping
# Should return: PONG

# Windows (if redis-cli is not in PATH, use the full path or skip this step)
# The application will confirm Redis connectivity on startup.
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
| `SESSION_SECRET` | ⚠️ Recommended | Auto-generated | Session signing secret (min 32 chars recommended) |
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
- **[Demo Script](./docs/DEMO_SCRIPT.md)** - Presenter guide for live demos
- **[Complete Documentation](./docs/README.md)** - Full documentation index

### Documentation by Topic
- **[Architecture & Design](./docs/architecture/)** - System design, data isolation, and database structure
- **[Authentication & Security](./docs/authentication/)** - Access control and security configuration
- **[Deployment & Environment](./docs/deployment/)** - Environment configuration, deployment guides
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

- **Browser-Only API Key Storage** - API keys are stored in browser `sessionStorage` only, never persisted on the server. Closing the tab erases the key.
- **Domain Whitelisting** - Restrict access by email domain
- **Session Isolation** - Multi-tenant data separation
- **CSRF Protection** - Built-in CSRF token validation
- **Rate Limiting** - Protect against abuse

> **Important:** This application has NOT passed a full security compliance review. Do not use production API keys or process sensitive data. It is designed for demonstration and testing only.

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
