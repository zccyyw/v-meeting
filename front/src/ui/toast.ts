import { message } from "antd";

/**
 * 全局 Toast 消息。
 * 使用 antd message 静态方法，在路由切换后仍能存活。
 * 主题由全局 ConfigProvider 自动管理。
 */
export function showMessage(text: string, durationSec = 2.5): void {
  message.success(text, durationSec);
}

export function showError(text: string, durationSec = 4): void {
  message.error(text, durationSec);
}

export function showInfo(text: string, durationSec = 3): void {
  message.info(text, durationSec);
}

export function showWarning(text: string, durationSec = 4): void {
  message.warning(text, durationSec);
}
