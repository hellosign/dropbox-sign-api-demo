# Internationalization (i18n) Guide

## Overview

The Dropbox Sign Demo Portal uses **i18n** for multi-language support with a **flat JSON structure** and **dot-notation keys**.

---

## Current Languages

- **English (en)** - Source of truth (337+ keys)
- **Spanish (es)** - Full translation (338 keys)
- **Japanese (ja)** - Full translation (338 keys)

Translation files: `/locales/*.json`

---

## How Translation Works

### Language Detection Priority

The system detects user language in this order:

1. **Query parameter** - `?locale=es` (highest priority)
2. **Session preference** - Saved in user session
3. **Cookie** - `locale` cookie value
4. **Accept-Language header** - Browser preference
5. **Default** - Falls back to `en` (English)

---

## Using Translations

### Server-Side (Handlebars Templates)

Use the `{{__ "key"}}` helper in `.hbs` files:

```handlebars
<!-- Button text -->
<button>{{__ "common.save"}}</button>

<!-- Input placeholder -->
<input placeholder="{{__ "form.placeholder.email"}}" />

<!-- Page title -->
<h1>{{__ "page.templates.title"}}</h1>
```

### Client-Side (JavaScript)

Use the `t(key)` function in JavaScript:

```javascript
// Show alert
alert(t('alert.success'));

// Update content
document.getElementById('title').textContent = t('page.title');

// Build strings
const message = t('notification.sent') + ' ' + userName;
```

---

## Translation File Structure

**Format:** Flat JSON with dot-notation keys

```json
{
  "_comment": "English translations - Source of truth",
  "common.welcome": "Welcome",
  "common.save": "Save",
  "nav.tabs.templates": "Templates",
  "form.label.email": "Email Address",
  "alert.success": "Success!"
}
```

**Key Naming Convention:**
- `common.*` - Common UI elements (buttons, labels)
- `nav.*` - Navigation items
- `form.*` - Form fields, labels, placeholders
- `alert.*` - Alert and notification messages
- `page.*` - Page-specific content
- `[feature].*` - Feature-specific translations

---

## Adding New Translations

### Step 1: Add to English Source

Edit `/locales/en.json`:

```json
{
  "feature.my_button": "Click Me",
  "feature.my_tooltip": "This is helpful"
}
```

### Step 2: Add to Other Languages

Edit `/locales/es.json`:
```json
{
  "feature.my_button": "Haz clic",
  "feature.my_tooltip": "Esto es útil"
}
```

Edit `/locales/ja.json`:
```json
{
  "feature.my_button": "クリック",
  "feature.my_tooltip": "これは便利です"
}
```

### Step 3: Use in Code

```handlebars
<button title="{{__ 'feature.my_tooltip'}}">
  {{__ "feature.my_button"}}
</button>
```

---

## Adding a New Language

### 1. Create Translation File

Create `/locales/fr.json`:

```json
{
  "_comment": "French translations",
  "common.welcome": "Bienvenue",
  "common.save": "Enregistrer",
  ...
}
```

Copy all keys from `en.json` and translate the values.

### 2. Register Language

Edit `src/middleware/i18n.js`:

```javascript
i18n.configure({
  locales: ['en', 'es', 'ja', 'fr'], // Add 'fr'
  defaultLocale: 'en',
  // ...
});
```

### 3. Restart Application

```bash
npm start
```

---

## Switching Languages

### As a User

**Method 1: URL Parameter**
```
http://localhost:3001/?locale=es
```

**Method 2: In Application**
Settings → Preferences → Select Language (if implemented)

**Method 3: Browser Default**
The app automatically detects your browser's language preference.

### As a Developer

**Set cookie:**
```javascript
document.cookie = "locale=ja; path=/";
location.reload();
```

**Check current locale:**
```javascript
console.log(req.session.preferences.locale);
```

---

## Testing Translations

### Test Different Languages

```bash
# English (default)
curl http://localhost:3001

# Spanish
curl http://localhost:3001/?locale=es

# Japanese
curl http://localhost:3001/?locale=ja
```

### Verify All Keys Present

```bash
# Count translation keys
grep -c '"[^"]*":' locales/en.json
grep -c '"[^"]*":' locales/es.json
grep -c '"[^"]*":' locales/ja.json
```

All files should have the same number of keys.

### Missing Key Behavior

If a translation key is missing, the key itself will be displayed:

```
{{__ "missing.key"}} → displays: "missing.key"
```

---

## Translation Workflow for Teams

### Using Translation Services

1. **Export** `locales/en.json` to your translation service (Transifex, Lokalise, DeepL, etc.)
2. **Translate** all values (keep keys unchanged)
3. **Import** translated JSON files back to `/locales/`
4. **Add** language codes to `src/middleware/i18n.js`
5. **Test** with `?locale=[code]`

### Manual Translation

1. Copy `en.json` to `[language-code].json`
2. Translate all values in the new file
3. Register in i18n configuration
4. Restart server

---

## Configuration

**File:** `src/middleware/i18n.js`

```javascript
i18n.configure({
  locales: ['en', 'es', 'ja'],        // Available languages
  defaultLocale: 'en',                 // Fallback language
  directory: './locales',              // Translation files location
  cookie: 'locale',                    // Cookie name
  queryParameter: 'locale',            // URL param name
  autoReload: process.env.NODE_ENV !== 'production',
  updateFiles: false,                  // Don't auto-update JSON
  syncFiles: false,                    // Don't sync missing keys
  objectNotation: false,               // Use flat structure
});
```

---

## Troubleshooting

### Translations Not Loading

**Check:**
- File exists: `/locales/[lang].json`
- JSON is valid (no syntax errors)
- Language registered in `i18n.configure({ locales: [...] })`

**Solution:**
- Validate JSON: `node -e "require('./locales/es.json')"`
- Restart server in production mode

### New Translations Not Appearing

**Development:** Auto-reloads, but may need hard refresh (Ctrl+Shift+R)  
**Production:** Requires server restart

### Wrong Language Showing

**Steps:**
1. Clear browser cookies
2. Force language: `?locale=en`
3. Check `Accept-Language` header in browser DevTools

---

## Best Practices

✅ **Always update all language files** when adding new keys  
✅ **Use descriptive key names** (`page.templates.title` not `pt`)  
✅ **Keep translations short** for UI elements  
✅ **Test in all languages** before deploying  
✅ **Document context** in `_comment` fields for translators  
✅ **Use placeholders** for dynamic content: `"Hello {name}"`

---

## Summary

- **3 languages:** English, Spanish, Japanese
- **337+ translation keys** covering all features
- **Server-side:** `{{__ "key"}}` in Handlebars
- **Client-side:** `t('key')` in JavaScript
- **Auto language detection** from browser/cookies
- **Simple JSON format** for easy translation
- **No build step required** - edit JSON and restart

For questions, see the [i18n npm package documentation](https://github.com/mashpie/i18n-node).
