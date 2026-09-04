import type { Db } from "./db.js";
import { getConfigInt, getConfigBool } from "./config-cache.js";

/**
 * 密码策略模块 — 所有参数通过 sys_config 配置，无硬编码。
 *
 * 配置项（均在 sys_config 表中）:
 *   sys.password.minLength      最小长度 (默认 10)
 *   sys.password.maxLength      最大长度 (默认 128)
 *   sys.password.requireUpper   是否需要大写字母 (默认 true)
 *   sys.password.requireLower   是否需要小写字母 (默认 true)
 *   sys.password.requireDigit   是否需要数字 (默认 true)
 *   sys.password.requireSpecial 是否需要特殊字符 (默认 true)
 *   sys.password.specialChars   允许的特殊字符集合 (默认 !@#$%^&*()_+-=[]{}|;:,.<>?/)
 *   sys.password.expireDays     密码过期天数 (默认 15，0 表示不强制)
 *   sys.password.preventReuse   是否禁止与旧密码相同 (默认 true)
 */

export type PasswordPolicy = {
  minLength: number;
  maxLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
  specialChars: string;
  expireDays: number;
  preventReuse: boolean;
};

/**
 * 从 sys_config 加载密码策略（带缓存）。
 */
export async function loadPasswordPolicy(db: Db): Promise<PasswordPolicy> {
  return {
    minLength: await getConfigInt(db, "sys.password.minLength", 10),
    maxLength: await getConfigInt(db, "sys.password.maxLength", 128),
    requireUpper: await getConfigBool(db, "sys.password.requireUpper", true),
    requireLower: await getConfigBool(db, "sys.password.requireLower", true),
    requireDigit: await getConfigBool(db, "sys.password.requireDigit", true),
    requireSpecial: await getConfigBool(db, "sys.password.requireSpecial", true),
    specialChars: await getConfigRaw(db, "sys.password.specialChars",
      "!@#$%^&*()_+-=[]{}|;:,.<>?/"),
    expireDays: await getConfigInt(db, "sys.password.expireDays", 15),
    preventReuse: await getConfigBool(db, "sys.password.preventReuse", true),
  };
}

/** getConfig 的字符串别名，避免循环引用 */
async function getConfigRaw(db: Db, key: string, def: string): Promise<string> {
  const { getConfig } = await import("./config-cache.js");
  return getConfig(db, key, def);
}

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

/**
 * 根据策略校验密码强度。
 */
export function validatePassword(password: string, policy: PasswordPolicy): ValidationResult {
  const errors: string[] = [];

  if (password.length < policy.minLength) {
    errors.push(`密码长度不能少于 ${policy.minLength} 个字符`);
  }
  if (password.length > policy.maxLength) {
    errors.push(`密码长度不能超过 ${policy.maxLength} 个字符`);
  }
  if (policy.requireUpper && !/[A-Z]/.test(password)) {
    errors.push("密码必须包含至少一个大写字母");
  }
  if (policy.requireLower && !/[a-z]/.test(password)) {
    errors.push("密码必须包含至少一个小写字母");
  }
  if (policy.requireDigit && !/[0-9]/.test(password)) {
    errors.push("密码必须包含至少一个数字");
  }
  if (policy.requireSpecial) {
    // 使用 "不包含任何特殊字符" 的方式检测，避免字符类中 - 的范围歧义
    const escaped = escapeRegex(policy.specialChars);
    // 在字符类中，- 需要放在末尾或转义，这里将其转义为 \-
    const safePattern = escaped.replace(/(?<!\\)-/g, "\\-");
    const specialRegex = new RegExp(`[${safePattern}]`);
    if (!specialRegex.test(password)) {
      errors.push("密码必须包含至少一个特殊字符");
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 判断密码是否为默认/初始密码（如 123456）。
 * 默认密码列表通过 sys.password.defaultPasswords 配置，逗号分隔。
 */
export async function isDefaultPassword(
  db: Db,
  password: string,
): Promise<boolean> {
  const { getConfig } = await import("./config-cache.js");
  const list = await getConfig(db, "sys.password.defaultPasswords", "123456,admin123");
  const defaults = list.split(",").map((s) => s.trim());
  return defaults.includes(password);
}

/**
 * 计算密码是否已过期。
 * @param pwdUpdateDate 密码最后更新时间（数据库中的字符串或 Date 对象）
 * @param expireDays 过期天数（0 表示不强制）
 */
export function isPasswordExpired(
  pwdUpdateDate: string | Date | null,
  expireDays: number,
): boolean {
  if (!pwdUpdateDate || expireDays <= 0) return false;
  // 兼容 MySQL 返回 Date 对象和字符串两种情况
  const dateStr = pwdUpdateDate instanceof Date
    ? pwdUpdateDate.toISOString()
    : typeof pwdUpdateDate === "string"
      ? (pwdUpdateDate.endsWith("Z") ? pwdUpdateDate : pwdUpdateDate.replace(" ", "T"))
      : String(pwdUpdateDate);
  const updated = new Date(dateStr);
  const diffMs = Date.now() - updated.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > expireDays;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
