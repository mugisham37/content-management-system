// =============================================================================
// ERROR HANDLING UTILITIES
// =============================================================================

import { Response } from 'express'
import { ZodError } from 'zod'
import { Prisma } from '@cms-platform/database'
import { Logger } from './logger'

// =============================================================================
// CUSTOM ERROR CLASSES
// =============================================================================

export class AppError extends Error {
  public readonly statusCode: number
  public readonly isOperational: boolean
  public readonly code?: string
  public readonly details?: any

  constructor(
    message: string,
    statusCode: number = 500,
    code?: string,
    details?: any,
    isOperational: boolean = true
  ) {
    super(message)
    
    this.statusCode = statusCode
    this.isOperational = isOperational
    this.code = code
    this.details = details

    Error.captureStackTrace(this, this.constructor)
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR', details)
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR')
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR')
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND')
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT')
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED')
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 500, 'DATABASE_ERROR', details)
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string) {
    super(`${service}: ${message}`, 502, 'EXTERNAL_SERVICE_ERROR')
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

export function handlePrismaError(error: any): AppError {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return new ConflictError('A record with this data already exists')
      case 'P2025':
        return new NotFoundError('Record')
      case 'P2003':
        return new ValidationError('Foreign key constraint failed')
      case 'P2014':
        return new ValidationError('Invalid ID provided')
      default:
        return new DatabaseError(`Database error: ${error.message}`, { code: error.code })
    }
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return new DatabaseError('Unknown database error occurred')
  }

  if (error instanceof Prisma.PrismaClientRustPanicError) {
    return new DatabaseError('Database engine error')
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return new DatabaseError('Database connection failed')
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return new ValidationError('Invalid query parameters')
  }

  return new DatabaseError('Database operation failed')
}

export function createErrorResponse(
  error: AppError | Error,
  req?: any,
  includeStack: boolean = false
): ErrorResponse {
  const isAppError = error instanceof AppError
  
  const response: ErrorResponse = {
    success: false,
    error: {
      message: error.message,
      code: isAppError ? error.code : 'INTERNAL_ERROR',
      statusCode: isAppError ? error.statusCode : 500,
      timestamp: new Date().toISOString(),
      path: req?.path,
      method: req?.method
    }
  }

  if (isAppError && error.details) {
    response.error.details = error.details
  }

  if (includeStack && error.stack) {
    response.error.stack = error.stack
  }

  return response
}

export function sendErrorResponse(
  res: Response,
  error: AppError | Error,
  req?: any
): void {
  const isAppError = error instanceof AppError
  const statusCode = isAppError ? error.statusCode : 500
  const includeStack = process.env.NODE_ENV === 'development'

  // Log the error
  if (statusCode >= 500) {
    Logger.logError(error, 'Server Error')
  } else if (statusCode >= 400) {
    Logger.warn(`Client Error: ${error.message}`, {
      statusCode,
      path: req?.path,
      method: req?.method,
      ip: req?.ip
    })
  }

  const errorResponse = createErrorResponse(error, req, includeStack)
  res.status(statusCode).json(errorResponse)
}

// =============================================================================
// ERROR PROCESSING UTILITIES
// =============================================================================

export function processError(error: any): AppError {
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

  // Handle Multer errors (file upload)
  if (error.code === 'LIMIT_FILE_SIZE') {
    return new ValidationError('File size too large')
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return new ValidationError('Unexpected file field')
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

  // If it's already an AppError, return as is
  if (error instanceof AppError) {
    return error
  }

  // Default to internal server error
  return new AppError(
    process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message || 'Unknown error occurred',
    500,
    'INTERNAL_ERROR',
    process.env.NODE_ENV === 'development' ? { originalError: error.message } : undefined,
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
  if (error instanceof AppError) {
    return error.isOperational
  }
  return false
}

export function shouldLogError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.statusCode >= 500
  }
  return true
}

// =============================================================================
// EXPORTS
// =============================================================================

export default AppError
