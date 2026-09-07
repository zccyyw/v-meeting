import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import type { Redis } from "ioredis";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(redis: Redis, userId: string | number) {
  const sessionId = nanoid(32);
  await redis.set(`session:${sessionId}`, String(userId), "EX", 60 * 60 * 24 * 7);
  return sessionId;
}

export async function getSessionUserId(redis: Redis, sessionId: string) {
  return redis.get(`session:${sessionId}`);
}

/**
 * 会话是否处于“强制修改密码”受限状态（密码过期后登录会打标记）。
 * 受限期间除改密等少数接口外应拒绝访问。
 */
export async function isForceChangePassword(redis: Redis, sessionId: string) {
  return (await redis.get(`session_force:${sessionId}`)) != null;
}
