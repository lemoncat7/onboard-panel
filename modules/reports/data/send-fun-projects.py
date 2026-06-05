#!/usr/bin/env python3
import sys
sys.path.insert(0, '/home/root/.openclaw/workspace/.agents/skills/stalwart-mail/scripts')
from send_mail import send

with open('/home/root/.openclaw/workspace/assets/reports/heartbeat-fun-projects-2026-05-22.html', 'r') as f:
    body = f.read()

send(
    "834426963@qq.com",
    "⚡ 今日好玩项目发现 - 2026-05-22",
    body,
    "moshang@mochencloud.cn"
)
