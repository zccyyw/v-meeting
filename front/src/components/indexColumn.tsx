import type { ColumnsType } from "antd/es/table";

/**
 * 管理端数据列表序号列（columns 首列插入）。
 * - 分页列表传 page/pageSize：序号跨页延续，第 p 页第 m 行 = (p-1)*pageSize + m + 1
 *   （antd Table 的 render index 为当前页内索引，服务端/客户端分页均适用）；
 * - 未分页的全量列表不传参：序号 = index + 1。
 *
 * fixed：表格配有横向滚动（scroll.x）时传 true 使序号列吸左；
 * 无 scroll.x 的表格须传 false，否则 antd 固定列行为异常。
 */
export function indexColumn<T>(
  page?: number,
  pageSize?: number,
  options: { fixed?: boolean; title?: string } = {},
): ColumnsType<T>[number] {
  const { fixed = true, title } = options;
  return {
    title,
    width: 64,
    align: "center",
    ...(fixed ? { fixed: "left" as const } : {}),
    render: (_: unknown, __: T, index: number) =>
      page && pageSize ? (page - 1) * pageSize + index + 1 : index + 1,
  };
}
