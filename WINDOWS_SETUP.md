# Windows Setup Guide

Complete step-by-step instructions for installing and running the Dropbox Sign Demo Portal on Windows.

---

## Prerequisites

Before you begin, you'll need to install the following software on your Windows machine.

### 1. Install Node.js and npm

**Node.js** includes npm (Node Package Manager) automatically.

#### Download and Install:

1. Go to: https://nodejs.org/
2. Download the **LTS (Long Term Support)** version for Windows
   - Recommended: Version 18.x or higher
3. Run the installer (`.msi` file)
4. Follow the installation wizard:
   - ✅ Accept the license agreement
   - ✅ Keep default installation path: `C:\Program Files\nodejs\`
   - ✅ Select **"Automatically install the necessary tools"** (includes npm)
   - ✅ Click **Install**
5. Restart your computer after installation

#### Verify Installation:

Open **Command Prompt** or **PowerShell** and run:

```bash
node --version
npm --version
```

You should see version numbers (e.g., `v18.20.0` and `10.5.0`).

---

### 2. Install Git (Optional - for cloning via command line)

If you want to use `git clone` command, install Git for Windows.

#### Download and Install:

1. Go to: https://git-scm.com/download/win
2. Download **Git for Windows**
3. Run the installer
4. Follow the installation wizard:
   - ✅ Keep default options
   - ✅ Select **"Use Git from the Windows Command Prompt"**
   - ✅ Click **Install**

#### Verify Installation:

```bash
git --version
```

You should see: `git version 2.x.x`

**Alternative:** You can download the code as a ZIP file from GitHub without installing Git.

---

### 3. Create a Dropbox Sign Account

You'll need this to log in to the portal.

1. Go to: https://www.hellosign.com
2. Sign up for a free account (or sign in if you already have one)

**Note:** You can start the application and log in without an API key. The API key is only needed later when you want to send signature requests.

---

## Installation Steps

### Method 1: Clone with Git (Recommended)

#### Step 1: Open Command Prompt or PowerShell

Press `Win + R`, type `cmd` or `powershell`, and press Enter.

#### Step 2: Navigate to Your Desired Directory

```bash
# Example: Navigate to your Documents folder
cd %USERPROFILE%\Documents

# Or create a projects folder
mkdir projects
cd projects
```

#### Step 3: Clone the Repository

```bash
git clone https://github.com/hellosign/dropbox-sign-api-demo.git
cd dropbox-sign-api-demo
```

---

### Method 2: Download as ZIP (Alternative)

If you don't want to install Git:

1. Go to: https://github.com/hellosign/dropbox-sign-api-demo
2. Click the green **"Code"** button
3. Click **"Download ZIP"**
4. Extract the ZIP file to your desired location
   - Example: `C:\Users\YourName\Documents\dropbox-sign-api-demo`
5. Open Command Prompt and navigate to the extracted folder:
   ```bash
   cd C:\Users\YourName\Documents\dropbox-sign-api-demo
   ```

---

## Configuration and Setup

### Step 1: Install Dependencies

In the project directory, run:

```bash
npm install
```

This will download and install all required packages (may take 2-3 minutes).

### Step 2: Run the Setup Wizard

**NEW: Automated Setup!** Just start the application and an interactive wizard will guide you:

```bash
npm start
```

**You'll see the setup wizard:**

```
╔════════════════════════════════════════════════════════╗
║        Welcome to Dropbox Sign API Demo Portal!       ║
╚════════════════════════════════════════════════════════╝

⚠️  No .env file detected - first-time setup required

This setup will:
  1. Create your .env configuration file
  2. Generate secure session and encryption keys
  3. Configure your admin email for login access

Run automatic setup? (yes/no):
```

**Follow the prompts:**

1. Type `yes` and press Enter
2. Wait while security keys are generated (takes a few seconds)
3. Enter your admin email address when prompted
   - **Important:** Use the email associated with your Dropbox Sign account
4. Press Enter

**Example:**

```
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

Admin email address: your-email@example.com
  ✓ Admin email set: your-email@example.com

╔════════════════════════════════════════════════════════╗
║            ✅ Setup Complete!                          ║
╚════════════════════════════════════════════════════════╝

