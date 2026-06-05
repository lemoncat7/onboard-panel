# Novels 模块冗余代码检查报告

## 文件概况

| 文件 | 行数 | 功能 |
|------|------|------|
| novels.js | 686 | 数据模型 + 业务逻辑 |
| routes.js | 754 | API 路由处理 |
| index.html | 1598 | 前端页面 + 交互 |
| **总计** | **3038** | |

---

## 1. 重复/冗余代码

### 1.1 封面校验逻辑（3处重复）

**novels.js:**
```javascript
// get() 函数
if (meta.cover && !meta.cover.startsWith('/onboard')) {
  cover = fs.existsSync(path.join(__dirname, 'data', 'covers', meta.cover)) ? '/onboard/modules/novels/data/covers/' + meta.cover : '';
}
```

**novels.js list() + scanUploadDir():**
```javascript
// 同样的封面路径拼接逻辑出现在 3 个地方
const cover = meta.cover ? (meta.cover.startsWith('/onboard') ? meta.cover : '/onboard/modules/novels/data/covers/' + meta.cover) : '';
```

**建议：** 提取 `resolveCoverPath(cover)` 函数，统一处理。

### 1.2 用户 ID 提取（多处重复）

```javascript
// routes.js 中多次出现
const userId = q.get('userId') || 'anonymous';
```

### 1.3 路径安全检查（重复）

```javascript
if (filePath.includes('..')) { json(res, { error: 'invalid path' }, 400); return true; }
if (!fullPath.startsWith(baseDir)) { json(res, { error: 'access denied' }, 403); return true; }
```

出现在文件管理器的读取、保存、删除中。

### 1.4 响应格式（轻微重复）

```javascript
json(res, { success: true });
json(res, { success: false, error: ... }, 400);
```

---

## 2. 已废弃/可删除代码

### 2.1 宠物相关代码（可选）

index.html 中宠物相关代码约 150 行：
- `petSay`, `petChat`, `petHide`, `petAnim`, `petGreet` 等
- 如果不再使用，可移入单独模块

### 2.2 旧版统计页面（index.html 底部）

```javascript
// 约 50 行统计页面渲染代码，如果已迁移到 reports 模块可删除
function loadStats() { ... }
```

### 2.3 调试代码

```javascript
// 如存在 console.log 调试语句，可清理
console.log("[LOAD]", readUrl, "userId="+currentUser.id);
```

---

## 3. 潜在问题代码

### 3.1 嵌套 try-catch

```javascript
// novels.js readJson
function readJson(p, fallback = null) {
  try {
    const realPath = fs.realpathSync(p);  // 可能抛异常
    return JSON.parse(fs.readFileSync(realPath, 'utf8'));  // 又可能抛异常
  } catch { return fallback; }
}
```

`realpathSync` 失败会静默返回 fallback，可能隐藏问题。

### 3.2 同步文件操作阻塞

大量使用 `fs.readFileSync`, `fs.writeFileSync`, `fs.readdirSync`。
高并发时可能阻塞事件循环。建议：
- 缓存热点数据（小说列表、章节）
- 使用异步 IO 或 Worker

### 3.3 内存缓存（chapterCache）无清理机制

```javascript
const chapterCache = {};
const CACHE_TTL = 10 * 60 * 1000;
const MAX_CACHE = 20;
```

缓存条目过期后不会自动删除，只控制数量。

---

## 4. 结构建议

### 4.1 拆分大文件

| 文件 | 拆分建议 |
|------|----------|
| novels.js | model.js（数据）+ service.js（业务） |
| routes.js | api/ 目录，按功能拆分 |
| index.html | 组件化（Vue/React）或至少拆 JS/CSS |

### 4.2 提取公共工具

```javascript
// utils.js
function resolveCover(cover) { ... }
function safePath(base, sub) { ... }  // 防路径穿越
function validateUserId(userId) { ... }
```

---

## 5. 统计数据

| 指标 | 数量 | 说明 |
|------|------|------|
| 函数总数 | 约 45+ | 分散在 3 个文件 |
| 重复逻辑 | 5 处 | 封面、路径检查、响应 |
| 可提取公共函数 | 8+ | 减少约 100 行 |
| 冗余/废弃代码 | 约 200 行 | 宠物、调试、旧版功能 |

---

## 建议优先级

1. **高：** 提取 `resolveCoverPath()` 统一封面处理（3处重复）
2. **中：** 提取 `safePath()` 统一路径安全检查（4处重复）
3. **中：** 异步化或加缓存，减少同步 IO
4. **低：** 拆分 index.html 的 JS/CSS

要执行优化吗？⚡