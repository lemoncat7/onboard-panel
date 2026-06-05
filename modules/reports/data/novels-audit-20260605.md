# Novels 模块综合审计报告

> 审计范围：novels.js / routes.js / auth.js / stats.js / index.html  
> 维度：安全加固 · 性能瓶颈 · 并发风险 · 代码结构

---

## 一、安全审计

### 1.1 已修复（本次提交 e91fc01）

| 漏洞 | 修复方式 | 验证状态 |
|------|----------|----------|
| `files` 路径穿越 (`../../etc/passwd`) | `safePath` base 收紧到 `data/.users/{uid}/upload` | ✅ 对端 400 |
| `upload-file` 文件名穿越 (`../../../tmp/x`) | `path.basename(fileName)` 截断路径 | ✅ 对端验证 |
| `data/.users` 横向信息泄露 | `safePath` 拒绝 `../..` 访问 | ✅ 对端 400 |
| 封面图片路径穿越 | `safePath(coversBase, fileName)` 校验 | ✅ 代码层面 |
| `....//` 双点绕过 | `path.normalize + startsWith('..')` | ✅ 对端 400 |

### 1.2 仍存在的安全问题

#### 🔴 高：命令注入（upload-cover）

```js
// routes.js:423
execSync(`ffmpeg -i "${tmpIn}" ... -y "${outPath}"`, { timeout: 15000 });
```

