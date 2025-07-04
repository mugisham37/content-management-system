// =============================================================================
// ERROR HANDLING UTILITIES
// =============================================================================

import { Response } from 'express'
import { ZodError } from 'zod'
import { Logger } from './logger'

// =============================================================================
// ENHANCED ERROR CLASSES
// =============================================================================

export class ApiError extends Error {
  public statusCode: number
  public isOperational: boolean
  public code?: string
  public details?: any
  public tenantId?: string
  public userId?: string
  public requestId?: string

  constructor(statusCode: number, message: string, code?: string, details?: any, isOperational = true) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = isOperational
    this.code = code
    this.details = details

    Error.captureStackTrace(this, this.constructor)
  }

  // Static factory methods for common errors
  static badRequest(message: string, details?: any) {
    return new ApiError(400, message, "BAD_REQUEST", details)
  }

  static unauthorized(message = "Unauthorized") {
    return new ApiError(401, message, "UNAUTHORIZED")
  }

  static forbidden(message = "Forbidden") {
    return new ApiError(403, message, "FORBIDDEN")
  }

  static notFound(message = "Resource not found") {
    return new ApiError(404, message, "NOT_FOUND")
  }

  static conflict(message: string, details?: any) {
    return new ApiError(409, message, "CONFLICT", details)
  }

  static validationError(message: string, details?: any) {
    return new ApiError(422, message, "VALIDATION_ERROR", details)
  }

  static tooManyRequests(message = "Too many requests") {
    return new ApiError(429, message, "TOO_MANY_REQUESTS")
  }

  static internal(message = "Internal server error") {
    return new ApiError(500, message, "INTERNAL_ERROR")
  }

  static serviceUnavailable(message = "Service unavailable") {
    return new ApiError(503, message, "SERVICE_UNAVAILABLE")
  }

  // Add context to error
  withContext(context: { tenantId?: string; userId?: string; requestId?: string }) {
    this.tenantId = context.tenantId
    this.userId = context.userId
    this.requestId = context.requestId
    return this
  }
}

// Specialized error classes extending ApiError
export class ValidationError extends ApiError {
  constructor(message: string, details?: any) {
    super(422, message, "VALIDATION_ERROR", details)
  }
}

export class DatabaseError extends ApiError {
  constructor(message: string, details?: any) {
    super(500, message, "DATABASE_ERROR", details)
  }
}

export class AuthenticationError extends ApiError {
  constructor(message = "Authentication failed") {
    super(401, message, "AUTHENTICATION_ERROR")
  }
}

export class AuthorizationError extends ApiError {
  constructor(message = "Access denied") {
    super(403, message, "AUTHORIZATION_ERROR")
  }
}

export class TenantError extends ApiError {
  constructor(message: string, details?: any) {
    super(403, message, "TENANT_ERROR", details)
  }
}

export class ContentTypeError extends ApiError {
  constructor(message: string, details?: any) {
    super(400, message, "CONTENT_TYPE_ERROR", details)
  }
}

export class WorkflowError extends ApiError {
  constructor(message: string, details?: any) {
    super(400, message, "WORKFLOW_ERROR", details)
  }
}

export class MediaError extends ApiError {
  constructor(message: string, details?: any) {
    super(400, message, "MEDIA_ERROR", details)
  }
}

export class PluginError extends ApiError {
  constructor(message: string, details?: any) {
    super(500, message, "PLUGIN_ERROR", details)
  }
}

export class WebhookError extends ApiError {
  constructor(message: string, details?: any) {
    super(500, message, "WEBHOOK_ERROR", details)
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string = 'Resource') {
    super(404, `${resource} not found`, 'NOT_FOUND')
  }
}

export class ConflictError extends ApiError {
  constructor(message: string) {
    super(409, message, 'CONFLICT')
  }
}

export class RateLimitError extends ApiError {
  constructor(message: string = 'Too many requests') {
    super(429, message, 'RATE_LIMIT_EXCEEDED')
  }
}

