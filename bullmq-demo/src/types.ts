/* ---- 数据库模型 ---- */

export interface Subscription {
  id: string;
  userId: string;
  phone: string;
  plan: string;
  /** ISO date string, e.g. "2026-03-28" */
  expireDate: string;
  reminderSent: boolean;
}

/* ---- Job Payloads ---- */

/** 扫描任务 — 不需要额外参数，触发即可 */
export interface ScanJobData {
  triggeredAt: string;
}

/** 短信发送任务 */
export interface SmsJobData {
  subscriptionId: string;
  userId: string;
  phone: string;
  plan: string;
  expireDate: string;
}
