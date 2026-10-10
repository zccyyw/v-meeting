/**
 * 用户导入/导出的 Excel(xlsx) 纯函数模块：列定义、工作簿构建、解析与单元格校验。
 *
 * 导出列覆盖 sys_user 全部业务字段 + 角色(role_keys) + 部门名称(dept_name)；
 * 角色用 role_key、部门用 dept_name 而非自增 id，保证导出文件跨环境可移植。
 * 日期统一输出 `YYYY-MM-DD HH:mm:ss` 文本，规避 MySQL/PG/SQLite 的时区与类型差异。
 */
import ExcelJS from "exceljs";

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** 受保护的系统账号：导入时禁止写入，导出时跳过 */
export const PROTECTED_USER_NAMES = ["system", "sysadmin"];

/** 导入模式：full = 完整迁移（导出文件原样导入）；simple = 最小化（仅必填字段） */
export type ImportMode = "full" | "simple";

export const DEFAULT_IMPORT_PASSWORD = "123456";
export const DEFAULT_ROLE_KEY = "common";

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 2000;

/** 导出列：表头为中文（与导入模板一致），key 为行数据键 */
export const EXPORT_COLUMNS: { header: string; key: string; width: number }[] = [
  { header: "用户ID", key: "user_id", width: 10 },
  { header: "登录账号", key: "user_name", width: 18 },
  { header: "密码", key: "password", width: 34 },
  { header: "用户昵称", key: "nick_name", width: 16 },
  { header: "状态", key: "status", width: 8 },
  { header: "角色", key: "role_keys", width: 18 },
  { header: "部门", key: "dept_name", width: 14 },
  { header: "邮箱", key: "email", width: 24 },
  { header: "手机号", key: "phonenumber", width: 14 },
  { header: "性别", key: "sex", width: 8 },
  { header: "用户类型", key: "user_type", width: 10 },
  { header: "头像", key: "avatar", width: 14 },
  { header: "备注", key: "remark", width: 24 },
  { header: "删除标记", key: "del_flag", width: 10 },
  { header: "登录IP", key: "login_ip", width: 16 },
  { header: "登录时间", key: "login_date", width: 20 },
  { header: "密码更新时间", key: "pwd_update_date", width: 20 },
  { header: "创建者", key: "create_by", width: 12 },
  { header: "更新者", key: "update_by", width: 12 },
  { header: "创建时间", key: "create_time", width: 20 },
  { header: "更新时间", key: "update_time", width: 20 },
];

/** 表头 → 行数据键。中文表头为主，另接受常见英文/驼峰别名（手写表格可用） */
const HEADER_ALIASES: Record<string, string> = {
  用户id: "user_id",
  用户ID: "user_id",
  id: "user_id",
  登录账号: "user_name",
  用户账号: "user_name",
  用户名: "user_name",
  账号: "user_name",
  username: "user_name",
  user_name: "user_name",
  密码: "password",
  password: "password",
  用户昵称: "nick_name",
  昵称: "nick_name",
  nick_name: "nick_name",
  nickName: "nick_name",
  状态: "status",
  status: "status",
  角色: "role_keys",
  role_keys: "role_keys",
  部门: "dept_name",
  dept_name: "dept_name",
  邮箱: "email",
  email: "email",
  手机号: "phonenumber",
  手机: "phonenumber",
  phonenumber: "phonenumber",
  phone: "phonenumber",
  性别: "sex",
  sex: "sex",
  用户类型: "user_type",
  user_type: "user_type",
  头像: "avatar",
  avatar: "avatar",
  备注: "remark",
  remark: "remark",
  删除标记: "del_flag",
  del_flag: "del_flag",
  登录ip: "login_ip",
  login_ip: "login_ip",
  登录时间: "login_date",
  login_date: "login_date",
  密码更新时间: "pwd_update_date",
  pwd_update_date: "pwd_update_date",
  创建者: "create_by",
  create_by: "create_by",
  更新者: "update_by",
  update_by: "update_by",
  创建时间: "create_time",
  create_time: "create_time",
  更新时间: "update_time",
  update_time: "update_time",
};

/** 把任意日期/时间值格式化为 `YYYY-MM-DD HH:mm:ss`（无效值原样返回） */
export function formatDateTime(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const d =
    value instanceof Date
      ? value
      : new Date(typeof value === "number" ? value : String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(value);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** 单元格值 → 字符串（兼容日期/公式/富文本/超链接/布尔） */
export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Date) return formatDateTime(value);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return v.richText.map((r) => String((r as { text?: string }).text ?? "")).join("").trim();
    }
    if (v.formula !== undefined) return cellToString(v.result);
    if (v.text !== undefined) return cellToString(v.text);
    if (v.hyperlink !== undefined) return cellToString(v.hyperlink);
    if (v.error !== undefined) return "";
  }
  return String(value).trim();
}

/** 表头文本 → 数据键（未识别返回 null） */
export function resolveHeaderKey(header: string): string | null {
  const text = header.trim();
  if (!text) return null;
  return HEADER_ALIASES[text] ?? HEADER_ALIASES[text.toLowerCase()] ?? null;
}

