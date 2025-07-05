import type { Request, Response, NextFunction } from "express"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import { config } from "../config"
import { monitoringService } from "../services/monitoring.service"
import { notificationService } from "../services/notification.service"

export interface ErrorContext {
  requestId?: string
  userId?: string
  tenantId?: string
  apiKeyId?: string
  sessionId?: string
  ipAddress?: string
  userAgent?: string
  path?: string
  method?: string
  body?: any
  params?: any
  query?: any
  headers?: any
}

export class ErrorMiddleware {
  /**
   * Main error handling middleware
   */
  public handleError = (error: Error, req: Request, res: Response, next: NextFunction) => {
    const context = this.buildErrorContext(req, error)
    
    // Log error with full context
    this.logError(error, context)
    
    // Record error metrics
    this.recordErrorMetrics(error, context)
    
    // Send notifications for critical errors
    this.handleCriticalErrorNotifications(error, context)
    
    // Convert known errors to ApiError
    const apiError = this.processError(error)
    
    // Send error response
    this.sendErrorResponse(res, apiError, context)
  }

  /**
   * 404 Not Found handler
   */
  public handleNotFound = (req: Request, res: Response) => {
    const context = this.buildErrorContext(req)
    
    logger.warn("Route not found", {
      path: req.originalUrl,
      method: req.method,
      ...context
    })

    res.status(404).json({
      success: false,
      error: {
        message: `Route ${req.originalUrl} not found`,
        code: "NOT_FOUND",
        statusCode: 404,
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
        method: req.method,
        requestId: context.requestId
      }
    })
  }

  /**
   * Async error wrapper for route handlers
   */
  public asyncHandler = <T extends any[], R>(
    fn: (...args: T) => Promise<R>
  ) => {
    return (...args: T): Promise<R> => {
      return Promise.resolve(fn(...args)).catch((error) => {
        throw this.processError(error)
      })
    }
  }

  /**
   * Build comprehensive error context
   */
  private buildErrorContext(req: Request, error?: Error): ErrorContext {
    const user = (req as any).user
    const tenant = (req as any).tenant
    const apiKey = (req as any).apiKey
    const session = (req as any).session

    return {
      requestId: (req as any).requestId,
      userId: user?._id || user?.id,
      tenantId: tenant?._id || tenant?.id || user?.tenantId,
      apiKeyId: apiKey?.id,
      sessionId: session?.id || user?.sessionId,
      ipAddress: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers["user-agent"],
      path: req.path,
      method: req.method,
      body: this.sanitizeRequestData(req.body),
      params: req.params,
      query: req.query,
      headers: this.sanitizeHeaders(req.headers)
    }
  }

  /**
   * Log error with appropriate level and context
   */
  private logError(error: Error, context: ErrorContext): void {
    const isApiError = error instanceof ApiError
    const statusCode = isApiError ? error.statusCode : 500

    const logData = {
      message: error.message,
      stack: error.stack,
      statusCode,
      ...context
    }

    if (statusCode >= 500) {
      logger.error("Server Error", logData)
    } else if (statusCode >= 400) {
      logger.warn("Client Error", logData)
    } else {
      logger.info("Request Error", logData)
    }
  }

  /**
   * Record error metrics for monitoring
   */
  private recordErrorMetrics(error: Error, context: ErrorContext): void {
    try {
      const isApiError = error instanceof ApiError
      const statusCode = isApiError ? error.statusCode : 500

      monitoringService.recordError({
        type: error.constructor.name,
        message: error.message,
        statusCode,
        path: context.path,
        method: context.method,
        userId: context.userId,
        tenantId: context.tenantId,
        timestamp: new Date()
      }).catch(metricsError => {
        logger.error("Failed to record error metrics:", metricsError)
      })
    } catch (metricsError) {
      logger.error("Error recording metrics:", metricsError)
    }
  }

