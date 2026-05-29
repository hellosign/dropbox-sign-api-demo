/**
 * Issue Classifier Service
 * Analyzes GitHub issues and classifies them by complexity
 */

/**
 * Classification patterns for different error types
 */
const SIMPLE_PATTERNS = {
  missing_translation: {
    regex: /translation missing|i18n key not found|__\(['"](.*?)['"]\)|{{__\s+['"](.*?)['"]/i,
    confidence: 95,
    suggestedActions: [
      'Add missing i18n key to /locales/en.json',
      'Add translations to locales/ directory for additional languages (es, ja, etc.)'
    ],
    affectedFiles: ['/locales/en.json']
  },
  typo: {
    regex: /typo|misspelled|should be ["'](.*?)["']|spelling error/i,
    confidence: 85,
    suggestedActions: [
      'Fix typo in template or string',
      'Search codebase for the misspelled text',
      'Update the text to the correct spelling'
    ],
    affectedFiles: ['/views/**/*.hbs', '/public/*.js']
  },
  css_selector: {
    regex: /querySelector.*returned null|element not found|cannot read.*null|getElementById.*null/i,
    confidence: 75,
    suggestedActions: [
      'Update CSS selector or add missing element',
      'Check if element ID or class name changed',
      'Verify element exists in the DOM when accessed'
    ],
    affectedFiles: ['/public/*.js', '/views/**/*.hbs', '/public/style.css']
  },
  missing_alt: {
    regex: /img.*missing alt|image.*alt attribute|alt text/i,
    confidence: 90,
    suggestedActions: [
      'Add alt attribute to img tag',
      'Use descriptive text for accessibility'
    ],
    affectedFiles: ['/views/**/*.hbs']
  },
  console_log: {
    regex: /console\.log|debug statement|remove console/i,
    confidence: 80,
    suggestedActions: [
      'Remove console.log statement',
      'Search for console.log in the file',
      'Replace with proper logging if needed'
    ],
    affectedFiles: ['/public/*.js', '/src/**/*.js']
  },
  reference_error: {
    regex: /ReferenceError.*is not defined|undefined variable|variable.*not declared/i,
    confidence: 70,
    suggestedActions: [
      'Define the missing variable',
      'Check for typos in variable name',
      'Verify variable is in scope'
    ],
    affectedFiles: ['/public/*.js', '/src/**/*.js']
  }
};

const COMPLEX_PATTERNS = {
  api_error: {
    regex: /API error|HTTP.*failed|request failed|status code [45]\d{2}|ECONNREFUSED/i,
    confidence: 80
  },
  database_error: {
    regex: /Redis.*connection|database.*error|query failed|ECONNRESET/i,
    confidence: 85
  },
  authentication_error: {
    regex: /auth.*failed|unauthorized|forbidden|session.*expired|CSRF/i,
    confidence: 75
  },
  race_condition: {
    regex: /race condition|concurrent|parallel.*conflict|timing issue/i,
    confidence: 60
  },
  performance_issue: {
    regex: /slow|performance|timeout|takes too long|memory leak/i,
    confidence: 65
  },
  network_error: {
    regex: /network.*error|ETIMEDOUT|connection.*refused|DNS.*failed/i,
    confidence: 80
  }
};

const UNRESOLVABLE_INDICATORS = {
  feature_request: {
    regex: /feature request|enhancement|should|could|would be nice|suggestion/i,
    confidence: 90
  },
  architecture_decision: {
    regex: /architecture|design decision|refactor|restructure|migrate/i,
    confidence: 70
  },
  security_vulnerability: {
    regex: /security|vulnerability|exploit|CVE-|injection|XSS|SQL injection/i,
    confidence: 95
  },
  requires_business_input: {
    regex: /business logic|stakeholder|product.*decision|requirement.*unclear/i,
    confidence: 80
  }
};

/**
 * Classify an issue based on its content
 * @param {string} issueBody - The issue body content
 * @param {string} issueTitle - The issue title
 * @param {Array} labels - Array of label objects
 * @returns {Object} - Classification result
 */
export function classifyIssue(issueBody, issueTitle, labels = []) {
  const fullText = `${issueTitle}\n${issueBody}`.toLowerCase();

  // Check if explicitly marked as feature request
  const hasFeatureLabel = labels.some(label =>
    label.name === 'feature-request' || label.name === 'enhancement'
  );

  if (hasFeatureLabel) {
    return {
      category: 'unresolvable',
      confidence: 95,
      detectedPatterns: ['feature_request'],
      reasons: ['Labeled as feature request'],
      suggestedActions: ['Review feature request with product team']
    };
  }

  // Check for unresolvable patterns first
  const unresolvableMatches = findPatternMatches(fullText, UNRESOLVABLE_INDICATORS);
  if (unresolvableMatches.length > 0) {
    const topMatch = unresolvableMatches[0];
    return {
      category: 'unresolvable',
      confidence: topMatch.confidence,
      detectedPatterns: unresolvableMatches.map(m => m.pattern),
      reasons: [`Matches ${topMatch.pattern} pattern`],
      suggestedActions: ['Requires manual review and decision']
    };
  }

  // Check for simple patterns
  const simpleMatches = findPatternMatches(fullText, SIMPLE_PATTERNS);
  if (simpleMatches.length > 0) {
    const topMatch = simpleMatches[0];
    const patternData = SIMPLE_PATTERNS[topMatch.pattern];

    return {
      category: 'simple',
      confidence: topMatch.confidence,
      detectedPatterns: simpleMatches.map(m => m.pattern),
      reasons: [`Matches ${topMatch.pattern} pattern`],
      suggestedActions: patternData.suggestedActions,
      affectedFiles: patternData.affectedFiles
    };
  }

  // Check for complex patterns
  const complexMatches = findPatternMatches(fullText, COMPLEX_PATTERNS);
  if (complexMatches.length > 0) {
    const topMatch = complexMatches[0];

    return {
      category: 'complex',
      confidence: topMatch.confidence,
      detectedPatterns: complexMatches.map(m => m.pattern),
      reasons: [`Matches ${topMatch.pattern} pattern - requires investigation`],
      suggestedActions: [
        'Review server logs for related errors',
        'Check Redis connection status',
        'Investigate root cause before attempting fix'
      ]
    };
  }

  // No clear pattern detected - default to complex for safety
  return {
    category: 'complex',
    confidence: 50,
    detectedPatterns: [],
    reasons: ['No clear pattern detected - manual review recommended'],
    suggestedActions: [
      'Review issue details carefully',
      'Attempt to reproduce the issue',
      'Gather more context from logs'
    ]
  };
}

/**
 * Find all matching patterns in text
 * @param {string} text - Text to search
 * @param {Object} patterns - Pattern definitions
 * @returns {Array} - Array of matches with confidence scores
 */
function findPatternMatches(text, patterns) {
  const matches = [];

  for (const [patternName, patternData] of Object.entries(patterns)) {
    if (patternData.regex.test(text)) {
      matches.push({
        pattern: patternName,
        confidence: patternData.confidence
      });
    }
  }

  // Sort by confidence (highest first)
  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Extract potential error messages from issue body
 * @param {string} issueBody - The issue body
 * @returns {Array} - Array of error messages
 */
export function extractErrorMessages(issueBody) {
  const errors = [];

  // Extract from "Recent Console Errors" section
  const consoleErrorsMatch = issueBody.match(/## Recent Console Errors\s+([\s\S]*?)(?=##|$)/i);
  if (consoleErrorsMatch) {
    const errorSection = consoleErrorsMatch[1];
    const errorLines = errorSection.split('\n').filter(line => line.trim());
    errors.push(...errorLines);
  }

  // Extract error messages from description
  const errorPatterns = [
    /error[:\s]+(.*?)(?:\n|$)/gi,
    /exception[:\s]+(.*?)(?:\n|$)/gi,
    /failed[:\s]+(.*?)(?:\n|$)/gi
  ];

  for (const pattern of errorPatterns) {
    let match;
    while ((match = pattern.exec(issueBody)) !== null) {
      if (match[1] && match[1].length > 10) {
        errors.push(match[1].trim());
      }
    }
  }

  return [...new Set(errors)]; // Remove duplicates
}

/**
 * Determine if an issue requires immediate attention
 * @param {Object} classification - Classification result
 * @param {string} issueBody - Issue body content
 * @returns {boolean} - True if urgent
 */
export function isUrgent(classification, issueBody) {
  const urgentKeywords = [
    'production down',
    'critical',
    'urgent',
    'blocking',
    'cannot access',
    'data loss',
    'security breach'
  ];

  const bodyLower = issueBody.toLowerCase();
  return urgentKeywords.some(keyword => bodyLower.includes(keyword));
}
