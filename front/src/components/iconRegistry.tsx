import type { ComponentType, ReactNode } from "react";
import {
  MobileOutlined,
  AlertOutlined, ApiOutlined, AppstoreOutlined, AuditOutlined, BankOutlined,
  BarChartOutlined, BellOutlined, BlockOutlined, BookOutlined,
  CalendarOutlined, CameraOutlined, CarOutlined, CheckCircleOutlined, ClockCircleOutlined,
  CloudOutlined, CloudServerOutlined, CodeOutlined, CompassOutlined, ControlOutlined,
  CopyOutlined, CrownOutlined, DashboardOutlined, DatabaseOutlined, DeleteOutlined,
  DesktopOutlined, DownloadOutlined, EditOutlined, EnvironmentOutlined,
  ExclamationCircleOutlined, ExportOutlined, EyeOutlined,
  FileDoneOutlined, FileOutlined, FileProtectOutlined, FileTextOutlined, FilterOutlined,
  FireOutlined, FlagOutlined, FolderOutlined, FundOutlined, GiftOutlined,
  GlobalOutlined, HeartOutlined, HomeOutlined, ImportOutlined, KeyOutlined,
  LineChartOutlined, LinkOutlined, LockOutlined, LoginOutlined, MailOutlined, MessageOutlined,
  MonitorOutlined, MoneyCollectOutlined, OrderedListOutlined, PayCircleOutlined, PhoneOutlined,
  PieChartOutlined, ProfileOutlined, PushpinOutlined, RocketOutlined, SafetyCertificateOutlined,
  SafetyOutlined, ScheduleOutlined, SearchOutlined, ReloadOutlined, SendOutlined, SettingOutlined, ShopOutlined,
  SnippetsOutlined, SolutionOutlined, StarOutlined, SyncOutlined, TagOutlined,
  TeamOutlined, ThunderboltOutlined, ToolOutlined, TrophyOutlined, UnlockOutlined,
  UploadOutlined, UserAddOutlined, UsergroupAddOutlined, UserOutlined, WalletOutlined,
  WarningOutlined, WifiOutlined,
} from "@ant-design/icons";

/**
 * 精选图标注册表（若依式图标选择控件的数据源）。
 * - name：antd 图标组件全名（sys_menu.icon 存储值）；
 * - alias：中文别名（供搜索）。
 * 数据库存量中的若依 svg 名（user/peoples/log/form/system）经 resolveIconName 兼容解析。
 */
export type IconItem = { name: string; alias: string; group: string };

const GROUPS: { group: string; icons: Record<string, string> }[] = [
  {
    group: "系统",
    icons: {
      SettingOutlined: "设置 参数 配置", ToolOutlined: "工具 维护", DashboardOutlined: "仪表盘 概览",
      ControlOutlined: "控制 台", AppstoreOutlined: "应用 商店 菜单",
      SafetyOutlined: "安全", SafetyCertificateOutlined: "安全 证书 认证", KeyOutlined: "密钥 钥匙",
      LockOutlined: "锁 加密", UnlockOutlined: "解锁", ApiOutlined: "接口 API",
      CodeOutlined: "代码", DatabaseOutlined: "数据库", CloudServerOutlined: "云 服务器",
      DesktopOutlined: "桌面 电脑", MobileOutlined: "手机 移动", GlobalOutlined: "全球 网络",
      HomeOutlined: "首页 主页", WifiOutlined: "无线 网络", LoginOutlined: "登录 进入口",
    },
  },
  {
    group: "用户与组织",
    icons: {
      UserOutlined: "用户 账号", UserAddOutlined: "添加 用户", UsergroupAddOutlined: "用户组 添加",
      TeamOutlined: "团队 部门 群组", CrownOutlined: "皇冠 王牌", BankOutlined: "银行 机构 大楼",
      SolutionOutlined: "方案 人员", ProfileOutlined: "档案 简历",
    },
  },
  {
    group: "审批与监控",
    icons: {
      AuditOutlined: "审计 审批", FileDoneOutlined: "完成 文件 审批", FileProtectOutlined: "受保护 文件",
      ScheduleOutlined: "日程 计划 审批", CheckCircleOutlined: "通过 对勾", ClockCircleOutlined: "时钟 等待",
      ExclamationCircleOutlined: "警告 提示", WarningOutlined: "警告 风险", AlertOutlined: "警报 提醒",
      MonitorOutlined: "监控 屏幕", EyeOutlined: "眼睛 查看", FundOutlined: "资金 趋势",
    },
  },
  {
    group: "文件与日志",
    icons: {
      FileOutlined: "文件", FileTextOutlined: "文件 日志 文本", FolderOutlined: "文件夹 目录",
      CopyOutlined: "复制", SnippetsOutlined: "片段 模板", OrderedListOutlined: "有序 列表",
      BarChartOutlined: "柱状 图表", PieChartOutlined: "饼图 图表", LineChartOutlined: "折线 图表",
      BookOutlined: "手册 文档"
    },
  },
  {
    group: "通信与操作",
    icons: {
      BellOutlined: "铃铛 通知", MailOutlined: "邮件 邮箱", MessageOutlined: "消息 留言",
      PhoneOutlined: "电话", SendOutlined: "发送", LinkOutlined: "链接",
      ExportOutlined: "导出", ImportOutlined: "导入", DownloadOutlined: "下载",
      UploadOutlined: "上传", SyncOutlined: "同步", ReloadOutlined: "刷新 重载",
      SearchOutlined: "搜索 查找", FilterOutlined: "筛选 过滤", EditOutlined: "编辑 修改",
      DeleteOutlined: "删除", StarOutlined: "星标 收藏", HeartOutlined: "喜欢 收藏",
      FlagOutlined: "旗帜 标记", TagOutlined: "标签", PushpinOutlined: "图钉 固定",
    },
  },
  {
    group: "业务与其他",
    icons: {
      CalendarOutlined: "日历 排期", CameraOutlined: "相机 截图", CarOutlined: "车辆 出行",
      ShopOutlined: "商店", GiftOutlined: "礼物", WalletOutlined: "钱包 费用",
      PayCircleOutlined: "支付", MoneyCollectOutlined: "收款 金额", RocketOutlined: "火箭 发布",
      ThunderboltOutlined: "闪电 快捷", FireOutlined: "热门", TrophyOutlined: "奖杯 排名",
      CompassOutlined: "指南 导航", EnvironmentOutlined: "位置 地址", BlockOutlined: "区块",
      CloudOutlined: "云",
    },
  },
];

