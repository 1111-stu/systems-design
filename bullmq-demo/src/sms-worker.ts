import { Worker } from 'bullmq';
import { REDIS_CONNECTION, QUEUE_NAMES } from './config.js';
import { markReminderSent } from './db-mock.js';
import { sendSms } from './sms-mock.js';
import { log } from './utils.js';
import type { SmsJobData } from './types.js';

const ACTOR = 'sms-worker';

/**
 * 启动短信发送 Worker
 * 消费短信任务 → 幂等检查 → 发送短信 → 标记已发送
 */
export const startSmsWorker = () => {
  const worker = new Worker<SmsJobData>(
    QUEUE_NAMES.smsReminder,
    async (job) => {
      const { subscriptionId, phone, plan, expireDate } = job.data;
      log(ACTOR, `处理任务: ${subscriptionId} → ${phone}, attempt=${job.attemptsMade + 1}`);

      // 幂等：DB 层检查，防止重复发送
      const updated = markReminderSent(subscriptionId);
      if (!updated) {
        log(ACTOR, `${subscriptionId} 已发送过, 跳过`);
        return { skipped: true };
      }

      // 发送短信（可能失败，BullMQ 自动重试）
      const content = `【EVE AI】您的${plan}将于 ${expireDate} 到期，请及时续费以免服务中断。`;
      await sendSms(phone, content);

      log(ACTOR, `${subscriptionId} 短信发送成功 ✓`);
      return { sent: true, phone };
    },
    { connection: REDIS_CONNECTION },
  );

  worker.on('failed', (job, err) => {
    log(ACTOR, `任务失败: ${job?.id} — ${err.message} (已重试 ${job?.attemptsMade} 次)`);
  });

  worker.on('completed', (job) => {
    log(ACTOR, `任务完成: ${job.id}`);
  });

  log(ACTOR, '短信 Worker 已启动');
  return worker;
};
