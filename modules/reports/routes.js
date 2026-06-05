const path = require('path');
const fs = require('fs');

const REPORTS_DIR = path.join(__dirname, 'data');

function handle(req, res, url, urlPath, tools) {
  const { serveFile, json } = tools;

  // === 报告列表（无需登录）===
  if (url === '/reports' || url.startsWith('/reports/')) {
    if (url === '/reports') {
      let files = [];
      try {
        files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.html'));
        files.sort((a, b) => fs.statSync(path.join(REPORTS_DIR, b)).mtimeMs - fs.statSync(path.join(REPORTS_DIR, a)).mtimeMs);
      } catch {}
      const list = files.map(f => {
        const ts = f.replace('.html', '');
        const d = new Date(parseInt(ts));
        const dateStr = isNaN(d.getTime()) ? ts : d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        return `<li><a href="/reports/${f}">${dateStr}</a></li>`;
      }).join('\n');
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>莫殇 Reports</title>
<style>
  body { background: #0a0a0f; color: #e0e0e0; font-family: -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }
  h1 { color: #00d4aa; }
  ul { list-style: none; padding: 0; }
  li { padding: 8px 0; border-bottom: 1px solid #222; }
  a { color: #00a8ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .empty { color: #666; margin-top: 20px; }
</style>
</head>
<body>
<h1>📋 莫殇 Reports</h1>
${list.length ? `<ul>${list}</ul>` : '<p class="empty">暂无报告</p>'}
</body>
</html>`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return true;
    }
    const fileName = path.basename(url);
    const filePath = path.join(REPORTS_DIR, fileName);
    if (fs.existsSync(filePath)) {
      serveFile(res, filePath, 'text/html');
      return true;
    }
  }

  // === Reports API ===
  if (urlPath === '/api/reports' && req.method === 'GET') {
    const readStatePath = path.join(REPORTS_DIR, '.read.json');
    let readMap = {};
    try { readMap = JSON.parse(fs.readFileSync(readStatePath, 'utf8')); } catch {}
    let files = [];
    try {
      files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.html'));
      files.sort((a, b) => {
        const ta = fs.statSync(path.join(REPORTS_DIR, a)).mtimeMs;
        const tb = fs.statSync(path.join(REPORTS_DIR, b)).mtimeMs;
        return tb - ta;
      });
    } catch {}
    const reports = files.map(f => {
      const stat = fs.statSync(path.join(REPORTS_DIR, f));
      return {
        file: f,
        title: f.replace('.html', '').replace(/^\d+-/, ''),
        timestamp: parseInt(f.replace(/[^0-9].*/, '')) || stat.mtimeMs,
        read: !!readMap[f],
        mtime: stat.mtimeMs
      };
    });
    json(res, { reports, unreadCount: reports.filter(r => !r.read).length });
    return true;
  }

  if (urlPath.startsWith('/api/reports/') && urlPath.endsWith('/read') && req.method === 'POST') {
    const file = urlPath.split('/')[3];
    const readStatePath = path.join(REPORTS_DIR, '.read.json');
    let readMap = {};
    try { readMap = JSON.parse(fs.readFileSync(readStatePath, 'utf8')); } catch {}
    readMap[file] = Date.now();
    fs.writeFileSync(readStatePath, JSON.stringify(readMap, null, 2));
    json(res, { success: true });
    return true;
  }

  return false;
}

module.exports = { handle };
