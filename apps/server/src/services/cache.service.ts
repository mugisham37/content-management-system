import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"

export interface CacheOptions {
  ttl?: number // Time to live in seconds
  maxSize?: number // Maximum number of items
  serialize?: boolean // Whether to serialize/deserialize values
  namespace?: string // Cache namespace for multi-tenancy
}

export interface CacheStats {
  hits: number
  misses: number
  sets: number
  deletes: number
  size: number
  maxSize: number
  hitRate: number
  memoryUsage: number
}

export interface CacheItem<T = any> {
  value: T
  expiresAt: number
  createdAt: number
  accessCount: number
  lastAccessed: number
  size: number
}

export interface CachePattern {
  pattern: string
  count: number
}

export class CacheService {
  private cache: Map<string, CacheItem> = new Map()
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    size: 0,
    maxSize: 10000,
    hitRate: 0,
    memoryUsage: 0,
  }
  private cleanupInterval: NodeJS.Timeout
  private defaultTtl: number = 3600 // 1 hour default
  private maxSize: number = 10000

  constructor(options: CacheOptions = {}) {
    this.defaultTtl = options.ttl || 3600
    this.maxSize = options.maxSize || 10000
    this.stats.maxSize = this.maxSize

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 60000) // Cleanup every minute

    logger.info("Cache service initialized", {
      defaultTtl: this.defaultTtl,
      maxSize: this.maxSize,
    })
  }

  /**
   * Get value from cache
   */
  async get<T = any>(key: string, namespace?: string): Promise<T | null> {
    try {
      const fullKey = this.buildKey(key, namespace)
      const item = this.cache.get(fullKey)

      if (!item) {
        this.stats.misses++
        this.updateHitRate()
        return null
      }

      // Check if expired
      if (Date.now() > item.expiresAt) {
        this.cache.delete(fullKey)
        this.stats.misses++
        this.stats.size--
        this.updateHitRate()
        return null
      }

      // Update access statistics
      item.accessCount++
      item.lastAccessed = Date.now()
      this.stats.hits++
      this.updateHitRate()

      return item.value as T
    } catch (error) {
      logger.error("Cache get error:", error)
      return null
    }
  }

  /**
   * Set value in cache
   */
  async set<T = any>(
    key: string,
    value: T,
    options: CacheOptions = {}
  ): Promise<void> {
    try {
      const fullKey = this.buildKey(key, options.namespace)
      const ttl = (options.ttl || this.defaultTtl) * 1000 // Convert to milliseconds
      const now = Date.now()

      // Calculate size (rough estimation)
      const size = this.calculateSize(value)

      const item: CacheItem<T> = {
        value,
        expiresAt: now + ttl,
        createdAt: now,
        accessCount: 0,
        lastAccessed: now,
        size,
      }

      // Check if we need to evict items
      if (this.cache.size >= this.maxSize) {
        await this.evictLeastRecentlyUsed()
      }

      // Set the item
      const wasExisting = this.cache.has(fullKey)
      this.cache.set(fullKey, item)

      if (!wasExisting) {
        this.stats.size++
      }
      this.stats.sets++
      this.updateMemoryUsage()

      logger.debug("Cache set", { key: fullKey, ttl: options.ttl })
    } catch (error) {
      logger.error("Cache set error:", error)
      throw ApiError.internal("Failed to set cache value")
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key: string, namespace?: string): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key, namespace)
      const deleted = this.cache.delete(fullKey)

      if (deleted) {
        this.stats.size--
        this.stats.deletes++
        this.updateMemoryUsage()
        logger.debug("Cache delete", { key: fullKey })
      }

      return deleted
    } catch (error) {
      logger.error("Cache delete error:", error)
      return false
    }
  }

  /**
   * Check if key exists in cache
   */
  async exists(key: string, namespace?: string): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key, namespace)
      const item = this.cache.get(fullKey)

      if (!item) {
        return false
      }

      // Check if expired
      if (Date.now() > item.expiresAt) {
        this.cache.delete(fullKey)
        this.stats.size--
        return false
      }

      return true
    } catch (error) {
      logger.error("Cache exists error:", error)
      return false
    }
  }

  /**
   * Get multiple values from cache
   */
  async mget<T = any>(keys: string[], namespace?: string): Promise<(T | null)[]> {
    try {
      const results: (T | null)[] = []

      for (const key of keys) {
        const value = await this.get<T>(key, namespace)
        results.push(value)
      }

      return results
    } catch (error) {
      logger.error("Cache mget error:", error)
      return keys.map(() => null)
    }
  }

  /**
   * Set multiple values in cache
   */
  async mset<T = any>(
    items: Array<{ key: string; value: T; options?: CacheOptions }>,
    namespace?: string
  ): Promise<void> {
    try {
      for (const item of items) {
        await this.set(
          item.key,
          item.value,
          { ...item.options, namespace: namespace || item.options?.namespace }
        )
      }
    } catch (error) {
      logger.error("Cache mset error:", error)
      throw ApiError.internal("Failed to set multiple cache values")
    }
  }

  /**
   * Increment numeric value in cache
   */
  async increment(
    key: string,
    delta: number = 1,
    options: CacheOptions = {}
  ): Promise<number> {
    try {
      const fullKey = this.buildKey(key, options.namespace)
      const item = this.cache.get(fullKey)

      let newValue: number
      if (!item || Date.now() > item.expiresAt) {
        newValue = delta
      } else {
        const currentValue = typeof item.value === "number" ? item.value : 0
        newValue = currentValue + delta
      }

      await this.set(key, newValue, options)
      return newValue
    } catch (error) {
      logger.error("Cache increment error:", error)
      throw ApiError.internal("Failed to increment cache value")
    }
  }

  /**
   * Decrement numeric value in cache
   */
  async decrement(
    key: string,
    delta: number = 1,
    options: CacheOptions = {}
  ): Promise<number> {
    return this.increment(key, -delta, options)
  }

  /**
   * Get keys matching pattern
   */
  async keys(pattern: string, namespace?: string): Promise<string[]> {
    try {
      const fullPattern = this.buildKey(pattern, namespace)
      const regex = new RegExp(fullPattern.replace(/\*/g, ".*"))
      const matchingKeys: string[] = []

      for (const key of this.cache.keys()) {
        if (regex.test(key)) {
          // Remove namespace prefix if present
          const originalKey = namespace ? key.replace(`${namespace}:`, "") : key
          matchingKeys.push(originalKey)
        }
      }

      return matchingKeys
    } catch (error) {
      logger.error("Cache keys error:", error)
      return []
    }
  }

  /**
   * Delete keys matching pattern
   */
  async deletePattern(pattern: string, namespace?: string): Promise<number> {
    try {
      const keys = await this.keys(pattern, namespace)
      let deletedCount = 0

      for (const key of keys) {
        const deleted = await this.delete(key, namespace)
        if (deleted) {
          deletedCount++
        }
      }

      logger.debug("Cache delete pattern", { pattern, deletedCount })
      return deletedCount
    } catch (error) {
      logger.error("Cache delete pattern error:", error)
      return 0
    }
  }

  /**
   * Clear all cache entries
   */
  async clear(namespace?: string): Promise<void> {
    try {
      if (namespace) {
        // Clear only entries in the specified namespace
        const keysToDelete: string[] = []
        for (const key of this.cache.keys()) {
          if (key.startsWith(`${namespace}:`)) {
            keysToDelete.push(key)
          }
        }

        for (const key of keysToDelete) {
          this.cache.delete(key)
        }

        this.stats.size = this.cache.size
      } else {
        // Clear all entries
        this.cache.clear()
        this.stats.size = 0
      }

      this.updateMemoryUsage()
      logger.info("Cache cleared", { namespace })
    } catch (error) {
      logger.error("Cache clear error:", error)
      throw ApiError.internal("Failed to clear cache")
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    this.updateMemoryUsage()
    return { ...this.stats }
  }

  /**
   * Get detailed cache information
   */
  async getInfo(): Promise<{
    stats: CacheStats
    topKeys: Array<{ key: string; accessCount: number; size: number }>
    expiringSoon: Array<{ key: string; expiresAt: number; ttl: number }>
    namespaces: Array<{ namespace: string; count: number; size: number }>
  }> {
    try {
      const now = Date.now()
      const items = Array.from(this.cache.entries())

      // Top accessed keys
      const topKeys = items
        .map(([key, item]) => ({
          key,
          accessCount: item.accessCount,
          size: item.size,
        }))
        .sort((a, b) => b.accessCount - a.accessCount)
        .slice(0, 10)

      // Keys expiring soon (within next hour)
      const expiringSoon = items
        .filter(([, item]) => item.expiresAt - now < 3600000) // 1 hour
        .map(([key, item]) => ({
          key,
          expiresAt: item.expiresAt,
          ttl: Math.max(0, Math.floor((item.expiresAt - now) / 1000)),
        }))
        .sort((a, b) => a.expiresAt - b.expiresAt)
        .slice(0, 10)

      // Namespace statistics
      const namespaceMap = new Map<string, { count: number; size: number }>()
      
      for (const [key, item] of items) {
        const namespace = key.includes(":") ? key.split(":")[0] : "default"
        const existing = namespaceMap.get(namespace) || { count: 0, size: 0 }
        existing.count++
        existing.size += item.size
        namespaceMap.set(namespace, existing)
      }

      const namespaces = Array.from(namespaceMap.entries()).map(([namespace, stats]) => ({
        namespace,
        ...stats,
      }))

      return {
        stats: this.getStats(),
        topKeys,
        expiringSoon,
        namespaces,
      }
    } catch (error) {
      logger.error("Cache get info error:", error)
      throw ApiError.internal("Failed to get cache info")
    }
  }

  /**
   * Warm up cache with data
   */
  async warmup<T = any>(
    data: Array<{ key: string; value: T; ttl?: number }>,
    namespace?: string
  ): Promise<void> {
    try {
      logger.info("Starting cache warmup", { count: data.length, namespace })

      for (const item of data) {
        await this.set(item.key, item.value, {
          ttl: item.ttl,
          namespace,
        })
      }

      logger.info("Cache warmup completed", { count: data.length })
    } catch (error) {
      logger.error("Cache warmup error:", error)
      throw ApiError.internal("Failed to warm up cache")
    }
  }

  /**
   * Get or set pattern (cache-aside pattern)
   */
  async getOrSet<T = any>(
    key: string,
    factory: () => Promise<T> | T,
    options: CacheOptions = {}
  ): Promise<T> {
    try {
      // Try to get from cache first
      const cached = await this.get<T>(key, options.namespace)
      if (cached !== null) {
        return cached
      }

      // Generate value using factory function
      const value = await factory()

      // Store in cache
      await this.set(key, value, options)

      return value
    } catch (error) {
      logger.error("Cache getOrSet error:", error)
      throw error
    }
  }

  /**
   * Refresh cache entry
   */
  async refresh<T = any>(
    key: string,
    factory: () => Promise<T> | T,
    options: CacheOptions = {}
  ): Promise<T> {
    try {
      // Generate new value
      const value = await factory()

      // Update cache
      await this.set(key, value, options)

      return value
    } catch (error) {
      logger.error("Cache refresh error:", error)
      throw error
    }
  }

  /**
   * Touch key to extend TTL
   */
  async touch(key: string, ttl?: number, namespace?: string): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key, namespace)
      const item = this.cache.get(fullKey)

      if (!item || Date.now() > item.expiresAt) {
        return false
      }

      // Extend TTL
      const newTtl = (ttl || this.defaultTtl) * 1000
      item.expiresAt = Date.now() + newTtl
      item.lastAccessed = Date.now()

      return true
    } catch (error) {
      logger.error("Cache touch error:", error)
      return false
    }
  }

  /**
   * Get TTL for key
   */
  async ttl(key: string, namespace?: string): Promise<number> {
    try {
      const fullKey = this.buildKey(key, namespace)
      const item = this.cache.get(fullKey)

      if (!item) {
        return -2 // Key doesn't exist
      }

      const remaining = item.expiresAt - Date.now()
      if (remaining <= 0) {
        return -1 // Key expired
      }

      return Math.floor(remaining / 1000) // Return seconds
    } catch (error) {
      logger.error("Cache ttl error:", error)
      return -2
    }
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    try {
      const now = Date.now()
      let expiredCount = 0

      for (const [key, item] of this.cache.entries()) {
        if (now > item.expiresAt) {
          this.cache.delete(key)
          expiredCount++
        }
      }

      if (expiredCount > 0) {
        this.stats.size = this.cache.size
        this.updateMemoryUsage()
        logger.debug("Cache cleanup completed", { expiredCount })
      }
    } catch (error) {
      logger.error("Cache cleanup error:", error)
    }
  }

  /**
   * Evict least recently used items
   */
  private async evictLeastRecentlyUsed(): Promise<void> {
    try {
      const items = Array.from(this.cache.entries())
      
      // Sort by last accessed time (oldest first)
      items.sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed)

      // Remove oldest 10% of items
      const toRemove = Math.max(1, Math.floor(items.length * 0.1))
      
      for (let i = 0; i < toRemove; i++) {
        const [key] = items[i]
        this.cache.delete(key)
      }

      this.stats.size = this.cache.size
      this.updateMemoryUsage()

      logger.debug("Cache LRU eviction", { removedCount: toRemove })
    } catch (error) {
      logger.error("Cache eviction error:", error)
    }
  }

  /**
   * Build full cache key with namespace
   */
  private buildKey(key: string, namespace?: string): string {
    return namespace ? `${namespace}:${key}` : key
  }

  /**
   * Calculate approximate size of value
   */
  private calculateSize(value: any): number {
    try {
      if (value === null || value === undefined) {
        return 0
      }

      if (typeof value === "string") {
        return value.length * 2 // Rough estimate for UTF-16
      }

      if (typeof value === "number") {
        return 8
      }

      if (typeof value === "boolean") {
        return 4
      }

      if (typeof value === "object") {
        return JSON.stringify(value).length * 2
      }

      return 0
    } catch {
      return 0
    }
  }

  /**
   * Update hit rate statistics
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses
    this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0
  }

  /**
   * Update memory usage statistics
   */
  private updateMemoryUsage(): void {
    let totalSize = 0
    for (const item of this.cache.values()) {
      totalSize += item.size
    }
    this.stats.memoryUsage = totalSize
  }

  /**
   * Destroy cache service
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    this.cache.clear()
    logger.info("Cache service destroyed")
  }
}

// Export singleton instance
export const cacheService = new CacheService()
