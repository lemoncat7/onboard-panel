/**
 * Onboard Supervisor — 监管服务
 * 监控 onboard-panel，挂了自动拉起
 * 独立进程，可被 hook 自启动
 */
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE_DIR = __dirname;
const PID_FILE = path.join(BASE_DIR, '.supervisor.pid');
const CHILD_PID_FILE = path.join(BASE_DIR, '.onboard.pid');
const LOG_FILE = path.join(BASE_DIR, '.supervisor.log');

const CHECK_INTERVAL = 5000;      // 5s 检查一次
const HEALTH_TIMEOUT = 3000;      // 健康检查超时 3s
const MAX_RESTARTS = 5;           // 连续重启上限
const RESTART_WINDOW = 60000;     // 重启窗口 60s

let child = null;
let restartCount = 0;
let lastRestartTime = 0;
let startTime = Date.now();
let childStartTime = 0;
let totalRestarts = 0;

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

function savePid(file, pid) {
  try {
    fs.writeFileSync(file, String(pid));
  } catch (e) {
    log('savePid error:', e.message);
  }
}

function readPid(file) {
  try {
    const pid = parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function httpHealthCheck(url, timeout) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.setTimeout(timeout);
  });
}

function shouldRestart() {
  const now = Date.now();
  if (now - lastRestartTime > RESTART_WINDOW) {
    restartCount = 0;
  }
  restartCount++;
  lastRestartTime = now;
  return restartCount <= MAX_RESTARTS;
}

async function startChild() {
  if (child) {
    log('child already running, skip');
    return;
  }

  // 检查旧 PID
  const oldPid = readPid(CHILD_PID_FILE);
  if (oldPid && isProcessAlive(oldPid)) {
    // 复用前先 HTTP 检查，确认是真的 onboard server
    const port = process.env.ONBOARD_PORT || 3000;
    const ok = await httpHealthCheck(`http://127.0.0.1:${port}/health`, HEALTH_TIMEOUT);
    if (ok) {
      log('found existing onboard process', oldPid, 'reusing');
      child = { pid: oldPid, _reused: true };
      childStartTime = Date.now();
      return;
    } else {
      log('existing pid', oldPid, 'not responding, not reusing');
      try { process.kill(oldPid, 'SIGKILL'); } catch {}
    }
  }

  log('starting onboard-panel...');
  
  // 检查端口是否已被占用（可能是旧进程或手动启动的）
  const port = process.env.ONBOARD_PORT || 3000;
  const portOk = await httpHealthCheck(`http://127.0.0.1:${port}/health`, HEALTH_TIMEOUT);
  if (portOk) {
    log('port', port, 'already in use with healthy server, skipping start');
    return;
  }
  const proc = spawn('node', ['server.js'], {
    cwd: BASE_DIR,
    detached: false,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' }
  });

  child = proc;
  childStartTime = Date.now();
  savePid(CHILD_PID_FILE, proc.pid);
  totalRestarts++;
  log('onboard-panel started, pid=', proc.pid);

  proc.on('exit', (code, signal) => {
    log('onboard-panel exited, code=', code, 'signal=', signal);
    child = null;
    try { fs.unlinkSync(CHILD_PID_FILE); } catch {}

    if (shouldRestart()) {
      log('restarting in 3s... (', restartCount, '/', MAX_RESTARTS, ')');
      setTimeout(startChild, 3000);
    } else {
      log('MAX_RESTARTS reached, giving up');
    }
  });
}

async function healthCheck() {
  // 1. 进程存活检查
  const pid = readPid(CHILD_PID_FILE);
  if (!pid) {
    log('health: no pid file');
    return false;
  }
  if (!isProcessAlive(pid)) {
    log('health: process', pid, 'not alive');
    return false;
  }

  // 2. HTTP 健康检查
  const port = process.env.ONBOARD_PORT || 3000;
  const ok = await httpHealthCheck(`http://127.0.0.1:${port}/health`, HEALTH_TIMEOUT);
  if (!ok) {
    log('health: HTTP check failed');
  }
  return ok;
}

async function tick() {
  const ok = await healthCheck();
  if (!ok) {
    log('health check failed, will restart');
    if (child && !child._reused) {
      try {
        child.kill('SIGTERM');
      } catch {}
    }
    child = null;
    if (shouldRestart()) {
      startChild().catch(e => log('restart error:', e.message));
    }
  }
}

// === Supervisor HTTP API ===
const API_PORT = (parseInt(process.env.ONBOARD_PORT, 10) || 3000) + 1;

const apiServer = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      role: 'supervisor',
      uptime: Date.now() - startTime,
      child: {
        pid: readPid(CHILD_PID_FILE),
        alive: isProcessAlive(readPid(CHILD_PID_FILE)),
        uptime: childStartTime ? Date.now() - childStartTime : 0,
      },
      restarts: { total: totalRestarts, recent: restartCount },
    }));
    return;
  }

  if (req.url === '/restart' && req.method === 'POST') {
    log('manual restart requested');
    if (child && !child._reused) {
      try { child.kill('SIGTERM'); } catch {}
    }
    child = null;
    restartCount = 0;
    startChild().then(() => {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, message: 'restarting' }));
    }).catch(err => {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: err.message }));
    });
    return;
  }

  if (req.url === '/log' && req.method === 'GET') {
    try {
      const logs = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).slice(-100);
      res.writeHead(200);
      res.end(JSON.stringify({ lines: logs }));
    } catch {
      res.writeHead(200);
      res.end(JSON.stringify({ lines: [] }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

// === Graceful shutdown ===
function shutdown() {
  log('supervisor shutting down...');
  if (child && !child._reused) {
    try { child.kill('SIGTERM'); } catch {}
  }
  apiServer.close(() => {
    try { fs.unlinkSync(PID_FILE); } catch {}
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// === Main ===
// Clean up stale PID files from previous container runs
try { fs.unlinkSync(CHILD_PID_FILE); } catch {}
try { fs.unlinkSync(PID_FILE); } catch {}

savePid(PID_FILE, process.pid);
startChild().then(() => {
  // 定期检查
  setInterval(tick, CHECK_INTERVAL);
}).catch(e => {
  log('startChild error:', e.message);
  process.exit(1);
});

apiServer.listen(API_PORT, '0.0.0.0', () => {
  log(`Supervisor API on http://0.0.0.0:${API_PORT}`);
});
