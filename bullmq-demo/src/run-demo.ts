import { Queue, QueueEvents } from 'bullmq';
import { REDIS_CONNECTION, QUEUE_NAMES } from './config.js';
import { registerDailyScan, startScanWorker } from './scheduler.js';
import { startSmsWorker } from './sms-worker.js';
import { getAllSubscriptions } from './db-mock.js';
import { log, sleep, nowIso } from './utils.js';
import type { ScanJobData, SmsJobData } from './types.js';

const ACTOR = 'demo';

const main = async () => {
  log(ACTOR, '========== BullMQ 订阅到期提醒 Demo ==========');
  log(ACTOR, '模拟数据库中的订阅:');
  for (const sub of getAllSubscriptions()) {
    log(ACTOR, `  ${sub.id} | ${sub.phone} | ${sub.plan} | 到期: ${sub.expireDate} | 已提醒: ${sub.reminderSent}`);
  }

  // ---- 1. 创建队列 ----
  const scanQueue = new Queue<ScanJobData>(QUEUE_NAMES.scan, { connection: REDIS_CONNECTION });
  const smsQueue = new Queue<SmsJobData>(QUEUE_NAMES.smsReminder, { connection: REDIS_CONNECTION });

  // QueueEvents 用于监听短信队列的完成/失败事件
  const smsEvents = new QueueEvents(QUEUE_NAMES.smsReminder, { connection: REDIS_CONNECTION });

  // ---- 2. 注册每日扫描定时任务（展示 Repeatable Job） ----
  await registerDailyScan(scanQueue);

  // ---- 3. 启动 Workers ----
  const scanWorker = startScanWorker(smsQueue);
  const smsWorker = startSmsWorker();

  // 等待 Worker 就绪
  await sleep(500);

  // ---- 4. 手动触发一次扫描（不等 cron，直接入队） ----
  log(ACTOR, '手动触发一次扫描任务...');
  await scanQueue.add('manual-scan', { triggeredAt: nowIso() });

  // ---- 5. 等待短信任务全部处理完成 ----
  const expectedCount = 3; // 明天到期且未提醒的有 3 条
  let completedCount = 0;
  let failedFinalCount = 0;

  await new Promise<void>((resolve) => {
    let resolved = false;
    const doResolve = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve();
      }
    };
    let timer: ReturnType<typeof setTimeout>;
    const checkDone = () => {
      if (completedCount + failedFinalCount >= expectedCount) {
        doResolve();
      }
    };

    smsEvents.on('completed', () => {
      completedCount++;
      checkDone();
    });

    smsEvents.on('failed', (_job, _err, prev) => {
      // prev === 'failed' 表示最终失败（重试耗尽），而非中间重试
      if (prev === 'failed') {
        failedFinalCount++;
        checkDone();
      }
    });

    // 超时保护
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
