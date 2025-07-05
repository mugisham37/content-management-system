import type { Request, Response, NextFunction } from "express"
import { logger } from "../utils/logger"

export interface LoggingOptions {
  includeBody?: boolean
  includeQuery?: boolean
  includeHeaders?: boolean
  excludeHeaders?: string[]
  maxBodySize?: number
  sanitizeFields?: string[]
}

export class LoggingMiddleware {
  /**
   * Request/Response logging middleware
   */
  public requestLogger = (options: LoggingOptions = {}) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now()
      const requestId = (req as any).requestId || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      // Store original end function
      const originalEnd = res.end

      // Log request
      this.logRequest(req, requestId, options)

      // Override end function to log response
      res.end = function (this: Response, ...args: any[]) {
        const responseTime = Date.now() - startTime
        
        // Log response
        LoggingMiddleware.prototype.logResponse.call(null, req, res, responseTime, requestId, options)
        
        // Call original end function
        return originalEnd.apply(this, args)
      }

      next()
    }
  }

  /**
   * Log incoming request
   */
  private logRequest(req: Request, requestId: string, options: LoggingOptions) {
    const logData: any = {
      requestId,
      method: req.method,
      url: req.url,
      path: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString()
    }

    // Include query parameters
    if (options.includeQuery && Object.keys(req.query).length > 0) {
      logData.query = this.sanitizeData(req.query, options.sanitizeFields)
    }

    // Include request body
    if (options.includeBody && req.body) {
      const bodySize = JSON.stringify(req.body).length
      if (!options.maxBodySize || bodySize <= options.maxBodySize) {
        logData.body = this.sanitizeData(req.body, options.sanitizeFields)
      } else {
        logData.bodyTruncated = true
        logData.bodySize = bodySize
      }
    }

    // Include headers
    if (options.includeHeaders) {
      const headers = { ...req.headers }
      
      // Remove excluded headers
      if (options.excludeHeaders) {
        options.excludeHeaders.forEach(header => {
          delete headers[header.toLowerCase()]
        })
      }

      // Always exclude sensitive headers
      const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key']
      sensitiveHeaders.forEach(header => {
        if (headers[header]) {
          headers[header] = '[REDACTED]'
        }
      })

      logData.headers = headers
    }

    logger.info("Incoming request", logData)
  }

  /**
   * Log outgoing response
   */
  private logResponse(req: Request, res: Response, responseTime: number, requestId: string, options: LoggingOptions) {
    const logData: any = {
      requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime,
      timestamp: new Date().toISOString()
    }

    // Add response headers if requested
    if (options.includeHeaders) {
      const responseHeaders = res.getHeaders()
      logData.responseHeaders = responseHeaders
    }

    // Log level based on status code
    if (res.statusCode >= 500) {
      logger.error("Request completed with server error", logData)
    } else if (res.statusCode >= 400) {
      logger.warn("Request completed with client error", logData)
    } else {
      logger.info("Request completed successfully", logData)
    }
  }

  /**
   * Sanitize sensitive data from logs
   */
  private sanitizeData(data: any, sensitiveFields: string[] = []): any {
    const defaultSensitiveFields = [
      'password', 'token', 'secret', 'key', 'auth', 'authorization',
      'cookie', 'session', 'csrf', 'ssn', 'credit', 'card'
    ]

    const allSensitiveFields = [...defaultSensitiveFields, ...sensitiveFields]

    const sanitize = (obj: any): any => {
      if (typeof obj !== 'object' || obj === null) {
        return obj
      }

      if (Array.isArray(obj)) {
        return obj.map(sanitize)
      }

      const sanitized: any = {}
      for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase()
        const isSensitive = allSensitiveFields.some(field => 
          lowerKey.includes(field.toLowerCase())
        )

        if (isSensitive) {
          sanitized[key] = '[REDACTED]'
        } else {
          sanitized[key] = sanitize(value)
        }
      }

      return sanitized
    }

    return sanitize(data)
  }

  /**
   * Error logging middleware
   */
  public errorLogger = (error: Error, req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId

    logger.error("Request error", {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      request: {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    })

    next(error)
  }

  /**
   * Performance logging middleware
   */
  public performanceLogger = (req: Request, res: Response, next: NextFunction) => {
    const startTime = process.hrtime.bigint()
    const requestId = (req as any).requestId

    res.on('finish', () => {
      const endTime = process.hrtime.bigint()
      const duration = Number(endTime - startTime) / 1000000 // Convert to milliseconds

      const logData = {
        requestId,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        memoryUsage: process.memoryUsage()
      }

      if (duration > 1000) { // Log slow requests (>1s)
        logger.warn("Slow request detected", logData)
      } else {
        logger.debug("Request performance", logData)
      }
    })

    next()
  }
}

// Create and export middleware instances
const loggingMiddleware = new LoggingMiddleware()

export const requestLogger = loggingMiddleware.requestLogger
export const errorLogger = loggingMiddleware.errorLogger
export const performanceLogger = loggingMiddleware.performanceLogger

// Export class for advanced usage
export { LoggingMiddleware }
