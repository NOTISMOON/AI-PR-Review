/**
 * 内存 LRU 缓存 — 快速、会话级作用域的 API 响应缓存。
 * 使用带 TTL 过期和 LRU 淘汰机制的 Map。
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  lastAccessed: number;
}

export class MemoryCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private defaultTTLMs: number;

  constructor(maxSize = 500, defaultTTLMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultTTLMs = defaultTTLMs;
  }

  /**
   * 获取缓存值，未找到或已过期返回 null。
   */
  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    // 更新最近访问时间，用于 LRU 淘汰
    entry.lastAccessed = Date.now();
    return entry.value;
  }

  /**
   * 设置值，可自定义 TTL 覆盖。
   */
  set(key: string, value: T, ttlMs?: number): void {
    // 若容量已满则淘汰
    if (this.store.size >= this.maxSize) {
      this.evictLRU();
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTTLMs),
      lastAccessed: Date.now(),
    });
  }

  /**
   * 检查键是否存在且未过期。
   */
  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /**
   * 删除一个键。
   */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * 清空所有条目。
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * 获取未过期条目的数量。
   */
  get size(): number {
    this.cleanExpired();
    return this.store.size;
  }

  /**
   * 淘汰最近最少使用的条目。
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.store) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.store.delete(oldestKey);
    }
  }

  /**
   * 移除所有已过期的条目。
   */
  private cleanExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

// ─── 应用特定的缓存实例 ─────────────────────────────

/** AI 分析结果缓存（TTL 1 小时，容量较小） */
export const analysisCache = new MemoryCache<unknown>(50, 60 * 60 * 1000);
