/**
 * History Module — JSON 文件历史数据持久化
 * 纯 JS，零依赖
 */
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '.history.json');
const RETENTION_DAYS = 7;
const MAX_RECORDS = RETENTION_DAYS * 24 * 60; // 每分钟一条，7天最多 10080 条

let cache = [];
let dirty = false;

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      cache = JSON.parse(raw);
      if (!Array.isArray(cache)) cache = [];
    }
  } catch (e) {
    console.error('[history] load error:', e.message);
    cache = [];
  }
}

function saveSync() {
  if (!dirty) return;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 0));
    dirty = false;
  } catch (e) {
    console.error('[history] save error:', e.message);
  }
}

function init() {
  load();
  // 每 30s 同步一次磁盘
  setInterval(saveSync, 30000);
  // 每 10min 清理一次过期数据
  setInterval(cleanup, 10 * 60 * 1000);
  cleanup();
  return Promise.resolve();
}

function record(data) {
  const d = data || {};
  const gw = d.gateway || {};
  const sess = d.sessions || {};
  const tasks = d.tasks || {};
  const agents = d.agents || {};
  cache.push({
    ts: Date.now(),
    version: d.version || null,
    gateway_mode: gw.mode || null,
    gateway_reachable: gw.reachable ? 1 : 0,
    sessions_count: sess.count || 0,
    sessions_tokens: sess.totalTokens || 0,
    sessions_percent: sess.totalUsedPercent || 0,
    tasks_total: tasks.total || 0,
    tasks_running: tasks.running || 0,
    tasks_succeeded: tasks.succeeded || 0,
    tasks_timedout: tasks.timedOut || 0,
    tasks_failures: tasks.failures || 0,
    agents_count: agents.count || 0,
    agents_total_sessions: agents.totalSessions || 0,
    memory_enabled: d.memory ? 1 : 0,
    os: d.os || null,
  });
  // 超过上限自动截断
  if (cache.length > MAX_RECORDS) {
    cache = cache.slice(-MAX_RECORDS);
  }
  dirty = true;
  return Promise.resolve();
}

function getHistory(minutes = 60) {
  const since = Date.now() - minutes * 60 * 1000;
  return Promise.resolve(
    cache.filter(r => r.ts > since)
  );
}

function cleanup() {
  const since = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const before = cache.length;
  cache = cache.filter(r => r.ts > since);
  if (cache.length !== before) dirty = true;
  return Promise.resolve(cache.length);
}

function close() {
  saveSync();
  return Promise.resolve();
}

module.exports = { init, record, getHistory, cleanup, close };
