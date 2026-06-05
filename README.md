# Onboard Panel

Gateway 代理状态看板 — 极简管理面板

## 页面

- **访问路径**: `/onboard/`
- **代理后端**: `http://openclaw-gateway:19000`

## 字段说明

| 字段 | 值 |
|------|-----|
| 前端请求路径 | `/onboard/` |
| 后端代理地址 | `http://openclaw-gateway:19000` |
| 缓存 | memory / redis / disk |
| 状态 | online |
| 操作 | 健康检查 / 清空缓存 / 刷新 |
| Onboard | v0.0.1 |

## 启动方式

### 1. 本地直接运行

```bash
node server.js
```

- 默认端口 `3000`
- 密码 `openclaw`（可通过 `ONBOARD_PASSWORD` 环境变量修改）

### 2. 脚本启停

```bash
./onboard.sh start    # 启动（后台 nohup）
./onboard.sh stop     # 停止
./onboard.sh restart  # 重启
./onboard.sh status   # 查看状态
```

### 3. Docker 运行

```bash
docker compose up -d
```

### 4. OpenClaw 自动启动（推荐）

项目自带 `gateway:startup` hook，OpenClaw Gateway 启动时自动拉起 onboard-panel。

#### 启用（一次性）

```bash
openclaw hooks enable onboard-launcher
openclaw gateway restart
```

#### Hook 文件结构

将仓库里的 `hooks/` 目录复制到 OpenClaw hooks 目录：

```bash
cp -r hooks/onboard-launcher ~/.openclaw/hooks/
```

目录结构：

```
~/.openclaw/hooks/onboard-launcher/
├── HOOK.md      # hook 元数据：名称、事件、依赖
└── handler.ts   # 触发时执行的逻辑
```

#### HOOK.md

```markdown
---
name: onboard-launcher
description: "Auto-start onboard panel on gateway startup"
metadata:
  { "openclaw": { "emoji": "⚡", "events": ["gateway:startup"], "requires": { "bins": ["node"] } } }
---

# Onboard Launcher

Launch the onboard panel service when OpenClaw Gateway starts.
```

- `events: ["gateway:startup"]` — 监听 Gateway 启动事件
- `requires.bins: ["node"]` — 要求系统有 node 命令

#### handler.ts

```typescript
import { spawn } from "child_process";
import { existsSync } from "fs";

const PANEL_DIR = "/home/root/.openclaw/workspace/onboard-panel";

const handler = async (event: any) => {
  // 只处理 gateway:startup 事件
  if (event.type !== "gateway" || event.action !== "startup") return;

  // 检查 server.js 是否存在
  if (!existsSync(`${PANEL_DIR}/server.js`)) return;

  // 检查是否已经在运行（请求 health 接口）
  try {
    const res = await fetch("http://localhost:3000/health");
    if (res.ok) return; // 已运行，跳过
  } catch {
    // 未运行，继续启动
  }

  // spawn 启动后台进程
  const proc = spawn("node", ["server.js"], {
    cwd: PANEL_DIR,
    detached: true,
    stdio: "ignore",
  });
  proc.unref();
};

export default handler;
```

逻辑说明：
1. Gateway 启动完成 → 触发 `gateway:startup` 事件
2. Hook 检查 `server.js` 是否存在
3. 检查 `http://localhost:3000/health` 是否通（避免重复启动）
4. 没运行则 `spawn` 启动 `node server.js`，`detached: true` + `unref()` 让进程独立存活

#### 原理

OpenClaw 的 hooks 机制会在 Gateway 启动完成后，按注册的事件触发对应的 handler。`detached: true` 让子进程脱离 Gateway 的进程组，即使 Gateway 后续重启，已启动的 onboard-panel 也不会被带掉。

## 本地预览

```bash
npx serve .
# 或
python3 -m http.server 8080
```

直接打开 `index.html` 也行。
