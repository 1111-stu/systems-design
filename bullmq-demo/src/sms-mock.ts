import { log } from './utils.js';

const ACTOR = 'sms-api';

/**
 * 模拟短信发送
 * - 30% 概率失败, 用于演示 BullMQ 自动重试
 */
export const sendSms = async (phone: string, content: string): Promise<void> => {
  // 模拟网络延迟
  await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 300));

  if (Math.random() < 0.3) {
    log(ACTOR, `发送失败 → ${phone} (模拟网络错误)`);
    throw new Error(`SMS_SEND_FAILED: 发送到 ${phone} 失败`);
  }

  log(ACTOR, `发送成功 → ${phone}: "${content}"`);
};
