// =============================================================================
// UTILITIES INDEX
// =============================================================================

// Error handling utilities
export * from './errors'
export { default as ErrorUtils } from './errors'

// Helper utilities
export * from './helpers'
export { default as helpers } from './helpers'

// Logger utilities
export * from './logger'
export { default as logger } from './logger'

// Swagger documentation utilities
export * from './swagger'
export { default as swagger } from './swagger'

// Import for internal use
import {
  ApiError,
  ValidationError,
  DatabaseError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  TenantError,
  ContentTypeError,
  WorkflowError,
  MediaError,
  PluginError,
  WebhookError,
  createContextualError,
} from './errors'

import {
  parsePaginationParams,
  createPaginationMeta,
  slugify,
  generateUniqueSlug,
  truncateString,
  toTitleCase,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  isValidEmail,
  isValidUrl,
  isValidUUID,
  isValidPhoneNumber,
  validatePasswordStrength,
  getClientIp,
  getUserAgent,
  formatFileSize,
  getFileExtension,
  getMimeTypeFromExtension,
  isAllowedFileType,
  generateRandomString,
  generateRandomAlphanumeric,
  generateRandomNumeric,
  generateSecureToken,
  deepMerge,
  isObject,
  deepClone,
  pick,
  omit,
  sanitizeForLogging,
  parseBoolean,
  parseInteger,
  parseFloat,
  getDateRangeFromPeriod,
  formatDateToISO,
  addDays,
  addHours,
  isDateInPast,
  isDateInFuture,
  removeDuplicates,
  chunkArray,
  shuffleArray,
  getRandomItem,
  sleep,
  retryWithBackoff,
  promiseAllWithLimit,
  MemoryCache,
} from './helpers'

import { Logger } from './logger'

// =============================================================================
// UTILITY COLLECTIONS
// =============================================================================

/**
 * Collection of all error classes for easy access
 */
export const ErrorClasses = {
  ApiError,
  ValidationError,
  DatabaseError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  TenantError,
  ContentTypeError,
  WorkflowError,
  MediaError,
  PluginError,
  WebhookError,
}

/**
 * Collection of validation utilities
 */
export const ValidationUtils = {
  isValidEmail,
  isValidUrl,
  isValidUUID,
  isValidPhoneNumber,
  validatePasswordStrength,
}

/**
 * Collection of string manipulation utilities
 */
export const StringUtils = {
  slugify,
  generateUniqueSlug,
  truncateString,
  toTitleCase,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
}

/**
 * Collection of date utilities
 */
export const DateUtils = {
  getDateRangeFromPeriod,
  formatDateToISO,
  addDays,
  addHours,
  isDateInPast,
  isDateInFuture,
}

/**
 * Collection of array utilities
 */
export const ArrayUtils = {
  removeDuplicates,
  chunkArray,
  shuffleArray,
  getRandomItem,
}

/**
 * Collection of async utilities
 */
export const AsyncUtils = {
  sleep,
  retryWithBackoff,
  promiseAllWithLimit,
}

/**
 * Collection of file utilities
 */
export const FileUtils = {
  formatFileSize,
  getFileExtension,
  getMimeTypeFromExtension,
  isAllowedFileType,
}

/**
 * Collection of random generation utilities
 */
export const RandomUtils = {
  generateRandomString,
  generateRandomAlphanumeric,
  generateRandomNumeric,
  generateSecureToken,
}

/**
 * Collection of object manipulation utilities
 */
export const ObjectUtils = {
  deepMerge,
  isObject,
  deepClone,
  pick,
  omit,
  sanitizeForLogging,
}

/**
 * Collection of type conversion utilities
 */
export const TypeUtils = {
  parseBoolean,
  parseInteger,
  parseFloat,
}

// =============================================================================
// UTILITY FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a contextual error with tenant and user information
 */
export const createTenantError = (
  statusCode: number,
  message: string,
  tenantId: string,
  userId?: string,
  code?: string,
  details?: any
) => {
  return createContextualError(statusCode, message, {
    tenantId,
    userId,
    code,
    details,
  })
}

/**
 * Create a validation error with field details
 */
export const createFieldValidationError = (
  field: string,
  message: string,
  value?: any
) => {
  return new ValidationError(`Validation failed for field '${field}': ${message}`, {
    field,
    value,
    message,
  })
}

/**
 * Create a paginated response structure
 */
export const createPaginatedResponse = <T>(
  data: T[],
  page: number,
  limit: number,
  total: number,
  message?: string
) => {
  const pagination = createPaginationMeta(page, limit, total)
  
  return {
    success: true,
    data,
    pagination,
    message: message || 'Data retrieved successfully',
    timestamp: new Date().toISOString(),
  }
}

