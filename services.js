/**
 * Services Monitor — Docker 服务健康监控
 * 仅支持手动添加
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const SERVICES_FILE = path.join(__dirname, '.services.json');
const CHECK_INTERVAL = 30000; // 30s

let services = [];      // { id, name, url, group, status, responseTime, lastCheck, lastOk, error }
let checkTimer = null;

function load() {
  try {
    if (fs.existsSync(SERVICES_FILE)) {
      services = JSON.parse(fs.readFileSync(SERVICES_FILE, 'utf8'));
      if (!Array.isArray(services)) services = [];
    }
  } catch (e) {
    console.error('[services] load error:', e.message);
    services = [];
  }
}

function save() {
  try {
    fs.writeFileSync(SERVICES_FILE, JSON.stringify(services, null, 2));
  } catch (e) {
    console.error('[services] save error:', e.message);
  }
}

function genId() {
  return 'svc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

// === Health Check ===
function checkUrl(url, timeout = 5000) {
  return new Promise((resolve) => {
    const proto = url.startsWith('https') ? https : http;
    const start = Date.now();
    const req = proto.get(url, { timeout }, (res) => {
      const rt = Date.now() - start;
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, statusCode: res.statusCode, responseTime: rt });
    });
    req.on('error', (err) => {
      resolve({ ok: false, statusCode: 0, responseTime: Date.now() - start, error: err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0, responseTime: Date.now() - start, error: 'timeout' });
    });
    req.setTimeout(timeout);
  });
}

async function checkService(svc) {
  const result = await checkUrl(svc.url);
  svc.status = result.ok ? 'ok' : 'error';
  svc.statusCode = result.statusCode;
  svc.responseTime = result.responseTime;
  svc.lastCheck = Date.now();
  if (result.ok) svc.lastOk = Date.now();
  svc.error = result.error || null;
  return result;
}

async function checkAll() {
  for (const svc of services) {
    await checkService(svc);
  }
  save();
}

// === CRUD ===
function add(data) {
  const svc = {
    id: genId(),
    name: data.name,
    url: data.url,
    group: data.group || 'default',
    status: 'unknown',
    responseTime: 0,
    lastCheck: 0,
    lastOk: 0,
    error: null,
  };
  services.push(svc);
  save();
  // 立即检查一次
  checkService(svc);
  return svc;
}

function update(id, data) {
  const idx = services.findIndex(s => s.id === id);
  if (idx === -1) return null;
  services[idx] = { ...services[idx], ...data, id };
  save();
  return services[idx];
}

function remove(id) {
  const idx = services.findIndex(s => s.id === id);
  if (idx === -1) return false;
  services.splice(idx, 1);
  save();
  return true;
}

function getAll() {
  return services;
}

function getGroups() {
  const groups = new Set(services.map(s => s.group || 'default'));
  return Array.from(groups);
}

// === Init ===
function init() {
  load();
  // 首次检查
  checkAll();
  // 定时检查
  checkTimer = setInterval(checkAll, CHECK_INTERVAL);
}

function stop() {
  if (checkTimer) clearInterval(checkTimer);
}

module.exports = { init, stop, add, update, remove, getAll, getGroups, checkService };