export class ExternalServiceError extends ApiError {
  constructor(service: string, message: string) {
    super(502, `${service}: ${message}`, 'EXTERNAL_SERVICE_ERROR')
  }
}

// Legacy AppError for backward compatibility
export class AppError extends ApiError {
  constructor(
    message: string,
    statusCode: number = 500,
    code?: string,
    details?: any,
    isOperational: boolean = true
  ) {
    super(statusCode, message, code, details, isOperational)
  }
}

// =============================================================================
// ERROR RESPONSE INTERFACE
// =============================================================================

interface ErrorResponse {
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

// =============================================================================
// ERROR HANDLING FUNCTIONS
// =============================================================================

export function handleZodError(error: ZodError): ValidationError {
  const details = error.errors.map(err => ({
    field: err.path.join('.'),
    message: err.message,
    code: err.code
  }))

  return new ValidationError('Validation failed', details)
}

export function handlePrismaError(error: any): ApiError {
  // Handle known Prisma error codes
  if (error.code) {
    switch (error.code) {
      case 'P2002':
        return new ConflictError('A record with this data already exists')
      case 'P2025':
        return new NotFoundError('Record')
      case 'P2003':
        return new ValidationError('Foreign key constraint failed')
      case 'P2014':
        return new ValidationError('Invalid ID provided')
      case 'P2016':
        return new ValidationError('Query interpretation error')
      case 'P2021':
        return new DatabaseError('Table does not exist')
      case 'P2022':
        return new DatabaseError('Column does not exist')
      default:
        return new DatabaseError(`Database error: ${error.message}`, { code: error.code })
    }
  }

  // Handle different Prisma error types by name
  if (error.name?.includes('PrismaClientKnownRequestError')) {
    return new DatabaseError('Known database request error')
  }

  if (error.name?.includes('PrismaClientUnknownRequestError')) {
    return new DatabaseError('Unknown database error occurred')
  }

  if (error.name?.includes('PrismaClientRustPanicError')) {
    return new DatabaseError('Database engine error')
  }

  if (error.name?.includes('PrismaClientInitializationError')) {
    return new DatabaseError('Database connection failed')
  }

  if (error.name?.includes('PrismaClientValidationError')) {
    return new ValidationError('Invalid query parameters')
  }

  return new DatabaseError('Database operation failed')
}

export function createErrorResponse(
  error: ApiError | Error,
  req?: any,
  includeStack: boolean = false
): ErrorResponse {
  const isApiError = error instanceof ApiError
  
  const response: ErrorResponse = {
    success: false,
    error: {
      message: error.message,
      code: isApiError ? error.code : 'INTERNAL_ERROR',
      statusCode: isApiError ? error.statusCode : 500,
      timestamp: new Date().toISOString(),
      path: req?.path,
      method: req?.method
    }
  }

  if (isApiError) {
    if (error.details) {
      response.error.details = error.details
    }
    if (error.tenantId) {
      response.error.tenantId = error.tenantId
    }
    if (error.userId) {
      response.error.userId = error.userId
    }
    if (error.requestId) {
      response.error.requestId = error.requestId
    }
  }

  if (includeStack && error.stack) {
    response.error.stack = error.stack
  }

  return response
}

export function sendErrorResponse(
  res: Response,
  error: ApiError | Error,
  req?: any
): void {
  const isApiError = error instanceof ApiError
  const statusCode = isApiError ? error.statusCode : 500
  const includeStack = process.env.NODE_ENV === 'development'

  // Log the error with context
  const logContext = {
    statusCode,
    path: req?.path,
    method: req?.method,
    ip: req?.ip,
    userAgent: req?.get('User-Agent'),
    tenantId: isApiError ? error.tenantId : undefined,
    userId: isApiError ? error.userId : undefined,
    requestId: isApiError ? error.requestId : undefined
  }

  if (statusCode >= 500) {
    Logger.logError(error, 'Server Error')
  } else if (statusCode >= 400) {
    Logger.warn(`Client Error: ${error.message}`, logContext)
  }

  const errorResponse = createErrorResponse(error, req, includeStack)
  res.status(statusCode).json(errorResponse)
}

// =============================================================================
// ERROR PROCESSING UTILITIES
// =============================================================================

export function processError(error: any): ApiError {
  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return handleZodError(error)
  }