/**
 * Create a success response structure
 */
export const createSuccessResponse = <T>(
  data: T,
  message?: string
) => {
  return {
    success: true,
    data,
    message: message || 'Operation completed successfully',
    timestamp: new Date().toISOString(),
  }
}

/**
 * Create a cache key with tenant isolation
 */
export const createTenantCacheKey = (
  tenantId: string,
  resource: string,
  identifier?: string
) => {
  const parts = ['tenant', tenantId, resource]
  if (identifier) {
    parts.push(identifier)
  }
  return parts.join(':')
}

/**
 * Create a unique identifier for requests
 */
export const createRequestId = () => {
  return `req_${Date.now()}_${generateRandomAlphanumeric(8)}`
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Common HTTP status codes
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const

/**
 * Common error codes
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  TENANT_ERROR: 'TENANT_ERROR',
  CONTENT_TYPE_ERROR: 'CONTENT_TYPE_ERROR',
  WORKFLOW_ERROR: 'WORKFLOW_ERROR',
  MEDIA_ERROR: 'MEDIA_ERROR',
  PLUGIN_ERROR: 'PLUGIN_ERROR',
  WEBHOOK_ERROR: 'WEBHOOK_ERROR',
} as const

/**
 * Common MIME types
 */
export const MIME_TYPES = {
  JSON: 'application/json',
  XML: 'application/xml',
  HTML: 'text/html',
  CSS: 'text/css',
  JAVASCRIPT: 'application/javascript',
  PDF: 'application/pdf',
  ZIP: 'application/zip',
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  GIF: 'image/gif',
  SVG: 'image/svg+xml',
  MP4: 'video/mp4',
  MP3: 'audio/mpeg',
  TEXT: 'text/plain',
} as const

/**
 * File size limits
 */
export const FILE_SIZE_LIMITS = {
  AVATAR: 2 * 1024 * 1024, // 2MB
  IMAGE: 10 * 1024 * 1024, // 10MB
  VIDEO: 100 * 1024 * 1024, // 100MB
  DOCUMENT: 50 * 1024 * 1024, // 50MB
  GENERAL: 25 * 1024 * 1024, // 25MB
} as const

/**
 * Cache TTL values (in milliseconds)
 */
export const CACHE_TTL = {
  SHORT: 5 * 60 * 1000, // 5 minutes
  MEDIUM: 30 * 60 * 1000, // 30 minutes
  LONG: 2 * 60 * 60 * 1000, // 2 hours
  VERY_LONG: 24 * 60 * 60 * 1000, // 24 hours
} as const

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export type PaginationParams = {
  page: number
  limit: number
  offset: number
}

export type PaginationMeta = {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
  nextPage: number | null
  prevPage: number | null
}

export type SuccessResponse<T = any> = {
  success: true
  data: T
  message?: string
  timestamp: string
}

export type PaginatedResponse<T = any> = {
  success: true
  data: T[]
  pagination: PaginationMeta
  message?: string
  timestamp: string
}

export type ErrorResponse = {
  success: false
  error: {
    message: string
    code?: string
    statusCode: number
    details?: any
    stack?: string
    timestamp: string
    path?: string
    method?: string
    tenantId?: string
    userId?: string
    requestId?: string
  }
}

export type UserAgent = {
  userAgent: string
  browser?: string
  os?: string
  device?: string
}

export type PasswordStrength = {
  isValid: boolean
  score: number
  feedback: string[]
}

// =============================================================================
// ADVANCED UTILITY CLASSES
// =============================================================================

/**
 * Rate limiter utility for API endpoints
 */
export class RateLimiter {
  private requests = new Map<string, { count: number; resetTime: number }>()
  
  constructor(
    private maxRequests: number = 100,
    private windowMs: number = 15 * 60 * 1000 // 15 minutes
  ) {}

  isAllowed(identifier: string): boolean {
    const now = Date.now()
    const record = this.requests.get(identifier)

    if (!record || now > record.resetTime) {
      this.requests.set(identifier, {
        count: 1,
        resetTime: now + this.windowMs
      })
      return true
    }

    if (record.count >= this.maxRequests) {
      return false
    }

    record.count++
    return true
  }

  getRemainingRequests(identifier: string): number {
    const record = this.requests.get(identifier)
    if (!record || Date.now() > record.resetTime) {
      return this.maxRequests
    }
    return Math.max(0, this.maxRequests - record.count)
  }

  getResetTime(identifier: string): number {
    const record = this.requests.get(identifier)
    return record?.resetTime || Date.now()
  }

  cleanup(): void {
    const now = Date.now()
    for (const [key, record] of this.requests.entries()) {
      if (now > record.resetTime) {
        this.requests.delete(key)
      }
    }
  }
}

/**
 * Circuit breaker utility for external service calls
 */
export class CircuitBreaker {
  private failures = 0
  private lastFailureTime = 0
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'

  constructor(
    private threshold: number = 5,
    private timeout: number = 60000, // 1 minute
    private resetTimeout: number = 30000 // 30 seconds
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'HALF_OPEN'
      } else {
        throw new Error('Circuit breaker is OPEN')
      }
    }

    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), this.timeout)
        )
      ])

      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess(): void {
    this.failures = 0
    this.state = 'CLOSED'
  }

  private onFailure(): void {
    this.failures++
    this.lastFailureTime = Date.now()

    if (this.failures >= this.threshold) {
      this.state = 'OPEN'
    }
  }

  getState(): string {
    return this.state
  }

  getFailureCount(): number {
    return this.failures
  }
}

