// src/services/pdf-generator.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { marked } from 'marked';
import PDFDocumentKit from 'pdfkit';
import { LOGO_CONFIG } from '../config/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Draw logo header on PDF document
 */
export function drawLogo(doc, pageWidth, topMargin, logoEnabled = true) {
  if (!logoEnabled) return 0;

  const config = LOGO_CONFIG;
  const leftMargin = 60;
  const rightMargin = 60;

  // Draw logo on left
  try {
    if (fs.existsSync(config.logoPath)) {
      doc.image(config.logoPath, leftMargin, topMargin, {
        width: config.logoWidth,
        height: config.logoHeight
      });
    }
  } catch (err) {
    console.warn('[LOGO] Failed to load logo:', err.message);
  }

  // Separator line
  const separatorY = topMargin + config.headerHeight;
  doc.strokeColor(config.separatorLineColor)
     .lineWidth(config.separatorLineWidth)
     .moveTo(leftMargin, separatorY)
     .lineTo(pageWidth - rightMargin, separatorY)
     .stroke();

  return config.headerHeight + config.headerPaddingBottom;
}

/**
 * Generate PDF from Markdown text
 */
export async function generatePdfFromMarkdown(markdownText, templateData = {}) {
  const tokens = marked.lexer(markdownText);
  const PAGE_WIDTH = 595.28 - 120; // A4 width minus margins

  // Pre-load all images referenced in the markdown
  const imageCache = {};
  function collectImages(tokenList) {
    for (const tok of tokenList) {
      if (tok.tokens) collectImages(tok.tokens);
      if (tok.type === 'image' && tok.href) {
        imageCache[tok.href] = null; // placeholder
      }
    }
  }
  collectImages(tokens);

  for (const href of Object.keys(imageCache)) {
    try {
      if (href.startsWith('http://') || href.startsWith('https://')) {
        const resp = await fetch(href);
        if (resp.ok) imageCache[href] = Buffer.from(await resp.arrayBuffer());
      } else {
        // Local path — resolve relative to public/
        const localPath = path.join(path.dirname(__dirname), '..', 'public', href.replace(/^\//, ''));
        if (fs.existsSync(localPath)) imageCache[href] = fs.readFileSync(localPath);
      }
    } catch (e) {
      console.warn('Could not load image:', href, e.message);
    }
  }

  return new Promise((resolve, reject) => {
    console.log('[PDF-GENERATOR] templateData received:', templateData);
    const logoEnabled = templateData.logoEnabled !== 'false' && templateData.logoEnabled !== false;
    console.log('[PDF-GENERATOR] logoEnabled computed:', logoEnabled, 'from:', templateData.logoEnabled);
    const headerHeight = logoEnabled ? LOGO_CONFIG.headerHeight + LOGO_CONFIG.headerPaddingBottom : 0;
    const doc = new PDFDocumentKit({
      size: 'A4',
      margins: { top: 60 + headerHeight, bottom: 60, left: 60, right: 60 },
      bufferPages: true,
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Draw logo on first page
    if (logoEnabled) {
      console.log('[PDF-GENERATOR] Drawing logo (logoEnabled:', logoEnabled, ')');
      drawLogo(doc, 595.28, 60, logoEnabled);
    }

    // Draw logo on every new page
    if (logoEnabled) {
      doc.on('pageAdded', () => {
        drawLogo(doc, 595.28, 60, logoEnabled);
      });
    }

    function renderInline(text, baseFont, baseFontBold, fontSize, opts) {
      const indent = (opts && opts.indent) || 0;
      const textWidth = PAGE_WIDTH - indent;
      const startX = 60 + indent;

      // First, strip <br>, <br/>, <br /> tags and replace with \n
      let cleaned = text.replace(/<br\s*\/?>/gi, '\n');

      // Split on newlines to handle line breaks
      const lines = cleaned.split('\n');

      lines.forEach((line, lineIdx) => {
        // Parse each line into segments: bold, italic, code, plain
        const segments = [];
        let remaining = line;

        while (remaining.length > 0) {
          // Bold: **text** or __text__
          const boldMatch = remaining.match(/^(\*\*|__)(.+?)\1/);
          if (boldMatch) {
            segments.push({ text: boldMatch[2], font: baseFontBold, size: fontSize });
            remaining = remaining.slice(boldMatch[0].length);
            continue;
          }
          // Italic: *text* or _text_
          const italicMatch = remaining.match(/^(\*|_)(.+?)\1/);
          if (italicMatch) {
            segments.push({ text: italicMatch[2], font: 'Helvetica-Oblique', size: fontSize });
            remaining = remaining.slice(italicMatch[0].length);
            continue;
          }
          // Code: `text`
          const codeMatch = remaining.match(/^`(.+?)`/);
          if (codeMatch) {
            segments.push({ text: codeMatch[1], font: 'Courier', size: fontSize - 1 });
            remaining = remaining.slice(codeMatch[0].length);
            continue;
          }
          // Plain text (up to next special char)
          const plainMatch = remaining.match(/^[^*_`]+/);
          if (plainMatch) {
            segments.push({ text: plainMatch[0], font: baseFont, size: fontSize });
            remaining = remaining.slice(plainMatch[0].length);
            continue;
          }
          // Single special char that doesn't start a pattern
          segments.push({ text: remaining[0], font: baseFont, size: fontSize });
          remaining = remaining.slice(1);
        }

        if (segments.length > 0) {
          // First segment starts at the indented x position
          const first = segments[0];
          doc.font(first.font).fontSize(first.size).text(first.text, startX, undefined, { continued: segments.length > 1, width: textWidth });
          for (let s = 1; s < segments.length; s++) {
            doc.font(segments[s].font).fontSize(segments[s].size).text(segments[s].text, { continued: s < segments.length - 1, width: textWidth });
          }
          if (segments.length === 1) {
            // Already finished (continued was false)
          }
        } else if (lineIdx < lines.length - 1) {
          // Empty line between content lines — add vertical space
          doc.moveDown(0.3);
        }
      });
    }

    function renderToken(token) {
      switch (token.type) {
        case 'heading': {
          const sizes = { 1: 22, 2: 18, 3: 15, 4: 13, 5: 12, 6: 11 };
          const size = sizes[token.depth] || 12;
          doc.moveDown(1.0);
          doc.font('Helvetica-Bold').fontSize(size).text(token.text, { width: PAGE_WIDTH });
          if (token.depth <= 2) {
            doc.moveDown(0.4);
            const y = doc.y;
            doc.moveTo(60, y).lineTo(60 + PAGE_WIDTH, y).lineWidth(0.5).stroke('#cbd5e1');
          }
          doc.moveDown(0.6);
          break;
        }
        case 'paragraph': {
          // Check for image tokens inside the paragraph
          const imgTokens = (token.tokens || []).filter(t => t.type === 'image');
          if (imgTokens.length > 0) {
            for (const img of imgTokens) {
              const imgBuf = imageCache[img.href];
              if (imgBuf) {
                try {
                  // Fit image within page width, max height 150
                  doc.image(imgBuf, { fit: [PAGE_WIDTH, 150], align: 'center' });
                  doc.moveDown(0.5);
                } catch (e) {
                  doc.font('Helvetica-Oblique').fontSize(10).fillColor('#991b1b')
                    .text(`[Image: ${img.text || img.href}]`, { width: PAGE_WIDTH });
                  doc.fillColor('#000000');
                }
              } else {
                doc.font('Helvetica-Oblique').fontSize(10).fillColor('#64748b')
                  .text(`[Image not found: ${img.text || img.href}]`, { width: PAGE_WIDTH });
                doc.fillColor('#000000');
              }
            }
            // If paragraph has non-image text too, render it
            const nonImageText = token.text.replace(/!\[.*?\]\(.*?\)/g, '').trim();
            if (nonImageText) {
              renderInline(nonImageText, 'Helvetica', 'Helvetica-Bold', 11);
            }
            doc.moveDown(0.8);
            break;
          }
          // Render the raw text which preserves markdown inline syntax
          renderInline(token.text, 'Helvetica', 'Helvetica-Bold', 11);
          doc.moveDown(0.8);
          break;
        }
        case 'list': {
          token.items.forEach((item, i) => {
            const bullet = token.ordered ? `${i + 1}. ` : '•  ';
            renderInline(bullet + item.text, 'Helvetica', 'Helvetica-Bold', 11, { indent: 15 });
            doc.moveDown(0.3);
          });
          doc.moveDown(0.5);
          break;
        }
        case 'hr': {
          doc.moveDown(0.6);
          const y = doc.y;
          doc.moveTo(60, y).lineTo(60 + PAGE_WIDTH, y).lineWidth(0.5).stroke('#94a3b8');
          doc.moveDown(0.8);
          break;
        }
        case 'blockquote': {
          doc.moveDown(0.4);
          const startY = doc.y;
          doc.font('Helvetica-Oblique').fontSize(11).fillColor('#475569');
          if (token.tokens) {
            token.tokens.forEach(t => {
              if (t.text) doc.text(t.text, 75, undefined, { width: PAGE_WIDTH - 15 });
            });
          }
          const endY = doc.y;
          doc.moveTo(68, startY - 2).lineTo(68, endY + 2).lineWidth(2).stroke('#2563eb');
          doc.fillColor('#000000');
          doc.moveDown(0.7);
          break;
        }
        case 'html': {
          // Handle <br> tags as vertical space
          if (/<br\s*\/?>/i.test(token.raw)) {
            doc.moveDown(0.8);
          }
          break;
        }
        case 'space': {
          doc.moveDown(0.6);
          break;
        }
        case 'table': {
          // Render markdown table
          doc.moveDown(0.6);

          const headers = token.header || [];
          const rows = token.rows || [];
          const align = token.align || [];

          // Calculate column widths (equal distribution for now)
          const numCols = headers.length;
          if (numCols === 0) break;

          const tableWidth = PAGE_WIDTH - 20;
          const colWidth = tableWidth / numCols;
          const rowHeight = 25;
          const cellPadding = 5;
          const startX = 60 + 10;
          let currentY = doc.y;

          // Draw header row with gray background
          doc.rect(startX, currentY, tableWidth, rowHeight)
             .fillAndStroke('#f1f5f9', '#cbd5e1');

          // Draw header text
          headers.forEach((cell, colIdx) => {
            const cellX = startX + (colIdx * colWidth) + cellPadding;
            const cellY = currentY + (rowHeight / 2) - 5;
            const cellText = cell.text || '';

            doc.font('Helvetica-Bold')
               .fontSize(10)
               .fillColor('#000000')
               .text(cellText, cellX, cellY, {
                 width: colWidth - (cellPadding * 2),
                 height: rowHeight,
                 align: align[colIdx] || 'left',
                 ellipsis: true
               });
          });

          currentY += rowHeight;

          // Draw data rows
          rows.forEach((row, rowIdx) => {
            const cells = row || [];

            // Alternate row colors for readability
            const bgColor = rowIdx % 2 === 0 ? '#ffffff' : '#f8fafc';
            doc.rect(startX, currentY, tableWidth, rowHeight)
               .fillAndStroke(bgColor, '#e2e8f0');

            // Draw cell text
            cells.forEach((cell, colIdx) => {
              const cellX = startX + (colIdx * colWidth) + cellPadding;
              const cellY = currentY + (rowHeight / 2) - 5;
              const cellText = cell.text || '';

              doc.font('Helvetica')
                 .fontSize(10)
                 .fillColor('#000000')
                 .text(cellText, cellX, cellY, {
                   width: colWidth - (cellPadding * 2),
                   height: rowHeight,
                   align: align[colIdx] || 'left',
                   ellipsis: true
                 });
            });

            currentY += rowHeight;
          });

          // Move cursor below table
          doc.y = currentY;
          doc.moveDown(0.8);
          break;
        }
        default:
          if (token.text) {
            doc.font('Helvetica').fontSize(11).text(token.text, { width: PAGE_WIDTH });
            doc.moveDown(0.3);
          }
          break;
      }
    }

    tokens.forEach(renderToken);

    doc.end();
  });
}
