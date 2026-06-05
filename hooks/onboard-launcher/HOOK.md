---
name: onboard-launcher
description: "Auto-start onboard panel on gateway startup"
metadata:
  { "openclaw": { "emoji": "⚡", "events": ["gateway:startup"], "requires": { "bins": ["node"] } } }
---

# Onboard Launcher

Launch the onboard supervisor when OpenClaw Gateway starts. Supervisor auto-starts the panel service.

- Supervisor: `/home/root/.openclaw/workspace/onboard-panel/supervisor.js`
- Panel: `/home/root/.openclaw/workspace/onboard-panel/server.js`
- Panel Port: `3000`
- Supervisor API: `3001`