  /**
   * Handle critical error notifications
   */
  private handleCriticalErrorNotifications(error: Error, context: ErrorContext): void {
    try {
      const isApiError = error instanceof ApiError
      const statusCode = isApiError ? error.statusCode : 500

      // Only notify for server errors (5xx) in production
      if (statusCode >= 500 && config.server.isProduction) {
        notificationService.sendCriticalErrorAlert({
          error: {
            message: error.message,
            stack: error.stack,
            type: error.constructor.name
          },
          context,
          timestamp: new Date()
        }).catch(notificationError => {
          logger.error("Failed to send critical error notification:", notificationError)
        })
      }
    } catch (notificationError) {
      logger.error("Error sending notifications:", notificationError)
    }
  }

  /**
   * Process and convert errors to ApiError
   */
  private processError(error: any): ApiError {
    // If it's already an ApiError, return as is
    if (error instanceof ApiError) {
      return error
    }

    // Handle Zod validation errors
    if (error.name === "ZodError") {
      const details = error.errors?.map((err: any) => ({
        field: err.path?.join('.'),
        message: err.message,
        code: err.code
      }))
      return new ApiError(422, "Validation failed", "VALIDATION_ERROR", details)
    }

    // Handle Prisma errors
    if (error.code?.startsWith('P') || error.name?.includes('Prisma')) {
      return this.handlePrismaError(error)
    }

    // Handle JWT errors
    if (error.name === "JsonWebTokenError") {
      return new ApiError(401, "Invalid token", "INVALID_TOKEN")
    }

    if (error.name === "TokenExpiredError") {
      return new ApiError(401, "Token expired", "TOKEN_EXPIRED")
    }

    if (error.name === "NotBeforeError") {
      return new ApiError(401, "Token not active", "TOKEN_NOT_ACTIVE")
    }

    // Handle Multer errors (file upload)
    if (error.code === "LIMIT_FILE_SIZE") {
      return new ApiError(413, "File size too large", "FILE_TOO_LARGE")
    }

    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return new ApiError(400, "Unexpected file field", "UNEXPECTED_FILE")
    }

    if (error.code === "LIMIT_FILE_COUNT") {
      return new ApiError(400, "Too many files", "TOO_MANY_FILES")
    }

