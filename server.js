const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const history = require('./history');
const services = require('./services');
const novels = require('./modules/novels/novels');
const novelsAuth = require('./modules/novels/auth');
const novelsStats = require('./modules/novels/stats');
const novelsRoutes = require('./modules/novels/routes');
const reportsRoutes = require('./modules/reports/routes');
const snacksRoutes = require('./modules/snacks/routes');

// Init novel module
novels.init();
novelsAuth.initUsers();

let statusCache = null;
let statusCacheTime = 0;
const STATUS_CACHE_TTL = 10000;

const config = (() => {
  const cp = path.join(__dirname, '.config.json');
  try { return JSON.parse(fs.readFileSync(cp, 'utf8')); } catch { return {}; }
})();

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
let PASSWORD = config.password || process.env.ONBOARD_PASSWORD || 'openclaw';
const COOKIE_NAME = 'onboard_auth';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

function hash(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function stripAnsi(str) {
  if (!str) return '';
  // Strip all ANSI escape sequences: ESC [ ... m
  return str.replace(/\x1b\[\d+(?:;\d+)*m/g, '')
            .replace(/\[38;5;\d+m/g, '')
            .replace(/\[39m/g, '');
}

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
    });
  }
  return list;
}

function isLoggedIn(req) {
  const cookies = parseCookies(req);
  return cookies[COOKIE_NAME] === hash(PASSWORD);
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end('error');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache, no-store, must-revalidate' });
    res.end(data);
  });
}

function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function runCmd(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: opts.timeout || 15000, cwd: opts.cwd }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: err.message, stderr: stderr?.trim() || '' });
      } else {
        resolve({ ok: true, stdout: stdout.trim(), stderr: stderr?.trim() || '' });
      }
    });
  });
}

function fetchStatus() {
  return new Promise((resolve) => {
    const now = Date.now();
    if (statusCache && now - statusCacheTime < STATUS_CACHE_TTL) {
      resolve(JSON.parse(statusCache));
      return;
    }
    exec('openclaw status --json', { timeout: 15000 }, async (err, stdout) => {
      if (err) {
        resolve({ error: 'exec failed', detail: err.message });
        return;
      }
      try {
        const raw = JSON.parse(stdout);
        const summary = {
          version: raw.runtimeVersion,
          updateAvailable: raw.update?.registry?.latestVersion && raw.update.registry.latestVersion !== raw.runtimeVersion ? raw.update.registry.latestVersion : null,
          gateway: {
            mode: raw.gateway?.mode,
            url: raw.gateway?.url,
            reachable: raw.gateway?.reachable ?? false,
            error: raw.gateway?.error || null,
          },
          sessions: {
            count: raw.sessions?.count || 0,
            totalTokens: (raw.sessions?.recent || []).reduce((s, r) => s + (r.totalTokens || 0), 0),
            totalUsedPercent: (raw.sessions?.recent || []).reduce((s, r) => s + (r.percentUsed || 0), 0),
          },
          tasks: {
            total: raw.tasks?.total || 0,
            running: raw.tasks?.byStatus?.running || 0,
            succeeded: raw.tasks?.byStatus?.succeeded || 0,
            timedOut: raw.tasks?.byStatus?.timed_out || 0,
            failures: raw.tasks?.failures || 0,
          },
          agents: {
            count: raw.agents?.agents?.length || 0,
            totalSessions: raw.agents?.totalSessions || 0,
          },
          heartbeat: raw.heartbeat?.agents?.[0]?.every || '—',
          memory: raw.memoryPlugin?.enabled ?? false,
          os: raw.os?.label || '—',
          time: Date.now(),
        };
        statusCache = JSON.stringify(summary);
        statusCacheTime = now;
        // 顺便写历史
        try { await history.record(summary); } catch {}
        resolve(summary);
      } catch (e) {
        resolve({ error: 'parse failed', detail: e.message });
      }
    });
  });
}

