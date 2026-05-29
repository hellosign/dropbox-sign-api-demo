# Documentation Overview

## Structure

```text
dbx-sign-api-demo-public/
├── README.md
├── .env.example
├── docs/
│   ├── README.md
│   ├── DOCUMENTATION.md
│   ├── DEMO_SCRIPT.md
│   ├── RELEASE_NOTES.md
│   ├── architecture/
│   ├── authentication/
│   ├── deployment/
│   ├── development/
│   ├── features/
│   └── security/
```

## Reading Paths

Quick local setup:

1. Read [README.md](../README.md).
2. Copy `.env.example` to `.env`.
3. Add Dropbox Sign credentials.
4. Run `npm install` and `npm start`.

OAuth setup:

1. Read [authentication/OAUTH_SETUP.md](./authentication/OAUTH_SETUP.md).
2. Review [authentication/OAUTH_DEPLOYMENT.md](./authentication/OAUTH_DEPLOYMENT.md).
3. Configure access rules with [authentication/ACCESS_CONTROL.md](./authentication/ACCESS_CONTROL.md).

Production deployment:

1. Review [deployment/ENV_CONFIGURATION.md](./deployment/ENV_CONFIGURATION.md).
2. Follow [deployment/DEPLOYMENT.md](./deployment/DEPLOYMENT.md).
3. Review [security/SECURITY.md](./security/SECURITY.md).

## Maintenance

When adding documentation, keep links relative, use placeholder credentials, and avoid machine-specific hostnames, usernames, paths, IP addresses, or private deployment aliases.
