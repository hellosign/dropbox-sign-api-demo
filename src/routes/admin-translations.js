// src/routes/admin-translations.js
// Admin panel routes for translation management

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import util from 'util';
import i18n from 'i18n';
import { requireSession, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
const execAsync = util.promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * GET /admin/translations - Display translation editor
 */
router.get('/', requireSession, requireAdmin, async (req, res) => {
  const localesDir = path.join(__dirname, '../../locales');
  const locales = ['en', 'es', 'ja'];
  const translations = {};

  try {
    // Load all translation files
    locales.forEach(locale => {
      const filePath = path.join(localesDir, `${locale}.json`);
      if (fs.existsSync(filePath)) {
        translations[locale] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    });

    // Get git status for translations
    let gitStatus = null;
    try {
      const { stdout } = await execAsync('git log -1 --format="%h|%ar|%s" -- locales/', {
        cwd: path.join(__dirname, '../..')
      });
      if (stdout.trim()) {
        const [hash, time, message] = stdout.trim().split('|');
        gitStatus = { hash, time, message };
      }
    } catch (error) {
      console.error('[Translations] Git status error:', error.message);
      gitStatus = { error: 'Git status unavailable' };
    }

    res.render('admin-translations', {
      title: 'Translation Management',
      userEmail: req.session.accountInfo?.email_address,
      isAdmin: req.session.isAdmin,
      translations,
      locales,
      gitStatus
    });
  } catch (error) {
    console.error('[Translations] Load error:', error);
    res.status(500).send('Failed to load translations');
  }
});

/**
 * POST /admin/translations - Save edited translations
 */
router.post('/', requireSession, requireAdmin, express.json(), async (req, res) => {
  const { locale, translations } = req.body;
  const userEmail = req.session.accountInfo?.email_address || 'unknown';

  // Validate locale
  const ALLOWED_LOCALES = ['en', 'es', 'ja'];
  if (!locale || !ALLOWED_LOCALES.includes(locale)) {
    return res.status(400).json({ error: 'Invalid locale', allowed: ALLOWED_LOCALES });
  }

  // Validate translations object
  if (!translations || typeof translations !== 'object') {
    return res.status(400).json({ error: 'Invalid translations data' });
  }

  const localesDir = path.join(__dirname, '../../locales');
  const filePath = path.join(localesDir, `${locale}.json`);

  try {
    // Write to JSON file
    fs.writeFileSync(
      filePath,
      JSON.stringify(translations, null, 2) + '\n',
      'utf8'
    );

    // Auto-commit to git (production only)
    let gitCommitted = false;
    let commitHash = null;

    if (process.env.NODE_ENV === 'production' && process.env.AUTO_COMMIT_TRANSLATIONS === 'true') {
      try {
        // Check if there are changes
        const { stdout: statusOutput } = await execAsync(`git status --porcelain ${filePath}`, {
          cwd: path.join(__dirname, '../..')
        });

        if (statusOutput.trim()) {
          // Stage the file
          await execAsync(`git add ${filePath}`, {
            cwd: path.join(__dirname, '../..')
          });

          // Commit with user info
          const commitMessage = `Update ${locale} translations\n\nEdited by: ${userEmail}\nTimestamp: ${new Date().toISOString()}`;
          await execAsync(`git commit -m "${commitMessage}"`, {
            cwd: path.join(__dirname, '../..')
          });

          // Get commit hash
          const { stdout: hashOutput } = await execAsync('git rev-parse --short HEAD', {
            cwd: path.join(__dirname, '../..')
          });
          commitHash = hashOutput.trim();

          gitCommitted = true;

          // Optional: Auto-push to remote
          if (process.env.AUTO_PUSH_TRANSLATIONS === 'true') {
            await execAsync('git push origin master', {
              cwd: path.join(__dirname, '../..')
            });
          }
        }
      } catch (gitError) {
        console.error('[Git] Auto-commit failed:', gitError.message);
        // Continue - file is still saved
      }
    }

    // Reload translations in memory
    i18n.configure({
      locales: ALLOWED_LOCALES,
      defaultLocale: 'en',
      directory: localesDir,
      autoReload: false,
      updateFiles: false,
      syncFiles: false,
      objectNotation: false
    });

    res.json({
      success: true,
      message: gitCommitted ? 'Saved and committed to git' : 'Saved successfully',
      gitCommitted,
      commitHash,
      requiresPull: gitCommitted && !process.env.AUTO_PUSH_TRANSLATIONS
    });

  } catch (error) {
    console.error('[Translation Save] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save translations',
      message: error.message
    });
  }
});

/**
 * POST /admin/translations/reload - Reload translations without restart
 */
router.post('/reload', requireSession, requireAdmin, (req, res) => {
  try {
    const localesDir = path.join(__dirname, '../../locales');
    i18n.configure({
      locales: ['en', 'es', 'ja'],
      defaultLocale: 'en',
      directory: localesDir,
      autoReload: false,
      updateFiles: false,
      syncFiles: false,
      objectNotation: false
    });

    res.json({ success: true, message: 'Translations reloaded' });
  } catch (error) {
    console.error('[Translation Reload] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /admin/translations/git-status - Get git status and recent commits
 */
router.get('/git-status', requireSession, requireAdmin, async (req, res) => {
  try {
    const { stdout: log } = await execAsync('git log -5 --format="%h|%an|%ar|%s" -- locales/', {
      cwd: path.join(__dirname, '../..')
    });

    const commits = log.trim().split('\n').filter(line => line).map(line => {
      const [hash, author, time, message] = line.split('|');
      return { hash, author, time, message };
    });

    const { stdout: status } = await execAsync('git status --porcelain locales/', {
      cwd: path.join(__dirname, '../..')
    });
    const hasUncommitted = status.trim().length > 0;

    res.json({ commits, hasUncommitted });
  } catch (error) {
    console.error('[Git Status] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
