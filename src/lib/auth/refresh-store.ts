import { randomBytes } from "node:crypto";
import { ensureRedis } from "@/lib/cache/redis";
import type { AuthUser } from "./jwt";

/**
 * refresh_token 服务端存储（“Redis 存用于刷新的 token”）。
 * 统一使用 cache/redis 模块；未配置/不可用 REDIS_URL 时降级为进程内存 Map，保证本地可跑。
 */
const memory = new Map<string, { user: AuthUser; expiresAt: number }>();

function memorySet(token: string, user: AuthUser, ttlSec: number) {
  memory.set(token, { user, expiresAt: Date.now() + ttlSec * 1000 });
}
function memoryGet(token: string): AuthUser | null {
  const m = memory.get(token);
  if (!m) return null;
  if (Date.now() > m.expiresAt) {
    memory.delete(token);
    return null;
  }
  return m.user;
}
function memoryDel(token: string) {
  memory.delete(token);
}

const key = (token: string) => `auth:refresh:${token}`;

/** 生成新的 refresh_token（随机不透明串） */
export function generateRefreshToken(): string {
  return randomBytes(48).toString("hex");
}

/** 保存 refresh_token（优先 Redis，失败则内存兜底） */
export async function saveRefreshToken(token: string, user: AuthUser, ttlSec: number): Promise<void> {
  const c = await ensureRedis();
  if (c) {
    try {
      await c.set(key(token), JSON.stringify(user), "EX", ttlSec);
      return;
    } catch {
      /* 降级到内存 */
    }
  }
  memorySet(token, user, ttlSec);
}

/** 校验并取出 refresh_token 对应的用户 */
export async function getRefreshUser(token: string): Promise<AuthUser | null> {
  const c = await ensureRedis();
  if (c) {
    try {
      const raw = await c.get(key(token));
      if (raw) return JSON.parse(raw) as AuthUser;
    } catch {
      /* 降级处理 */
    }
  }
  return memoryGet(token);
}

/** 删除 refresh_token（登出 / 刷新轮换） */
export async function deleteRefreshToken(token: string): Promise<void> {
  const c = await ensureRedis();
  if (c) {
    try {
      await c.del(key(token));
    } catch {
      /* 忽略 */
    }
  }
  memoryDel(token);
}