/** 为导出/模板工作簿统一设置列与表头样式 */
function styleSheet(ws: ExcelJS.Worksheet): void {
  ws.columns = EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  header.height = 20;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/** 构建导出工作簿：sheet1 = 用户数据 */
export async function buildUsersWorkbook(
  data: Record<string, string>[],
  sheetName = "用户",
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Meeting";
  const ws = wb.addWorksheet(sheetName);
  styleSheet(ws);
  for (const row of data) ws.addRow(row);
  // ExcelJS.Buffer 与 Node Buffer 类型不兼容，此处统一转成 Node Buffer
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as Uint8Array);
}

/**
 * 构建导入模板。
 * sheet1「用户导入」只含表头——不放示例数据行，避免运维忘记删除示例行而
 * 误导入示例账号（示例含角色字段，属高危）；示例数据仅以文本形式放在说明页。
 */
export async function buildTemplateWorkbook(
  mode: ImportMode,
  deptNameExample: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Meeting";

  const ws = wb.addWorksheet("用户导入");
  styleSheet(ws);

  const sample: Record<string, string> = {
    user_id: "1001",
    user_name: "zhangsan",
    password:
      mode === "full"
        ? "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
        : "",
    nick_name: "张三",
    status: "0",
    role_keys: "common",
    dept_name: deptNameExample,
    email: "zhangsan@example.com",
    phonenumber: "13800138000",
    sex: "0",
    user_type: "00",
    avatar: "",
    remark: "示例行",
    del_flag: "0",
    login_ip: "",
    login_date: "",
    pwd_update_date: "",
    create_by: "",
    update_by: "",
    create_time: "",
    update_time: "",
  };

  const doc = wb.addWorksheet("填写说明");
  doc.columns = [
    { header: "列名", key: "col", width: 16 },
    { header: "模式", key: "mode", width: 20 },
    { header: "必填", key: "required", width: 8 },
    { header: "说明", key: "desc", width: 56 },
  ];
  doc.getRow(1).font = { bold: true };
  const rows: [string, string, string, string][] = [
    ["用户ID", "完整迁移", "否", "导出用；导入时忽略（系统自动分配，避免主键冲突）"],
    ["登录账号", "两种模式", "是", "唯一标识。已存在则按导入内容覆盖更新"],
    ["密码", "两种模式", "否", "完整迁移建议填哈希值（$2 开头，将原样写入、密码保持不变）；留空或填明文时按默认密码 123456 处理"],
    ["用户昵称", "两种模式", "是", "完整迁移必填；最小化留空时自动取登录账号"],
    ["状态", "两种模式", "否", "0=正常，1=停用。留空默认 0"],
    ["角色", "两种模式", "否", `逗号分隔的角色标识，普通用户填 common${mode === "full" ? "，管理员填 admin" : ""}；留空默认 common（普通用户）。角色不存在则该行失败`],
    ["部门", "两种模式", "否", `填部门名称（如 ${deptNameExample}）；不存在时留空并提示，不中断导入`],
    ["邮箱", "两种模式", "否", "最长 50 字符"],
    ["手机号", "两种模式", "否", "最长 11 字符"],
    ["性别", "两种模式", "否", "0=男，1=女，2=未知。留空默认 0"],
    ["用户类型", "两种模式", "否", "留空默认 00"],
    ["备注", "两种模式", "否", "最长 500 字符"],
    ["其他列", "两种模式", "否", "删除标记/登录信息/审计时间等仅供核对，导入时忽略"],
    ["行顺序", "两种模式", "—", "按表头名匹配列，不依赖列顺序；多余列忽略"],
  ];
  for (const r of rows) doc.addRow({ col: r[0], mode: r[1], required: r[2], desc: r[3] });

  // 示例数据：仅以文本形式列出，供复制粘贴到「用户导入」sheet
  const note = doc.addRow({});
  note.getCell(1).value =
    "示例数据（复制到「用户导入」sheet 第 2 行起填写；请勿在说明页直接填写后导入）";
  note.getCell(1).font = { bold: true };
  for (const col of EXPORT_COLUMNS) {
    const r = doc.addRow({});
    r.getCell(1).value = col.header;
    r.getCell(2).value = sample[col.key] ?? "";
  }
  doc.views = [{ state: "frozen", ySplit: 1 }];

  // ExcelJS.Buffer 与 Node Buffer 类型不兼容，此处统一转成 Node Buffer
  return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as Uint8Array);
}

export type ParsedSheet = {
  /** 有效表头 → 列号 */
  headerMap: Map<number, string>;
  /** 数据行（键为行数据键，空值不写入） */
  rows: { rowNo: number; cells: Record<string, string> }[];
};

/** 解析导入文件：读取表头并按数据键归一化每一行 */
export async function parseUserSheet(buffer: Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("invalid_xlsx");

  const headerMap = new Map<number, string>();
  ws.getRow(1).eachCell((cell, col) => {
    const key = resolveHeaderKey(cellToString(cell.value));
    if (key) headerMap.set(col, key);
  });

  const rows: ParsedSheet["rows"] = [];
  for (let rowNo = 2; rowNo <= ws.rowCount; rowNo++) {
    const row = ws.getRow(rowNo);
    const cells: Record<string, string> = {};
    let hasValue = false;
    for (const [col, key] of headerMap) {
      const text = cellToString(row.getCell(col).value);
      if (text) {
        cells[key] = text;
        hasValue = true;
      }
    }
    if (hasValue) rows.push({ rowNo, cells });
  }
  return { headerMap, rows };
}