// === History data collection ===
let lastHistoryCollect = 0;
async function collectHistory() {
  const now = Date.now();
  if (now - lastHistoryCollect < 55000) return;
  lastHistoryCollect = now;
  try {
    const d = await fetchStatus();
    if (!d.error) await history.record(d);
  } catch (e) {
    console.error('[history collect]', e.message);
  }
}
setInterval(collectHistory, 60000);

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let url = req.url;
  const rawUrl = url;
  console.log(`${new Date().toISOString()} ${req.method} ${url}`);

  const prefix = '/onboard';
  if (url.startsWith(prefix + '/')) {
    url = url.slice(prefix.length);
  } else if (url === prefix) {
    url = '/';
  }

  // 处理 /novels 前缀（用于不带 /onboard 的访问）
  const novelsPrefix = '/novels';
  if (url.startsWith(novelsPrefix + '/')) {
    url = url.slice(novelsPrefix.length);
  } else if (url === novelsPrefix) {
    url = '/';
  }

  // === 健康检查 ===
  if (url === '/health') {
    json(res, { status: 'ok', time: Date.now() });
    return;
  }

  // === OpenClaw 状态 ===
  if (url === '/api/status') {
    const d = await fetchStatus();
    json(res, d);
    return;
  }

  // === 历史数据 ===
  const urlPath = url.split('?')[0];
  if (urlPath === '/api/history') {
    const q = new URL(req.url, `http://localhost`).searchParams;
    const minutes = parseInt(q.get('minutes'), 10) || 60;
    try {
      const rows = await history.getHistory(minutes);
      json(res, { data: rows, count: rows.length });
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
    return;
  }

  if (urlPath === '/api/history/summary') {
    const q = new URL(req.url, `http://localhost`).searchParams;
    const minutes = parseInt(q.get('minutes'), 10) || 60;
    try {
      const rows = await history.getHistory(minutes);
      // 按小时聚合
      const buckets = {};
      rows.forEach(r => {
        const h = Math.floor(r.ts / (60 * 60 * 1000));
        if (!buckets[h]) {
          buckets[h] = { ts: h * 60 * 60 * 1000, sessions: [], tokens: [], tasks_running: [], agents: [] };
        }
        buckets[h].sessions.push(r.sessions_count);
        buckets[h].tokens.push(r.sessions_tokens);
        buckets[h].tasks_running.push(r.tasks_running);
        buckets[h].agents.push(r.agents_count);
      });
      const summary = Object.values(buckets).map(b => ({
        ts: b.ts,
        sessions_avg: Math.round(b.sessions.reduce((a, c) => a + c, 0) / b.sessions.length),
        tokens_avg: Math.round(b.tokens.reduce((a, c) => a + c, 0) / b.tokens.length),
        tasks_avg: Math.round(b.tasks_running.reduce((a, c) => a + c, 0) / b.tasks_running.length),
        agents_avg: Math.round(b.agents.reduce((a, c) => a + c, 0) / b.agents.length),
      }));
      json(res, { data: summary, count: summary.length });
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
    return;
  }

  // === 设备管理 ===
  if (url === '/api/devices/pending') {
    const result = await runCmd('openclaw devices list --json 2>/dev/null || echo "[]"');
    if (!result.ok) {
      json(res, { error: result.error, devices: [] }, 500);
      return;
    }
    try {
      const all = JSON.parse(result.stdout || '[]');
      const pending = (all.devices || all || []).filter(d => d.status === 'pending' || d.status === 'scope upgrade, repair');
      json(res, { devices: pending, count: pending.length });
    } catch {
      json(res, { devices: [], count: 0 });
    }
    return;
  }

  if (url === '/api/devices/approve' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { requestId } = JSON.parse(body);
        const cmd = requestId
          ? `openclaw devices approve ${requestId}`
          : 'openclaw devices approve --latest';
        const result = await runCmd(cmd);
        json(res, {
          success: result.ok,
          message: result.ok ? 'approved' : (result.error || 'failed'),
          stdout: result.stdout,
          stderr: result.stderr,
        }, result.ok ? 200 : 500);
      } catch {
        json(res, { success: false, message: 'bad request' }, 400);
      }
    });
    return;
  }

  // === Gateway 操作 ===
  if (url === '/api/gateway/restart' && req.method === 'POST') {
    const result = await runCmd('openclaw gateway restart', { timeout: 30000 });
    json(res, {
      success: result.ok,
      message: result.ok ? 'gateway restarting' : result.error,
      stdout: result.stdout,
      stderr: result.stderr,
    }, result.ok ? 200 : 500);
    return;
  }

  if (url === '/api/gateway/detail' && req.method === 'GET') {
    const result = await runCmd('openclaw gateway status');
    if (!result.ok) {
      json(res, { success: false, error: result.error }, 500);
      return;
    }
    // 解析 plain text 输出
    const lines = result.stdout.split('\n');
    const detail = {};
    lines.forEach(line => {
      const m = line.match(/^([^:]+):\s*(.+)$/);
      if (m) {
        const key = stripAnsi(m[1].trim()).replace(/^\s+/, '');
        const val = stripAnsi(m[2].trim()).replace(/^\s+/, '');
        if (key && val && key !== 'Troubles' && key !== 'Troubleshooting') {
          detail[key] = val;
        }
      }
    });
    json(res, { success: true, detail });
    return;
  }

  // === 缓存操作 ===
  if (url === '/api/cache/clear' && req.method === 'POST') {
    statusCache = null;
    statusCacheTime = 0;
    json(res, { success: true, message: 'status cache cleared' });
    return;
  }

  // === Supervisor 状态代理 ===
  if (urlPath === '/api/supervisor' && req.method === 'GET') {
    const supervisorPort = PORT + 1;
    http.get('http://127.0.0.1:' + supervisorPort + '/health', { timeout: 3000 }, (proxyRes) => {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        try {
          const d = JSON.parse(data);
          json(res, { success: true, ...d });
        } catch {
          json(res, { success: false, error: 'parse error', raw: data });
        }
      });
    }).on('error', (err) => {
      json(res, { success: false, error: err.message, status: 'unreachable' });
    }).setTimeout(3000, function() { this.destroy(); });
    return;
  }

  // === Docker 服务管理 ===
  if (urlPath === '/api/services' && req.method === 'GET') {
    const q = new URL(req.url, `http://localhost`).searchParams;
    const group = q.get('group');
    let list = services.getAll();
    if (group) list = list.filter(s => s.group === group);
    json(res, { services: list, count: list.length });
    return;
  }

  if (urlPath === '/api/services/groups' && req.method === 'GET') {
    json(res, { groups: services.getGroups() });
    return;
  }

  if (url === '/api/services' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const svc = services.add(data);
        json(res, { success: true, service: svc });
      } catch (e) {
        json(res, { success: false, error: e.message }, 400);
      }
    });
    return;
  }

  if (urlPath.startsWith('/api/services/') && req.method === 'PUT') {
    const id = urlPath.split('/')[3];
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const svc = services.update(id, data);
        if (!svc) return json(res, { success: false, error: 'not found' }, 404);
        json(res, { success: true, service: svc });
      } catch (e) {
        json(res, { success: false, error: e.message }, 400);
      }
    });
    return;
  }

  if (urlPath.startsWith('/api/services/') && req.method === 'DELETE') {
    const id = urlPath.split('/')[3];
    const ok = services.remove(id);
    json(res, { success: ok }, ok ? 200 : 404);
    return;
  }

  if (urlPath.startsWith('/api/services/') && urlPath.endsWith('/check') && req.method === 'POST') {
    const id = urlPath.split('/')[3];
    const all = services.getAll();
    const svc = all.find(s => s.id === id);
    if (!svc) return json(res, { success: false, error: 'not found' }, 404);
    await services.checkService(svc);
    json(res, { success: true, service: svc });
    return;
  }

  // === 登录 API ===
  if (url === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { password } = JSON.parse(body);
        if (password === PASSWORD) {
          const token = hash(PASSWORD);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `${COOKIE_NAME}=${token}; Max-Age=${COOKIE_MAX_AGE}; Path=/onboard/; HttpOnly; SameSite=Lax`
          });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '密码错误' }));
        }
      } catch {
        res.writeHead(400).end('bad request');
      }
    });
    return;
  }

  if (url === '/api/logout' && req.method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `${COOKIE_NAME}=; Max-Age=0; Path=/onboard/; HttpOnly; SameSite=Lax`
    });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // === 静态资源（无需登录）===
  if (url.startsWith('/assets/')) {
    const fileName = url.slice('/assets/'.length);
    const assetsDir = path.join(__dirname, 'assets');
    const filePath = path.join(assetsDir, fileName);
    const ext = path.extname(fileName).toLowerCase();
    const ct = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.svg' ? 'image/svg+xml' : 'text/html';
    if (fs.existsSync(filePath)) {
      serveFile(res, filePath, ct);
      return;
    }
  }


  // === 模块路由 ===
  if (reportsRoutes.handle(req, res, url, urlPath, { serveFile, json })) return;
  if (snacksRoutes.handle(req, res, url, urlPath, { serveFile, json, runCmd })) return;
  if (novelsRoutes.handle(req, res, url, urlPath, { serveFile, json })) return;

  // === 静态文件 ===
  if (url === '/' || url === '/login' || url === '/index.html') {
    if (rawUrl === '/novels' || rawUrl === '/novels/' || rawUrl.startsWith('/novels?') ||
        rawUrl === '/onboard/novels' || rawUrl === '/onboard/novels/' || rawUrl.startsWith('/onboard/novels?')) {
      serveFile(res, path.join(__dirname, 'modules/novels/index.html'), 'text/html');
      return;
    }
    if (!isLoggedIn(req)) {
      serveFile(res, path.join(__dirname, 'login.html'), 'text/html');
      return;
    }
    serveFile(res, path.join(__dirname, 'index.html'), 'text/html');
    return;
  }

  res.writeHead(404).end('not found');
});

// === Init ===
(async () => {
  await history.init();
  services.init();
  server.listen(PORT, HOST, () => {
    console.log(`🚀 Onboard Panel listening on http://${HOST}:${PORT}`);
    console.log(`🔒 Password: ${PASSWORD}`);
    console.log(`🛡️  Cookie path: /onboard/`);
  });
})();
