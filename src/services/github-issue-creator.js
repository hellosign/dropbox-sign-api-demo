/**
 * GitHub Issue Creator Service
 * Creates structured GitHub issues for user feedback using GitHub REST API
 */

import { Octokit } from '@octokit/rest';

// GitHub repository configuration
const GITHUB_OWNER = 'dbx-solutions';
const GITHUB_REPO = 'dropbox-sign-demo-portal';

/**
 * Get authenticated Octokit instance
 * @returns {Octokit}
 */
function getOctokit() {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is not set');
  }

  return new Octokit({ auth: token });
}

/**
 * Create a GitHub issue from user feedback
 * @param {Object} feedback - Feedback data
 * @param {string} feedback.type - Type: bug, feature, or general
 * @param {string} feedback.description - User's description
 * @param {Object} feedback.context - Context data (URL, browser, errors, etc.)
 * @param {string} feedback.userEmail - User's email
 * @returns {Promise<Object>} - { issueNumber, issueUrl }
 */
export async function createFeedbackIssue(feedback) {
  const { type, description, context, userEmail } = feedback;

  // Generate issue title (max 80 chars)
  const titlePrefix = type === 'bug' ? '🐛 Bug' : type === 'feature' ? '✨ Feature' : '💬 Feedback';
  const descriptionSnippet = description.substring(0, 50).trim();
  const title = `${titlePrefix}: ${descriptionSnippet}${description.length > 50 ? '...' : ''}`;

  // Generate issue body
  const body = generateIssueBody(feedback);

  // Determine labels (only use labels that exist in the repo)
  const labels = ['auto-triage-pending'];
  if (type === 'bug') labels.push('bug');
  if (type === 'feature') labels.push('feature-request');

  try {
    // Create issue using GitHub REST API
    const octokit = getOctokit();

    console.log('[GitHub Issue Creator] Creating issue:', {
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      title: title.substring(0, 50) + '...',
      labels
    });

    const response = await octokit.issues.create({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      title,
      body,
      labels
    });

    const issueNumber = response.data.number;
    const issueUrl = response.data.html_url;

    console.log('GitHub issue created:', {
      issueNumber,
      issueUrl,
      type,
      userEmail,
      timestamp: new Date().toISOString()
    });

    return { issueNumber, issueUrl };

  } catch (error) {
    console.error('Failed to create GitHub issue:', {
      error: error.message,
      status: error.status,
      type,
      userEmail,
      timestamp: new Date().toISOString()
    });

    // Provide more specific error messages
    if (error.status === 401) {
      throw new Error('GitHub authentication failed - check GITHUB_TOKEN');
    } else if (error.status === 403) {
      throw new Error('GitHub permission denied - token needs repo scope');
    } else if (error.status === 404) {
      throw new Error('GitHub repository not found or no access');
    }

    throw new Error('Failed to create GitHub issue');
  }
}

/**
 * Generate formatted issue body
 */
function generateIssueBody(feedback) {
  const { type, description, context, userEmail } = feedback;

  const typeLabel = type === 'bug' ? 'Bug Report' : type === 'feature' ? 'Feature Request' : 'General Feedback';
  const timestamp = new Date().toISOString();

  let body = `## User Report

**Type**: ${typeLabel}
**Reported by**: ${userEmail}
**Date**: ${timestamp}

## Description

${description}

## Context

- **URL**: ${context.url || 'N/A'}
- **Tab**: ${context.tab || 'N/A'}
- **Browser**: ${context.browserInfo?.browser || 'Unknown'} ${context.browserInfo?.version || ''} (${context.browserInfo?.os || 'Unknown'})
- **User Agent**: ${context.browserInfo?.userAgent || 'N/A'}
`;

  // Add recent console errors if available
  if (context.recentErrors && context.recentErrors.length > 0) {
    body += `\n## Recent Console Errors\n\n`;
    context.recentErrors.forEach((error, index) => {
      body += `${index + 1}. [${error.type}] ${error.message}\n`;
      if (error.stack) {
        body += `   \`\`\`\n   ${error.stack.substring(0, 200)}${error.stack.length > 200 ? '...' : ''}\n   \`\`\`\n`;
      }
    });
  }

  body += `\n## Auto-Triage Status

Status: ⏳ Pending
Last Updated: ${timestamp}

---
*This issue was created automatically by the feedback widget*
`;

  return body;
}

/**
 * Parse browser info from user agent string
 * @param {string} userAgent
 * @returns {Object} - { browser, version, os, userAgent }
 */
export function parseBrowserInfo(userAgent) {
  if (!userAgent) {
    return { browser: 'Unknown', version: '', os: 'Unknown', userAgent: '' };
  }

  let browser = 'Unknown';
  let version = '';
  let os = 'Unknown';

  // Detect browser
  if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
    browser = 'Chrome';
    const match = userAgent.match(/Chrome\/(\d+)/);
    version = match ? match[1] : '';
  } else if (userAgent.includes('Firefox')) {
    browser = 'Firefox';
    const match = userAgent.match(/Firefox\/(\d+)/);
    version = match ? match[1] : '';
  } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
    browser = 'Safari';
    const match = userAgent.match(/Version\/(\d+)/);
    version = match ? match[1] : '';
  } else if (userAgent.includes('Edg')) {
    browser = 'Edge';
    const match = userAgent.match(/Edg\/(\d+)/);
    version = match ? match[1] : '';
  }

  // Detect OS
  if (userAgent.includes('Windows')) {
    os = 'Windows';
  } else if (userAgent.includes('Mac OS X')) {
    os = 'macOS';
  } else if (userAgent.includes('Linux')) {
    os = 'Linux';
  } else if (userAgent.includes('Android')) {
    os = 'Android';
  } else if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    os = 'iOS';
  }

  return { browser, version, os, userAgent };
}
