# 📄 Kanmate — Smart PDF Downloader

Download PDFs from any site, no login required. Kanmate uses a **server-side proxy** to bypass CORS and access restrictions.

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
node server.js
```

### 3. Open in browser
```
http://localhost:3000
```

Paste any PDF link → hit Download → done!

---

## 🌐 Supported Platforms

| Platform         | Support Level      | Notes                                      |
|------------------|--------------------|--------------------------------------------|
| Direct .pdf URLs | ✅ Full download    | Any public PDF link                        |
| Google Drive     | ✅ Full download    | Auto-converts share links to direct        |
| Dropbox          | ✅ Full download    | Auto-converts to direct download URL       |
| Internet Archive | ✅ Full download    | Fetches PDF from metadata API              |
| University sites | ✅ Full download    | Most open-access academic PDFs             |
| Academia.edu     | ⚡ Best effort      | Works for public papers                    |
| ResearchGate     | ⚡ Best effort      | Works for open-access papers               |
| Scribd           | ℹ️ Mirror links    | Requires premium — shows alternative sites |
| Studocu          | ℹ️ Info only       | Login-gated, shows alternatives            |

---

## 🔧 How It Works

1. **You paste a URL** into Kanmate
2. **Server detects the platform** and applies the right fetch strategy
3. **Proxy fetches the file** server-side — no CORS blocks, browser-spoofed headers
4. **Streams the PDF** back to your browser for download

### Why server-side?
Browsers block cross-origin requests (CORS). Kanmate's Node.js backend makes the request directly, like a real browser visiting the page from a server — bypassing those restrictions.

---

## 📁 Project Structure

```
kanmate/
├── server.js          # Express proxy server
├── public/
│   └── index.html     # Frontend UI
├── package.json
└── README.md
```

---

## ⚙️ Configuration

Default port: **3000**

Change it with an environment variable:
```bash
PORT=8080 node server.js
```

---

## 🛡️ Notes

- Files are **not stored** on the server — they stream directly to your device
- Works best with publicly accessible PDFs
- Sites like Scribd and Studocu use DRM and require paid accounts — Kanmate shows mirror alternatives for those

---

## 📦 Dependencies

- `express` — HTTP server
- `cors` — Cross-origin headers
- `axios` — HTTP client with streaming
- `cheerio` — HTML parsing for page scraping

---

Built with ❤️ · **Kanmate** v2.0
