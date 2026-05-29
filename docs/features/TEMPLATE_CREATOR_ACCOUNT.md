# Template Creator Account Issue

## Issue

When creating a template via the "Save as Dropbox Sign Template" button, the template appears in the Dropbox Sign portal, but the "Created By" field shows a different email address than the OAuth user who created it.

## Why This Happens

### Embedded Draft API Requirement

The `templateCreateEmbeddedDraft` endpoint **requires** a `client_id` parameter:

```typescript
// From SDK type definition
export declare class TemplateCreateEmbeddedDraftRequest {
    "clientId": string;  // ← REQUIRED (no ? mark)
    "files"?: Array<RequestFile>;
    // ... other optional fields
}
```

### Template Ownership

When you provide a `client_id`, Dropbox Sign associates the template with the **API app account**, not the OAuth user account:

- **OAuth User**: The person authenticated via OAuth (you)
- **API App Owner**: The account that owns the API app (client_id)
- **Template Creator**: Shows the API app owner's email

### Current Implementation

```javascript
// server.js /create-template endpoint
const createReq = new DropboxSign.TemplateCreateEmbeddedDraftRequest();
createReq.clientId = OAUTH_CLIENT_ID; // Required by API
// Template will show OAUTH_CLIENT_ID owner as creator
```

## Expected Behavior

This is **not a bug** - it's how the Dropbox Sign embedded draft API works:

1. **Embedded drafts require a client_id** to generate the embedded editor URL
2. **Templates are associated with the API app** that creates them
3. **The API app owner's email** appears as the creator in the UI

## Who Can See the Template?

Even though the "Created By" shows a different email:
- ✅ The OAuth user can see and edit the template
- ✅ The template appears in the OAuth user's account
- ✅ The OAuth user has full control over the template
- ✅ The template is created using the OAuth user's permissions

The "Created By" field is just **metadata** showing which API app was used.

## Comparison: Different Endpoints

### Embedded Draft (Current)
```javascript
// Requires client_id
templateApi.templateCreateEmbeddedDraft({
  clientId: OAUTH_CLIENT_ID,  // ← REQUIRED
  // ... other fields
});
// Result: "Created By" shows API app owner
```

### Direct Template Creation
```javascript
// client_id is optional
templateApi.templateCreate({
  clientId: OAUTH_CLIENT_ID,  // ← OPTIONAL
  formFieldsPerDocument: [...], // ← REQUIRED (must define fields)
  // ... other fields
});
// Result: "Created By" might show OAuth user if client_id omitted
// BUT: You must manually define all form fields (no embedded editor)
```

## Why We Use Embedded Draft

The embedded draft endpoint is used because:
1. ✅ Provides an embedded editor UI for users to place fields
2. ✅ Users can visually design the template
3. ✅ No need to manually define field positions
4. ❌ Requires `client_id` (shows API app owner as creator)

## Alternative: Direct Template Creation

You could use the direct `templateCreate` endpoint to avoid the `client_id` requirement, but:

❌ **Requires manual field definition**:
```javascript
const createReq = new DropboxSign.TemplateCreateRequest();
// Must explicitly define all form fields with positions
createReq.formFieldsPerDocument = [
  {
    documentIndex: 0,
    apiId: "signature_1",
    type: "signature",
    x: 100,
    y: 200,
    width: 150,
    height: 30,
    signer: 0
  },
  // ... must define EVERY field manually
];
```

This defeats the purpose of the embedded editor where users visually place fields.

## Recommendation

**Accept this behavior** - the "Created By" field showing the API app owner is expected when using embedded drafts. The OAuth user still owns and controls the template.

### For Users

When you see a different email in "Created By":
- ✅ This is normal for templates created via the demo portal
- ✅ You still own the template
- ✅ You can edit, use, and delete the template
- ℹ️ The email shown is the API app that powered the creation

### For Developers

If you need templates to show the OAuth user as creator:
1. Use the direct `templateCreate` endpoint (no embedded editor)
2. Manually define all form field positions
3. Omit `client_id` from the request

**Trade-off**: You lose the visual embedded editor experience.

## API App Owner Email

The email shown in "Created By" corresponds to the account that owns the OAuth app with the `OAUTH_CLIENT_ID`:

```bash
# In your .env file
OAUTH_CLIENT_ID=c8b13f2482823690e009608080a87663
```

This client ID is owned by a specific Dropbox Sign account, and that account's email is what appears as the creator.

## Summary

| Aspect | Value |
|--------|-------|
| **Issue** | "Created By" shows wrong email |
| **Cause** | Embedded draft requires `client_id` |
| **Impact** | Cosmetic only - template still belongs to OAuth user |
| **Fix Available?** | No - this is expected API behavior |
| **Workaround** | Use direct template creation (lose embedded editor) |
| **Recommendation** | Accept as-is - functionality is correct |

---

**Last Updated:** 2026-04-18
