import { theme } from "antd";

/**
 * 会议页 antd 浮层（布局选择 / 会议详情 / 底部按钮设备菜单等）的暗色主题：
 * 会议页整体是自定义暗色（--meeting-*），antd 默认亮色浮层放进去会突兀，
 * 用局部 ConfigProvider 覆写 colorBgElevated 等 token，使浮层底色/箭头/文字
 * 与会议暗黑风格一致（嵌套的等分 Dropdown 菜单一并继承）。
 * 底色为半透明深色（配合各浮层的 backdrop-filter 形成玻璃拟态，见 index.css）。
 */
export const MEETING_DARK_OVERLAY_THEME = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: "#1278ff",
    borderRadius: 8,
    colorBgElevated: "rgba(20, 24, 28, 0.9)",
    colorBgContainer: "rgba(20, 24, 28, 0.9)",
    colorText: "#f5f6f7",
    colorTextSecondary: "rgba(255, 255, 255, 0.55)",
    colorBorder: "rgba(255, 255, 255, 0.14)",
    colorBorderSecondary: "rgba(255, 255, 255, 0.08)",
    colorFill: "rgba(255, 255, 255, 0.08)",
    colorFillSecondary: "rgba(255, 255, 255, 0.12)",
    colorFillTertiary: "rgba(255, 255, 255, 0.06)",
  },
};
