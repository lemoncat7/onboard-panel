# 系统巡检 & Wiki 巡检报告

**巡检时间**: 2026-05-27 02:05 CST
**执行节点**: main (981dd79e4ef3)

---

## 系统状态

| 指标 | 状态 | 详情 |
|------|------|------|
| **磁盘空间 (/)** | ✅ 健康 | 3.7T 总量，已用 530G (15%)，可用 3.2T |
| **磁盘空间 (cache)** | ✅ 健康 | 917G 总量，已用 180G (20%)，可用 736G |
| **内存** | ⚠️ 中等 | 15G 总量，已用 10G，可用 5.4G (含缓存) |
| **Swap** | ⚠️ 使用 | 9.7G 总量，已用 5.5G |
| **负载** | ⚠️ 中等 | 1.60 / 1.84 / 1.91 (1m / 5m / 15m) |
| **僵尸进程** | ✅ 健康 | 0 |
| **运行时间** | ✅ | 3 天 11 小时 |

## Wiki 状态

| 指标 | 状态 | 详情 |
|------|------|------|
| **Vault 模式** | ✅ bridge | /home/root/.openclaw/workspace/record/wiki |
| **编译状态** | ✅ 成功 | 84 页，0 索引更新 |
| **Lint 检查** | ⚠️ 3 警告 | 0 错误，3 个 broken wikilink |
| **导出产物** | ✅ 68 artifacts | 2 entities, 3 concepts, 1 syntheses, 10 reports |

### Lint 详情
- `bridge-workspace-ae26912a-memory-dreaming-light-2026-05-23-a3f20d86.md`: Broken wikilink `reply_to_current`, `url`
- `bridge-workspace-ae26912a-memory-dreaming-light-2026-05-24-be154bbd.md`: Broken wikilink `reply_to_current`

> 均为 bridge workspace 源文件中的误报，不影响核心 wiki。

---

**结论**: 系统健康，Wiki 正常运行 ✅