Starting the application...
```

**That's it!** The wizard automatically:
- ✅ Creates the `.env` configuration file
- ✅ Generates secure random secrets (SESSION_SECRET, ENCRYPTION_KEY, CSRF_SECRET)
- ✅ Sets your admin email for access control

---

## Running the Application

### After Setup

The application should start automatically after the wizard completes. You'll see:

```
[ENV] Loaded .env (default)
[I18N] Configured locales: [ 'en', 'es', 'ja' ]
✓ Redis connected for session persistence (or using in-memory storage)
Server listening on http://localhost:3001
```

### Step 2: Open in Browser

Open your web browser and go to:

```
http://localhost:3001
```

You should see the **Dropbox Sign Demo Portal** login page!

### Step 3: Log In

Use your Dropbox Sign account credentials (the email you configured as admin).

### Step 4: Add API Key (Optional)

The portal has a built-in onboarding wizard that will guide you through adding your API key when you first log in. You can also add it later via:

**Option 1: Via Onboarding (Recommended)**
- Follow the onboarding steps after first login
- The wizard will help you add your API key

**Option 2: Manual Setup**
1. Go to: https://app.hellosign.com/api/createApiKey
2. Click **"Reveal"** to see your API key
3. Add it through the portal's Settings → API Key section

---

## Stopping the Application

Press `Ctrl + C` in the Command Prompt window to stop the server.

---

## Troubleshooting

### Error: "node is not recognized"

**Problem:** Node.js is not installed or not in PATH

**Solution:**
1. Reinstall Node.js from https://nodejs.org/
2. Restart Command Prompt after installation
3. Verify with `node --version`

---

### Error: "npm is not recognized"

**Problem:** npm is not installed

**Solution:**
1. npm comes with Node.js - reinstall Node.js
2. Make sure you selected "Add to PATH" during installation

---

### Error: "Port 3001 is already in use"

**Problem:** Another application is using port 3001

**Solution:**
1. Change the port in `.env`: `PORT=3002`
2. Or find and close the application using port 3001:
   ```bash
   netstat -ano | findstr :3001
   taskkill /PID <PID_NUMBER> /F
   ```

---

### Error: "SESSION_SECRET is required"

**Problem:** Setup wizard didn't complete or .env file is missing

**Solution:**
1. Delete the `.env` file if it exists: `del .env`
2. Run the setup wizard again: `npm start`
3. Follow all prompts to completion

---

### Setup Wizard Issues

**Problem:** Setup wizard doesn't appear or exits immediately

**Solution:**
1. Check if `.env` file already exists: `dir .env`
2. If it exists but is incomplete, delete it: `del .env`
3. Run `npm start` again to trigger the wizard

---

### Error: "Cannot find module"

**Problem:** Dependencies not installed

**Solution:**
1. Run `npm install` in the project directory
2. Make sure you're in the correct folder
3. Check for errors during `npm install`

---

### Application starts but browser shows "Cannot GET /"

**Problem:** Server is running but not responding

**Solution:**
1. Check the server console for errors
2. Verify you're accessing `http://localhost:3001` (correct port)
3. Try clearing browser cache (Ctrl + Shift + Delete)

---

## Optional: Install Redis (For Production)

### Do I Need Redis?

**Skip Redis if:**
- ✅ Just testing the application for a few minutes
- ✅ Single user (just you)
- ✅ Don't mind logging in again after restarting the server

**Install Redis if:**
- ✅ Running for multiple users
- ✅ Want to keep login sessions after server restarts
- ✅ Want to preserve API logs history
- ✅ Using for production demos or deployments

### What Redis Provides

For development and testing, the app works fine without Redis (uses in-memory storage). However, in-memory storage means sessions and API logs are lost when the server restarts.

Install Redis to enable:
- **Persistent sessions** - Users stay logged in across server restarts
- **Persistent API logs** - API call history is preserved
- **Better performance** - Faster data access and caching

### Install Redis on Windows:

1. **Download Redis for Windows** (choose one):
   - **Chocolatey:** `choco install redis-64`
   - **Scoop:** `scoop install redis`
   - **Manual:** Download the latest `.msi` or `.zip` from [github.com/tporadowski/redis/releases](https://github.com/tporadowski/redis/releases)

2. **Install and start Redis:**
   - If installed via MSI, Redis runs as a Windows service automatically
   - Otherwise, start it manually: `redis-server`
   - If the service isn't running: `net start Redis`

3. **Configure in `.env`:**
   ```bash
   REDIS_URL=redis://localhost:6379
   ```

4. **Restart the application**

5. **Verify the app is using Redis:**
   - When you start the server, you should see:
   ```
   ✓ Redis connected for session persistence
   ```
   - Instead of:
   ```
   ✓ Redis: Memory (sessions not persisted)
   ```

---

## Firewall Configuration

If you want to access the application from other devices on your network:

1. Open **Windows Defender Firewall**
2. Click **"Allow an app through firewall"**
3. Click **"Change settings"**
4. Click **"Allow another app"**
5. Browse to: `C:\Program Files\nodejs\node.exe`
6. Add and enable for both Private and Public networks
7. Access from other devices: `http://YOUR_WINDOWS_IP:3001`

---

## Next Steps

Once the application is running:

1. ✅ **Explore Features** - Navigate through templates, signatures, API logs
2. ✅ **Create Templates** - Build reusable signature templates
3. ✅ **Send Test Requests** - Try sending a signature request
4. ✅ **View API Logs** - See all API calls in real-time
5. ✅ **Customize Branding** - Add your logo and colors in Settings

See the [Demo Script](./docs/DEMO_SCRIPT.md) for a complete walkthrough!

---

## Getting Help

- **Documentation:** Check the `/docs` folder
- **API Issues:** [Dropbox Sign API Docs](https://developers.hellosign.com/)
- **Bug Reports:** [GitHub Issues](https://github.com/hellosign/dropbox-sign-api-demo/issues)

---

## System Requirements

**Minimum:**
- Windows 10 or Windows 11
- 4GB RAM
- 500MB free disk space
- Internet connection

**Recommended:**
- Windows 10/11 (64-bit)
- 8GB RAM
- 1GB free disk space
- Stable internet connection

---

**Ready to get started?** Follow the steps above and you'll be up and running in 10 minutes! 🚀
