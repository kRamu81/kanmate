const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const cheerio = require('cheerio');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// Platform Detection
// ─────────────────────────────────────────────
function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes('scribd.com'))       return 'scribd';
  if (u.includes('studocu.com'))      return 'studocu';
  if (u.includes('academia.edu'))     return 'academia';
  if (u.includes('slideshare.net'))   return 'slideshare';
  if (u.includes('docsend.com'))      return 'docsend';
  if (u.includes('issuu.com'))        return 'issuu';
  if (u.includes('dropbox.com'))      return 'dropbox';
  if (u.includes('drive.google.com')) return 'gdrive';
  if (u.includes('onedrive.live.com') || u.includes('1drv.ms')) return 'onedrive';
  if (u.includes('sharepoint.com'))   return 'sharepoint';
  if (u.includes('researchgate.net')) return 'researchgate';
  if (u.includes('archive.org'))      return 'archive';
  if (u.includes('medium.com'))       return 'article';
  if (u.includes('linkedin.com/pulse') || u.includes('linkedin.com/posts')) return 'article';
  if (u.includes('dev.to'))           return 'article';
  if (u.includes('hashnode.com') || u.includes('hashnode.dev')) return 'article';
  if (u.includes('substack.com'))     return 'article';
  if (u.includes('notion.so') || u.includes('notion.site')) return 'article';
  if (u.includes('telegraph.ph'))     return 'article';
  if (u.includes('wordpress.com') || u.includes('blogspot.com')) return 'article';
  if (u.endsWith('.pdf') || u.includes('.pdf?') || u.includes('/pdf/')) return 'direct';
  return 'generic';
}

// ─────────────────────────────────────────────
// Browser-like headers
// ─────────────────────────────────────────────
function browserHeaders(referer = '') {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Upgrade-Insecure-Requests': '1',
    ...(referer ? { 'Referer': referer } : {})
  };
}

// ─────────────────────────────────────────────
// URL Transformers
// ─────────────────────────────────────────────
function transformGDriveUrl(url) {
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return `https://drive.google.com/uc?export=download&id=${match[1]}`;
  if (url.includes('uc?export=download')) return url;
  return null;
}

function transformDropboxUrl(url) {
  return url
    .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
    .replace('?dl=0', '?dl=1')
    + (url.includes('?') ? '&dl=1' : '?dl=1');
}

async function extractArchive(url) {
  const match = url.match(/archive\.org\/details\/([^/?]+)/);
  if (match) {
    const id = match[1];
    const { data } = await axios.get(`https://archive.org/metadata/${id}`, { timeout: 15000 });
    const pdf = (data.files || []).find(f => f.name && f.name.endsWith('.pdf'));
    if (pdf) return `https://archive.org/download/${id}/${pdf.name}`;
  }
  return null;
}

// ─────────────────────────────────────────────
// Article Extractor (Medium, LinkedIn, etc.)
// ─────────────────────────────────────────────
async function extractArticle(url) {
  const { data: html } = await axios.get(url, {
    headers: browserHeaders(),
    timeout: 20000,
    responseType: 'text',
  });

  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.textContent || article.textContent.trim().length < 100) {
    return null;
  }

  return {
    title: article.title || 'Article',
    byline: article.byline || '',
    siteName: article.siteName || new URL(url).hostname,
    textContent: article.textContent.trim(),
    excerpt: article.excerpt || '',
  };
}

// ─────────────────────────────────────────────
// PDF Generator from article text
// ─────────────────────────────────────────────
function generateArticlePDF(article, res) {
  const doc = new PDFDocument({
    margin: 60,
    size: 'A4',
    info: {
      Title: article.title,
      Author: article.byline || 'Kanmate',
      Subject: article.excerpt,
    }
  });

  // Filename
  const safeTitle = article.title.replace(/[^a-zA-Z0-9 ]/g, '').trim().slice(0, 60) || 'article';
  const filename = `${safeTitle}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Kanmate-Filename', filename);
  res.setHeader('X-Kanmate-Platform', 'article');

  doc.pipe(res);

  // ── Header ──
  doc.rect(0, 0, doc.page.width, 120).fill('#0f0f23');

  doc.fill('#a78bfa')
     .fontSize(9)
     .font('Helvetica-Bold')
     .text('KANMATE · ARTICLE DOWNLOAD', 60, 30, { align: 'left' });

  doc.fill('#ffffff')
     .fontSize(20)
     .font('Helvetica-Bold')
     .text(article.title, 60, 50, { width: doc.page.width - 120, align: 'left' });

  // ── Meta ──
  doc.moveDown(3);

  if (article.byline) {
    doc.fill('#6b7280').fontSize(10).font('Helvetica')
       .text(`By ${article.byline}`, { align: 'left' });
    doc.moveDown(0.3);
  }

  doc.fill('#9ca3af').fontSize(9)
     .text(`Source: ${article.siteName}`, { align: 'left' });

  doc.moveDown(1);
  doc.moveTo(60, doc.y).lineTo(doc.page.width - 60, doc.y).stroke('#e5e7eb');
  doc.moveDown(1);

  // ── Body ──
  const paragraphs = article.textContent
    .split(/\n{2,}/)
    .map(p => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 30);

  doc.fill('#1f2937').fontSize(12).font('Helvetica').lineGap(4);

  for (const para of paragraphs) {
    if (doc.y > doc.page.height - 100) doc.addPage();
    doc.text(para, { align: 'justify' });
    doc.moveDown(0.8);
  }

  // ── Footer ──
  doc.moveDown(2);
  doc.moveTo(60, doc.y).lineTo(doc.page.width - 60, doc.y).stroke('#e5e7eb');
  doc.moveDown(0.5);
  doc.fill('#9ca3af').fontSize(8)
     .text(`Downloaded via Kanmate · kanmate.vercel.app · ${new Date().toLocaleDateString()}`, { align: 'center' });

  doc.end();
  return filename;
}

// ─────────────────────────────────────────────
// Platform-specific: Scribd
// ─────────────────────────────────────────────
async function extractScribd(url) {
  const match = url.match(/scribd\.com\/(?:doc|document)\/(\d+)/);
  if (!match) return null;
  const docId = match[1];
  return {
    type: 'info',
    docId,
    message: 'Scribd requires account authentication.',
    alternatives: [
      `https://scribd.vpdfs.com/view/${docId}`,
      `https://www.pdfdrive.com/?q=scribd+${docId}`,
    ]
  };
}

