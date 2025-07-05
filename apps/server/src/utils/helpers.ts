// =============================================================================
// HELPER UTILITIES
// =============================================================================

import type { Request } from "express"
import { ApiError } from "./errors"
import { config } from "../config"
import { isObject as isObjectTypeGuard, isMergeable, isCloneable, type ObjectLike } from "./typeGuards"

// =============================================================================
// PAGINATION UTILITIES
// =============================================================================

/**
 * Parse pagination parameters from request query with enhanced validation
 */
export const parsePaginationParams = (query: any, maxLimit = 100): { page: number; limit: number; offset: number } => {
  const page = query.page ? Number.parseInt(query.page as string, 10) : 1
  const limit = query.limit ? Number.parseInt(query.limit as string, 10) : config.pagination.defaultLimit

  // Validate pagination parameters
  if (page < 1) {
    throw ApiError.badRequest("Page number must be greater than 0")
  }

  if (limit < 1) {
    throw ApiError.badRequest("Limit must be greater than 0")
  }

  if (limit > maxLimit) {
    throw ApiError.badRequest(`Limit cannot exceed ${maxLimit}`)
  }

  const validatedPage = page > 0 ? page : 1
  const validatedLimit = limit > 0 && limit <= maxLimit ? limit : config.pagination.defaultLimit
  const offset = (validatedPage - 1) * validatedLimit

  return {
    page: validatedPage,
    limit: validatedLimit,
    offset
  }
}

/**
 * Create pagination metadata
 */
export const createPaginationMeta = (
  page: number,
  limit: number,
  total: number
) => {
  const totalPages = Math.ceil(total / limit)
  
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    nextPage: page < totalPages ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null
  }
}

// =============================================================================
// STRING UTILITIES
// =============================================================================

/**
 * Generate a slug from a string with enhanced options
 */
export const slugify = (text: string, options: { 
  maxLength?: number
  separator?: string
  lowercase?: boolean
} = {}): string => {
  const { maxLength = 100, separator = "-", lowercase = true } = options
  
  let slug = text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .trim()
    .replace(/\s+/g, separator) // Replace spaces with separator
    .replace(new RegExp(`\\${separator}+`, 'g'), separator) // Replace multiple separators with single
    .replace(new RegExp(`^\\${separator}+`), '') // Trim separator from start
    .replace(new RegExp(`\\${separator}+$`), '') // Trim separator from end

  if (lowercase) {
    slug = slug.toLowerCase()
  }

  if (maxLength && slug.length > maxLength) {
    slug = slug.substring(0, maxLength).replace(new RegExp(`\\${separator}+$`), '')
  }

  return slug
}

/**
 * Generate a unique slug by appending a number if needed
 */
export const generateUniqueSlug = async (
  baseSlug: string,
  checkExists: (slug: string) => Promise<boolean>,
  maxAttempts = 100
): Promise<string> => {
  let slug = baseSlug
  let counter = 1

  while (counter <= maxAttempts) {
    const exists = await checkExists(slug)
    if (!exists) {
      return slug
    }
    slug = `${baseSlug}-${counter}`
    counter++
  }

  throw ApiError.internal(`Could not generate unique slug after ${maxAttempts} attempts`)
}

/**
 * Truncate string to a maximum length with ellipsis
 */
export const truncateString = (str: string, maxLength: number, ellipsis = "..."): string => {
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength - ellipsis.length) + ellipsis
}

/**
 * Convert string to title case
 */
export const toTitleCase = (str: string): string => {
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase())
}

/**
 * Convert string to camelCase
 */
export const toCamelCase = (str: string): string => {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => {
      return index === 0 ? word.toLowerCase() : word.toUpperCase()
    })
    .replace(/\s+/g, '')
}

/**
 * Convert string to PascalCase
 */
export const toPascalCase = (str: string): string => {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word) => word.toUpperCase())
    .replace(/\s+/g, '')
}

/**
 * Convert string to snake_case
 */