- `tmpIn` 是内部生成（`/tmp/cover_in_${Date.now()}`），相对可控
- 但 `outPath = path.join(coversDir, safeName + '.jpg')` 中的 `safeName` 仅做了 `[^a-zA-Z0-9_]` 替换，**未过滤 `"` 和 `` ` ``**
- 如果通过其他方式（如软链接）让 `coversDir` 指向恶意路径，或 safeName 为空导致 `outPath` 异常，存在命令注入窗口
- **建议：** 使用数组参数形式的 `spawn` 代替 `execSync`，彻底隔离 shell 解释

#### 🟠 中：密码无 Salt + SHA256

```js
// auth.js:108
passwordHash: hash(password),  // hash = sha256
```

- SHA256 无 salt，相同密码哈希值相同，易被彩虹表攻击
- **建议：** 迁移至 `bcrypt` 或 `argon2`

#### 🟠 中：Token 永不过期

```js
// auth.js:24
const payload = JSON.stringify({ uid: userId, iat: Date.now() });
```

- 仅记录 `iat`，无 `exp` 字段，token 一旦泄露永久有效
- **建议：** 添加 `exp: Date.now() + 7*24*60*60*1000`，并在 `verifyToken` 中校验

#### 🟡 低：阅读进度接口无频率限制

- `updateReading` 可被高频调用，持续写 `reading.json`
- `pet-chat` 已有频率限制，但阅读进度接口没有

---

## 二、性能审计

### 2.1 同步 IO 阻塞事件循环

全模块使用 `*Sync` API，高并发时主线程被阻塞：

| 场景 | 同步调用链 | 影响 |
|------|-----------|------|
| 获取小说详情 | `get()` → `calcNovelStats()` → 遍历全部章节 → `readText()` + `countWords()` | 章节越多越慢 |
| 首页列表 | `list()` → 遍历所有 genre → 遍历所有小说 → `calcNovelStats()` | O(n²) 复杂度 |
| 文件上传 | `fs.writeFileSync()` 直接写磁盘 | 大文件阻塞 |
| 封面处理 | `execSync('ffmpeg ...')` 阻塞 15s | 单线程卡死 |

**量化估算：**
- 假设 1 本小说 100 章，每章 10KB
- `get()` 需读取 100 个文件 → ~100ms（机械盘）
- `list()` 展示 20 本小说 → 20 × 100ms = **2s**
- 这意味着首页加载需要 2 秒，且期间服务器无法处理其他请求

### 2.2 重复计算无缓存

```js
// novels.js:calcNovelStats()
// 每次调用都重新读取所有章节并计算字数
for (const ch of chapters) {
  const content = readText(path.join(chaptersDir, ch));
  totalWords += countWords(content);
}
```

- `meta.json` 中已记录 `updatedAt`，但 `calcNovelStats` 不利用此信息做增量更新
- **建议：** 将字数统计写入 `stats.json`，仅在章节 mtime 变化时重算

### 2.3 线性扫描查找

```js
// novels.js:findNovelDir()
function findNovelDir(novelId) {
  const genres = getGenres();      // 读取所有 genre 目录
  for (const genre of genres) {    // 线性扫描
    if (fs.existsSync(novelDir)) return novelDir;
  }
}
```

- 每本小说查询都要扫描全部 genre 目录
- **建议：** 启动时构建 `novelId → {genre, dir}` 的内存索引，增量维护

### 2.4 章节缓存缺陷

```js
// novels.js:490-492
const chapterCache = {};
const CACHE_TTL = 10 * 60 * 1000;
const MAX_CACHE = 20;
```

- 缓存的是**完整章节内容**，如果单章 1MB，20 章缓存 = 20MB
- 驱逐策略是 FIFO（`delete chapterCache[keys[0]]`），不是 LRU，热点数据可能被误驱逐
- 无过期清理机制，过期条目仍占用内存直到被驱逐
- **建议：** 限制单章大小上限，改用 LRU 算法，过期条目主动删除

---

## 三、并发审计

### 3.1 数据竞争（读-改-写模式无锁）

所有基于 JSON 文件的数据修改都遵循 "读 → 内存改 → 写" 模式，**无文件锁**，并发时必然丢数据：

| 操作 | 文件 | 并发风险 |
|------|------|----------|
| `register()` | `users.json` | 并发注册同用户名 → 重复用户 |
| `login()` | `users.json` | 并发登录 → `lastLogin` 覆盖 |
| `updateReading()` | `reading.json` | 并发阅读 → 进度丢失 |
| `updateChapter()` | `progress.json` + `meta.json` | 并发保存章节 → 状态不一致 |
| `addReader()` | `readers.json` | 并发阅读 → 读者数丢失 |
| `update()` | `meta.json` | 并发更新元数据 → 覆盖 |

**复现场景：**
```
T1: read users.json  → 用户A不存在
T2: read users.json  → 用户A不存在（T1尚未写入）
T1: push 用户A → write users.json
T2: push 用户A → write users.json（覆盖了T1的数据）
```

**建议方案：**
1. 短期：使用 `proper-lockfile` 或 `lockfile` 库对关键文件加锁
2. 中期：将高频写操作（阅读进度）迁移到 SQLite / LevelDB
3. 长期：使用数据库替代文件系统

### 3.2 软链接与真实目录的竞争

```js
// novels.js:remove()
fs.rmSync(novelDir, { recursive: true, force: true });
```

- `novelDir` 可能是 `data/type/{genre}/` 下的**软链接**
- `fs.rmSync` 默认跟随软链接删除真实目录，这是预期行为
- 但如果并发删除和 genre 变更（`update()` 中的 `fs.renameSync`）同时发生，可能操作不一致状态
- `update()` 中 `fs.renameSync(novelDir, newDir)` 在 `novelDir` 是软链接时会移动软链接本身（已知 bug）

---

## 四、代码结构审计

### 4.1 文件过大

| 文件 | 行数 | 职责 | 拆分建议 |
|------|------|------|----------|
| `routes.js` | 813 | 路由 + 业务 + 文件解析 + 图片处理 | 按功能拆分为 `api/files.js`, `api/auth.js`, `api/novel.js` |
| `index.html` | ~1600 | HTML + CSS + JS | 至少拆出 `app.js` 和 `style.css` |
| `novels.js` | 658 | 模型 + 业务 + 工具 + 缓存 | 拆为 `model.js` + `service.js` + `utils.js` |

### 4.2 重复代码

- `resolveCover()` 已提取 ✅
- `safePath()` 已提取 ✅
- `readJson/writeJson/ensureDir/countWords` 在 `novels.js` 和 `auth.js` 中**重复定义**
- `stats.js` 与 `auth.js` 的用户管理逻辑重复（`createOrUpdateUser` vs `register/login`）
- `auth.js` 和 `novels.js` 的 `updateReading` 同名但不同实现，易混淆

### 4.3 循环依赖

```js
// auth.js:170
const novels = require('./novels');
novels.updateReading(novelId, chapterNum);
```

- `auth.js` → `novels.js`，`routes.js` → `auth.js` + `novels.js`
- 当前无直接循环，但 `auth.js` 耦合了小说业务逻辑
- **建议：** `updateReading` 的通知逻辑应放在 routes 层或事件总线中，而非 auth 模块直接调用

### 4.4 硬编码与魔法值

```js
// novels.js:71
item.name !== 'template' && item.name !== '%E5%BD%92%E5%A2%9F'
```

- `%E5%BD%92%E5%A2%9F`（归墟）是 URL 编码的中文，硬编码排除非常 hacky
- 邀请码 `wandao` 硬编码在 auth.js
- 封面默认尺寸 400x600 硬编码在 ffmpeg 命令中

---

## 五、风险评估矩阵

| 问题 | 严重度 | 利用难度 | 修复成本 | 优先级 |
|------|--------|----------|----------|--------|
| 并发写数据丢失 | 🔴 高 | 低 | 中 | **P0** |
| 同步 IO 阻塞 | 🔴 高 | — | 高 | P1 |
| 命令注入 (ffmpeg) | 🟠 中 | 中 | 低 | **P0** |
| 密码无 Salt | 🟠 中 | 低 | 低 | P1 |
| Token 永不过期 | 🟠 中 | 低 | 低 | P1 |
| 缓存策略缺陷 | 🟡 低 | — | 低 | P2 |
| 代码重复 | 🟡 低 | — | 低 | P2 |
| genre 变更 bug | 🟡 低 | — | 低 | P2 |

---

## 六、修复建议（按优先级排序）

### P0：立即修复

1. **替换 `execSync` 为 `spawn`**（upload-cover）
2. **添加文件锁**（`proper-lockfile`）保护 `users.json`, `meta.json`, `readers.json` 等

### P1：短期修复

3. **密码加盐：** 引入 `bcrypt`，迁移现有密码（可双轨兼容）
4. **Token 过期：** 添加 `exp` 字段，7 天过期
5. **统计缓存：** `calcNovelStats` 结果写入 `stats.json`，按 mtime 增量更新
6. **内存索引：** 启动时构建 `novelId → dir` 索引，避免 `findNovelDir` 线性扫描

### P2：中期优化

7. **拆分大文件：** routes.js → `api/*.js`
8. **提取公共工具：** `utils.js` 统一 `readJson/writeJson/ensureDir`
9. **LRU 缓存：** 替换章节缓存的 FIFO 策略
10. **清理硬编码：** 配置化邀请码、排除目录列表

---

## 七、并发场景压力测试建议

```bash
# 模拟 50 并发用户同时注册
ab -n 1000 -c 50 -p register.json -T application/json \
  https://oclaw.mochencloud.cn:1443/onboard/api/novels/auth/register

# 模拟 50 并发同时更新阅读进度
ab -n 1000 -c 50 -p reading.json -T application/json \
  https://oclaw.mochencloud.cn:1443/onboard/api/novels/users/{id}/reading/{novelId}
```

预期在无锁情况下，`users.json` 和 `reading.json` 会出现数据丢失或 JSON 损坏。

---

*报告生成时间：2026-06-05*  
*覆盖版本：master@e91fc01*
