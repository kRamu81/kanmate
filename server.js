const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// Site-specific extractors
// ─────────────────────────────────────────────

// Detect which platform a URL belongs to
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
  if (u.endsWith('.pdf') || u.includes('.pdf?') || u.includes('/pdf/')) return 'direct';
  return 'generic';
}

// Common browser-like headers
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

// ── Google Drive ──────────────────────────────
function transformGDriveUrl(url) {
  // /file/d/FILE_ID/view → /uc?export=download&id=FILE_ID
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) {
    return `https://drive.google.com/uc?export=download&id=${match[1]}`;
  }
  // Already a direct download link
  if (url.includes('uc?export=download')) return url;
  return null;
}

// ── Dropbox ───────────────────────────────────
function transformDropboxUrl(url) {
  return url
    .replace('www.dropbox.com', 'dl.dropboxusercontent.com')
    .replace('?dl=0', '?dl=1')
    .replace('?dl=0', '')
    + (url.includes('?') ? '&dl=1' : '?dl=1');
}

// ── OneDrive ──────────────────────────────────
function transformOneDriveUrl(url) {
  if (url.includes('1drv.ms') || url.includes('onedrive.live.com')) {
    // Convert share link to download
    const encoded = encodeURIComponent(url);
    return `https://api.onedrive.com/v1.0/shares/u!${Buffer.from(url).toString('base64')}/root/content`;
  }
  return url;
}

// ── Internet Archive ──────────────────────────
async function extractArchive(url) {
  // archive.org details page → get raw file
  const match = url.match(/archive\.org\/details\/([^/?]+)/);
  if (match) {
    const id = match[1];
    const metaUrl = `https://archive.org/metadata/${id}`;
    const { data } = await axios.get(metaUrl, { timeout: 15000 });
    const files = data.files || [];
    const pdf = files.find(f => f.name && f.name.endsWith('.pdf'));
    if (pdf) {
      return `https://archive.org/download/${id}/${pdf.name}`;
    }
  }
  return null;
}

// ── Scribd ────────────────────────────────────
async function extractScribd(url) {
  // Try to find the document ID and use a known extraction technique
  const match = url.match(/scribd\.com\/(?:doc|document)\/(\d+)/);
  if (!match) return null;
  const docId = match[1];
  // Use the Scribd embed URL which sometimes serves the PDF content
  // Also try the download24h style mirror sites
  return {
    type: 'info',
    docId,
    embedUrl: `https://www.scribd.com/embeds/${docId}/content?start_page=1&view_mode=scroll&show_related_documents=true`,
    message: 'Scribd requires account authentication. Try: scribd.vpdfs.com or downloader.la for this document.',
    alternatives: [
      `https://scribd.vpdfs.com/view/${docId}`,
      `https://www.pdfdrive.com/?q=scribd+${docId}`,
    ]
  };
}

// ── Studocu ───────────────────────────────────
async function extractStudocu(url) {
  try {
    const { data } = await axios.get(url, {
      headers: browserHeaders(),
      timeout: 15000
    });
    const $ = cheerio.load(data);
    // Look for PDF download links in page
    let pdfUrl = null;
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href.includes('.pdf')) { pdfUrl = href; return false; }
    });
    // Try meta tags
    const og = $('meta[property="og:url"]').attr('content');
    return { type: 'info', pdfUrl, pageUrl: og || url, message: 'Studocu requires login to download. Document preview only.' };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// Main proxy fetch endpoint
// ─────────────────────────────────────────────
app.post('/api/fetch', async (req, res) => {
  const { url } = req.body;

  if (!url) return res.status(400).json({ error: 'URL is required' });

  let targetUrl = url.trim();
  const platform = detectPlatform(targetUrl);

  console.log(`[Kanmate] Fetching: ${targetUrl} (platform: ${platform})`);

  try {
    // ── Platform-specific transformations ──────
    if (platform === 'gdrive') {
      const direct = transformGDriveUrl(targetUrl);
      if (!direct) return res.status(400).json({ error: 'Could not parse Google Drive URL.' });
      targetUrl = direct;
    }

    if (platform === 'dropbox') {
      targetUrl = transformDropboxUrl(targetUrl);
    }

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

    // ── Generic / Direct fetch ─────────────────
    const response = await axios({
      method: 'GET',
      url: targetUrl,
      responseType: 'stream',
      timeout: 60000,
      maxRedirects: 10,
      headers: {
        ...browserHeaders(),
        'Accept': 'application/pdf,application/octet-stream,*/*',
      },
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
      const urlPath = new URL(targetUrl).pathname;
      const urlFile = urlPath.split('/').pop();
      if (urlFile && urlFile.includes('.')) filename = decodeURIComponent(urlFile);
    }
    if (!filename.toLowerCase().endsWith('.pdf')) filename += '.pdf';

    // Stream back to client
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('X-Kanmate-Filename', filename);
    res.setHeader('X-Kanmate-Platform', platform);

    response.data.pipe(res);

    response.data.on('error', (err) => {
      console.error('[Kanmate] Stream error:', err.message);
    });

  } catch (err) {
    console.error('[Kanmate] Error:', err.message);

    if (err.response) {
      const status = err.response.status;
      if (status === 401 || status === 403) {
        return res.status(403).json({
          error: 'Access denied',
          message: `The server returned ${status}. This document requires authentication that cannot be bypassed.`,
          platform
        });
      }
      if (status === 404) {
        return res.status(404).json({ error: 'File not found (404)', platform });
      }
    }

    return res.status(500).json({
      error: 'Fetch failed',
      message: err.message,
      platform
    });
  }
});

// Info endpoint — returns platform detection without fetching
app.post('/api/detect', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  const platform = detectPlatform(url.trim());
  res.json({ platform });
});

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'Kanmate' }));

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`\n🚀 Kanmate server running at http://localhost:${PORT}\n`);
  });
}

module.exports = app;