export const toSnakeCase = (str: string): string => {
  return str
    .replace(/\W+/g, ' ')
    .split(/ |\B(?=[A-Z])/)
    .map(word => word.toLowerCase())
    .join('_')
}

// =============================================================================
// VALIDATION UTILITIES
// =============================================================================

/**
 * Validate email format with enhanced regex
 */
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
  return emailRegex.test(email)
}

/**
 * Validate URL format
 */
export const isValidUrl = (url: string): boolean => {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * Validate UUID format
 */
export const isValidUUID = (uuid: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}

/**
 * Validate phone number (basic international format)
 */
export const isValidPhoneNumber = (phone: string): boolean => {
  const phoneRegex = /^\+?[1-9]\d{1,14}$/
  return phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''))
}

/**
 * Validate password strength
 */
export const validatePasswordStrength = (password: string): {
  isValid: boolean
  score: number
  feedback: string[]
} => {
  const feedback: string[] = []
  let score = 0

  if (password.length >= 8) {
    score += 1
  } else {
    feedback.push('Password must be at least 8 characters long')
  }

  if (/[a-z]/.test(password)) {
    score += 1
  } else {
    feedback.push('Password must contain at least one lowercase letter')
  }

  if (/[A-Z]/.test(password)) {
    score += 1
  } else {
    feedback.push('Password must contain at least one uppercase letter')
  }

  if (/\d/.test(password)) {
    score += 1
  } else {
    feedback.push('Password must contain at least one number')
  }

  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    score += 1
  } else {
    feedback.push('Password must contain at least one special character')
  }

  return {
    isValid: score >= 4,
    score,
    feedback
  }
}

// =============================================================================
// REQUEST UTILITIES
// =============================================================================

/**
 * Get client IP address from request with proxy support
 */
export const getClientIp = (req: Request): string => {
  const forwardedFor = req.headers["x-forwarded-for"]
  const realIp = req.headers["x-real-ip"]
  const cfConnectingIp = req.headers["cf-connecting-ip"]

  if (cfConnectingIp && typeof cfConnectingIp === 'string') {
    return cfConnectingIp
  }

  if (realIp && typeof realIp === 'string') {
    return realIp
  }

  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
    return ips.split(",")[0].trim()
  }

  return req.socket.remoteAddress || req.connection.remoteAddress || "unknown"
}

/**
 * Get user agent information
 */
export const getUserAgent = (req: Request): {
  userAgent: string
  browser?: string
  os?: string
  device?: string
} => {
  const userAgent = req.headers["user-agent"] || "unknown"
  
  // Basic parsing (you might want to use a library like 'ua-parser-js' for more detailed parsing)
  const browser = userAgent.includes('Chrome') ? 'Chrome' :
                 userAgent.includes('Firefox') ? 'Firefox' :
                 userAgent.includes('Safari') ? 'Safari' :
                 userAgent.includes('Edge') ? 'Edge' : 'Unknown'

  const os = userAgent.includes('Windows') ? 'Windows' :
            userAgent.includes('Mac') ? 'macOS' :
            userAgent.includes('Linux') ? 'Linux' :
            userAgent.includes('Android') ? 'Android' :
            userAgent.includes('iOS') ? 'iOS' : 'Unknown'

  const device = userAgent.includes('Mobile') ? 'Mobile' :
                userAgent.includes('Tablet') ? 'Tablet' : 'Desktop'

  return { userAgent, browser, os, device }
}

// =============================================================================
// FILE UTILITIES
// =============================================================================

/**
 * Format file size in human readable format
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes"
  
  const k = 1024
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}

/**
 * Get file extension from filename
 */
export const getFileExtension = (filename: string): string => {
  return filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2).toLowerCase()
}

/**
 * Get MIME type from file extension
 */
