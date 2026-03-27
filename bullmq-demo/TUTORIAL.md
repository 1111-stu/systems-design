# BullMQ 订阅到期提醒 — 从零到一完整教程

> 本教程面向 BullMQ 零基础读者，逐步拆解一个「订阅到期前一天发短信提醒」的完整实现。

---

## 目录

1. [先搞懂：我们要解决什么问题？](#1-先搞懂我们要解决什么问题)
2. [方案设计：为什么选定时扫描？](#2-方案设计为什么选定时扫描)
3. [核心概念速览](#3-核心概念速览)
4. [项目搭建](#4-项目搭建)
5. [第一步：定义数据结构（types.ts）](#5-第一步定义数据结构typests)
6. [第二步：基础设施（config.ts + utils.ts）](#6-第二步基础设施configts--utilsts)
7. [第三步：模拟数据库（db-mock.ts）](#7-第三步模拟数据库db-mockts)
8. [第四步：模拟短信 API（sms-mock.ts）](#8-第四步模拟短信-apisms-mockts)
9. [第五步：扫描调度器（scheduler.ts）](#9-第五步扫描调度器schedulerts)
10. [第六步：短信 Worker（sms-worker.ts）](#10-第六步短信-workersms-workerts)
11. [第七步：主入口串联一切（run-demo.ts）](#11-第七步主入口串联一切run-demots)
12. [运行 Demo](#12-运行-demo)
13. [关键机制深入解析](#13-关键机制深入解析)
14. [常见问题](#14-常见问题)
15. [生产环境改造指南](#15-生产环境改造指南)

---

## 1. 先搞懂：我们要解决什么问题？

假设你做了一个会员订阅系统，用户购买后有到期时间。产品经理提了一个需求：

> **订阅到期前一天，自动给用户发一条短信提醒续费。**

听起来简单？直接写个定时任务查数据库发短信不就行了？

但实际有很多坑：

| 问题 | 说明 |
|------|------|
| 短信发失败了怎么办？ | 网络超时、运营商限流，需要**自动重试** |
| 重试会不会重复发？ | 用户收到 3 条一样的短信，体验极差，需要**幂等保护** |
| 服务器挂了重启呢？ | 内存里的任务全丢了，需要**持久化** |
| 多台服务器部署呢？ | 同一条短信被多台机器同时发，需要**分布式锁/竞争消费** |
| 量大了怎么办？ | 10 万用户同时到期，需要**异步队列削峰** |

**BullMQ 就是专门解决这类问题的工具。** 它基于 Redis，提供：任务队列、自动重试、定时任务、分布式竞争消费等能力。

---

## 2. 方案设计：为什么选定时扫描？

### 两种方案对比

**方案 A：用户订阅时创建 Delayed Job**
```
用户购买 → 计算到期前一天的时间 → 创建一个 delay 30 天的 job → 到时间自动执行
```

**方案 B：每天定时扫描数据库（本 Demo 采用）**
```
每天凌晨 2 点 cron 触发 → 查数据库"明天到期"的订阅 → 批量创建短信任务
```

### 为什么选方案 B？

| 维度 | 方案 A (Delayed Job) | 方案 B (定时扫描) |
|------|---------------------|------------------|
| Job 存活时间 | 几天到几十天 | 几分钟 |
| 用户退订/续费 | 需要找到旧 job 删除 | 不用管，下次扫描自然跳过 |
| Redis 故障恢复 | 长期 job 丢失风险高 | 重启后重新扫描即可 |
| 排查问题 | 难以审计 | 每次扫描有日志 |
| 数据真相源 | Redis | 数据库 |

**结论：数据库是真相源，job 只是"搬运工"，活得越短越安全。**

### 整体流程图

```
┌─────────────────────────────────────────────────────────┐
│                    每天凌晨 2:00                         │
│              Repeatable Job 自动触发                     │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Scan Worker 消费扫描任务                     │
│                                                         │
│  1. 查 DB: SELECT * FROM subscriptions                  │
│            WHERE expire_date = '明天'                    │
│            AND reminder_sent = false                     │
│                                                         │
│  2. 找到 N 条 → 批量创建 N 个短信任务                     │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│            SMS Worker 竞争消费短信任务                     │
│                                                         │
│  对每个任务:                                             │
│  1. 幂等检查: DB 里 reminderSent 是否已 true              │
│  2. 发短信（调用短信 API）                                │
│  3. 成功 → 标记 DB reminderSent = true                   │
│  4. 失败 → BullMQ 自动重试（指数退避，最多 3 次）          │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 核心概念速览

开始写代码前，先理解 BullMQ 的 4 个核心概念：

### Queue（队列）

队列是一个"任务收纳箱"。你把任务扔进去（`queue.add()`），Worker 从里面取出来处理。

```typescript
// 创建队列
const queue = new Queue('sms-reminder', { connection: redis });

// 往队列里扔一个任务
await queue.add('send-sms', { phone: '138xxxx', content: '到期提醒' });
```

### Worker（工人）

Worker 是"干活的人"。它一直盯着队列，有新任务就取出来处理。

```typescript
// 创建 Worker，告诉它怎么处理任务
const worker = new Worker('sms-reminder', async (job) => {
  // job.data 就是你 add 时传的数据
  await sendSms(job.data.phone, job.data.content);
}, { connection: redis });
```

### Job（任务）

一个 Job 就是队列里的一条具体任务，包含：
- `data`：你传入的数据（手机号、内容等）
- `id`：唯一标识
- `attemptsMade`：已重试次数
- 状态流转：`waiting` → `active` → `completed` / `failed`

### Repeatable Job（定时任务）

用 cron 表达式让任务按计划自动触发，类似 Linux 的 crontab：

```typescript
// 每天凌晨 2 点自动创建一个任务
await queue.upsertJobScheduler('my-scheduler', {
  pattern: '0 2 * * *'  // cron: 分 时 日 月 星期几
}, {
  name: 'my-job',
  data: { ... }
});
```

---

## 4. 项目搭建

### 目录结构

```
bullmq-demo/
├── docker-compose.yml   # 一键启动 Redis
├── package.json
├── tsconfig.json
└── src/
    ├── types.ts         # 类型定义 — 第 1 步
    ├── config.ts        # Redis 连接配置 — 第 2 步
    ├── utils.ts         # 工具函数 — 第 2 步
    ├── db-mock.ts       # 模拟数据库 — 第 3 步
    ├── sms-mock.ts      # 模拟短信 API — 第 4 步
    ├── scheduler.ts     # 扫描调度器 — 第 5 步
    ├── sms-worker.ts    # 短信 Worker — 第 6 步
    └── run-demo.ts      # 主入口 — 第 7 步
```

### package.json

```json
{
  "name": "bullmq-subscription-demo",
  "private": true,
  "type": "module",
  "scripts": {
    "demo": "tsx src/run-demo.ts"
  },
  "dependencies": {
    "bullmq": "^5.52.1",
    "ioredis": "^5.6.1"
  },
  "devDependencies": {
    "@types/node": "^20",
    "tsx": "^4.21.0",
    "typescript": "^5.8.0"
  }
}
```

说明：
- `"type": "module"` — 使用 ES Module（`import/export`）
- `bullmq` — 核心队列库
- `ioredis` — BullMQ 底层依赖的 Redis 客户端
- `tsx` — 直接运行 TypeScript，不用先编译

### docker-compose.yml

```yaml
services:
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
```

一条命令启动 Redis：`docker compose up -d`

---

## 5. 第一步：定义数据结构（types.ts）

> 先定义"长什么样"，再写"怎么做"。

```typescript
/* ---- 数据库模型 ---- */

export interface Subscription {
  id: string;          // 订阅 ID，如 "sub_001"
  userId: string;      // 用户 ID
  phone: string;       // 手机号
  plan: string;        // 套餐名，如 "月度会员"
  expireDate: string;  // 到期日期，如 "2026-03-28"
  reminderSent: boolean; // 是否已发送提醒（幂等标记！）
}

/* ---- Job 数据 ---- */

/** 扫描任务的 payload — 只需要记录触发时间 */
export interface ScanJobData {
  triggeredAt: string;
}

/** 短信任务的 payload — 包含发短信所需的全部信息 */
export interface SmsJobData {
  subscriptionId: string;
  userId: string;
  phone: string;
  plan: string;
  expireDate: string;
}
```

**要点：**
- `reminderSent` 是整个幂等机制的关键字段——后面会反复提到
- Job 的 data 里要放**处理该任务所需的全部信息**，Worker 拿到 data 就能直接干活，不需要再去查别的

---

## 6. 第二步：基础设施（config.ts + utils.ts）

### config.ts — Redis 连接 + 队列名

```typescript
import type { ConnectionOptions } from 'bullmq';

/** Redis 连接配置 */
export const REDIS_CONNECTION: ConnectionOptions = {
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
};

/** 队列名称 — 集中管理，避免拼写错误 */
export const QUEUE_NAMES = {
  scan: 'subscription-scan',      // 扫描队列
  smsReminder: 'sms-reminder',    // 短信队列
} as const;
```

**要点：**
- BullMQ 的 Queue 和 Worker 通过**队列名**关联——名字一样就是同一个队列
- `as const` 让 TypeScript 把值当作字面量类型，避免拼错

### utils.ts — 日志、sleep、日期

```typescript
import { randomBytes } from 'node:crypto';

/** 带时间戳的统一日志，格式：[时间] [模块] 消息 */
export const log = (actor: string, message: string, extra?: unknown) => {
  const time = new Date().toISOString();
  if (typeof extra === 'undefined') {
    console.log(`[${time}] [${actor}] ${message}`);
    return;
  }
  console.log(`[${time}] [${actor}] ${message}`, extra);
};

/** Promise 版 sleep */
export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 当前 ISO 时间戳 */
export const nowIso = () => new Date().toISOString();

/** 生成带前缀的随机 ID */
export const createId = (prefix: string) =>
  `${prefix}_${randomBytes(6).toString('hex')}`;

/** 获取明天的日期字符串 (YYYY-MM-DD) */
export const getTomorrowDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};
```

**要点：**
- `getTomorrowDate()` 会被多处调用——扫描器用它查"明天到期"的订阅，mock 数据也用它生成到期日期
- `log()` 的 `actor` 参数标识是哪个模块打的日志，方便在输出中区分

---

## 7. 第三步：模拟数据库（db-mock.ts）

> 生产环境替换为真实数据库查询，接口不变。

```typescript
import type { Subscription } from './types.js';
import { getTomorrowDate, log } from './utils.js';

const ACTOR = 'db';

// 预置 5 条订阅数据
const tomorrow = getTomorrowDate();

const subscriptions: Subscription[] = [
  // ✅ 这 3 条：明天到期 + 未提醒 → 会被扫描到
  { id: 'sub_001', userId: 'user_1001', phone: '13800001111',
    plan: '月度会员', expireDate: tomorrow, reminderSent: false },

  { id: 'sub_002', userId: 'user_1002', phone: '13800002222',
    plan: '季度会员', expireDate: tomorrow, reminderSent: false },

  { id: 'sub_003', userId: 'user_1003', phone: '13800003333',
    plan: '年度会员', expireDate: tomorrow, reminderSent: false },

  // ❌ 这条：到期日很远 → 不会被扫描到
  { id: 'sub_004', userId: 'user_1004', phone: '13800004444',
    plan: '月度会员', expireDate: '2026-12-31', reminderSent: false },

  // ❌ 这条：明天到期但已发过提醒 → 不会被扫描到
  { id: 'sub_005', userId: 'user_1005', phone: '13800005555',
    plan: '年度会员', expireDate: tomorrow, reminderSent: true },
];
```

两个关键方法：

```typescript
/** 查询指定日期到期 + 未发送提醒的订阅 */
export const findExpiringSubscriptions = (date: string): Subscription[] => {
  const results = subscriptions.filter(
    (s) => s.expireDate === date && !s.reminderSent,
  );
  log(ACTOR, `查询 ${date} 到期的订阅, 找到 ${results.length} 条`);
  return results;
};

/**
 * 标记已发送提醒（幂等操作！）
 * 返回 true = 成功标记，false = 已经标记过了
 */
export const markReminderSent = (subscriptionId: string): boolean => {
  const sub = subscriptions.find((s) => s.id === subscriptionId);
  if (!sub || sub.reminderSent) {
    log(ACTOR, `${subscriptionId} 已标记过或不存在, 跳过`);
    return false;  // ← 幂等保护：已经处理过的，返回 false
  }
  sub.reminderSent = true;
  log(ACTOR, `${subscriptionId} 标记 reminderSent = true`);
  return true;
};

/** 获取所有订阅（调试用） */
export const getAllSubscriptions = (): Subscription[] => [...subscriptions];
```

**重点理解 `markReminderSent` 的幂等设计：**

```
第一次调用 markReminderSent('sub_001')
  → reminderSent 是 false → 改为 true → 返回 true → Worker 继续发短信

第二次调用 markReminderSent('sub_001')  // 重试时
  → reminderSent 已经是 true → 返回 false → Worker 跳过，不重复发
```

这就是"幂等"——**多次执行和一次执行效果一样**，用户不会收到重复短信。

---

## 8. 第四步：模拟短信 API（sms-mock.ts）

```typescript
import { log } from './utils.js';

const ACTOR = 'sms-api';

/**
 * 模拟短信发送
 * 30% 概率失败 → 用来演示 BullMQ 的自动重试机制
 */
export const sendSms = async (phone: string, content: string): Promise<void> => {
  // 模拟网络延迟 200~500ms
  await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 300));

  // 30% 概率抛错
  if (Math.random() < 0.3) {
    log(ACTOR, `发送失败 → ${phone} (模拟网络错误)`);
    throw new Error(`SMS_SEND_FAILED: 发送到 ${phone} 失败`);
  }

  log(ACTOR, `发送成功 → ${phone}: "${content}"`);
};
```

**要点：**
- 故意加入 30% 失败率，是为了让你在运行时看到 BullMQ 自动重试的效果
- 生产环境替换为真实短信 SDK（阿里云 / 腾讯云），接口保持 `async (phone, content) => void`

---

## 9. 第五步：扫描调度器（scheduler.ts）

这是最核心的文件，包含两部分：注册定时任务 + 扫描 Worker。

### 注册定时任务

```typescript
import { Queue, Worker } from 'bullmq';
import { REDIS_CONNECTION, QUEUE_NAMES } from './config.js';
import { findExpiringSubscriptions } from './db-mock.js';
import { getTomorrowDate, log, nowIso } from './utils.js';
import type { ScanJobData, SmsJobData } from './types.js';

const ACTOR = 'scan-worker';

/**
 * 注册每日扫描的定时任务
 */
export const registerDailyScan = async (scanQueue: Queue<ScanJobData>) => {
  await scanQueue.upsertJobScheduler(
    'daily-subscription-scan',     // 调度器唯一 ID
    { pattern: '0 2 * * *' },      // cron: 每天凌晨 2 点
    {
      name: 'scan-expiring-subscriptions',
      data: { triggeredAt: nowIso() },
    },
  );
  log(ACTOR, '已注册每日扫描定时任务 (cron: 0 2 * * *)');
};
```

`upsertJobScheduler` 的妙处：
- **upsert = update + insert** — 如果已存在就更新，不存在就创建
- 多台服务器同时调用也只会产生**一个**定时任务（不会重复）
- cron `0 2 * * *` 解读：分=0, 时=2, 日=任意, 月=任意, 星期=任意 → 每天 02:00

### 扫描 Worker

```typescript
export const startScanWorker = (smsQueue: Queue<SmsJobData>) => {
  const worker = new Worker<ScanJobData>(
    QUEUE_NAMES.scan,          // 监听 "subscription-scan" 队列
    async (job) => {
      log(ACTOR, `开始扫描, jobId=${job.id}`);

      // 1. 查数据库：明天到期 + 未提醒
      const tomorrow = getTomorrowDate();
      const expiring = findExpiringSubscriptions(tomorrow);

      if (expiring.length === 0) {
        log(ACTOR, '没有即将到期的订阅');
        return { scanned: 0 };
      }

      // 2. 批量入队短信任务
      for (const sub of expiring) {
        await smsQueue.add(
          'send-reminder',
          {
            subscriptionId: sub.id,
            userId: sub.userId,
            phone: sub.phone,
            plan: sub.plan,
            expireDate: sub.expireDate,
          },
          {
            // ⭐ jobId 做幂等：同一订阅同一天不会重复入队
            jobId: `reminder-${sub.id}-${tomorrow}`,

            // ⭐ 重试配置
            attempts: 3,                              // 最多尝试 3 次
            backoff: { type: 'exponential', delay: 2000 }, // 指数退避
            // 第 1 次失败: 等 2 秒重试
            // 第 2 次失败: 等 4 秒重试
            // 第 3 次失败: 最终失败
          },
        );
        log(ACTOR, `短信任务入队: ${sub.id} → ${sub.phone}`);
      }

      log(ACTOR, `扫描完成, 入队 ${expiring.length} 条短信任务`);
      return { scanned: expiring.length };
    },
    { connection: REDIS_CONNECTION },
  );

  worker.on('failed', (job, err) => {
    log(ACTOR, `扫描任务失败: ${job?.id} — ${err.message}`);
  });

  log(ACTOR, '扫描 Worker 已启动');
  return worker;
};
```

**理解数据流转：**

```
Scan Worker 是"中间人"——它不发短信，它的工作是：
查数据库 → 把结果拆成一个个小任务 → 扔进短信队列

这叫"扇出"（Fan-out）：1 个扫描任务 → N 个短信任务
```

**理解 jobId 的幂等作用：**

```
假设扫描器意外跑了两次（cron 抽风、手动触发）：

第一次：add('send-reminder', {...}, { jobId: 'reminder-sub_001-2026-03-28' })
  → Redis 里没有这个 ID → 创建成功 ✓

第二次：add('send-reminder', {...}, { jobId: 'reminder-sub_001-2026-03-28' })
  → Redis 里已有这个 ID → 自动跳过 ✓

结果：用户只收到 1 条短信，不会重复
```

---

## 10. 第六步：短信 Worker（sms-worker.ts）

```typescript
import { Worker } from 'bullmq';
import { REDIS_CONNECTION, QUEUE_NAMES } from './config.js';
import { markReminderSent } from './db-mock.js';
import { sendSms } from './sms-mock.js';
import { log } from './utils.js';
import type { SmsJobData } from './types.js';

const ACTOR = 'sms-worker';

export const startSmsWorker = () => {
  const worker = new Worker<SmsJobData>(
    QUEUE_NAMES.smsReminder,     // 监听 "sms-reminder" 队列
    async (job) => {
      const { subscriptionId, phone, plan, expireDate } = job.data;
      log(ACTOR, `处理任务: ${subscriptionId} → ${phone}, attempt=${job.attemptsMade + 1}`);

      // ⭐ 第一层防线：DB 幂等检查
      const updated = markReminderSent(subscriptionId);
      if (!updated) {
        // 已经发过了（可能是重试到来时，之前的尝试其实成功了）
        log(ACTOR, `${subscriptionId} 已发送过, 跳过`);
        return { skipped: true };
      }

      // ⭐ 发短信（可能抛错 → BullMQ 自动捕获 → 按 backoff 策略重试）
      const content = `【EVE AI】您的${plan}将于 ${expireDate} 到期，请及时续费以免服务中断。`;
      await sendSms(phone, content);

      log(ACTOR, `${subscriptionId} 短信发送成功 ✓`);
      return { sent: true, phone };
    },
    { connection: REDIS_CONNECTION },
  );

  // 监听失败事件（每次失败都会触发，包括中间重试）
  worker.on('failed', (job, err) => {
    log(ACTOR, `任务失败: ${job?.id} — ${err.message} (已重试 ${job?.attemptsMade} 次)`);
  });

  // 监听完成事件
  worker.on('completed', (job) => {
    log(ACTOR, `任务完成: ${job.id}`);
  });

  log(ACTOR, '短信 Worker 已启动');
  return worker;
};
```

**理解双重幂等保护：**

短信不能重复发，我们做了两层保护：

```
┌─────────────────────────────────────────────────────────────┐
│ 第一层：BullMQ jobId 去重（scheduler.ts）                    │
│                                                             │
│ 同一个 jobId 的任务，只会在队列里存在一个                       │
│ → 防止扫描器重复入队                                          │
├─────────────────────────────────────────────────────────────┤
│ 第二层：DB reminderSent 标记（sms-worker.ts）                │
│                                                             │
│ 发短信前先检查 DB，已标记就跳过                                │
│ → 防止 Worker 重试时重复发送                                  │
│                                                             │
│ 场景：第 1 次尝试短信已发出但 Worker 超时了                    │
│       BullMQ 认为失败，触发重试                               │
│       重试时 DB 已标记 true → 跳过 → 用户只收到 1 条          │
└─────────────────────────────────────────────────────────────┘
```

**理解自动重试：**

```
Worker 的 handler 函数抛出异常 → BullMQ 自动捕获 → 检查 attempts 配置

if (已尝试次数 < attempts) {
  等待 backoff 时间 → 重新放回队列 → 再次执行 handler
} else {
  标记为最终失败 → 触发 'failed' 事件
}

指数退避 (exponential, delay: 2000):
  第 1 次失败 → 等 2 秒 → 重试
  第 2 次失败 → 等 4 秒 → 重试
  第 3 次失败 → 最终失败，不再重试
```

---

## 11. 第七步：主入口串联一切（run-demo.ts）

```typescript
import { Queue, QueueEvents } from 'bullmq';
import { REDIS_CONNECTION, QUEUE_NAMES } from './config.js';
import { registerDailyScan, startScanWorker } from './scheduler.js';
import { startSmsWorker } from './sms-worker.js';
import { getAllSubscriptions } from './db-mock.js';
import { log, sleep, nowIso } from './utils.js';
import type { ScanJobData, SmsJobData } from './types.js';

const ACTOR = 'demo';

const main = async () => {
  // 打印初始数据
  log(ACTOR, '========== BullMQ 订阅到期提醒 Demo ==========');
  log(ACTOR, '模拟数据库中的订阅:');
  for (const sub of getAllSubscriptions()) {
    log(ACTOR, `  ${sub.id} | ${sub.phone} | ${sub.plan} | 到期: ${sub.expireDate} | 已提醒: ${sub.reminderSent}`);
  }

  // ---- 1. 创建队列 ----
  const scanQueue = new Queue<ScanJobData>(QUEUE_NAMES.scan, { connection: REDIS_CONNECTION });
  const smsQueue  = new Queue<SmsJobData>(QUEUE_NAMES.smsReminder, { connection: REDIS_CONNECTION });

  // QueueEvents：监听队列事件（完成/失败），用于 Demo 结束判断
  const smsEvents = new QueueEvents(QUEUE_NAMES.smsReminder, { connection: REDIS_CONNECTION });

  // ---- 2. 注册定时任务 ----
  await registerDailyScan(scanQueue);

  // ---- 3. 启动 Workers ----
  const scanWorker = startScanWorker(smsQueue);
  const smsWorker = startSmsWorker();
  await sleep(500); // 等 Worker 就绪

  // ---- 4. 手动触发一次扫描 ----
  // 真实环境里由 cron 自动触发，这里为了 Demo 手动触发
  log(ACTOR, '手动触发一次扫描任务...');
  await scanQueue.add('manual-scan', { triggeredAt: nowIso() });

  // ---- 5. 等待所有短信任务完成 ----
  // （Demo 专用逻辑，生产环境不需要）
  const expectedCount = 3;
  let completedCount = 0;
  let failedFinalCount = 0;

  await new Promise<void>((resolve) => {
    let resolved = false;
    const doResolve = () => {
      if (!resolved) { resolved = true; clearTimeout(timer); resolve(); }
    };
    let timer: ReturnType<typeof setTimeout>;

    const checkDone = () => {
      if (completedCount + failedFinalCount >= expectedCount) doResolve();
    };

    smsEvents.on('completed', () => { completedCount++; checkDone(); });
    smsEvents.on('failed', (_job, _err, prev) => {
      if (prev === 'failed') { failedFinalCount++; checkDone(); }
    });

    timer = setTimeout(() => {
      log(ACTOR, '超时: 未在 15 秒内完成所有任务');
      doResolve();
    }, 15_000);
  });

  // ---- 6. 打印结果 ----
  log(ACTOR, '========== 结果汇总 ==========');
  log(ACTOR, `成功发送: ${completedCount}, 最终失败: ${failedFinalCount}`);
  log(ACTOR, '数据库最终状态:');
  for (const sub of getAllSubscriptions()) {
    log(ACTOR, `  ${sub.id} | ${sub.phone} | 已提醒: ${sub.reminderSent}`);
  }

  // ---- 7. 优雅关闭 ----
  log(ACTOR, '正在关闭...');
  await smsEvents.close();
  await scanWorker.close();
  await smsWorker.close();
  await scanQueue.close();
  await smsQueue.close();
  log(ACTOR, 'Demo 完成 ✓');
};

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

**QueueEvents 是什么？**

它是队列的"旁观者"——不处理任务，只监听事件。Demo 用它来知道"所有短信都处理完了"，以便打印结果并退出。

生产环境通常不需要 QueueEvents，Worker 处理完就完了，不需要主动等待。

---

## 12. 运行 Demo

```bash
# 1. 启动 Redis
docker compose up -d

# 2. 安装依赖
pnpm install

# 3. 运行
pnpm run demo
```

### 预期输出解读

```
[demo] ========== BullMQ 订阅到期提醒 Demo ==========
[demo] 模拟数据库中的订阅:
[demo]   sub_001 | 13800001111 | 月度会员 | 到期: 2026-03-28 | 已提醒: false   ← 会处理
[demo]   sub_002 | 13800002222 | 季度会员 | 到期: 2026-03-28 | 已提醒: false   ← 会处理
[demo]   sub_003 | 13800003333 | 年度会员 | 到期: 2026-03-28 | 已提醒: false   ← 会处理
[demo]   sub_004 | 13800004444 | 月度会员 | 到期: 2026-12-31 | 已提醒: false   ← 跳过（日期不对）
[demo]   sub_005 | 13800005555 | 年度会员 | 到期: 2026-03-28 | 已提醒: true    ← 跳过（已提醒）

[scan-worker] 已注册每日扫描定时任务
[scan-worker] 扫描 Worker 已启动
[sms-worker] 短信 Worker 已启动
[demo] 手动触发一次扫描任务...

[scan-worker] 开始扫描
[db] 查询 2026-03-28 到期的订阅, 找到 3 条
[scan-worker] 短信任务入队: sub_001 → 13800001111
[scan-worker] 短信任务入队: sub_002 → 13800002222
[scan-worker] 短信任务入队: sub_003 → 13800003333

[sms-worker] 处理任务: sub_001 → 13800001111, attempt=1
[sms-api] 发送成功 → 13800001111                                ← 一次成功
[sms-worker] sub_001 短信发送成功 ✓

[sms-worker] 处理任务: sub_002 → 13800002222, attempt=1
[sms-api] 发送失败 → 13800002222 (模拟网络错误)                   ← 失败了！
[sms-worker] 任务失败 (已重试 1 次)
...等待 2 秒（指数退避）...
[sms-worker] 处理任务: sub_002 → 13800002222, attempt=2          ← 自动重试
[sms-api] 发送成功 → 13800002222                                ← 重试成功！
[sms-worker] sub_002 已发送过, 跳过                               ← 幂等保护生效

[demo] ========== 结果汇总 ==========
[demo] 成功发送: 3, 最终失败: 0
[demo] 数据库最终状态:
[demo]   sub_001 | 已提醒: true     ← 已更新
[demo]   sub_002 | 已提醒: true     ← 已更新
[demo]   sub_003 | 已提醒: true     ← 已更新
[demo]   sub_004 | 已提醒: false    ← 未受影响
[demo]   sub_005 | 已提醒: true     ← 原本就是 true
```

> 由于 30% 的随机失败率，每次运行的输出可能略有不同。有时全部一次成功，有时会看到重试。

### 重复运行注意

BullMQ 用 `jobId` 去重——已完成的 job 留在 Redis 里，同 ID 的新 job 会被跳过。重复运行前需要清 Redis：

```bash
docker exec bullmq-demo-redis-1 redis-cli FLUSHALL
```

这在生产环境中是**正确行为**——同一天的定时任务跑两次，不会重复发短信。

---

## 13. 关键机制深入解析

### 13.1 为什么需要"幂等"？

```
"幂等" = 一个操作执行 1 次和执行 N 次，效果相同

为什么任务队列特别需要幂等？因为"至少一次投递"（at-least-once delivery）：

BullMQ 保证：你的任务"至少会被执行一次"
但不保证：你的任务"只会被执行一次"

可能多次执行的场景：
1. Worker 处理完但还没来得及 ACK → 超时 → BullMQ 认为失败 → 重试
2. 网络抖动导致 ACK 丢失
3. Worker 进程被 kill

所以 Worker 的 handler 必须做到：就算被调 10 次，用户也只收到 1 条短信。
```

### 13.2 竞争消费怎么工作？

```
多台服务器部署时：

Server A 启动 SMS Worker ─┐
Server B 启动 SMS Worker ─┼── 都监听 "sms-reminder" 队列
Server C 启动 SMS Worker ─┘

队列里有 3 个任务：[sub_001] [sub_002] [sub_003]

BullMQ 通过 Redis 原子操作保证：
  Server A 拿到 sub_001 → 其他人拿不到
  Server B 拿到 sub_002 → 其他人拿不到
  Server C 拿到 sub_003 → 其他人拿不到

同一个任务不会被两台服务器同时处理（分布式锁）。
```

### 13.3 指数退避（Exponential Backoff）

```
配置：attempts: 3, backoff: { type: 'exponential', delay: 2000 }

时间线：
  0s   → 第 1 次尝试 → 失败
  +2s  → 第 2 次尝试 → 失败（delay * 2^0 = 2000ms）
  +4s  → 第 3 次尝试 → 失败（delay * 2^1 = 4000ms）
  → 最终失败，不再重试

为什么不立即重试？
  如果短信服务因为过载挂了，所有 Worker 同时重试会加重过载。
  指数退避给服务"喘口气"的时间。
```

### 13.4 Repeatable Job vs 普通 Job

```
普通 Job:
  queue.add('name', data)  →  执行一次就完了

Repeatable Job (Job Scheduler):
  queue.upsertJobScheduler('id', { pattern: '0 2 * * *' }, template)
  → 每天凌晨 2 点自动创建一个新 job
  → Redis 记住了这个 cron 规则
  → 即使服务重启，只要再次调用 upsertJobScheduler，cron 继续生效
  → 全局唯一：多台服务器注册同一个 ID，只产生一个定时任务
```

---

## 14. 常见问题

### Q: 为什么 Demo 用 `tsx` 而不是先编译再运行？

`tsx` 是一个 TypeScript 直接执行器，内部用 esbuild 做即时转译。适合 Demo 和开发环境，省去 `tsc → node` 两步。生产环境建议先 `tsc` 编译。

### Q: BullMQ 和 Redis 是什么关系？

BullMQ 用 Redis 作为存储后端。队列、任务状态、定时规则全部存在 Redis 里。Worker 通过 Redis 的阻塞操作（BRPOPLPUSH）等待新任务，实现高效的事件驱动。

### Q: Worker 挂了怎么办？

Worker 挂了，它正在处理的任务会超时（默认 30 秒），BullMQ 自动标记为失败并重试。重启 Worker 后，它会继续消费队列里的任务。

### Q: 如果 Redis 挂了呢？

Redis 挂了，Queue 和 Worker 都无法工作。Redis 恢复后，队列里的任务还在（前提是 Redis 开了持久化 AOF/RDB）。生产环境建议 Redis 开启 AOF 持久化。

### Q: 能不能用多个 Worker 并行处理？

可以！这正是 BullMQ 的强项。你可以：
- 同一进程里创建多个 Worker（通过 `concurrency` 选项）
- 多台服务器各自启动 Worker

BullMQ 通过 Redis 保证每个任务只被一个 Worker 处理。

---

## 15. 生产环境改造指南

| Demo 中的模拟 | 生产替换为 | 注意事项 |
|--------------|-----------|---------|
| `db-mock.ts` | MySQL/PostgreSQL 查询 | `markReminderSent` 用 `UPDATE ... WHERE reminderSent = false` 保证原子性 |
| `sms-mock.ts` | 阿里云/腾讯云短信 SDK | 注意短信模板审核、频率限制 |
| `docker-compose.yml` 单节点 Redis | Redis 集群或云 Redis | 开启 AOF 持久化 |
| `console.log` 日志 | 结构化日志（winston/pino） | 接入日志收集系统 |
| 无监控 | [Bull Board](https://github.com/felixmosh/bull-board) | Web 界面查看队列状态 |
| 无告警 | 监听 `'failed'` 事件 | 最终失败时发告警到钉钉/企业微信 |

### 数据库幂等的生产写法

```sql
-- 原子操作：只有 reminderSent = false 时才更新，返回受影响行数
UPDATE subscriptions
SET reminder_sent = true, reminded_at = NOW()
WHERE id = 'sub_001' AND reminder_sent = false;

-- 受影响行数 = 1 → 继续发短信
-- 受影响行数 = 0 → 已发过，跳过
```

---

## 总结

回顾整个实现，核心思路就三句话：

1. **定时扫描数据库**（Repeatable Job），找到需要提醒的订阅
2. **批量入队短信任务**（Queue + Job），每个订阅一个任务
3. **Worker 消费并发短信**，失败自动重试，幂等防重复

BullMQ 帮你解决了：持久化、重试、竞争消费、定时调度。你只需要专注于业务逻辑。
