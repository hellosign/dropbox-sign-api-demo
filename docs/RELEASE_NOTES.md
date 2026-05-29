# Release Notes

## 1.0.0 - Initial Public Release

### Features

- **Template Management** - Create, edit, and manage signature templates
- **Signature Requests** - Send documents for signature with status tracking
- **Embedded Signing** - In-app signing experience via iframe
- **Webhook Integration** - Real-time event notifications
- **API App Management** - View and configure API apps
- **API Logging** - View all API calls and responses in real-time
- **Custom Branding** - Apply custom colors, logos, and themes
- **Multi-language Support** - English, Spanish, and Japanese
- **Access Control** - Domain and email whitelisting
- **Docker Support** - One-command setup with Docker Compose

### Setup Options

- **Docker** (recommended) - `docker compose up` with Redis included
- **Native** - Interactive setup wizard on first `npm start`
- **Manual** - Copy `.env.example` and configure manually

### Security

- Session isolation per user
- API key encryption at rest
- CSRF protection
- Rate limiting
- Secure cookie configuration

### Requirements

- Node.js 22+ (native setup)
- Docker Desktop (Docker setup)
- Dropbox Sign account
