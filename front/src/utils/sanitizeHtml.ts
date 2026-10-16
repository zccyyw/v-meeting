import DOMPurify from "dompurify";

/**
 * 富文本展示前净化（白名单过滤 script/事件属性等）。
 * 通知公告为管理端发布的富文本，C 端与管理端展示均须经此函数。
 */
export function sanitizeHtml(html: string | null | undefined): string {
  return DOMPurify.sanitize(html ?? "");
}