    // Handle MongoDB-like errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue || {})[0]
      return new ApiError(409, `${field} already exists`, "DUPLICATE_KEY", { field })
    }

    // Handle network errors
    if (error.code === "ECONNREFUSED") {
      return new ApiError(503, "Service unavailable", "SERVICE_UNAVAILABLE")
    }

    if (error.code === "ETIMEDOUT") {
      return new ApiError(504, "Request timeout", "REQUEST_TIMEOUT")
    }

    if (error.code === "ENOTFOUND") {
      return new ApiError(503, "Service not found", "SERVICE_NOT_FOUND")
    }

    // Handle axios/HTTP errors
    if (error.response) {
      return new ApiError(
        error.response.status || 500,
        `External service error: ${error.response.statusText}`,
        "EXTERNAL_SERVICE_ERROR",
        { status: error.response.status, data: error.response.data }
      )
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      const details = Object.values(error.errors || {}).map((err: any) => ({
        field: err.path,
        message: err.message,
        value: err.value
      }))
      return new ApiError(422, "Validation failed", "VALIDATION_ERROR", details)
    }

    // Handle cast errors
    if (error.name === "CastError") {
      return new ApiError(400, `Invalid ${error.path}: ${error.value}`, "INVALID_ID")
    }

    // Default to internal server error
    return new ApiError(
      500,
      config.server.isDevelopment ? error.message : "Internal server error",
      "INTERNAL_ERROR",
      config.server.isDevelopment ? { 
        originalError: error.message, 
        stack: error.stack 
      } : undefined
    )
  }

  /**
   * Handle Prisma-specific errors
   */
  private handlePrismaError(error: any): ApiError {
    if (error.code) {
      switch (error.code) {
        case 'P2002':
          const field = error.meta?.target?.[0] || 'field'
          return new ApiError(409, `${field} already exists`, "DUPLICATE_ENTRY", { field })
        case 'P2025':
          return new ApiError(404, "Record not found", "RECORD_NOT_FOUND")
        case 'P2003':
          return new ApiError(400, "Foreign key constraint failed", "FOREIGN_KEY_CONSTRAINT")
        case 'P2014':
          return new ApiError(400, "Invalid ID provided", "INVALID_ID")
        case 'P2016':
          return new ApiError(400, "Query interpretation error", "QUERY_ERROR")
        case 'P2021':
          return new ApiError(500, "Table does not exist", "TABLE_NOT_FOUND")
        case 'P2022':
          return new ApiError(500, "Column does not exist", "COLUMN_NOT_FOUND")
        default:
          return new ApiError(500, `Database error: ${error.message}`, "DATABASE_ERROR", { code: error.code })
      }
    }

    // Handle different Prisma error types by name
    if (error.name?.includes('PrismaClientKnownRequestError')) {
      return new ApiError(400, "Database request error", "DATABASE_REQUEST_ERROR")
    }

    if (error.name?.includes('PrismaClientUnknownRequestError')) {
      return new ApiError(500, "Unknown database error", "UNKNOWN_DATABASE_ERROR")
    }

    if (error.name?.includes('PrismaClientRustPanicError')) {
      return new ApiError(500, "Database engine error", "DATABASE_ENGINE_ERROR")
    }

    if (error.name?.includes('PrismaClientInitializationError')) {
      return new ApiError(500, "Database connection failed", "DATABASE_CONNECTION_ERROR")
    }

    if (error.name?.includes('PrismaClientValidationError')) {
      return new ApiError(400, "Invalid query parameters", "INVALID_QUERY")
    }

    return new ApiError(500, "Database operation failed", "DATABASE_ERROR")
  }

  /**
   * Send error response to client
   */
  private sendErrorResponse(res: Response, error: ApiError, context: ErrorContext): void {
    const response: any = {
      success: false,
      error: {
        message: error.message,
        code: error.code || "INTERNAL_ERROR",
        statusCode: error.statusCode,
        timestamp: new Date().toISOString(),
        requestId: context.requestId
      }
    }

    // Add additional context in development
    if (config.server.isDevelopment) {
      response.error.stack = error.stack
      response.error.path = context.path
      response.error.method = context.method
      
      if (error.details) {
        response.error.details = error.details
      }
    }

    // Add tenant context if available
    if (context.tenantId) {
      response.error.tenantId = context.tenantId
    }

    // Add user context if available (but not sensitive info)
    if (context.userId) {
      response.error.userId = context.userId
    }

    res.status(error.statusCode).json(response)
  }

  /**
   * Sanitize request data for logging
   */
  private sanitizeRequestData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data
    }

    const sensitiveFields = [
      'password', 'passwordConfirm', 'currentPassword', 'newPassword',
      'token', 'refreshToken', 'accessToken', 'apiKey', 'secret',
      'creditCard', 'ssn', 'socialSecurityNumber', 'bankAccount'
    ]

    const sanitized = { ...data }
    
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]'
      }
    }

    return sanitized
  }

  /**
   * Sanitize headers for logging
   */
  private sanitizeHeaders(headers: any): any {
    const sanitized = { ...headers }
    
    if (sanitized.authorization) {
      sanitized.authorization = '[PRESENT]'
    }
    
    if (sanitized['x-api-key']) {
      sanitized['x-api-key'] = '[PRESENT]'
    }
    
    if (sanitized.cookie) {
      sanitized.cookie = '[PRESENT]'
    }

    return {
      'content-type': sanitized['content-type'],
      'accept': sanitized.accept,
      'user-agent': sanitized['user-agent'],
      'x-forwarded-for': sanitized['x-forwarded-for'],
      'x-real-ip': sanitized['x-real-ip'],
      'authorization': sanitized.authorization,
      'x-api-key': sanitized['x-api-key'],
      'x-tenant-id': sanitized['x-tenant-id'],
      'x-request-id': sanitized['x-request-id']
    }
  }
}

// Create and export middleware instances
const errorMiddleware = new ErrorMiddleware()
export const errorHandler = errorMiddleware.handleError
export const notFoundHandler = errorMiddleware.handleNotFound
export const asyncHandler = errorMiddleware.asyncHandler

// Export class for advanced usage
export { ErrorMiddleware }
