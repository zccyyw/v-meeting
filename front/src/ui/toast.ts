import { App as AntApp, message as staticMessage } from "antd";

/** <AntApp> 提供的 message 实例类型（可消费动态主题上下文） */
type MessageApi = ReturnType<typeof AntApp.useApp>["message"];

/**
 * 全局 Toast 消息。
 *
 * antd 的静态方法（message.success 等）无法消费 App 上下文（动态主题/暗色模式），
 * 控制台会输出 "Static function can not consume context like dynamic theme"。
 * 这里改为使用 <AntApp> 提供的实例（由 ThemeProvider 绑定），
 * 绑定前回退到静态方法以保证调用不中断。
 */
let boundApi: MessageApi | null = null;

/** 由 ThemeProvider 内部的 <AntApp> 调用，注入可消费上下文的 message 实例。 */
export function bindMessageApi(api: MessageApi | null): void {
  boundApi = api;
}

export function showMessage(text: string, durationSec = 2.5): void {
  (boundApi ?? staticMessage).success(text, durationSec);
}

export function showError(text: string, durationSec = 4): void {
  (boundApi ?? staticMessage).error(text, durationSec);
}

export function showInfo(text: string, durationSec = 3): void {
  (boundApi ?? staticMessage).info(text, durationSec);
}

export function showWarning(text: string, durationSec = 4): void {
  (boundApi ?? staticMessage).warning(text, durationSec);
}
