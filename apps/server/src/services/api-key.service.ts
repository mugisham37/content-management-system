import crypto from "crypto"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"

export enum ApiKeyScope {
  READ = "read",
  WRITE = "write",
  DELETE = "delete",
  ADMIN = "admin",
  CONTENT_READ = "content:read",
  CONTENT_WRITE = "content:write",
  CONTENT_DELETE = "content:delete",
  MEDIA_READ = "media:read",
  MEDIA_WRITE = "media:write",
  MEDIA_DELETE = "media:delete",
  USER_READ = "user:read",
  USER_WRITE = "user:write",
  USER_DELETE = "user:delete",
  ANALYTICS_READ = "analytics:read",
  WEBHOOK_READ = "webhook:read",
  WEBHOOK_WRITE = "webhook:write",
  WORKFLOW_READ = "workflow:read",
  WORKFLOW_WRITE = "workflow:write",
  SYSTEM_READ = "system:read",
  SYSTEM_WRITE = "system:write",
}

export interface ApiKey {
  id: string
  name: string
  key: string
  hashedKey: string
  scopes: ApiKeyScope[]
  isActive: boolean
  expiresAt?: Date
  lastUsedAt?: Date
  usageCount: number
  rateLimit?: {
    limit: number
    window: number
    remaining: number
    resetTime: Date
  }
  ipWhitelist?: string[]
  metadata?: Record<string, any>
  createdBy: string
  tenantId?: string
  createdAt: Date
  updatedAt: Date
}

export interface ApiKeyUsage {
  id: string
  apiKeyId: string
  endpoint: string
  method: string
  statusCode: number
  responseTime: number
  ipAddress: string
  userAgent: string
  timestamp: Date
  requestSize: number
  responseSize: number
  error?: string
}

export interface CreateApiKeyRequest {
  name: string
  scopes: ApiKeyScope[]
  expiresAt?: Date
  rateLimit?: {
    limit: number
    window: number
  }
  ipWhitelist?: string[]
  metadata?: Record<string, any>
  tenantId?: string
}

export interface UpdateApiKeyRequest {
  name?: string
  scopes?: ApiKeyScope[]
  isActive?: boolean
  expiresAt?: Date | null
  rateLimit?: {
    limit: number
    window: number
  }
  ipWhitelist?: string[]
  metadata?: Record<string, any>
}

export interface ApiKeyValidationResult {
  isValid: boolean
  apiKey?: ApiKey
  error?: string
  rateLimitExceeded?: boolean
  ipBlocked?: boolean
}

export class ApiKeyService {
  private apiKeys: Map<string, ApiKey> = new Map()
  private usageTracking: Map<string, ApiKeyUsage[]> = new Map()
  private rateLimitCache: Map<string, { count: number; resetTime: Date }> = new Map()

  constructor() {
    // Initialize cleanup intervals
    this.startCleanupTasks()
  }

  /**
   * Generate a new API key
   */
  private generateApiKey(): string {
    return `ak_${crypto.randomBytes(32).toString("hex")}`
  }

  /**
   * Hash API key for secure storage
   */
  private hashApiKey(key: string): string {
    return crypto.createHash("sha256").update(key).digest("hex")
  }

