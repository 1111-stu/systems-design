import type { Subscription } from './types.js';
import { getTomorrowDate, log } from './utils.js';

const ACTOR = 'db';

/**
 * 内存模拟数据库
 * 预置 5 条订阅，其中 3 条明天到期
 */
const tomorrow = getTomorrowDate();

const subscriptions: Subscription[] = [
  { id: 'sub_001', userId: 'user_1001', phone: '13800001111', plan: '月度会员', expireDate: tomorrow, reminderSent: false },
  { id: 'sub_002', userId: 'user_1002', phone: '13800002222', plan: '季度会员', expireDate: tomorrow, reminderSent: false },
  { id: 'sub_003', userId: 'user_1003', phone: '13800003333', plan: '年度会员', expireDate: tomorrow, reminderSent: false },
  // 下面两条不会被扫描到
  { id: 'sub_004', userId: 'user_1004', phone: '13800004444', plan: '月度会员', expireDate: '2026-12-31', reminderSent: false },
  { id: 'sub_005', userId: 'user_1005', phone: '13800005555', plan: '年度会员', expireDate: tomorrow, reminderSent: true }, // 已发送过
];

/** 查询指定日期到期且未发送提醒的订阅 */
export const findExpiringSubscriptions = (date: string): Subscription[] => {
  const results = subscriptions.filter(
    (s) => s.expireDate === date && !s.reminderSent,
  );
  log(ACTOR, `查询 ${date} 到期的订阅, 找到 ${results.length} 条`);
  return results;
};

/**
 * 标记已发送提醒（幂等）
 * @returns true 表示更新成功, false 表示已经标记过（幂等保护）
 */
export const markReminderSent = (subscriptionId: string): boolean => {
  const sub = subscriptions.find((s) => s.id === subscriptionId);
  if (!sub || sub.reminderSent) {
    log(ACTOR, `${subscriptionId} 已标记过或不存在, 跳过`);
    return false;
  }
  sub.reminderSent = true;
  log(ACTOR, `${subscriptionId} 标记 reminderSent = true`);
  return true;
};

/** 获取所有订阅（调试用） */
export const getAllSubscriptions = (): Subscription[] => [...subscriptions];
