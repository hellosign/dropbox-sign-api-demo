# Contributing to Dropbox Sign Demo Portal

Thank you for your interest in contributing to the Dropbox Sign Demo Portal! This document provides guidelines for contributing to the project.

---

## Getting Started

### Prerequisites
- Node.js 18+ and npm
- Redis (optional for local development, in-memory sessions work for testing)
- Dropbox Sign API key (get one at [developers.hellosign.com](https://developers.hellosign.com))

### Setup for Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/hellosign/dropbox-sign-api-demo.git
   cd dropbox-sign-api-demo
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Dropbox Sign API credentials
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

The application will be available at `http://localhost:3001`

---

## Development Workflow

### Running the Application

```bash
npm start
```

The application will run at `http://localhost:3001`

### Code Style

- Use consistent indentation (2 spaces for JavaScript, Handlebars templates)
- Follow existing code patterns and naming conventions
- Add comments for complex logic or non-obvious decisions
- Keep functions focused and modular

---

## Project Structure

```
dropbox-sign-api-demo/
├── server.js              # Main Express application
├── src/
│   ├── routes/           # Route handlers
│   ├── services/         # Business logic
│   ├── middleware/       # Express middleware
│   ├── utils/            # Utility functions
│   └── config/           # Configuration modules
├── views/                # Handlebars templates
├── public/               # Static assets
├── config/               # Application config files
├── locales/              # i18n translation files
└── docs/                 # Documentation
```

---

## Making Changes

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-description
```

### 2. Make Your Changes

- Follow the existing code style and patterns
- Test your changes locally
- Ensure the application starts without errors
- Check that existing functionality still works

### 3. Commit Your Changes

```bash
git add .
git commit -m "Clear, descriptive commit message"
```

**Commit message guidelines:**
- Use present tense ("Add feature" not "Added feature")
- Be descriptive but concise
- Reference issue numbers if applicable (#123)

### 4. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub with:
- Clear description of what changed and why
- Screenshots for UI changes
- Any special testing instructions

---

## Pull Request Guidelines

### Before Submitting

- [ ] Code follows the project's style and conventions
- [ ] Application starts and runs without errors
- [ ] Existing features still work as expected
- [ ] New features are documented (README, inline comments)
- [ ] Environment variables added to `.env.example` with descriptions

### PR Description Should Include

1. **What changed** - Brief summary of the changes
2. **Why** - Problem being solved or feature being added
3. **How to test** - Steps to verify the changes work
4. **Screenshots** - For UI changes
5. **Breaking changes** - If any, clearly documented

---

## Reporting Bugs

### Before Reporting

- Check [existing issues](https://github.com/hellosign/dropbox-sign-api-demo/issues) to avoid duplicates
- Verify the bug exists in the latest version

### Bug Report Should Include

1. **Description** - What happened vs. what you expected
2. **Steps to reproduce** - Detailed steps to recreate the issue
3. **Environment** - OS, Node version, browser (if UI issue)
4. **Logs** - Relevant error messages or console output
5. **Screenshots** - If applicable

---

## Feature Requests

We welcome feature requests! Please:

1. Check if the feature already exists or is planned
2. Clearly describe the use case and problem it solves
3. Provide examples of how the feature would work
4. Consider if it fits the project's scope (demo platform for Dropbox Sign API)

---

## Questions or Need Help?

- **Documentation**: Check the `/docs` folder
- **Issues**: [GitHub Issues](https://github.com/hellosign/dropbox-sign-api-demo/issues)
- **Dropbox Sign API**: [Official API Documentation](https://developers.hellosign.com/)

---

## Contributor License Agreement

All external contributions to this project are subject to the Dropbox Contributor License Agreement (CLA). When you open a pull request for the first time, the **cla-assistant** bot will guide you through the signing process. You only need to sign it once.

## License

By contributing to this project, you agree that your contributions will be licensed under the Apache License 2.0.
