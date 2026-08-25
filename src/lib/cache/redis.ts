import { randomBytes } from "node:crypto";
import Redis from "ioredis";

/**
 * Redis 客户端统一模块（对应后端文档 `cache/`）。
 * - 单例客户端（读取 REDIS_URL；未配置/不可用时返回 null，调用方自行降级）
 * - 缓存机制：JSON 序列化 get/set(带 TTL)/del/按模式批量删（Cache Aside）
 * - 分布式锁机制：SET NX PX 加锁 + Lua 脚本按持有令牌释放
 */
let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!client) {
    client = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    client.on("error", () => {
      /* 静默，调用方通过 ensureRedis 判定可用性 */
    });
  }
  return client;
}

/** 确保已连接；不可用返回 null */
export async function ensureRedis(): Promise<Redis | null> {
  const c = getRedis();
  if (!c) return null;
  try {
    if (c.status === "wait") await c.connect();
    return c.status === "ready" ? c : null;
  } catch {
    return null;
  }
}

/** 健康检查 */
export async function pingRedis(): Promise<boolean> {
  const c = await ensureRedis();
  if (!c) return false;
  try {
    return (await c.ping()) === "PONG";
  } catch {
    return false;
  }
}

// ── 缓存机制（Cache Aside） ──

/** 读缓存（JSON 反序列化；未命中或 Redis 不可用返回 null） */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const c = await ensureRedis();
  if (!c) return null;
  try {
    const raw = await c.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** 写缓存，返回是否真正写入 Redis（便于调用方区分 Redis 不可用） */
export async function cacheSet(key: string, value: unknown, ttlSec: number): Promise<boolean> {
  const c = await ensureRedis();
  if (!c) return false;
  try {
    await c.set(key, JSON.stringify(value), "EX", ttlSec);
    return true;
  } catch {
    return false;
  }
}

/** 删除单个缓存键 */
export async function cacheDel(key: string): Promise<void> {
  const c = await ensureRedis();
  if (!c) return;
  try {
    await c.del(key);
  } catch {
    /* ignore */
  }
}

/** 按模式删除缓存键（如 github:repo:*），用于 webhook 触发缓存失效 */
export async function cacheDelPattern(pattern: string): Promise<void> {
  const c = await ensureRedis();
  if (!c) return;
  try {
    const keys = await c.keys(pattern);
    if (keys.length) await c.del(...keys);
  } catch {
    /* ignore */
  }
}

/**
 * 读透式缓存（single-flight）：命中直接返回；未命中用分布式锁只让一个请求回源构建，
 * 其余等待后读缓存，防止缓存击穿打爆上游。适合「外部会改动」的短 TTL 缓存主策略。
 * Redis 不可用时直接回源（无缓存降级）。
 */
export async function cachedRead<T>(
  key: string,
  ttlSec: number,
  build: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;

  const lockKey = `cache:lock:${key}`;
  const token = randomBytes(8).toString("hex");
  const locked = await acquireLock(lockKey, Math.max(ttlSec, 5), token);
  try {
    // 双重检查：等待锁的请求可能已被上一个请求填充
    const again = await cacheGet<T>(key);
    if (again !== null) return again;
    const value = await build();
    // 写入 TTL 加随机抖动（约 85%~115%），避免一大批 key 同时到点造成缓存雪崩
    await cacheSet(key, value, ttlSec * (0.85 + Math.random() * 0.3));
    return value;
  } finally {
    if (locked) await releaseLock(lockKey, token);
  }
}

// ── 分布式锁机制 ──

/**
 * 加分布式锁（SET NX PX）。token 用于保证只有持有者能释放。
 * waitMs>0 表示获取失败时轮询等待；返回 false 表示未拿到锁。
 * （无 Redis 时直接返回 true，跳过加锁，便于本地运行。）
 */
export async function acquireLock(
  key: string,
  ttlSec: number,
  token: string,
  waitMs = 0,
): Promise<boolean> {
  const c = await ensureRedis();
  if (!c) return true;
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const ok = await c.set(`lock:${key}`, token, "PX", ttlSec * 1000, "NX");
      if (ok === "OK") return true;
    } catch {
      return true;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** 释放分布式锁：仅持有者（token 匹配）可释放，防止误删他人锁 */
export async function releaseLock(key: string, token: string): Promise<void> {
  const c = await ensureRedis();
  if (!c) return;
  const script = `
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
    else
      return 0
    end`;
  try {
    await c.eval(script, 1, `lock:${key}`, token);
  } catch {
    /* ignore */
  }
}

// ── 实时通知广播（Redis Pub/Sub，多实例 SSE 推送用） ──

/** 通知广播频道 */
export const NOTIFY_CHANNEL = "notify";

/** 广播一条通知消息到频道（任意实例发布，各实例的 SSE 订阅者收到后推给前端） */
export async function redisPublish(channel: string, message: unknown): Promise<boolean> {
  const c = await ensureRedis();
  if (!c) return false;
  try {
    await c.publish(channel, JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

let subClient: Redis | null = null;

/**
 * 获取专用的 subscriber 连接。
 * ioredis 中 subscribe 会把连接切换为订阅模式、不能再执行普通命令，
 * 因此必须与缓存用的主连接分离；多个 SSE 连接共享这一个订阅连接即可。
 */
export function getRedisSubscriber(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!subClient) {
    subClient = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    subClient.on("error", () => {
      /* 静默：订阅失败时 SSE 端降级为兜底轮询 */
    });
  }
  return subClient;
}

let notifySubscribed = false;

/** 建立对通知频道的订阅（幂等，全局共享一次）；返回是否可用 */
export async function ensureNotifySubscribed(): Promise<Redis | null> {
  const sub = getRedisSubscriber();
  if (!sub) return null;
  try {
    if (sub.status === "wait") await sub.connect();
    if (sub.status !== "ready") return null;
    if (!notifySubscribed) {
      await sub.subscribe(NOTIFY_CHANNEL);
      notifySubscribed = true;
    }
    return sub;
  } catch {
    return null;
  }
}