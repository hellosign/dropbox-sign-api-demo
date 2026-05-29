# Dropbox Sign API Demo Portal Documentation

This directory contains the public technical documentation for the demo portal.

## Getting Started

- [Main README](../README.md) - Project overview and quick start
- [OAuth Quick Start](./README_OAUTH.md) - OAuth-oriented setup guide
- [Demo Script](./DEMO_SCRIPT.md) - Presenter guide for live demos

## Documentation by Topic

- [Architecture](./architecture/) - Data isolation and database structure
- [Authentication](./authentication/) - OAuth, API key cleanup notes, and access control
- [Deployment](./deployment/) - Environment configuration and deployment guidance
- [Features](./features/) - Template sharing, template creation, text tags, and admin features
- [Security](./security/) - Security implementation notes and review summary
- [Development](./development/) - Implementation notes and migration history

## Common Tasks

- Configure OAuth: [authentication/OAUTH_SETUP.md](./authentication/OAUTH_SETUP.md)
- Configure access control: [authentication/ACCESS_CONTROL.md](./authentication/ACCESS_CONTROL.md)
- Deploy the app: [deployment/DEPLOYMENT.md](./deployment/DEPLOYMENT.md)
- Review environment variables: [deployment/ENV_CONFIGURATION.md](./deployment/ENV_CONFIGURATION.md)
- Understand session isolation: [architecture/OAUTH_DATA_ISOLATION.md](./architecture/OAUTH_DATA_ISOLATION.md)
- Troubleshoot template creation: [features/TEMPLATE_CREATION_FIX.md](./features/TEMPLATE_CREATION_FIX.md)

## Notes

- Local examples use `http://localhost:3001`.
- Production examples use placeholder domains unless a public demo URL is specifically documented.
- Do not commit real `.env` files, generated logs, local customer files, or personal workspace data.
