# Text Tags Limitation in Template Creation

## Problem

When creating a template from the Document Editor's "Text Tags" tab using "Save as Dropbox Sign Template", the text tags remain as literal text in the embedded editor instead of being converted to interactive signature/form fields.

## Root Cause

The Dropbox Sign API has **different parameters for different endpoints**:

### ✅ Unclaimed Draft API (Supports Text Tags)
```javascript
// UnclaimedDraftCreateEmbeddedRequest
{
  useTextTags: true,          // ✅ Parse text tags like [sig|req|signer1]
  usePreexistingFields: true, // ✅ Parse PDF form fields
  hideTextTags: true          // ✅ Hide the text tag syntax after parsing
}
```

### ❌ Template Embedded Draft API (No Text Tags Support)
```javascript
// TemplateCreateEmbeddedDraftRequest
{
  usePreexistingFields: true, // ✅ Parse PDF form fields ONLY
  // useTextTags: undefined   // ❌ NOT AVAILABLE
}
```

## Why This Matters

- **Text tags** like `[sig|req|signer1]` are strings embedded in text
- **PDF form fields** are interactive elements created in PDF editors (Adobe Acrobat, etc.)
- Template creation API only supports PDF form fields, NOT text tags
- Unclaimed drafts (signature requests) support both

## Current Implementation

The `/create-template` endpoint uses:
```javascript
const createReq = new DropboxSign.TemplateCreateEmbeddedDraftRequest();
createReq.usePreexistingFields = true; // Only detects PDF form fields
```

This works for PDFs with Acrobat form fields, but NOT for text tags.

## Verification

Checked SDK type definitions:
- `/node_modules/@dropbox/sign/types/model/templateCreateEmbeddedDraftRequest.d.ts`
  - Has: `usePreexistingFields?: boolean`
  - Missing: `useTextTags` parameter

- `/node_modules/@dropbox/sign/types/model/unclaimedDraftCreateEmbeddedRequest.d.ts`
  - Has: `usePreexistingFields?: boolean`
  - Has: `useTextTags?: boolean` ✅
  - Has: `hideTextTags?: boolean` ✅

## Workarounds

### Option 1: Use Unclaimed Drafts Instead of Templates
Instead of "Save as Dropbox Sign Template", use "Send for Signature":
- Uses `/oauth/create-unclaimed-draft` endpoint
- Supports `useTextTags: true`
- Text tags will be parsed correctly
- **Trade-off**: Creates a one-time signature request, not a reusable template

### Option 2: Manual Template Creation
1. Go to Dropbox Sign web UI
2. Upload the PDF
3. Manually add signature/form fields in the template editor
4. Save as template
- **Trade-off**: Can't automate from the portal

### Option 3: Two-Step Process (Complex)
1. Create unclaimed draft with `useTextTags: true`
2. Complete the draft to create a signature request
3. Convert signature request to template via API
- **Trade-off**: More complex, requires multiple API calls
- **Unknown**: Whether this preserves the fields correctly

### Option 4: Use PDF Form Fields Instead of Text Tags
- Generate PDFs with actual form fields (using a PDF library that supports form fields)
- Use `usePreexistingFields: true` in template creation
- **Trade-off**: Requires different PDF generation approach (PDFKit doesn't support form fields)

## Recommendation

For the **Demo Portal**, the best approach is:

1. **For Templates**: Use the embedded template editor to manually place fields
   - Remove the "Save as Dropbox Sign Template" button from Text Tags tab
   - Or add a warning that text tags won't be auto-parsed for templates
   
2. **For Text Tags**: Use the "Send for Signature" flow instead
   - `/oauth/create-unclaimed-draft` with `useTextTags: true`
   - Text tags will work perfectly for signature requests
   - Already implemented and working in the portal

## Updated Documentation

The portal supports text tags for **signature requests** via:
- Document Editor → Text Tags → Send for Signature ✅

The portal does NOT support text tags for **template creation**:
- Document Editor → Text Tags → Save as Dropbox Sign Template ❌
  - Text tags will appear as literal text
  - Fields must be added manually in the template editor

## Testing

You can verify this behavior:

1. **Text Tags in Signature Request** (Works):
   ```bash
   # Uses UnclaimedDraftCreateEmbeddedRequest
   POST /oauth/create-unclaimed-draft
   {
     useTextTags: true,  // ✅ Supported
     files: [pdf_with_text_tags]
   }
   ```

2. **Text Tags in Template** (Doesn't Work):
   ```bash
   # Uses TemplateCreateEmbeddedDraftRequest
   POST /create-template
   {
     usePreexistingFields: true,  // Only for PDF form fields
     files: [pdf_with_text_tags]
   }
   ```

## API Limitation Summary

| Feature | Template Creation | Unclaimed Draft (Signature Request) |
|---------|------------------|-------------------------------------|
| PDF Form Fields | ✅ `usePreexistingFields: true` | ✅ `usePreexistingFields: true` |
| Text Tags | ❌ Not supported | ✅ `useTextTags: true` |
| Use Case | Reusable templates | One-time signature requests |

## Conclusion

This is a **Dropbox Sign API limitation**, not a bug in the demo portal. The template creation endpoint does not support text tag parsing - only the signature request (unclaimed draft) endpoint does.

---

**Last Updated:** 2026-04-18