export const ICON_ITEMS: IconItem[] = GROUPS.flatMap(({ group, icons }) =>
  Object.entries(icons).map(([name, alias]) => ({ name, alias, group })),
);

const ICON_SET = new Set(ICON_ITEMS.map((i) => i.name));

const ICON_COMPONENTS: Record<string, ComponentType> = {
  SettingOutlined, ToolOutlined, DashboardOutlined, ControlOutlined,
  AppstoreOutlined, SafetyOutlined, SafetyCertificateOutlined, KeyOutlined, LockOutlined,
  UnlockOutlined, ApiOutlined, CodeOutlined, DatabaseOutlined, CloudServerOutlined, LoginOutlined,
  DesktopOutlined, MobileOutlined, GlobalOutlined, HomeOutlined, WifiOutlined,
  UserOutlined, UserAddOutlined, UsergroupAddOutlined, TeamOutlined, CrownOutlined,
  BankOutlined, SolutionOutlined, ProfileOutlined,
  AuditOutlined, FileDoneOutlined, FileProtectOutlined, ScheduleOutlined, CheckCircleOutlined,
  ClockCircleOutlined, ExclamationCircleOutlined, WarningOutlined, AlertOutlined, MonitorOutlined,
  EyeOutlined, FundOutlined,
  FileOutlined, FileTextOutlined, FolderOutlined, CopyOutlined, SnippetsOutlined,
  OrderedListOutlined, BarChartOutlined, PieChartOutlined, LineChartOutlined, BookOutlined,
  BellOutlined, MailOutlined, MessageOutlined, PhoneOutlined, SendOutlined, LinkOutlined,
  ExportOutlined, ImportOutlined, DownloadOutlined, UploadOutlined, SyncOutlined, ReloadOutlined,
  SearchOutlined, FilterOutlined, EditOutlined, DeleteOutlined, StarOutlined, HeartOutlined,
  FlagOutlined, TagOutlined, PushpinOutlined,
  CalendarOutlined, CameraOutlined, CarOutlined, ShopOutlined, GiftOutlined, WalletOutlined,
  PayCircleOutlined, MoneyCollectOutlined, RocketOutlined, ThunderboltOutlined, FireOutlined,
  TrophyOutlined, CompassOutlined, EnvironmentOutlined, BlockOutlined, CloudOutlined,
};

/** 若依 svg 遗留名 → antd 图标全名（数据库存量值兼容） */
const LEGACY_ICON_MAP: Record<string, string> = {
  user: "UserOutlined",
  peoples: "TeamOutlined",
  log: "FileTextOutlined",
  form: "FormOutlined",
  system: "SettingOutlined",
};

/** 解析存储值为可渲染的图标名：#/空 → null；遗留名 → 映射；未知 → null */
export function resolveIconName(raw?: string | null): string | null {
  if (!raw || raw === "#") return null;
  if (ICON_SET.has(raw)) return raw;
  return LEGACY_ICON_MAP[raw] ?? null;
}

/** 按存储值渲染图标组件；解析失败返回 null */
export function getIcon(raw?: string | null): ReactNode {
  const name = resolveIconName(raw);
  if (!name) return null;
  const Cmp = ICON_COMPONENTS[name];
  return Cmp ? <Cmp /> : null;
}
