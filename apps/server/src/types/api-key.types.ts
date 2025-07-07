// =============================================================================
// API KEY TYPE DEFINITIONS
// =============================================================================

// Define types locally (will be replaced with Prisma types once properly configured)
export enum ApiKeyScope {
  READ = "READ",
  WRITE = "WRITE",
  ADMIN = "ADMIN"
}

export interface ApiKey {
  id: string
  name: string
  key: string
  scopes: ApiKeyScope[]
  expiresAt: Date | null
  lastUsedAt: Date | null
  isActive: boolean
  createdById: string
  tenantId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateApiKeyRequest {
  name: string
  scopes: ApiKeyScope[]
  expiresAt?: Date
  tenantId?: string
}

export interface UpdateApiKeyRequest {
  name?: string
  scopes?: ApiKeyScope[]
  isActive?: boolean
  expiresAt?: Date | null
}

export interface ApiKeyValidationResult {
  isValid: boolean
  apiKey?: ApiKey
  error?: string
  rateLimitExceeded?: boolean
  ipBlocked?: boolean
}

export interface ApiKeyUsageStats {
  totalRequests: number
  successfulRequests: number
  errorRequests: number
  averageResponseTime: number
  requestsByEndpoint: Record<string, number>
  requestsByStatus: Record<number, number>
  requestsOverTime: Array<{ date: string; count: number }>
}

export interface ApiKeyAnalytics {
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
}

export interface RateLimitInfo {
  limit: number
  remaining: number
  resetTime: Date
  windowMs: number
}

export interface ApiKeyWithPlainKey {
  apiKey: ApiKey
  plainKey: string
}

export interface ApiKeyFilters {
  name?: string
  scopes?: ApiKeyScope[]
  isActive?: boolean
  isExpired?: boolean
  createdById?: string
  tenantId?: string
  search?: string
  dateFrom?: Date
  dateTo?: Date
}

export interface PaginatedApiKeys {
  apiKeys: ApiKey[]
  total: number
  page: number
  limit: number
  hasNext: boolean
  hasPrev: boolean
}

export interface ApiKeyUsageEntry {
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

export interface CleanupResult {
  deletedCount: number
  errors: string[]
}

export interface ApiKeyValidationOptions {
  requiredScopes?: ApiKeyScope[]
  ipAddress?: string
  checkRateLimit?: boolean
  updateUsage?: boolean
}

export interface RateLimitConfig {
  windowMs: number
  maxRequests: number
  skipSuccessfulRequests?: boolean
  skipFailedRequests?: boolean
}

export interface ApiKeyMetrics {
  createdToday: number
  activeCount: number
  expiredCount: number
  totalUsage: number
  averageUsagePerKey: number
  topScopes: Array<{ scope: ApiKeyScope; count: number }>
}
