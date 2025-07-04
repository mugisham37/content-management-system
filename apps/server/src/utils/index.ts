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
  
  // Constants
  HTTP_STATUS,
  ERROR_CODES,
  MIME_TYPES,
  FILE_SIZE_LIMITS,
  CACHE_TTL,
  
  // Logger
  Logger,
}
