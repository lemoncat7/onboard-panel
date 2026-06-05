#!/bin/bash
# Onboard Panel Supervisor Auto-start Hook
# 启动监管服务，监管服务会自动拉起 onboard-panel

PANEL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SUPERVISOR_PID_FILE="$PANEL_DIR/.supervisor.pid"
SUPERVISOR_LOG="$PANEL_DIR/.supervisor.log"

echo "[onboard-hook] starting supervisor..."

# 如果监管服务已经在跑，跳过
if [ -f "$SUPERVISOR_PID_FILE" ]; then
  OLD_PID=$(cat "$SUPERVISOR_PID_FILE" 2>/dev/null)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[onboard-hook] supervisor already running (pid=$OLD_PID)"
    exit 0
  fi
fi

# 杀掉残留的 onboard 进程
ONBOARD_PID=$(cat "$PANEL_DIR/.onboard.pid" 2>/dev/null)
if [ -n "$ONBOARD_PID" ] && kill -0 "$ONBOARD_PID" 2>/dev/null; then
  echo "[onboard-hook] killing stale onboard process $ONBOARD_PID"
  kill "$ONBOARD_PID" 2>/dev/null
  sleep 1
fi

# 启动监管服务（后台）
cd "$PANEL_DIR"
nohup node supervisor.js > "$SUPERVISOR_LOG" 2>&1 &
SUP_PID=$!
echo "$SUP_PID" > "$SUPERVISOR_PID_FILE"
echo "[onboard-hook] supervisor started (pid=$SUP_PID)"
