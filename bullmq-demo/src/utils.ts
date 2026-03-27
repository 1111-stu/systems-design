import { randomBytes } from 'node:crypto';

/** 带时间戳的统一日志 */
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
