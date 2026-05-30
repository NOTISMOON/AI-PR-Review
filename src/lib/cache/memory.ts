/**
 * In-Memory LRU Cache — fast, session-scoped cache for API responses.
 * Uses a Map with TTL-based expiration and LRU eviction.
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
   * Get a cached value. Returns null if not found or expired.
   */
  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    // Update last access time for LRU
    entry.lastAccessed = Date.now();
    return entry.value;
  }

  /**
   * Set a value with optional TTL override.
   */
  set(key: string, value: T, ttlMs?: number): void {
    // Evict if at capacity
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
   * Check if key exists and is not expired.
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
   * Delete a key.
   */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get the number of non-expired entries.
   */
  get size(): number {
    this.cleanExpired();
    return this.store.size;
  }

  /**
   * Evict the least recently used entry.
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
   * Remove all expired entries.
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

// ─── Application-specific cache instances ─────────────────────────────

export interface GitHubCacheEntry {
  data: unknown;
  etag?: string;
  lastModified?: string;
}

/** Cache for GitHub API responses (5 min TTL) */
export const githubCache = new MemoryCache<GitHubCacheEntry>(200, 5 * 60 * 1000);

/** Cache for AI analysis results (24 hour TTL) */
export const analysisCache = new MemoryCache<unknown>(100, 24 * 60 * 60 * 1000);
