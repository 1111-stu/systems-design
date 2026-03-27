import type { ConnectionOptions } from 'bullmq';

/** Redis 连接配置 */
export const REDIS_CONNECTION: ConnectionOptions = {
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
};

/** 队列名称 */
export const QUEUE_NAMES = {
  /** 定时扫描队列 — Repeatable Job 触发 */
  scan: 'subscription-scan',
  /** 短信发送队列 — 扫描后批量入队 */
  smsReminder: 'sms-reminder',
} as const;
