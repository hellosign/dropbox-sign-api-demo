# Demo Script - Presenter Guide

A step-by-step guide for demonstrating the Dropbox Sign API Demo Portal in live sessions.

---

## Pre-Demo Checklist

- [ ] Application is running (`npm start` or `docker compose up`)
- [ ] Browser open to `http://localhost:3001`
- [ ] Logged in with your Dropbox Sign account
- [ ] API key configured in Settings
- [ ] Custom branding applied if demoing for a specific audience (Settings > Themes)

---

## Demo Flow

### 1. Portal Overview (2 min)

- Show the tabbed interface: New Request, Document Editor, Signature Status, Templates, Team, API Apps, API Logs, Settings
- Highlight the clean, branded interface
- Mention multi-language support (Settings > Language: English, Spanish, Japanese)

### 2. Templates (5 min)

**Viewing templates:**
1. Navigate to the Templates tab
2. Show templates synced from your Dropbox Sign account
3. Demonstrate template labels/grouping by theme

**Key talking points:**
- Templates are reusable across multiple signature requests
- Fields can be assigned to different signers (roles)
- Templates support merge fields for dynamic content
- Templates can be shared across team members

### 3. Sending Signature Requests (5 min)

**From the New Request tab:**
1. Select a template or upload a document
2. Add signer email addresses
3. Customize the subject and message
4. Send the request

**Key talking points:**
- Requests can be sent to multiple signers
- Signing order can be configured
- Test mode available (no real emails sent)
- Real-time status tracking in the Signature Status tab

### 4. Embedded Signing (3 min)

1. Send a signature request with embedded signing enabled
2. Click the sign link to open the embedded signing modal
3. Show the full in-app signing experience

**Key talking points:**
- Signing happens within the application (no redirect to external site)
- Fully customizable look and feel
- White-label experience for end users
- Fullscreen mode available (configurable in Settings)

### 5. Signature Status (2 min)

1. Navigate to the Signature Status tab
2. Show the list of sent requests and their current status
3. Demonstrate real-time status updates

**Key talking points:**
- Track all signature requests in one place
- See who has signed and who hasn't
- Cancel or resend requests as needed

### 6. API Apps (3 min)

1. Navigate to the API Apps tab
2. Show configured apps with test mode and webhook toggles
3. Explain webhook callback URLs for event notifications

**Key talking points:**
- API apps define branding and callback configuration
- Test mode prevents real emails to signers
- Webhook callbacks deliver real-time event notifications (signature_request_sent, signature_request_signed, etc.)

### 7. API Logs (2 min)

1. Navigate to the API Logs tab
2. Show the request/response pairs from recent actions
3. Expand a log entry to see full request and response details

**Key talking points:**
- Full visibility into every API interaction
- Useful for debugging and understanding the API
- Shows exactly what code is needed to replicate each action
- Logs are per-user (isolated in multi-user deployments)

### 8. Settings (1 min)

Briefly show available configuration:
- Theme/branding customization
- Language selection
- Embedded signing preferences
- API key management

---

## Tips for Presenters

- **Customize branding first** — Apply audience-appropriate colors and logo before the demo (Settings > Themes)
- **Prepare templates in advance** — Have 2-3 templates ready to avoid upload delays
- **Use test mode** — API apps in test mode won't send real emails to signers
- **Show the API logs** — Technical audiences appreciate seeing the actual API calls
- **Keep it interactive** — Let the audience suggest scenarios to demo

---

## Common Questions

**Q: How long does integration take?**
A: Basic integration (send for signature) can be done in a few hours. Full embedded workflows typically take 1-2 weeks.

**Q: What languages are supported?**
A: The API supports 22+ languages for the signing experience. This demo portal supports English, Spanish, and Japanese.

**Q: Can we customize the signing experience?**
A: Yes — branding, colors, redirect URLs, and the entire embedded experience are customizable via API apps.

**Q: What about compliance?**
A: Dropbox Sign is SOC 2 Type II compliant, HIPAA ready, and provides full audit trails for every signature.

**Q: Can multiple people use this portal?**
A: Yes — the portal supports multiple users with session isolation. Each user sees only their own data.

---

## After the Demo

1. Share relevant [Dropbox Sign API documentation](https://developers.hellosign.com/)
2. Offer a sandbox/test account if needed
3. Follow up with specific integration guidance based on their use case
