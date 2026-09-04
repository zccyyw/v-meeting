/**
 * 密码应用层加密传输 — AES-GCM
 *
 * 前后端共享固定密钥（32 bytes），使用 AES-GCM-256 加密密码明文。
 * 前端加密后通过 `enc:<base64 iv>:<base64 ciphertext>` 格式传输。
 * 后端解密后获取明文，用于密码验证。
 *
 * 注意：此加密仅防止密码在 HTTP 请求体中明文传输，
 * 实际安全性仍依赖 HTTPS/TLS。
 */

// ── Node.js 兼容：确保 btoa/atob 可用 ──
if (typeof globalThis.btoa === "undefined" && typeof Buffer !== "undefined") {
  (globalThis as any).btoa = (s: string) => Buffer.from(s, "binary").toString("base64");
}
if (typeof globalThis.atob === "undefined" && typeof Buffer !== "undefined") {
  (globalThis as any).atob = (s: string) => Buffer.from(s, "base64").toString("binary");
}

// 确保 crypto.subtle 在 Node.js 中可用
let _crypto: typeof globalThis.crypto | null = null;
if (typeof globalThis.crypto?.subtle !== "undefined") {
  _crypto = globalThis.crypto;
} else {
  try {
    // Node.js 16-19 需要 webcrypto
    const { webcrypto } = await import("node:crypto");
    _crypto = webcrypto as unknown as typeof globalThis.crypto;
  } catch {
    // ignore — 浏览器环境一定有
  }
}
const crypto = _crypto ?? globalThis.crypto;

const enc = new TextEncoder();
const dec = new TextDecoder();

// 密钥来源：优先环境变量，否则使用默认值
declare const __MEETING_CRYPTO_KEY__: string | undefined;
const DEFAULT_KEY = "Meeting@2026#SecureKey!8xZw3qL";
const RAW_KEY =
  (typeof process !== "undefined" && process.env?.MEETING_CRYPTO_KEY) ||
  (typeof globalThis !== "undefined" && (globalThis as any).__MEETING_CRYPTO_KEY__) ||
  (typeof __MEETING_CRYPTO_KEY__ !== "undefined" ? __MEETING_CRYPTO_KEY__ : null) ||
  DEFAULT_KEY;

function getKeyBytes(): ArrayBuffer {
  const arr = new Uint8Array(32);
  const src = enc.encode(RAW_KEY);
  for (let i = 0; i < 32; i++) {
    arr[i] = src[i % src.length] ?? 0;
  }
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  cachedKey = await crypto.subtle.importKey(
    "raw",
    getKeyBytes(),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return cachedKey;
}

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return (globalThis as any).btoa(binary);
}

function fromBase64(str: string): ArrayBuffer {
  const binary: string = (globalThis as any).atob(str);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}

/**
 * 加密密码明文，返回 `enc:<base64 iv>:<base64 ciphertext>` 格式字符串。
 * 前端在发送密码前调用。
 */
export async function encryptPassword(plain: string): Promise<string> {
  const key = await getKey();
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const iv = ivBytes.buffer.slice(ivBytes.byteOffset, ivBytes.byteOffset + ivBytes.byteLength) as ArrayBuffer;
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plain),
  );
  return `enc:${toBase64(iv)}:${toBase64(ciphertext)}`;
}

/**
 * 解密密码。
 * 后端在收到密码后调用：如果是 `enc:` 前缀则解密，否则直接返回原文（向后兼容）。
 */
export async function decryptPassword(stored: string): Promise<string> {
  if (!stored.startsWith("enc:")) return stored;
  const parts = stored.split(":");
  if (parts.length !== 3) return stored;
  const iv = fromBase64(parts[1]!);
  const ciphertext = fromBase64(parts[2]!);
  const key = await getKey();
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    return dec.decode(plaintext);
  } catch {
    return stored;
  }
}

/**
 * 判断字符串是否为加密格式
 */
export function isEncrypted(s: string): boolean {
  return s.startsWith("enc:");
}