export const getMimeTypeFromExtension = (extension: string): string => {
  const mimeTypes: Record<string, string> = {
    // Images
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp',
    'ico': 'image/x-icon',
    
    // Documents
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt': 'text/plain',
    'rtf': 'application/rtf',
    
    // Archives
    'zip': 'application/zip',
    'rar': 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    'tar': 'application/x-tar',
    'gz': 'application/gzip',
    
    // Audio
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'flac': 'audio/flac',
    
    // Video
    'mp4': 'video/mp4',
    'avi': 'video/x-msvideo',
    'mov': 'video/quicktime',
    'wmv': 'video/x-ms-wmv',
    'flv': 'video/x-flv',
    'webm': 'video/webm',
    
    // Web
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'xml': 'application/xml'
  }

  return mimeTypes[extension.toLowerCase()] || 'application/octet-stream'
}

/**
 * Check if file type is allowed
 */
export const isAllowedFileType = (mimeType: string, allowedTypes: string[]): boolean => {
  return allowedTypes.includes(mimeType)
}

// =============================================================================
// RANDOM GENERATION UTILITIES
// =============================================================================

/**
 * Generate a random string with specified length and character set
 */
export const generateRandomString = (
  length = 10,
  charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
): string => {
  let result = ""
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length))
  }
  return result
}

/**
 * Generate a random alphanumeric string
 */
export const generateRandomAlphanumeric = (length = 10): string => {
  return generateRandomString(length, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
}

/**
 * Generate a random numeric string
 */
export const generateRandomNumeric = (length = 6): string => {
  return generateRandomString(length, "0123456789")
}

/**
 * Generate a secure random token
 */
export const generateSecureToken = (length = 32): string => {
  return generateRandomString(length, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*")
}

// =============================================================================
// OBJECT UTILITIES
// =============================================================================

/**
 * Deep merge objects with array handling
 */
export const deepMerge = <T extends ObjectLike, U extends ObjectLike>(target: T, source: U): T & U => {
  const output = { ...target } as T & U

  if (isMergeable(target) && isMergeable(source)) {
    Object.keys(source).forEach((key) => {
      if (isMergeable(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] })
        } else {
          (output as any)[key] = deepMerge(target[key] as ObjectLike, source[key] as ObjectLike)
        }
      } else {
        Object.assign(output, { [key]: source[key] })
      }
    })
  }

  return output
}

/**
 * Check if value is an object (not array or null)
 */
export const isObject = (item: any): boolean => {
  return item && typeof item === "object" && !Array.isArray(item) && item !== null
}

/**
 * Deep clone an object with proper type constraints
 * Supports primitives, objects, arrays, dates, and null/undefined values
 */
export function deepClone<T extends object>(obj: T): T;
export function deepClone<T>(obj: T): T;
export function deepClone<T>(obj: T): T {
  // Handle primitive types and null
  if (obj === null || typeof obj !== "object") return obj
  
  // Handle Date objects
  if (obj instanceof Date) return new Date(obj.getTime()) as T
  
  // Handle Arrays
  if (Array.isArray(obj)) return obj.map(item => deepClone(item)) as T
  
  // Handle Objects
  if (typeof obj === "object" && obj !== null) {
    const clonedObj = {} as T
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        (clonedObj as any)[key] = deepClone((obj as any)[key])
      }
    }
    return clonedObj
  }
  
  return obj
}

/**
 * Pick specific properties from an object
 */
export const pick = <T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> => {
  const result = {} as Pick<T, K>
  keys.forEach(key => {
    if (key) {
      result[key] = obj[key]
    }
  })
  return result
}

/**
 * Omit specific properties from an object
 */
export const omit = <T, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> => {
  const result = { ...obj } as any
  keys.forEach(key => {
    delete result[key]
  })
  return result
}

/**
 * Sanitize object for logging (remove sensitive fields)
 */
export const sanitizeForLogging = (
  obj: any,
  sensitiveFields: string[] = ["password", "token", "secret", "key", "auth", "authorization"]
): any => {
  if (!obj) return obj
  if (typeof obj !== "object") return obj

  const result: any = Array.isArray(obj) ? [] : {}

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const lowerKey = key.toLowerCase()
      const isSensitive = sensitiveFields.some(field => lowerKey.includes(field.toLowerCase()))
      
      if (isSensitive) {
        result[key] = "[REDACTED]"
      } else if (typeof obj[key] === "object") {
        result[key] = sanitizeForLogging(obj[key], sensitiveFields)
      } else {
        result[key] = obj[key]
      }
    }
  }

  return result
}

