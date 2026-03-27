# BullMQ 订阅到期提醒 Demo

用 BullMQ 实现「订阅到期前一天发短信提醒」的完整工作流。

## 方案：定时扫描 + 批量入队

```
每天凌晨 cron 触发（Repeatable Job）
    ↓
Scan Worker 查数据库: 明天到期 + 未提醒的订阅
    ↓
批量入队短信任务到 sms-reminder 队列
    ↓
SMS Worker 竞争消费 → 幂等检查 → 发短信 → 标记已发送
    ↓
失败自动重试（指数退避，最多 3 次）
```

### 为什么不用 delayed job？

订阅到期提醒的 delay 可能长达几天到几十天，长时间 delayed job 存在：
- Redis 故障丢失风险
- 订阅变更后需要找到旧 job 删除重建
- 难以审计和排查

定时扫描方案以数据库为真相源，job 只活几分钟，更可靠。

## 文件结构

```
src/
├── run-demo.ts      # Demo 入口：启动所有组件，模拟完整流程
├── scheduler.ts     # 注册 Repeatable Job + 扫描 Worker
├── sms-worker.ts    # 短信发送 Worker（幂等 + 自动重试）
├── db-mock.ts       # 模拟数据库（5 条订阅，3 条明天到期）
├── sms-mock.ts      # 模拟短信 API（30% 失败率演示重试）
├── types.ts         # TypeScript 类型定义
├── config.ts        # Redis 连接 & 队列名常量
└── utils.ts         # 日志、sleep、ID 生成等工具
```

## 运行

```bash
# 确保 Redis 运行在 127.0.0.1:6379
npm install
npm run demo
```

## 关键特性

| 特性 | 实现方式 |
|------|---------|
| 定时触发 | `upsertJobScheduler` — 多实例注册也只产生一个定时任务 |
| 分布式安全 | BullMQ 竞争消费，同一 job 只被一个 Worker 处理 |
| 幂等 | DB 层 `reminderSent` 标记，防止重复发送 |
| 自动重试 | `attempts: 3, backoff: exponential` |
| 批量入队 | 扫描后一次性创建多个短信任务，`jobId` 防重复 |

## 预期输出

1. 打印 5 条模拟订阅数据
2. 注册每日扫描定时任务
3. 手动触发扫描，找到 3 条明天到期的订阅
4. 3 个短信任务入队
5. 短信发送（部分可能失败后自动重试）
6. 最终 3 条全部处理完成
7. 打印数据库最终状态，优雅退出

## 生产环境要点

- `db-mock.ts` 替换为真实数据库查询
- `sms-mock.ts` 替换为真实短信 SDK（阿里云/腾讯云）
- Redis 配置持久化（AOF）
- 可选：接入 [Bull Board](https://github.com/felixmosh/bull-board) 做可视化监控
