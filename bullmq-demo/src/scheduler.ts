import { Queue, Worker } from 'bullmq';
import { REDIS_CONNECTION, QUEUE_NAMES } from './config.js';
import { findExpiringSubscriptions } from './db-mock.js';
import { getTomorrowDate, log, nowIso } from './utils.js';
import type { ScanJobData, SmsJobData } from './types.js';

const ACTOR = 'scan-worker';

/**
 * 注册每日扫描的 Repeatable Job
 * 多实例部署时都可以调用，BullMQ 保证全局只产生一个定时任务
 */
export const registerDailyScan = async (scanQueue: Queue<ScanJobData>) => {
  await scanQueue.upsertJobScheduler(
    'daily-subscription-scan',
    { pattern: '0 2 * * *' }, // 每天凌晨 2 点
    {
      name: 'scan-expiring-subscriptions',
      data: { triggeredAt: nowIso() },
    },
  );
  log(ACTOR, '已注册每日扫描定时任务 (cron: 0 2 * * *)');
};

/**
 * 启动扫描 Worker
 * 消费扫描任务 → 查 DB → 批量入队短信任务
 */
export const startScanWorker = (smsQueue: Queue<SmsJobData>) => {
  const worker = new Worker<ScanJobData>(
    QUEUE_NAMES.scan,
    async (job) => {
      log(ACTOR, `开始扫描, jobId=${job.id}`);

      const tomorrow = getTomorrowDate();
      const expiring = findExpiringSubscriptions(tomorrow);

      if (expiring.length === 0) {
        log(ACTOR, '没有即将到期的订阅');
        return { scanned: 0 };
      }

      // 批量入队短信任务，jobId 做幂等
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
            jobId: `reminder-${sub.id}-${tomorrow}`, // 幂等键：同一订阅同一天不会重复入队
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
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