// ─────────────────────────────────────────────
// Platform-specific: Studocu
// ─────────────────────────────────────────────
async function extractStudocu(url) {
  try {
    const { data } = await axios.get(url, { headers: browserHeaders(), timeout: 15000 });
    const $ = cheerio.load(data);
    let pdfUrl = null;
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href.includes('.pdf')) { pdfUrl = href; return false; }
    });
    const og = $('meta[property="og:url"]').attr('content');
    return { type: 'info', pdfUrl, pageUrl: og || url, message: 'Studocu requires login to download.' };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// API: /api/fetch
// ─────────────────────────────────────────────
app.post('/api/fetch', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  let targetUrl = url.trim();
  const platform = detectPlatform(targetUrl);

  console.log(`[Kanmate v1.1] Fetching: ${targetUrl} (platform: ${platform})`);

  try {
    // ── Article extraction ─────────────────────
    if (platform === 'article') {
      const article = await extractArticle(targetUrl);
      if (!article) {
        return res.status(422).json({
          error: 'Could not extract article content.',
          message: 'The article may be behind a paywall or the page did not have enough readable content.',
          platform
        });
      }
      generateArticlePDF(article, res);
      return;
    }

    // ── Platform transforms ────────────────────
    if (platform === 'gdrive') {
      const direct = transformGDriveUrl(targetUrl);
      if (!direct) return res.status(400).json({ error: 'Could not parse Google Drive URL.' });
      targetUrl = direct;
    }

    if (platform === 'dropbox') targetUrl = transformDropboxUrl(targetUrl);

    if (platform === 'archive') {
      const extracted = await extractArchive(targetUrl);
      if (extracted) targetUrl = extracted;
    }

    if (platform === 'scribd') {
      const info = await extractScribd(targetUrl);
      if (info) return res.json({ platform: 'scribd', ...info });
    }

    if (platform === 'studocu') {
      const info = await extractStudocu(targetUrl);
      if (info) return res.json({ platform: 'studocu', ...info });
    }

    // ── Generic / Direct PDF fetch ─────────────
    const response = await axios({
      method: 'GET',
      url: targetUrl,
      responseType: 'stream',
      timeout: 60000,
      maxRedirects: 10,
      headers: { ...browserHeaders(), 'Accept': 'application/pdf,application/octet-stream,*/*' },
      validateStatus: status => status < 400,
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';
    const contentLength = response.headers['content-length'];
    const contentDisposition = response.headers['content-disposition'] || '';

    // Extract filename
    let filename = 'kanmate-document.pdf';
    const cdMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (cdMatch) {
      filename = cdMatch[1].replace(/['"]/g, '').trim();
    } else {
      try {
        const urlPath = new URL(targetUrl).pathname;
        const urlFile = urlPath.split('/').pop();
        if (urlFile && urlFile.includes('.')) filename = decodeURIComponent(urlFile);
      } catch {}
    }
    if (!filename.toLowerCase().endsWith('.pdf')) filename += '.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('X-Kanmate-Filename', filename);
    res.setHeader('X-Kanmate-Platform', platform);

    response.data.pipe(res);
    response.data.on('error', err => console.error('[Kanmate] Stream error:', err.message));

  } catch (err) {
    console.error('[Kanmate] Error:', err.message);
    if (err.response) {
      const status = err.response.status;
      if (status === 401 || status === 403) {
        return res.status(403).json({
          error: 'Access denied',
          message: `The server returned ${status}. This document requires authentication.`,
          platform
        });
      }
      if (status === 404) return res.status(404).json({ error: 'File not found (404)', platform });
    }
    return res.status(500).json({ error: 'Fetch failed', message: err.message, platform });
  }
});

// ─────────────────────────────────────────────
// API: /api/detect
// ─────────────────────────────────────────────
app.post('/api/detect', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const platform = detectPlatform(url.trim());
  res.json({ platform });
});

// ─────────────────────────────────────────────
// API: /api/health
// ─────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'Kanmate', version: '1.1.0' }));

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`\n🚀 Kanmate v1.1 running at http://localhost:${PORT}\n`);
  });
}

module.exports = app;
