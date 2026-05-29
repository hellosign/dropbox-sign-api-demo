# Template Sharing Guide

## Overview

The Sign API Demo application supports sharing Dropbox Sign templates with team members via the Dropbox Sign API. However, there are important limitations based on team hierarchy and user roles.

## Team Hierarchy and Sharing Permissions

### How Template Sharing Works

Template sharing in Dropbox Sign follows a hierarchical permission model based on team structure:

| Scenario | Can Share? | Can Receive? | Notes |
|----------|-----------|--------------|-------|
| **Same team member → Same team member** | ✅ Yes | ✅ Yes | Works for all roles |
| **Admin/Owner → Sub-team member** | ✅ Yes | ✅ Yes | Global visibility from admin |
| **Member → Sub-team member** | ❌ No | ❌ No | Cross-team sharing restricted |
| **Sub-team member → Parent team** | ❌ No | ❌ No | Upward sharing not allowed |
| **Sub-team member → Other sub-team** | ❌ No | ❌ No | Lateral sharing not allowed |

### User Roles

Dropbox Sign has several user roles that affect template sharing:

- **Owner (`o`)**: Full admin privileges, can share across all teams and sub-teams
- **Admin (`a`)**: Administrative privileges, can share with team and sub-team members
- **Member (`m`)**: Regular member, can only share with same-team members

## Using the Template Sharing Feature

### Step 1: Select Templates

1. Navigate to the **Templates** tab
2. Use checkboxes to select one or more templates you want to share
3. Click the **Share** button (shows count of selected templates)

### Step 2: Enter Email Addresses

1. In the modal, select "Team Members (enter emails)"
2. Enter email addresses in the text area, one per line:
   ```
   colleague1@company.com
   colleague2@company.com
   colleague3@company.com
   ```
3. Optionally check "Skip email notification" to prevent notification emails

### Step 3: Review Limitations

Before sharing, review the warning message that displays:
- Your current role (Admin, Owner, or Member)
- Who you can share with based on your role
- Team membership requirements

### Step 4: Share

1. Click the **Share** button
2. The system will attempt to share each template with each user
3. You'll see a summary of successful shares and any errors

## Common Errors and Solutions

### "Account does not belong to your team"

**Cause**: The recipient is not a member of your team, or is in a different sub-team and you don't have admin privileges.

**Solutions**:
1. **Add user to your team first**: Invite the user to join your team in Dropbox Sign settings
2. **Move user to same team**: If they're in a sub-team, move them to your team level
3. **Use admin account**: Authenticate with an admin/owner account for cross-team sharing

### "This action is not allowed by the granted scopes"

**Cause**: Your OAuth application doesn't have the `team` scope enabled.

**Solution**: This error occurs when trying to use Team API features. The current implementation uses direct email input to work around this limitation.

### Templates Not Visible After Sharing

**Cause**: Dropbox Sign API has a propagation delay. When templates are shared, it can take 30-60 seconds for the changes to appear in the `templateList()` API response.

**Solution**:
1. **Wait 30-60 seconds** after sharing
2. Click the **Refresh button** in the Templates tab
3. The shared template should now appear

**Note**: This is a limitation of the Dropbox Sign API, not the portal. The API needs time to propagate sharing changes across their system.

## API Implementation Details

### Backend Flow

1. **User enters emails**: Frontend collects email addresses
2. **Resolve account IDs**: Backend calls `AccountApi.accountGet()` to resolve emails to account IDs
3. **Share templates**: For each template and each user, calls `TemplateApi.templateAddUser()`
4. **Return results**: Returns count of successful shares and any errors

### Key API Calls

```javascript
// Resolve email to account_id
const accountResp = await accountApi.accountGet(null, email);
const accountId = accountResp.body.account.accountId;

// Share template
const addUserRequest = new DropboxSign.TemplateAddUserRequest();
addUserRequest.accountId = accountId;
addUserRequest.skipNotification = skipNotification;
await templateApi.templateAddUser(templateId, addUserRequest);
```

### Fetching Shared Templates

To see both owned and shared templates, the `account_id` must be passed to `templateList()`:

```javascript
// Include shared templates by passing account_id
const response = await templateApi.templateList(accountId, page, pageSize);
```

Without the `account_id`, only templates you created are returned.

## Best Practices

### For Administrators

1. **Use admin account for cross-team sharing**: If you need to share templates across sub-teams, authenticate with an admin or owner account
2. **Organize teams appropriately**: Keep users who need to share templates in the same team
3. **Document team structure**: Maintain a record of team hierarchy for troubleshooting

### For Regular Users

1. **Verify team membership**: Ensure recipients are on your team before attempting to share
2. **Check role limitations**: Understand your role's sharing capabilities
3. **Use skip notification option**: For bulk sharing, consider skipping notifications to avoid email spam

### For Development

1. **Store account_id in session**: Required for listing shared templates
2. **Store role_code in session**: Needed for permission checks and UI customization
3. **Handle partial failures**: Some users may fail while others succeed - show detailed error messages
4. **Invalidate cache after sharing**: Clear template cache to reflect new sharing status

## Troubleshooting

### Debugging Steps

1. **Check server logs**: Look for `[SHARE]` tagged messages showing the sharing process
2. **Verify account IDs**: Confirm that account IDs are being resolved correctly
3. **Check API response**: Look for specific error messages from the Dropbox Sign API
4. **Test with same-team member**: Verify basic sharing works before attempting cross-team

### Log Examples

Successful sharing:
```
[SHARE] Resolved user@company.com to account_id: abc123...
[SHARE] Sharing template template_id with account_id: abc123...
[SHARE] ✓ Success
```

Failed sharing:
```
[SHARE] ✗ Error sharing with user@company.com : Account does not belong to your team.
```

## Security Considerations

1. **Team-only sharing**: Templates can only be shared within team boundaries
2. **OAuth authentication**: All API calls use user's OAuth token, ensuring proper authorization
3. **Session isolation**: Each user's templates and shares are isolated in their session
4. **No external sharing**: Cannot share templates with users outside your Dropbox Sign organization

## Future Enhancements

Potential improvements to consider:

1. **Team browser**: UI to browse team members and sub-teams (requires Team API OAuth scope)
2. **Bulk operations**: Share multiple templates with multiple teams in one operation
3. **Unshare functionality**: Remove template access from users
4. **Share history**: Track who shared what with whom
5. **Permission levels**: Different access levels (view-only vs edit)

## Related Documentation

- [OAuth Setup Guide](./OAUTH_SETUP.md) - Configure OAuth application
- [Access Control Configuration](./ACCESS_CONTROL.md) - Domain/email restrictions
- [OAuth Data Isolation](./OAUTH_DATA_ISOLATION.md) - How user data is isolated

## Support

For issues or questions:
1. Check server logs for `[SHARE]` messages
2. Verify team membership in Dropbox Sign UI
3. Confirm user roles and permissions
4. Review this documentation for common issues