// =============================================================================
// TYPE CONVERSION UTILITIES
// =============================================================================

/**
 * Parse boolean from various input types
 */
export const parseBoolean = (value: any): boolean => {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const lowercased = value.toLowerCase().trim()
    return lowercased === "true" || lowercased === "yes" || lowercased === "1" || lowercased === "on"
  }
  if (typeof value === "number") return value === 1
  return false
}

/**
 * Parse integer with fallback
 */
export const parseInteger = (value: any, fallback = 0): number => {
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

/**
 * Parse float with fallback
 */
export const parseFloat = (value: any, fallback = 0.0): number => {
  const parsed = Number.parseFloat(value)
  return Number.isNaN(parsed) ? fallback : parsed
}

// =============================================================================
// DATE UTILITIES
// =============================================================================

/**
 * Get date range from period with timezone support
 */
export const getDateRangeFromPeriod = (
  period: "today" | "yesterday" | "last7days" | "last30days" | "thisMonth" | "lastMonth" | "thisYear" | "lastYear" | "custom",
  customStart?: Date,
  customEnd?: Date,
  timezone = "UTC"
): { startDate: Date; endDate: Date } => {
  const now = new Date()
  
  // Helper to create date in specified timezone
  const createDate = (year: number, month: number, day: number) => {
    return new Date(Date.UTC(year, month, day))
  }

  const today = createDate(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  switch (period) {
    case "today":
      return {
        startDate: today,
        endDate: tomorrow,
      }
    case "yesterday":
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      return {
        startDate: yesterday,
        endDate: today,
      }
    case "last7days":
      const last7days = new Date(today)
      last7days.setDate(last7days.getDate() - 7)
      return {
        startDate: last7days,
        endDate: tomorrow,
      }
    case "last30days":
      const last30days = new Date(today)
      last30days.setDate(last30days.getDate() - 30)
      return {
        startDate: last30days,
        endDate: tomorrow,
      }
    case "thisMonth":
      const thisMonthStart = createDate(now.getFullYear(), now.getMonth(), 1)
      const nextMonthStart = createDate(now.getFullYear(), now.getMonth() + 1, 1)
      return {
        startDate: thisMonthStart,
        endDate: nextMonthStart,
      }
    case "lastMonth":
      const lastMonthStart = createDate(now.getFullYear(), now.getMonth() - 1, 1)
      const thisMonthStart2 = createDate(now.getFullYear(), now.getMonth(), 1)
      return {
        startDate: lastMonthStart,
        endDate: thisMonthStart2,
      }
    case "thisYear":
      const thisYearStart = createDate(now.getFullYear(), 0, 1)
      const nextYearStart = createDate(now.getFullYear() + 1, 0, 1)
      return {
        startDate: thisYearStart,
        endDate: nextYearStart,
      }
    case "lastYear":
      const lastYearStart = createDate(now.getFullYear() - 1, 0, 1)
      const thisYearStart2 = createDate(now.getFullYear(), 0, 1)
      return {
        startDate: lastYearStart,
        endDate: thisYearStart2,
      }
    case "custom":
      if (!customStart || !customEnd) {
        throw ApiError.badRequest("Custom date range requires both start and end dates")
      }
      return {
        startDate: customStart,
        endDate: customEnd,
      }
    default:
      return {
        startDate: today,
        endDate: tomorrow,
      }
  }
}

/**
 * Format date to ISO string with timezone
 */
export const formatDateToISO = (date: Date, timezone = "UTC"): string => {
  return date.toISOString()
}

/**
 * Add days to date
 */
export const addDays = (date: Date, days: number): Date => {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

/**
 * Add hours to date
 */
export const addHours = (date: Date, hours: number): Date => {
  const result = new Date(date)
  result.setHours(result.getHours() + hours)
  return result
}

/**
 * Check if date is in the past
 */
export const isDateInPast = (date: Date): boolean => {
  return date < new Date()
}

/**
 * Check if date is in the future
 */
export const isDateInFuture = (date: Date): boolean => {
  return date > new Date()
}

// =============================================================================
// ARRAY UTILITIES
// =============================================================================

/**
 * Remove duplicates from array
 */
export const removeDuplicates = <T>(array: T[]): T[] => {
  return [...new Set(array)]
}

/**
 * Chunk array into smaller arrays
 */
export const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

/**
 * Shuffle array
 */
export const shuffleArray = <T>(array: T[]): T[] => {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

/**
 * Get random item from array
 */
export const getRandomItem = <T>(array: T[]): T | undefined => {
  if (array.length === 0) return undefined
  return array[Math.floor(Math.random() * array.length)]
}

// =============================================================================
// ASYNC UTILITIES
// =============================================================================

/**
 * Sleep for specified milliseconds
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Retry async function with exponential backoff
 */
export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000,
  maxDelay = 10000
): Promise<T> => {
  let lastError: Error

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      
      if (attempt === maxRetries) {
        throw lastError
      }

      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
      await sleep(delay)
    }
  }

  throw lastError!
}

/**
 * Execute promises with concurrency limit
 */
export const promiseAllWithLimit = async <T>(
  promises: (() => Promise<T>)[],
  limit = 5
): Promise<T[]> => {
  const results: T[] = []
  const executing: Promise<void>[] = []

  for (const promiseFactory of promises) {
    const promise = promiseFactory().then(result => {
      results.push(result)
    })

    executing.push(promise)

    if (executing.length >= limit) {
      await Promise.race(executing)
      executing.splice(executing.findIndex(p => p === promise), 1)
    }
  }

  await Promise.all(executing)
  return results
}

// =============================================================================
// CACHE UTILITIES
// =============================================================================

/**
 * Simple in-memory cache with TTL
 */
export class MemoryCache<T> {
  private cache = new Map<string, { value: T; expires: number }>()

  set(key: string, value: T, ttlMs = 300000): void { // 5 minutes default
    const expires = Date.now() + ttlMs
    this.cache.set(key, { value, expires })
  }

  get(key: string): T | undefined {
    const item = this.cache.get(key)
    if (!item) return undefined

    if (Date.now() > item.expires) {
      this.cache.delete(key)
      return undefined
    }

    return item.value
  }

  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  size(): number {
    return this.cache.size
  }

  cleanup(): void {
    const now = Date.now()
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expires) {
        this.cache.delete(key)
      }
    }
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  // Pagination
  parsePaginationParams,
  createPaginationMeta,
  
  // String utilities
  slugify,
  generateUniqueSlug,
  truncateString,
  toTitleCase,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  
  // Validation
  isValidEmail,
  isValidUrl,
  isValidUUID,
  isValidPhoneNumber,
  validatePasswordStrength,
  
  // Request utilities
  getClientIp,
  getUserAgent,
  
  // File utilities
  formatFileSize,
  getFileExtension,
  getMimeTypeFromExtension,
  isAllowedFileType,
  
  // Random generation
  generateRandomString,
  generateRandomAlphanumeric,
  generateRandomNumeric,
  generateSecureToken,
  
  // Object utilities
  deepMerge,
  isObject,
  deepClone,
  pick,
  omit,
  sanitizeForLogging,
  
  // Type conversion
  parseBoolean,
  parseInteger,
  parseFloat,
  
  // Date utilities
  getDateRangeFromPeriod,
  formatDateToISO,
  addDays,
  addHours,
  isDateInPast,
  isDateInFuture,
  
  // Array utilities
  removeDuplicates,
  chunkArray,
  shuffleArray,
  getRandomItem,
  
  // Async utilities
  sleep,
  retryWithBackoff,
  promiseAllWithLimit,
  
  // Cache
  MemoryCache
}
