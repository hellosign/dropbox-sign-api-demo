# Demo Script - Presenter Guide

A step-by-step guide for demonstrating the Dropbox Sign API Demo Portal in live sessions.

---

## Pre-Demo Checklist

- [ ] Application is running (`npm start` or `docker compose up`)
- [ ] Browser open to `http://localhost:3001`
- [ ] Logged in with your Dropbox Sign account
- [ ] API key configured (if showing API features)
- [ ] Custom branding applied (if demoing for a specific prospect)

---

## Demo Flow

### 1. Portal Overview (2 min)

- Show the dashboard and navigation
- Highlight the clean, branded interface
- Mention multi-language support (Settings > Language)

### 2. Template Management (5 min)

**Creating a template:**
1. Navigate to Templates
2. Upload a sample PDF document
3. Add signature fields, text fields, and date fields
4. Save the template

**Key talking points:**
- Templates are reusable across multiple signature requests
- Fields can be assigned to different signers
- Templates support merge fields for dynamic content

### 3. Sending Signature Requests (5 min)

**From a template:**
1. Select a saved template
2. Add signer email addresses
3. Customize the message
4. Send the request

**Key talking points:**
- Requests can be sent to multiple signers
- Signing order can be configured
- Real-time status tracking available

### 4. Embedded Signing (3 min)

1. Create a signature request with embedded signing enabled
2. Generate a sign URL
3. Show the embedded signing iframe experience

**Key talking points:**
- Signing happens within your application (no redirect)
- Fully customizable look and feel
- White-label experience for end users

### 5. Webhook Events (3 min)

1. Navigate to Webhooks section
2. Show incoming events from recent signature requests
3. Explain the event types (signature_request_sent, signature_request_signed, etc.)

**Key talking points:**
- Real-time notifications for all signature events
- Webhooks enable automated workflows
- Events include full request metadata

### 6. API Logs (2 min)

1. Navigate to API Logs
2. Show the request/response pairs from recent actions
3. Highlight the API endpoints used

**Key talking points:**
- Full visibility into API interactions
- Useful for debugging and understanding the API
- Shows exactly what code is needed to replicate each action

---

## Tips for Presenters

- **Customize branding first** - Apply the prospect's colors and logo before the demo (Settings > Themes)
- **Prepare templates in advance** - Have 2-3 templates ready to avoid upload delays
- **Use test mode** - API apps in test mode won't send real emails to signers
- **Show the API logs** - Technical audiences appreciate seeing the actual API calls
- **Keep it interactive** - Let prospects suggest scenarios to demo

---

## Common Questions

**Q: How long does integration take?**
A: Basic integration (send for signature) can be done in a few hours. Full embedded workflows typically take 1-2 weeks.

**Q: What languages are supported?**
A: The API supports 22+ languages for the signing experience. This demo portal supports English, Spanish, and Japanese.

**Q: Can we customize the signing experience?**
A: Yes - branding, colors, redirect URLs, and the entire embedded experience are customizable.

**Q: What about compliance?**
A: Dropbox Sign is SOC 2 Type II compliant, HIPAA ready, and provides full audit trails for every signature.

---

## After the Demo

1. Share relevant API documentation links
2. Offer a sandbox/test account if needed
3. Follow up with specific integration guidance based on their use case