  /**
   * Create a new API key
   */
  public async createApiKey(
    request: CreateApiKeyRequest,
    createdBy: string
  ): Promise<{ apiKey: ApiKey; plainKey: string }> {
    try {
      // Validate scopes
      this.validateScopes(request.scopes)

      // Check if API key with the same name already exists for this tenant
      const existingKey = Array.from(this.apiKeys.values()).find(
        key => key.name === request.name && 
               key.tenantId === request.tenantId &&
               key.createdBy === createdBy
      )

      if (existingKey) {
        throw ApiError.conflict(`API key with name '${request.name}' already exists`)
      }

      // Generate API key
      const plainKey = this.generateApiKey()
      const hashedKey = this.hashApiKey(plainKey)

      const apiKey: ApiKey = {
        id: crypto.randomUUID(),
        name: request.name,
        key: plainKey.substring(0, 8) + "..." + plainKey.substring(plainKey.length - 4), // Masked version
        hashedKey,
        scopes: request.scopes,
        isActive: true,
        expiresAt: request.expiresAt,
        usageCount: 0,
        rateLimit: request.rateLimit ? {
          ...request.rateLimit,
          remaining: request.rateLimit.limit,
          resetTime: new Date(Date.now() + request.rateLimit.window),
        } : undefined,
        ipWhitelist: request.ipWhitelist,
        metadata: request.metadata,
        createdBy,
        tenantId: request.tenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Store in memory (in real implementation, this would be stored in database)
      this.apiKeys.set(apiKey.id, apiKey)

      logger.info(`API key created: ${apiKey.name}`, {
        apiKeyId: apiKey.id,
        createdBy,
        scopes: apiKey.scopes,
      })

      // Return API key with the plain text key (only time it's accessible)
      return { apiKey, plainKey }
    } catch (error) {
      logger.error("Failed to create API key:", error)
      throw error
    }
  }

  /**
   * Get all API keys for a user/tenant
   */
  public async getAllApiKeys(
    createdBy?: string,
    tenantId?: string,
    options: {
      includeInactive?: boolean
      page?: number
      limit?: number
    } = {}
  ): Promise<{
    apiKeys: ApiKey[]
    total: number
    page: number
    limit: number
  }> {
    try {
      const { includeInactive = false, page = 1, limit = 20 } = options

      let filteredKeys = Array.from(this.apiKeys.values())

      // Filter by creator
      if (createdBy) {
        filteredKeys = filteredKeys.filter(key => key.createdBy === createdBy)
      }

      // Filter by tenant
      if (tenantId) {
        filteredKeys = filteredKeys.filter(key => key.tenantId === tenantId)
      }

      // Filter by active status
      if (!includeInactive) {
        filteredKeys = filteredKeys.filter(key => key.isActive)
      }

      // Sort by creation date (newest first)
      filteredKeys.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

      // Paginate
      const total = filteredKeys.length
      const startIndex = (page - 1) * limit
      const paginatedKeys = filteredKeys.slice(startIndex, startIndex + limit)

      return {
        apiKeys: paginatedKeys,
        total,
        page,
        limit,
      }
    } catch (error) {
      logger.error("Failed to get API keys:", error)
      throw ApiError.internal("Failed to retrieve API keys")
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
      logger.error("Failed to get API key:", error)
      throw error
    }
  }

  /**
   * Update API key
   */
  public async updateApiKey(
    id: string,
    updates: UpdateApiKeyRequest,
    updatedBy: string
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
        apiKey.expiresAt = updates.expiresAt === null ? undefined : updates.expiresAt
      }
      if (updates.rateLimit !== undefined) {
        apiKey.rateLimit = updates.rateLimit ? {
          ...updates.rateLimit,
          remaining: updates.rateLimit.limit,
          resetTime: new Date(Date.now() + updates.rateLimit.window),
        } : undefined
      }
      if (updates.ipWhitelist !== undefined) apiKey.ipWhitelist = updates.ipWhitelist
      if (updates.metadata !== undefined) apiKey.metadata = updates.metadata

      apiKey.updatedAt = new Date()

      // Update in storage
      this.apiKeys.set(id, apiKey)

      logger.info(`API key updated: ${apiKey.name}`, {
        apiKeyId: id,
        updatedBy,
      })

      return apiKey
    } catch (error) {
      logger.error("Failed to update API key:", error)
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

      // Clean up usage tracking
      this.usageTracking.delete(id)

      // Clean up rate limit cache
      this.rateLimitCache.delete(id)

      logger.info(`API key deleted: ${apiKey.name}`, {
        apiKeyId: id,
      })
    } catch (error) {
      logger.error("Failed to delete API key:", error)
      throw error
    }
  }

  /**
   * Validate API key and check permissions
   */
  public async validateApiKey(
    key: string,
    requiredScopes?: ApiKeyScope[],
    ipAddress?: string
  ): Promise<ApiKeyValidationResult> {
    try {
      const hashedKey = this.hashApiKey(key)

      // Find API key by hashed key
      const apiKey = Array.from(this.apiKeys.values()).find(
        k => k.hashedKey === hashedKey
      )

      if (!apiKey) {
        return {
          isValid: false,
          error: "Invalid API key",
        }
      }

      // Check if API key is active
      if (!apiKey.isActive) {
        return {
          isValid: false,
          error: "API key is inactive",
        }
      }

      // Check expiration
      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        return {
          isValid: false,
          error: "API key has expired",
        }
      }

      // Check IP whitelist
      if (apiKey.ipWhitelist && ipAddress) {
        const isIpAllowed = apiKey.ipWhitelist.some(allowedIp => {
          if (allowedIp.includes("/")) {
            // CIDR notation support
            return this.isIpInCidr(ipAddress, allowedIp)
          }
          return allowedIp === ipAddress
        })

        if (!isIpAllowed) {
          return {
            isValid: false,
            error: "IP address not allowed",
            ipBlocked: true,
          }
        }
      }

      // Check rate limiting
      if (apiKey.rateLimit) {
        const rateLimitResult = this.checkRateLimit(apiKey)
        if (!rateLimitResult.allowed) {
          return {
            isValid: false,
            error: "Rate limit exceeded",
            rateLimitExceeded: true,
          }
        }
      }

      // Check required scopes
      if (requiredScopes && requiredScopes.length > 0) {
        const hasRequiredScopes = requiredScopes.every(scope => 
          apiKey.scopes.includes(scope) || 
          apiKey.scopes.includes(ApiKeyScope.ADMIN)
        )

        if (!hasRequiredScopes) {
          return {
            isValid: false,
            error: "Insufficient permissions",
          }
        }
      }

      // Update usage statistics
      await this.updateUsageStats(apiKey)

      return {
        isValid: true,
        apiKey,
      }
    } catch (error) {
      logger.error("Failed to validate API key:", error)
      return {
        isValid: false,
        error: "Validation error",
      }
    }
  }

  /**
   * Regenerate API key
   */
  public async regenerateApiKey(id: string): Promise<{ apiKey: ApiKey; plainKey: string }> {
    try {
      const apiKey = await this.getApiKeyById(id)

      // Generate new key
      const plainKey = this.generateApiKey()
      const hashedKey = this.hashApiKey(plainKey)

      // Update API key
      apiKey.key = plainKey.substring(0, 8) + "..." + plainKey.substring(plainKey.length - 4)
      apiKey.hashedKey = hashedKey
      apiKey.updatedAt = new Date()
      apiKey.lastUsedAt = undefined
      apiKey.usageCount = 0

      // Reset rate limit
      if (apiKey.rateLimit) {
        apiKey.rateLimit.remaining = apiKey.rateLimit.limit
        apiKey.rateLimit.resetTime = new Date(Date.now() + apiKey.rateLimit.window)
      }

      // Update in storage
      this.apiKeys.set(id, apiKey)

      // Clear usage tracking
      this.usageTracking.delete(id)
      this.rateLimitCache.delete(id)

      logger.info(`API key regenerated: ${apiKey.name}`, {
        apiKeyId: id,
      })

      return { apiKey, plainKey }
    } catch (error) {
      logger.error("Failed to regenerate API key:", error)
      throw error
    }
  }

  /**
   * Track API key usage
   */
  public async trackUsage(
    apiKeyId: string,
    usage: Omit<ApiKeyUsage, "id" | "apiKeyId" | "timestamp">
  ): Promise<void> {
    try {
      const usageRecord: ApiKeyUsage = {
        id: crypto.randomUUID(),
        apiKeyId,
        timestamp: new Date(),
        ...usage,
      }

      // Store usage record
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
      logger.error("Failed to track API key usage:", error)
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
  ): Promise<{
    totalRequests: number
    successfulRequests: number
    errorRequests: number
    averageResponseTime: number
    requestsByEndpoint: Record<string, number>
    requestsByStatus: Record<number, number>
    requestsOverTime: Array<{ date: string; count: number }>
  }> {
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
      logger.error("Failed to get usage stats:", error)
      throw ApiError.internal("Failed to retrieve usage statistics")
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
  ): Promise<{
    totalApiKeys: number
    activeApiKeys: number
    expiredApiKeys: number
    totalRequests: number
    topApiKeys: Array<{
      id: string
      name: string
      requests: number
      lastUsed?: Date
    }>
    usageByScope: Record<string, number>
    errorRates: Record<string, number>
  }> {
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
      logger.error("Failed to get API key analytics:", error)
      throw ApiError.internal("Failed to retrieve analytics")
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
   * Check rate limit
   */
  private checkRateLimit(apiKey: ApiKey): { allowed: boolean; remaining: number; resetTime: Date } {
    if (!apiKey.rateLimit) {
      return { allowed: true, remaining: Infinity, resetTime: new Date() }
    }

    const now = new Date()
    const cacheKey = apiKey.id
    let rateLimitData = this.rateLimitCache.get(cacheKey)

    // Reset if window has passed
    if (!rateLimitData || now >= rateLimitData.resetTime) {
      rateLimitData = {
        count: 0,
        resetTime: new Date(now.getTime()
