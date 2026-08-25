/**
 * 轻量客户端缓存 + 去重 + 局部失效（纯客户端模块，无任何第三方依赖）。
 * 目的：减少「来回导航 / 局部变更 → 整页全量请求」的重复请求。
 *
 * 实现说明：
 * - 模块级内存 Map，key 为完整 URL 字符串，value 存 { ts, data }。
 * - cachedFetch 在 TTL 窗口内直接命中内存并返回，避免重复请求；未命中时走 authFetch
 *   真实请求（保留 authFetch 的 401 自动 refresh 能力）。
 * - 请求失败（HTTP 非 ok 或网络/解析错误）直接 reject 且不写入缓存，避免把坏数据缓存。
 * - invalidateCache 负责局部失效：对 syncData 后、审查任务变更 / SSE 通知到来等时机做精准清理。
 */
import { authFetch } from "@/lib/client/auth-fetch";

/** 缓存条目：写入时间戳 + 缓存的数据载荷 */
interface CacheEntry {
  ts: number;
  data: unknown;
}

// 模块级内存缓存（页面来回导航、SPA 路由切换间共享）
const cacheStore = new Map<string, CacheEntry>();

/**
 * 带缓存的 GET fetch：TTL 内命中直接返回缓存；未命中用 authFetch 真实请求并写入缓存。
 * 失败（HTTP 非 ok / 网络错 / JSON 解析错）一律 reject，且不写入缓存。
 *
 * @param url     请求地址（作为缓存 key，天然含查询参数，如 pulls 的 owner/repo）
 * @param ttlSec  有效时长（秒），默认 60
 */
export async function cachedFetch<T>(url: string, ttlSec = 60): Promise<T> {
  const now = Date.now();
  const hit = cacheStore.get(url);
  // TTL 窗口内命中：直接复用缓存，减少重复请求
  if (hit && now - hit.ts < ttlSec * 1000) {
    return hit.data as T;
  }

  try {
    const res = await authFetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    // JSON 解析失败视为请求失败，直接 reject 且不写入缓存
    const data: T = await res.json();
    cacheStore.set(url, { ts: now, data });
    return data;
  } catch (err) {
    throw err;
  }
}

/**
 * 局部失效：删除所有 key 以 prefix 开头的缓存项。
 * 用于数据变更时精准清理，避免整页全量重拉。
 * 例：invalidateCache("/api/review/tasks") 只清审查任务相关的缓存。
 */
export function invalidateCache(prefix: string): void {
  if (!prefix) return;
  for (const key of cacheStore.keys()) {
    if (key.startsWith(prefix)) {
      cacheStore.delete(key);
    }
  }
}