/**
 * Event emitter utility for internal events
 */
export class EventEmitter {
  private events = new Map<string, Function[]>()

  on(event: string, listener: Function): void {
    if (!this.events.has(event)) {
      this.events.set(event, [])
    }
    this.events.get(event)!.push(listener)
  }

  off(event: string, listener: Function): void {
    const listeners = this.events.get(event)
    if (listeners) {
      const index = listeners.indexOf(listener)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }

  emit(event: string, ...args: any[]): void {
    const listeners = this.events.get(event)
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(...args)
        } catch (error) {
          Logger.error(`Error in event listener for ${event}`, { error })
        }
      })
    }
  }

  once(event: string, listener: Function): void {
    const onceWrapper = (...args: any[]) => {
      this.off(event, onceWrapper)
      listener(...args)
    }
    this.on(event, onceWrapper)
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event)
    } else {
      this.events.clear()
    }
  }

  listenerCount(event: string): number {
    return this.events.get(event)?.length || 0
  }
}

/**
 * Performance monitor utility
 */
export class PerformanceMonitor {
  private metrics = new Map<string, { 
    count: number
    totalTime: number
    minTime: number
    maxTime: number
    avgTime: number
  }>()

  startTimer(operation: string): () => void {
    const startTime = Date.now()
    
    return () => {
      const duration = Date.now() - startTime
      this.recordMetric(operation, duration)
    }
  }

  async measure<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const endTimer = this.startTimer(operation)
    try {
      const result = await fn()
      endTimer()
      return result
    } catch (error) {
      endTimer()
      throw error
    }
  }

  private recordMetric(operation: string, duration: number): void {
    const existing = this.metrics.get(operation)
    
    if (!existing) {
      this.metrics.set(operation, {
        count: 1,
        totalTime: duration,
        minTime: duration,
        maxTime: duration,
        avgTime: duration
      })
    } else {
      existing.count++
      existing.totalTime += duration
      existing.minTime = Math.min(existing.minTime, duration)
      existing.maxTime = Math.max(existing.maxTime, duration)
      existing.avgTime = existing.totalTime / existing.count
    }
  }

  getMetrics(operation?: string): any {
    if (operation) {
      return this.metrics.get(operation)
    }
    return Object.fromEntries(this.metrics)
  }

  reset(operation?: string): void {
    if (operation) {
      this.metrics.delete(operation)
    } else {
      this.metrics.clear()
    }
  }
}

// =============================================================================
// DEFAULT EXPORT
// =============================================================================

export default {
  // Error utilities
  ErrorClasses,
  createTenantError,
  createFieldValidationError,
  
  // Response utilities
  createPaginatedResponse,
  createSuccessResponse,
  
  // Cache utilities
  createTenantCacheKey,
  MemoryCache,
  
  // Request utilities
  createRequestId,
  
  // Validation utilities
  ValidationUtils,
  
  // String utilities
  StringUtils,
  
  // Date utilities
  DateUtils,
  
  // Array utilities
  ArrayUtils,
  
  // Async utilities
  AsyncUtils,
  
  // File utilities
  FileUtils,
  
  // Random utilities
  RandomUtils,
  
  // Object utilities
  ObjectUtils,
  
  // Type utilities
  TypeUtils,
  
  // Advanced utilities
  RateLimiter,
  CircuitBreaker,
  EventEmitter,
  PerformanceMonitor,
  
  // Constants
  HTTP_STATUS,
  ERROR_CODES,
  MIME_TYPES,
  FILE_SIZE_LIMITS,
  CACHE_TTL,
  
  // Logger
  Logger,
}