  // Handle Prisma errors
  if (error.name?.includes('Prisma') || error.code?.startsWith('P')) {
    return handlePrismaError(error)
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    return new AuthenticationError('Invalid token')
  }

  if (error.name === 'TokenExpiredError') {
    return new AuthenticationError('Token expired')
  }

  if (error.name === 'NotBeforeError') {
    return new AuthenticationError('Token not active')
  }

  // Handle Multer errors (file upload)
  if (error.code === 'LIMIT_FILE_SIZE') {
    return new ValidationError('File size too large')
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return new ValidationError('Unexpected file field')
  }

  if (error.code === 'LIMIT_FILE_COUNT') {
    return new ValidationError('Too many files')
  }

  // Handle MongoDB-like errors (if using MongoDB)
  if (error.code === 11000) {
    return new ConflictError('Duplicate key error')
  }

  // Handle network errors
  if (error.code === 'ECONNREFUSED') {
    return new ExternalServiceError('Database', 'Connection refused')
  }

  if (error.code === 'ETIMEDOUT') {
    return new ExternalServiceError('External Service', 'Request timeout')
  }

  if (error.code === 'ENOTFOUND') {
    return new ExternalServiceError('External Service', 'Service not found')
  }

  // Handle axios errors
  if (error.response) {
    return new ExternalServiceError('HTTP Request', `${error.response.status}: ${error.response.statusText}`)
  }

  // If it's already an ApiError, return as is
  if (error instanceof ApiError) {
    return error
  }

  // Default to internal server error
  return new ApiError(
    500,
    process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message || 'Unknown error occurred',
    'INTERNAL_ERROR',
    process.env.NODE_ENV === 'development' ? { originalError: error.message, stack: error.stack } : undefined,
    false
  )
}

// =============================================================================
// ASYNC ERROR WRAPPER
// =============================================================================

export function asyncHandler<T extends any[], R>(
  fn: (...args: T) => Promise<R>
) {
  return (...args: T): Promise<R> => {
    return Promise.resolve(fn(...args)).catch((error) => {
      throw processError(error)
    })
  }
}

// =============================================================================
// ERROR VALIDATION HELPERS
// =============================================================================

export function isOperationalError(error: Error): boolean {
  if (error instanceof ApiError) {
    return error.isOperational
  }
  return false
}

export function shouldLogError(error: Error): boolean {
  if (error instanceof ApiError) {
    return error.statusCode >= 500
  }
  return true
}

export function isTenantError(error: Error): boolean {
  return error instanceof TenantError
}

export function isValidationError(error: Error): boolean {
  return error instanceof ValidationError
}

export function isAuthenticationError(error: Error): boolean {
  return error instanceof AuthenticationError
}

export function isAuthorizationError(error: Error): boolean {
  return error instanceof AuthorizationError
}

// =============================================================================
// ERROR CONTEXT HELPERS
// =============================================================================

export function addErrorContext(
  error: ApiError,
  context: { tenantId?: string; userId?: string; requestId?: string }
): ApiError {
  return error.withContext(context)
}

export function createContextualError(
  statusCode: number,
  message: string,
  context: { tenantId?: string; userId?: string; requestId?: string; code?: string; details?: any }
): ApiError {
  const error = new ApiError(statusCode, message, context.code, context.details)
  return error.withContext(context)
}

// =============================================================================
// EXPORTS
// =============================================================================

export default ApiError
