#!/bin/bash
DIR="/home/root/.openclaw/workspace/onboard-panel"
PID_FILE="/tmp/onboard-panel.pid"

start() {
  if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
    echo "already running (pid $(cat $PID_FILE))"
    return
  fi
  cd "$DIR" && nohup node server.js > /tmp/onboard-panel.log 2>&1 &
  echo $! > "$PID_FILE"
  echo "started on pid $! → http://localhost:3000"
}

stop() {
  if [ -f "$PID_FILE" ]; then
    kill $(cat "$PID_FILE") 2>/dev/null && echo "stopped" || echo "already dead"
    rm -f "$PID_FILE"
  else
    echo "not running"
  fi
}

status() {
  if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
    echo "running, pid $(cat $PID_FILE)"
    echo "log: /tmp/onboard-panel.log"
  else
    echo "not running"
  fi
}

case "$1" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 1; start ;;
  status) status ;;
  *) echo "usage: $0 {start|stop|restart|status}" ;;
esac
