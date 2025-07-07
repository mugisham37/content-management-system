// =============================================================================
// API KEY SERVICE - SIMPLIFIED VERSION
// =============================================================================

import { ApiError } from '../utils/errors'
import { logger } from '../utils/logger'
import { CryptoUtils } from '../utils/crypto.utils'
import { IpUtils } from '../utils/ip.utils'
import {
  ApiKey,
  ApiKeyScope,
  CreateApiKeyRequest,
  UpdateApiKeyRequest,
  ApiKeyValidationResult,
  ApiKeyValidationOptions,
  ApiKeyWithPlainKey,
  ApiKeyFilters,
  PaginatedApiKeys,
  ApiKeyUsageStats,
  ApiKeyAnalytics,
  ApiKeyUsageEntry,
  CleanupResult,
  ApiKeyMetrics
} from '../types/api-key.types'

export class ApiKeyService {
  private apiKeys: Map<string, ApiKey> = new Map()
  private rateLimitCache: Map<string, { count: number; resetTime: Date }> = new Map()
  private usageTracking: Map<string, ApiKeyUsageEntry[]> = new Map()
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    this.startCleanupTasks()
  }

  /**
   * Start automated cleanup tasks
   */
  private startCleanupTasks(): void {
    // Cleanup expired API keys every hour
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupExpiredKeys()
        this.cleanupRateLimitCache()
        this.cleanupUsageTracking()
        logger.info('API key cleanup completed successfully')
      } catch (error) {
        logger.error('API key cleanup failed:', error)
      }
    }, 60 * 60 * 1000) // 1 hour

    // Cleanup rate limit cache every 5 minutes
    setInterval(() => {
      this.cleanupRateLimitCache()
    }, 5 * 60 * 1000) // 5 minutes
  }

  /**
   * Stop cleanup tasks (for graceful shutdown)
   */
  public stopCleanupTasks(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * Create a new API key
   */
  public async createApiKey(
    request: CreateApiKeyRequest,
    createdBy: string
  ): Promise<ApiKeyWithPlainKey> {
    try {
      // Validate scopes
      this.validateScopes(request.scopes)

      // Check if API key with the same name already exists for this tenant
      const existingKey = Array.from(this.apiKeys.values()).find(
        key => key.name === request.name && 
               key.tenantId === request.tenantId &&
               key.createdById === createdBy
      )

      if (existingKey) {
        throw ApiError.conflict(`API key with name '${request.name}' already exists`)
      }

      // Generate API key
      const plainKey = CryptoUtils.generateApiKey()
      const hashedKey = await CryptoUtils.hashApiKey(plainKey)

      const apiKey: ApiKey = {
        id: CryptoUtils.generateSecureToken(16),
        name: request.name,
        key: hashedKey,
        scopes: request.scopes,
        isActive: true,
        expiresAt: request.expiresAt || null,
        lastUsedAt: null,
        createdById: createdBy,
        tenantId: request.tenantId || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Store in memory
      this.apiKeys.set(apiKey.id, apiKey)

      logger.info(`API key created: ${apiKey.name}`, {
        apiKeyId: apiKey.id,
        createdBy,
        scopes: apiKey.scopes,
      })

      return { apiKey, plainKey }
    } catch (error) {
      logger.error('Failed to create API key:', error)
      throw error
    }
  }

  /**
   * Get all API keys with pagination
   */
  public async getAllApiKeys(
    filters: ApiKeyFilters = {},
    options: {
      page?: number
      limit?: number
    } = {}
  ): Promise<PaginatedApiKeys> {
    try {
      const { page = 1, limit = 20 } = options

      let filteredKeys = Array.from(this.apiKeys.values())

      // Apply filters
      if (filters.name) {
        filteredKeys = filteredKeys.filter(key => 
          key.name.toLowerCase().includes(filters.name!.toLowerCase())
        )
      }

      if (filters.createdById) {
        filteredKeys = filteredKeys.filter(key => key.createdById === filters.createdById)
      }

      if (filters.tenantId) {
        filteredKeys = filteredKeys.filter(key => key.tenantId === filters.tenantId)
      }

      if (filters.isActive !== undefined) {
        filteredKeys = filteredKeys.filter(key => key.isActive === filters.isActive)
      }

      if (filters.scopes && filters.scopes.length > 0) {
        filteredKeys = filteredKeys.filter(key => 
          filters.scopes!.some(scope => key.scopes.includes(scope))
        )
      }

      if (filters.isExpired !== undefined) {
        const now = new Date()
        filteredKeys = filteredKeys.filter(key => {
          const isExpired = key.expiresAt ? key.expiresAt < now : false
          return filters.isExpired ? isExpired : !isExpired
        })
      }

      // Sort by creation date (newest first)
      filteredKeys.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

      // Apply pagination
      const total = filteredKeys.length
      const startIndex = (page - 1) * limit
      const paginatedKeys = filteredKeys.slice(startIndex, startIndex + limit)

      return {
        apiKeys: paginatedKeys,
        total,
        page,
        limit,
        hasNext: startIndex + limit < total,
        hasPrev: page > 1
      }
    } catch (error) {
      logger.error('Failed to get API keys:', error)
      throw ApiError.internal('Failed to retrieve API keys')
    }
  }

  /**
   * Get API key by ID
   */
  public async getApiKeyById(id: string): Promise<ApiKey> {
    try {
      const apiKey = this.apiKeys.get(id)
      if (!apiKey) {
        throw ApiError.notFound("API key not found")
      }
      return apiKey
    } catch (error) {
      logger.error('Failed to get API key:', error)
      throw error
    }
  }

  /**
   * Update API key
   */
  public async updateApiKey(
    id: string,
    updates: UpdateApiKeyRequest
  ): Promise<ApiKey> {
    try {
      const apiKey = await this.getApiKeyById(id)

      // Validate scopes if provided
      if (updates.scopes) {
        this.validateScopes(updates.scopes)
      }

      // Update fields
      if (updates.name !== undefined) apiKey.name = updates.name
      if (updates.scopes !== undefined) apiKey.scopes = updates.scopes
      if (updates.isActive !== undefined) apiKey.isActive = updates.isActive
      if (updates.expiresAt !== undefined) {
        apiKey.expiresAt = updates.expiresAt
      }

      apiKey.updatedAt = new Date()

      // Update in storage
      this.apiKeys.set(id, apiKey)

      logger.info(`API key updated: ${apiKey.name}`, {
        apiKeyId: id,
      })

      return apiKey
    } catch (error) {
      logger.error('Failed to update API key:', error)
      throw error
    }
  }

  /**
   * Delete API key
   */
  public async deleteApiKey(id: string): Promise<void> {
    try {
      const apiKey = await this.getApiKeyById(id)

      // Remove from storage
      this.apiKeys.delete(id)

      // Clean up local caches
      this.usageTracking.delete(id)
      this.rateLimitCache.delete(id)

      logger.info(`API key deleted: ${apiKey.name}`, {
        apiKeyId: id,
      })
    } catch (error) {
      logger.error('Failed to delete API key:', error)
      throw error
    }
  }

  /**
   * Validate API key and check permissions
   */
  public async validateApiKey(
    key: string,
    options: ApiKeyValidationOptions = {}
  ): Promise<ApiKeyValidationResult> {
    try {
      const {
        requiredScopes = [],
        ipAddress,
        checkRateLimit = true,
        updateUsage = true
      } = options

      // Find API key by checking hash
      let matchedApiKey: ApiKey | null = null

      for (const apiKey of this.apiKeys.values()) {
        const isMatch = await CryptoUtils.verifyApiKey(key, apiKey.key)
        if (isMatch) {
          matchedApiKey = apiKey
          break
        }
      }

      if (!matchedApiKey) {
        return {
          isValid: false,
          error: "Invalid API key",
        }
      }

      // Check if API key is active
      if (!matchedApiKey.isActive) {
        return {
          isValid: false,
          error: "API key is inactive",
        }
      }

      // Check expiration
      if (matchedApiKey.expiresAt && matchedApiKey.expiresAt < new Date()) {
        return {
          isValid: false,
          error: "API key has expired",
        }
      }

      // Check IP whitelist (placeholder for future implementation)
      if (ipAddress) {
        // IP whitelist functionality would be implemented here
        // For now, we'll skip this check
      }

      // Check rate limiting
      if (checkRateLimit) {
        const rateLimitResult = this.checkRateLimit(matchedApiKey)
        if (!rateLimitResult.allowed) {
          return {
            isValid: false,
            error: "Rate limit exceeded",
            rateLimitExceeded: true,
          }
        }
      }

      // Check required scopes
      if (requiredScopes.length > 0) {
        const hasRequiredScopes = requiredScopes.every(scope => 
          matchedApiKey!.scopes.includes(scope) || 
          matchedApiKey!.scopes.includes(ApiKeyScope.ADMIN)
        )

        if (!hasRequiredScopes) {
          return {
            isValid: false,
            error: "Insufficient permissions",
          }
        }
      }

      // Update usage statistics
      if (updateUsage) {
        await this.updateUsageStats(matchedApiKey)
      }

      return {
        isValid: true,
        apiKey: matchedApiKey,
      }
    } catch (error) {
      logger.error('Failed to validate API key:', error)
      return {
        isValid: false,
        error: "Validation error",
      }
    }
  }

  /**
   * Regenerate API key
   */
  public async regenerateApiKey(id: string): Promise<ApiKeyWithPlainKey> {
    try {
      const apiKey = await this.getApiKeyById(id)

      // Generate new key
      const plainKey = CryptoUtils.generateApiKey()
      const hashedKey = await CryptoUtils.hashApiKey(plainKey)

      // Update API key
      apiKey.key = hashedKey
      apiKey.updatedAt = new Date()
      apiKey.lastUsedAt = null

      // Update in storage
      this.apiKeys.set(id, apiKey)

      // Clear local caches
      this.usageTracking.delete(id)
      this.rateLimitCache.delete(id)

      logger.info(`API key regenerated: ${apiKey.name}`, {
        apiKeyId: id,
      })

      return { apiKey, plainKey }
    } catch (error) {
      logger.error('Failed to regenerate API key:', error)
      throw error
    }
  }

  /**
   * Track API key usage
   */
  public async trackUsage(
    apiKeyId: string,
    usage: Omit<ApiKeyUsageEntry, "id" | "apiKeyId" | "timestamp">
  ): Promise<void> {
    try {
      const usageRecord: ApiKeyUsageEntry = {
        id: CryptoUtils.generateSecureToken(16),
        apiKeyId,
        timestamp: new Date(),
        ...usage,
      }

      // Store usage record in memory
      if (!this.usageTracking.has(apiKeyId)) {
        this.usageTracking.set(apiKeyId, [])
      }
      this.usageTracking.get(apiKeyId)!.push(usageRecord)

      // Keep only last 1000 usage records per API key
      const records = this.usageTracking.get(apiKeyId)!
      if (records.length > 1000) {
        records.splice(0, records.length - 1000)
      }
    } catch (error) {
      logger.error('Failed to track API key usage:', error)
    }
  }

  /**
   * Get API key usage statistics
   */
  public async getUsageStats(
    apiKeyId: string,
    timeRange?: {
      start: Date
      end: Date
    }
  ): Promise<ApiKeyUsageStats> {
    try {
      const usageRecords = this.usageTracking.get(apiKeyId) || []

      // Filter by time range if provided
      const filteredRecords = timeRange
        ? usageRecords.filter(record => 
            record.timestamp >= timeRange.start && 
            record.timestamp <= timeRange.end
          )
        : usageRecords

      if (filteredRecords.length === 0) {
        return {
          totalRequests: 0,
          successfulRequests: 0,
          errorRequests: 0,
          averageResponseTime: 0,
          requestsByEndpoint: {},
          requestsByStatus: {},
          requestsOverTime: [],
        }
      }

      // Calculate statistics
      const totalRequests = filteredRecords.length
      const successfulRequests = filteredRecords.filter(r => r.statusCode < 400).length
      const errorRequests = totalRequests - successfulRequests
      const averageResponseTime = filteredRecords.reduce((sum, r) => sum + r.responseTime, 0) / totalRequests

      // Group by endpoint
      const requestsByEndpoint: Record<string, number> = {}
      filteredRecords.forEach(record => {
        const key = `${record.method} ${record.endpoint}`
        requestsByEndpoint[key] = (requestsByEndpoint[key] || 0) + 1
      })

      // Group by status code
      const requestsByStatus: Record<number, number> = {}
      filteredRecords.forEach(record => {
        requestsByStatus[record.statusCode] = (requestsByStatus[record.statusCode] || 0) + 1
      })

      // Group by date
      const requestsByDate: Record<string, number> = {}
      filteredRecords.forEach(record => {
        const date = record.timestamp.toISOString().split('T')[0]
        requestsByDate[date] = (requestsByDate[date] || 0) + 1
      })

      const requestsOverTime = Object.entries(requestsByDate)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date))

      return {
        totalRequests,
        successfulRequests,
        errorRequests,
        averageResponseTime: Math.round(averageResponseTime * 100) / 100,
        requestsByEndpoint,
        requestsByStatus,
        requestsOverTime,
      }
    } catch (error) {
      logger.error('Failed to get usage stats:', error)
      throw ApiError.internal('Failed to retrieve usage statistics')
    }
  }

  /**
   * Get API key analytics
   */
  public async getAnalytics(
    tenantId?: string,
    timeRange?: {
      start: Date
      end: Date
    }
  ): Promise<ApiKeyAnalytics> {
    try {
      let apiKeys = Array.from(this.apiKeys.values())

      // Filter by tenant
      if (tenantId) {
        apiKeys = apiKeys.filter(key => key.tenantId === tenantId)
      }

      const totalApiKeys = apiKeys.length
      const activeApiKeys = apiKeys.filter(key => key.isActive).length
      const expiredApiKeys = apiKeys.filter(key => 
        key.expiresAt && key.expiresAt < new Date()
      ).length

      // Calculate total requests
      let totalRequests = 0
      const apiKeyStats: Record<string, { requests: number; errors: number; lastUsed?: Date }> = {}

      for (const apiKey of apiKeys) {
        const usage = this.usageTracking.get(apiKey.id) || []
        const filteredUsage = timeRange
          ? usage.filter(u => u.timestamp >= timeRange.start && u.timestamp <= timeRange.end)
          : usage

        const requests = filteredUsage.length
        const errors = filteredUsage.filter(u => u.statusCode >= 400).length
        const lastUsed = filteredUsage.length > 0
          ? new Date(Math.max(...filteredUsage.map(u => u.timestamp.getTime())))
          : undefined

        totalRequests += requests
        apiKeyStats[apiKey.id] = { requests, errors, lastUsed }
      }

      // Top API keys by usage
      const topApiKeys = apiKeys
        .map(key => ({
          id: key.id,
          name: key.name,
          requests: apiKeyStats[key.id]?.requests || 0,
          lastUsed: apiKeyStats[key.id]?.lastUsed,
        }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 10)

      // Usage by scope
      const usageByScope: Record<string, number> = {}
      for (const apiKey of apiKeys) {
        const requests = apiKeyStats[apiKey.id]?.requests || 0
        for (const scope of apiKey.scopes) {
          usageByScope[scope] = (usageByScope[scope] || 0) + requests
        }
      }

      // Error rates
      const errorRates: Record<string, number> = {}
      for (const apiKey of apiKeys) {
        const stats = apiKeyStats[apiKey.id]
        if (stats && stats.requests > 0) {
          const errorRate = (stats.errors / stats.requests) * 100
          errorRates[apiKey.id] = Math.round(errorRate * 100) / 100
        }
      }

      return {
        totalApiKeys,
        activeApiKeys,
        expiredApiKeys,
        totalRequests,
        topApiKeys,
        usageByScope,
        errorRates,
      }
    } catch (error) {
      logger.error('Failed to get API key analytics:', error)
      throw ApiError.internal('Failed to retrieve analytics')
    }
  }

  /**
   * Cleanup expired API keys
   */
  public async cleanupExpiredKeys(): Promise<CleanupResult> {
    try {
      const now = new Date()
      const expiredKeys = Array.from(this.apiKeys.values()).filter(
        key => key.expiresAt && key.expiresAt < now
      )

      let deletedCount = 0
      const errors: string[] = []

      for (const key of expiredKeys) {
        try {
          this.apiKeys.delete(key.id)
          this.usageTracking.delete(key.id)
          this.rateLimitCache.delete(key.id)
          deletedCount++
        } catch (error) {
          errors.push(`Failed to delete key ${key.id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      logger.info(`Cleaned up ${deletedCount} expired API keys`)

      return {
        deletedCount,
        errors
      }
    } catch (error) {
      logger.error('Failed to cleanup expired keys:', error)
      return {
        deletedCount: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    }
  }

  /**
   * Get API key metrics
   */
  public async getMetrics(): Promise<ApiKeyMetrics> {
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const allKeys = Array.from(this.apiKeys.values())
      const todayKeys = allKeys.filter(key => key.createdAt >= today)

      const activeCount = allKeys.filter(key => key.isActive).length
      const expiredCount = allKeys.filter(key => 
        key.expiresAt && key.expiresAt < new Date()
      ).length

      // Calculate total usage
      let totalUsage = 0
      for (const [, records] of this.usageTracking.entries()) {
        totalUsage += records.length
      }

      const averageUsagePerKey = allKeys.length > 0 ? totalUsage / allKeys.length : 0

      // Top scopes
      const scopeCounts: Record<string, number> = {}
      for (const key of allKeys) {
        for (const scope of key.scopes) {
          scopeCounts[scope] = (scopeCounts[scope] || 0) + 1
        }
      }

      const topScopes = Object.entries(scopeCounts)
        .map(([scope, count]) => ({ scope: scope as ApiKeyScope, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)

      return {
        createdToday: todayKeys.length,
        activeCount,
        expiredCount,
        totalUsage,
        averageUsagePerKey: Math.round(averageUsagePerKey * 100) / 100,
        topScopes
      }
    } catch (error) {
      logger.error('Failed to get API key metrics:', error)
      throw ApiError.internal('Failed to retrieve metrics')
    }
  }

  /**
   * Validate scopes
   */
  private validateScopes(scopes: ApiKeyScope[]): void {
    if (!scopes || scopes.length === 0) {
      throw ApiError.badRequest("At least one scope is required")
    }

    const validScopes = Object.values(ApiKeyScope)
    for (const scope of scopes) {
      if (!validScopes.includes(scope)) {
        throw ApiError.badRequest(`Invalid scope: ${scope}`)
      }
    }
  }

  /**
   * Check rate limit for API key
   */
  private checkRateLimit(apiKey: ApiKey): { allowed: boolean; remaining: number; resetTime: Date } {
    // Default rate limit: 1000 requests per hour
    const defaultLimit = 1000
    const windowMs = 60 * 60 * 1000 // 1 hour

    const now = new Date()
    const cacheKey = apiKey.id
    let rateLimitData = this.rateLimitCache.get(cacheKey)

    // Reset if window has passed
    if (!rateLimitData || now >= rateLimitData.resetTime) {
      rateLimitData = {
        count: 0,
        resetTime: new Date(now.getTime() + windowMs),
      }
      this.rateLimitCache.set(cacheKey, rateLimitData)
    }

    // Check if limit exceeded
    if (rateLimitData.count >= defaultLimit) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: rateLimitData.resetTime,
      }
    }

    // Increment counter
    rateLimitData.count++
    this.rateLimitCache.set(cacheKey, rateLimitData)

    return {
      allowed: true,
      remaining: defaultLimit - rateLimitData.count,
      resetTime: rateLimitData.resetTime,
    }
  }

  /**
   * Update usage statistics for API key
   */
  private async updateUsageStats(apiKey: ApiKey): Promise<void> {
    try {
      // Update last used timestamp
      apiKey.lastUsedAt = new Date()
      this.apiKeys.set(apiKey.id, apiKey)
    } catch (error) {
      logger.error('Failed to update usage stats:', error)
      // Don't throw error as this is not critical
    }
  }

  /**
   * Check if IP is in CIDR range
   */
  private isIpInCidr(ip: string, cidr: string): boolean {
    return IpUtils.isIpInCidr(ip, cidr)
  }

  /**
   * Cleanup rate limit cache
   */
  private cleanupRateLimitCache(): void {
    const now = new Date()
    for (const [key, data] of this.rateLimitCache.entries()) {
      if (now >= data.resetTime) {
        this.rateLimitCache.delete(key)
      }
    }
  }

  /**
   * Cleanup usage tracking data
   */
  private cleanupUsageTracking(): void {
    const cutoffTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days ago
    
    for (const [apiKeyId, records] of this.usageTracking.entries()) {
      const filteredRecords = records.filter(record => record.timestamp > cutoffTime)
      if (filteredRecords.length === 0) {
        this.usageTracking.delete(apiKeyId)
      } else {
        this.usageTracking.set(apiKeyId, filteredRecords)
      }
    }
  }
}
