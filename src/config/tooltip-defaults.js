/**
 * Default Tooltip Configuration
 * Contains all tooltip definitions for the Sign Portal Demo
 *
 * IMPORTANT: When adding/removing form fields, update this file to keep tooltips in sync
 */

export function getDefaultTooltipConfig() {
  return {
    version: "1.0",
    globalSettings: {
      enabled: true,
      defaultPosition: "top",
      showDelay: 500,
      hideDelay: 200
    },
    tooltips: {
      // ========================================
      // PRIORITY 1: CRITICAL TECHNICAL FIELDS
      // ========================================

      documentMode: {
        id: "documentMode",
        fieldName: "Document Mode",
        viewLocation: "index/tab-mandate",
        text: "Choose how to structure your document: Templates auto-populate fields, Text Tags use markdown syntax, or Form Fields lets you position fields visually",
        position: "right",
        enabled: true,
        sourceUrl: "https://developers.hellosign.com/",
        priority: 1,
        lastModified: "2026-05-02T00:00:00Z"
      },

      themeSelect: {
        id: "themeSelect",
        fieldName: "Theme Dropdown",
        viewLocation: "index/tab-mandate",
        text: "Choose a theme to customize field labels and page title. Themes can be created and edited in the Settings tab",
        position: "right",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-30T00:00:00Z"
      },

      singleSigner: {
        id: "singleSigner",
        fieldName: "Single Signer",
        viewLocation: "index/tab-mandate",
        text: "When checked, only one person needs to sign. Uncheck to require signatures from multiple signers",
        position: "right",
        enabled: true,
        sourceUrl: "",
        priority: 1,
        lastModified: "2026-04-29T00:00:00Z"
      },

      eidAuth: {
        id: "eidAuth",
        fieldName: "eID Verification",
        viewLocation: "index/tab-mandate",
        text: "Require signers to verify their identity using electronic ID (eID). Available in some regions. May require additional signer steps",
        position: "right",
        enabled: true,
        sourceUrl: "",
        priority: 1,
        lastModified: "2026-04-29T00:00:00Z"
      },

      smsAuth: {
        id: "smsAuth",
        fieldName: "SMS Authentication",
        viewLocation: "index/tab-mandate",
        text: "Require signer to verify via SMS code before signing. Enhances security. Signer must have valid phone number",
        position: "right",
        enabled: true,
        sourceUrl: "https://help.dropbox.com/account-access/dropbox-sign-sms-two-factor-authentication",
        priority: 1,
        lastModified: "2026-05-02T00:00:00Z"
      },

      smsDelivery: {
        id: "smsDelivery",
        fieldName: "SMS Delivery",
        viewLocation: "index/tab-mandate",
        text: "Send signing link via SMS instead of email. Requires Standard/Premium API plan. Not available in test mode",
        position: "right",
        enabled: true,
        sourceUrl: "",
        priority: 1,
        lastModified: "2026-04-29T00:00:00Z"
      },

      smsPhone: {
        id: "smsPhone",
        fieldName: "Phone Number",
        viewLocation: "index/tab-mandate",
        text: "Include country code (e.g., +44 for UK, +1 for US). Required for SMS authentication or delivery",
        position: "right",
        enabled: true,
        sourceUrl: "",
        priority: 1,
        lastModified: "2026-04-29T00:00:00Z"
      },

      previewTagsCheckbox: {
        id: "previewTagsCheckbox",
        fieldName: "Preview Tags",
        viewLocation: "index/tab-editor",
        text: "Show signature field tags [sig|req|signer1] in the live preview. Helps verify correct field placement before sending",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 1,
        lastModified: "2026-04-29T00:00:00Z"
      },

      formFieldsPageSelect: {
        id: "formFieldsPageSelect",
        fieldName: "Form Fields Page Select",
        viewLocation: "index/tab-editor",
        text: "Select which page of the document to edit. Add and position signature fields for each page separately",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 1,
        lastModified: "2026-04-29T00:00:00Z"
      },

      testMode: {
        id: "testMode",
        fieldName: "Test Mode",
        viewLocation: "index/tab-api-apps",
        text: "Test Mode allows unlimited signature requests without using your API quota. Real signers cannot complete requests in test mode",
        position: "top",
        enabled: true,
        sourceUrl: "https://help.dropbox.com/integrations/how-to-turn-off-test-mode-dropbox-sign",
        priority: 1,
        lastModified: "2026-05-02T00:00:00Z"
      },

      consoleLoggingEnabled: {
        id: "consoleLoggingEnabled",
        fieldName: "Browser Console Logging",
        viewLocation: "admin/users-system",
        text: "Streams all browser console messages to server logs for debugging. Disable in production to avoid performance impact and logging sensitive data",
        position: "right",
        enabled: true,
        sourceUrl: "",
        priority: 1,
        lastModified: "2026-04-29T00:00:00Z"
      },

      maxLogFileSize: {
        id: "maxLogFileSize",
        fieldName: "Max Log File Size",
        viewLocation: "admin/users-system",
        text: "Log files are archived when they exceed this size. Prevents disk space issues from excessive logging",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 1,
        lastModified: "2026-04-29T00:00:00Z"
      },

      maxRotatedFiles: {
        id: "maxRotatedFiles",
        fieldName: "Keep Rotated Files",
        viewLocation: "admin/users-system",
        text: "Number of archived log files to retain. Older files are deleted. Increasing this uses more disk space",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 1,
        lastModified: "2026-04-29T00:00:00Z"
      },

      apiKey: {
        id: "apiKey",
        fieldName: "API Key",
        viewLocation: "login",
        text: "Your API key from Dropbox Sign account settings, not your login password. Find it at app.hellosign.com under API settings",
        position: "top",
        enabled: true,
        sourceUrl: "https://developers.hellosign.com/",
        priority: 1,
        lastModified: "2026-05-02T00:00:00Z"
      },

      // ========================================
      // PRIORITY 2: HIGH VALUE FIELDS
      // ========================================

      templateLabelAssignment: {
        id: "templateLabelAssignment",
        fieldName: "Template Label Assignment",
        viewLocation: "index/tab-templates",
        text: "Labels associate templates with themes. When a theme is selected, only templates with matching labels appear. Leave blank to show template for all themes",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      shareTemplatesBtn: {
        id: "shareTemplatesBtn",
        fieldName: "Share Templates",
        viewLocation: "index/tab-templates",
        text: "Share selected templates with team members. Only users on your team can receive shared templates",
        position: "bottom",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      enableCallbacks: {
        id: "enableCallbacks",
        fieldName: "Enable Callbacks",
        viewLocation: "index/tab-api-apps",
        text: "Enable webhook callbacks to receive real-time notifications when signature status changes. Requires valid callback URL",
        position: "top",
        enabled: true,
        sourceUrl: "https://developers.hellosign.com/",
        priority: 2,
        lastModified: "2026-05-02T00:00:00Z"
      },

      visibleCheckbox: {
        id: "visibleCheckbox",
        fieldName: "Visible",
        viewLocation: "index/tab-api-apps",
        text: "When checked, this API app appears in the dropdown on the main form. Uncheck to hide from users",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      customLogoFile: {
        id: "customLogoFile",
        fieldName: "Custom Logo",
        viewLocation: "index/tab-api-apps",
        text: "Part of Premium Branding. Upload a custom logo to replace the Dropbox Sign logo in embedded signing pages. Requires API Premium plan",
        position: "top",
        enabled: true,
        sourceUrl: "https://help.dropbox.com/account-settings/dropbox-sign-premium-branding",
        priority: 2,
        lastModified: "2026-05-02T00:00:00Z"
      },

      resetWhiteLabeling: {
        id: "resetWhiteLabeling",
        fieldName: "Reset White Labeling",
        viewLocation: "index/tab-api-apps",
        text: "Part of Premium Branding. Removes all custom white labeling colors and restores default Dropbox Sign branding. Only available for API Premium plan",
        position: "top",
        enabled: true,
        sourceUrl: "https://help.dropbox.com/account-settings/dropbox-sign-premium-branding",
        priority: 2,
        lastModified: "2026-05-02T00:00:00Z"
      },

      settingFullscreenSigning: {
        id: "settingFullscreenSigning",
        fieldName: "Full Screen iFrame",
        viewLocation: "index/tab-settings",
        text: "Fullscreen mode provides better signing experience for end users. Modal mode keeps your site header/footer visible",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      settingSmsDeliveryEnabled: {
        id: "settingSmsDeliveryEnabled",
        fieldName: "Show SMS Delivery Option",
        viewLocation: "index/tab-settings",
        text: "Must be enabled for SMS Delivery to appear as an option on the main form. Requires Standard/Premium API plan",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      settingLogoOnTextTags: {
        id: "settingLogoOnTextTags",
        fieldName: "Show Portal Logo on Text Tags Documents",
        viewLocation: "index/tab-settings",
        text: "Displays portal branding on generated documents. Disable if using custom logos in your markdown content",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      themeName: {
        id: "themeName",
        fieldName: "Theme Name",
        viewLocation: "index/tab-settings",
        text: "Click to edit the theme name. This name appears in the Theme dropdown on the main form",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      themePageTitle: {
        id: "themePageTitle",
        fieldName: "Page Title",
        viewLocation: "index/tab-settings",
        text: "The main heading displayed on the signing form page. Personalizes the experience for your signers",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      themeTabLabel: {
        id: "themeTabLabel",
        fieldName: "Tab Label",
        viewLocation: "index/tab-settings",
        text: "The text shown on the 'New Mandate' tab button. Example: 'Send Document', 'Create Agreement'",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      sessionId: {
        id: "sessionId",
        fieldName: "Session ID",
        viewLocation: "admin/users-system",
        text: "Unique identifier for this user's login session. Multiple sessions mean user is logged in from different browsers/devices",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      lastActivity: {
        id: "lastActivity",
        fieldName: "Last Activity",
        viewLocation: "admin/users-system",
        text: "Time of last page load or API request. Long inactivity may indicate abandoned session",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      deleteUserBtn: {
        id: "deleteUserBtn",
        fieldName: "Delete User",
        viewLocation: "admin/users-system",
        text: "PERMANENT ACTION: Deletes all user data, sessions, and settings. Cannot be undone",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      allowedDomains: {
        id: "allowedDomains",
        fieldName: "Allowed Domains",
        viewLocation: "admin/access-control",
        text: "Users whose email domain matches (e.g., @company.com) can login. Overridden by specific email whitelist",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      allowedEmails: {
        id: "allowedEmails",
        fieldName: "Allowed Emails",
        viewLocation: "admin/access-control",
        text: "Whitelist specific email addresses. Takes precedence over domain-based access. Useful for external partners",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      forceLogoutBtn: {
        id: "forceLogoutBtn",
        fieldName: "Force Logout",
        viewLocation: "admin/access-control",
        text: "Immediately log out all active sessions from this domain/email. They cannot rejoin if access is removed",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      removeDomainBtn: {
        id: "removeDomainBtn",
        fieldName: "Remove Domain/Email",
        viewLocation: "admin/access-control",
        text: "Blocks NEW logins from this domain/email. Existing sessions remain until you force logout",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      adminEmails: {
        id: "adminEmails",
        fieldName: "Admin Emails",
        viewLocation: "admin/access-control",
        text: "These users can access sensitive admin features. Restrict to trusted personnel only",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      apiCallsSaved: {
        id: "apiCallsSaved",
        fieldName: "API Calls Saved",
        viewLocation: "admin/security",
        text: "Honeypot triggers + format rejections = failed attempts caught before API cost. Saves Dropbox Sign API quota",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      suspicionScore: {
        id: "suspicionScore",
        fieldName: "Suspicion Score",
        viewLocation: "admin/security",
        text: "0-100 score indicating likelihood of attack. 0-50: Low risk, 50-80: Medium risk, 80+: High risk. Green/Yellow/Red badges",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      filterIP: {
        id: "filterIP",
        fieldName: "Filter by IP",
        viewLocation: "admin/security",
        text: "Enter IP address to filter events. Supports partial IP matching (e.g., 192.168 matches all 192.168.x.x)",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      filterEventType: {
        id: "filterEventType",
        fieldName: "Filter Event Type",
        viewLocation: "admin/security",
        text: "honeypot_triggered: Bot detection. format_rejected: Invalid key format. login_suspicious: Unusual pattern. rate_limit: Too many attempts",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      blockIPInput: {
        id: "blockIPInput",
        fieldName: "Block IP Address",
        viewLocation: "admin/security",
        text: "Enter IPv4 address (e.g., 192.168.1.1). Use CIDR notation for ranges (e.g., 192.168.1.0/24)",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      blockDuration: {
        id: "blockDuration",
        fieldName: "Block Duration",
        viewLocation: "admin/security",
        text: "How long to block this IP. After expiration, normal access rules apply. Permanent blocks require manual renewal",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 2,
        lastModified: "2026-04-29T00:00:00Z"
      },

      // ========================================
      // PRIORITY 3: CONTEXTUAL ENHANCEMENTS
      // ========================================

      embedBtn: {
        id: "embedBtn",
        fieldName: "Embed Button",
        viewLocation: "index/tab-mandate",
        text: "Generate embed code to integrate signing into your website/app",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 3,
        lastModified: "2026-04-29T00:00:00Z"
      },

      unclaimedFileBtn: {
        id: "unclaimedFileBtn",
        fieldName: "Unclaimed Draft (File)",
        viewLocation: "index/tab-mandate",
        text: "Create a draft signature request from an uploaded file. Send link later without specifying signer emails",
        position: "top",
        enabled: true,
        sourceUrl: "https://developers.hellosign.com/",
        priority: 3,
        lastModified: "2026-05-02T00:00:00Z"
      },

      unclaimedTemplateBtn: {
        id: "unclaimedTemplateBtn",
        fieldName: "Unclaimed Draft (Template)",
        viewLocation: "index/tab-mandate",
        text: "Create a draft from a template. Signer can claim and complete using a public link",
        position: "top",
        enabled: true,
        sourceUrl: "https://developers.hellosign.com/",
        priority: 3,
        lastModified: "2026-05-02T00:00:00Z"
      },

      sendRemindersBtn: {
        id: "sendRemindersBtn",
        fieldName: "Send Reminders",
        viewLocation: "index/tab-activity",
        text: "Send email reminders to all signers who haven't signed yet. Cannot send reminders within 1 hour of the last reminder, or for embedded signatures",
        position: "top",
        enabled: true,
        sourceUrl: "https://developers.hellosign.com/api/signature-request/remind",
        priority: 3,
        lastModified: "2026-05-02T00:00:00Z"
      },

      deleteSelectedBtn: {
        id: "deleteSelectedBtn",
        fieldName: "Delete Selected",
        viewLocation: "index/tab-activity",
        text: "Remove selected signature requests. Signers will still have copies of signed documents",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 3,
        lastModified: "2026-04-29T00:00:00Z"
      },

      pageSizeSelect: {
        id: "pageSizeSelect",
        fieldName: "Page Size",
        viewLocation: "index/tab-activity",
        text: "Number of signature requests to display per page. More rows = slower loading on large lists",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 3,
        lastModified: "2026-04-29T00:00:00Z"
      },

      showLogsOnAllScreens: {
        id: "showLogsOnAllScreens",
        fieldName: "Show Logs on All Screens",
        viewLocation: "index/tab-logs",
        text: "Keep API log panel visible while navigating other tabs. Useful for debugging during form submission",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 3,
        lastModified: "2026-04-29T00:00:00Z"
      },

      teamHierarchy: {
        id: "teamHierarchy",
        fieldName: "Team Hierarchy",
        viewLocation: "index/tab-team",
        text: "Shows your team structure, members, and roles. Expand arrows reveal sub-team members and their permissions",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 3,
        lastModified: "2026-04-29T00:00:00Z"
      },

      collapseAllTeamsBtn: {
        id: "collapseAllTeamsBtn",
        fieldName: "Collapse All",
        viewLocation: "index/tab-team",
        text: "Hide all sub-teams. Use to get quick overview of top-level structure",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 3,
        lastModified: "2026-04-29T00:00:00Z"
      },

      refreshBtn: {
        id: "refreshBtn",
        fieldName: "Refresh Button",
        viewLocation: "index/various",
        text: "Manually refresh data from server. Auto-refresh may run in background",
        position: "top",
        enabled: true,
        sourceUrl: "",
        priority: 3,
        lastModified: "2026-04-29T00:00:00Z"
      }
    }
  };
}
