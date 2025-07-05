import type { Request, Response, NextFunction } from "express"
import helmet from "helmet"
import cors from "cors"
import { config } from "../config"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"

export interface SecurityOptions {
  cors?: {
    origin?: string | string[] | boolean
    credentials?: boolean
    methods?: string[]
    allowedHeaders?: string[]
    exposedHeaders?: string[]
    maxAge?: number
  }
  helmet?: {
    contentSecurityPolicy?: boolean | object
    crossOriginEmbedderPolicy?: boolean
    crossOriginOpenerPolicy?: boolean
    crossOriginResourcePolicy?: boolean
    dnsPrefetchControl?: boolean
    frameguard?: boolean | object
    hidePoweredBy?: boolean
    hsts?: boolean | object
    ieNoOpen?: boolean
    noSniff?: boolean
    originAgentCluster?: boolean
    permittedCrossDomainPolicies?: boolean
    referrerPolicy?: boolean | object
    xssFilter?: boolean
  }
  rateLimiting?: {
    windowMs?: number
    max?: number
    skipSuccessfulRequests?: boolean
  }
}

export class SecurityMiddleware {
  /**
   * Configure CORS middleware
   */
  public configureCors = (options: SecurityOptions['cors'] = {}) => {
    const corsOptions = {
      origin: options.origin || config.server.corsOrigin || true,
      credentials: options.credentials !== undefined ? options.credentials : true,
      methods: options.methods || ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: options.allowedHeaders || [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'X-API-Key',
        'X-Tenant-ID',
        'X-Request-ID'
      ],
      exposedHeaders: options.exposedHeaders || [
        'X-Total-Count',
        'X-Page-Count',
        'X-Current-Page',
        'X-Rate-Limit-Limit',
        'X-Rate-Limit-Remaining',
        'X-Rate-Limit-Reset'
      ],
      maxAge: options.maxAge || 86400, // 24 hours
      optionsSuccessStatus: 200
    }

    return cors(corsOptions)
  }

  /**
   * Configure Helmet security headers
   */
  public configureHelmet = (options: SecurityOptions['helmet'] = {}) => {
    const helmetOptions = {
      contentSecurityPolicy: options.contentSecurityPolicy !== false ? {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          manifestSrc: ["'self'"],
          ...(typeof options.contentSecurityPolicy === 'object' ? options.contentSecurityPolicy : {})
        }
      } : false,
      crossOriginEmbedderPolicy: options.crossOriginEmbedderPolicy !== false,
      crossOriginOpenerPolicy: options.crossOriginOpenerPolicy !== false,
      crossOriginResourcePolicy: options.crossOriginResourcePolicy !== false ? { policy: "cross-origin" } : false,
      dnsPrefetchControl: options.dnsPrefetchControl !== false,
      frameguard: options.frameguard !== false ? { action: 'deny' } : false,
      hidePoweredBy: options.hidePoweredBy !== false,
      hsts: options.hsts !== false ? {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true
      } : false,
      ieNoOpen: options.ieNoOpen !== false,
      noSniff: options.noSniff !== false,
      originAgentCluster: options.originAgentCluster !== false,
      permittedCrossDomainPolicies: options.permittedCrossDomainPolicies !== false ? { permittedPolicies: "none" } : false,
      referrerPolicy: options.referrerPolicy !== false ? { policy: "no-referrer" } : false,
      xssFilter: options.xssFilter !== false
    }

    return helmet(helmetOptions)
  }

  /**
   * IP whitelist middleware
   */
  public ipWhitelist = (allowedIPs: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress
      const requestId = (req as any).requestId

      if (!clientIP) {
        logger.warn("Unable to determine client IP", { requestId })
        return next(new ApiError(403, "Access denied", "IP_UNKNOWN"))
      }

      // Check if IP is in whitelist
      const isAllowed = allowedIPs.some(allowedIP => {
        if (allowedIP.includes('/')) {
          // CIDR notation support would go here
          return false
        }
        return clientIP === allowedIP
      })

      if (!isAllowed) {
        logger.warn("IP not in whitelist", {
          clientIP,
          allowedIPs,
          requestId,
          path: req.path,
          method: req.method
        })
        return next(new ApiError(403, "Access denied", "IP_NOT_ALLOWED"))
      }

      next()
    }
  }

  /**
   * IP blacklist middleware
   */
  public ipBlacklist = (blockedIPs: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress
      const requestId = (req as any).requestId

      if (!clientIP) {
        return next()
      }

      // Check if IP is in blacklist
      const isBlocked = blockedIPs.some(blockedIP => {
        if (blockedIP.includes('/')) {
          // CIDR notation support would go here
          return false
        }
        return clientIP === blockedIP
      })

      if (isBlocked) {
        logger.warn("Blocked IP attempted access", {
          clientIP,
          requestId,
          path: req.path,
          method: req.method,
          userAgent: req.headers['user-agent']
        })
        return next(new ApiError(403, "Access denied", "IP_BLOCKED"))
      }

      next()
    }
  }

  /**
   * Request size limit middleware
   */
  public requestSizeLimit = (maxSize: number = 10 * 1024 * 1024) => { // 10MB default
    return (req: Request, res: Response, next: NextFunction) => {
      const contentLength = req.headers['content-length']
      
      if (contentLength && parseInt(contentLength) > maxSize) {
        logger.warn("Request size limit exceeded", {
          contentLength: parseInt(contentLength),
          maxSize,
          requestId: (req as any).requestId,
          path: req.path,
          method: req.method
        })
        return next(new ApiError(413, "Request entity too large", "REQUEST_TOO_LARGE"))
      }

      next()
    }
  }

  /**
   * SQL injection protection middleware
   */
  public sqlInjectionProtection = (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId
    
    // SQL injection patterns
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/i,
      /(\b(OR|AND)\s+\d+\s*=\s*\d+)/i,
      /(--|\/\*|\*\/|;)/,
      /(\b(CHAR|NCHAR|VARCHAR|NVARCHAR)\s*\(\s*\d+\s*\))/i,
      /(\b(CAST|CONVERT|SUBSTRING|ASCII|CHAR_LENGTH)\s*\()/i
    ]

    const checkForSQLInjection = (obj: any, path: string = ''): boolean => {
      if (typeof obj === 'string') {
        return sqlPatterns.some(pattern => pattern.test(obj))
      }
      
      if (Array.isArray(obj)) {
        return obj.some((item, index) => checkForSQLInjection(item, `${path}[${index}]`))
      }
      
      if (obj && typeof obj === 'object') {
        return Object.entries(obj).some(([key, value]) => 
          checkForSQLInjection(value, path ? `${path}.${key}` : key)
        )
      }
      
      return false
    }

    // Check request body
    if (req.body && checkForSQLInjection(req.body, 'body')) {
      logger.warn("Potential SQL injection attempt detected in body", {
        body: req.body,
        requestId,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      })
      return next(new ApiError(400, "Invalid request data", "INVALID_REQUEST_DATA"))
    }

    // Check query parameters
    if (req.query && checkForSQLInjection(req.query, 'query')) {
      logger.warn("Potential SQL injection attempt detected in query", {
        query: req.query,
        requestId,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      })
      return next(new ApiError(400, "Invalid query parameters", "INVALID_QUERY_PARAMETERS"))
    }

    next()
  }

  /**
   * XSS protection middleware
   */
  public xssProtection = (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId
    
    // XSS patterns
    const xssPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<img[^>]+src[\\s]*=[\\s]*["\']javascript:/gi,
      /<object[^>]*>/gi,
      /<embed[^>]*>/gi,
      /<link[^>]*>/gi,
      /<meta[^>]*>/gi
    ]

    const checkForXSS = (obj: any, path: string = ''): boolean => {
      if (typeof obj === 'string') {
        return xssPatterns.some(pattern => pattern.test(obj))
      }
      
      if (Array.isArray(obj)) {
        return obj.some((item, index) => checkForXSS(item, `${path}[${index}]`))
      }
      
      if (obj && typeof obj === 'object') {
        return Object.entries(obj).some(([key, value]) => 
          checkForXSS(value, path ? `${path}.${key}` : key)
        )
      }
      
      return false
    }

    // Check request body
    if (req.body && checkForXSS(req.body, 'body')) {
      logger.warn("Potential XSS attempt detected in body", {
        body: req.body,
        requestId,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      })
      return next(new ApiError(400, "Invalid request data", "INVALID_REQUEST_DATA"))
    }

    // Check query parameters
    if (req.query && checkForXSS(req.query, 'query')) {
      logger.warn("Potential XSS attempt detected in query", {
        query: req.query,
        requestId,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      })
      return next(new ApiError(400, "Invalid query parameters", "INVALID_QUERY_PARAMETERS"))
    }

    next()
  }

  /**
   * CSRF protection middleware
   */
  public csrfProtection = (req: Request, res: Response, next: NextFunction) => {
    // Skip CSRF for safe methods and API endpoints
    const safeMethods = ['GET', 'HEAD', 'OPTIONS']
    const isApiRequest = req.path.startsWith('/api/')
    
    if (safeMethods.includes(req.method) || isApiRequest) {
      return next()
    }

    const csrfToken = req.headers['x-csrf-token'] || req.body._csrf
    const sessionCsrfToken = (req as any).session?.csrfToken

    if (!csrfToken || !sessionCsrfToken || csrfToken !== sessionCsrfToken) {
      logger.warn("CSRF token validation failed", {
        hasToken: !!csrfToken,
        hasSessionToken: !!sessionCsrfToken,
        requestId: (req as any).requestId,
        ip: req.ip,
        path: req.path,
        method: req.method
      })
      return next(new ApiError(403, "Invalid CSRF token", "INVALID_CSRF_TOKEN"))
    }

    next()
  }

  /**
   * Content type validation middleware
   */
  public validateContentType = (allowedTypes: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const contentType = req.headers['content-type']
      
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        if (!contentType) {
          return next(new ApiError(400, "Content-Type header is required", "CONTENT_TYPE_REQUIRED"))
        }

        const isAllowed = allowedTypes.some(type => contentType.includes(type))
        
        if (!isAllowed) {
          logger.warn("Invalid content type", {
            contentType,
            allowedTypes,
            requestId: (req as any).requestId,
            path: req.path,
            method: req.method
          })
          return next(new ApiError(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE"))
        }
      }

      next()
    }
  }

  /**
   * User agent validation middleware
   */
  public validateUserAgent = (options: {
    required?: boolean
    blockedPatterns?: RegExp[]
    allowedPatterns?: RegExp[]
  } = {}) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const userAgent = req.headers['user-agent']
      const requestId = (req as any).requestId

      // Check if user agent is required
      if (options.required && !userAgent) {
        return next(new ApiError(400, "User-Agent header is required", "USER_AGENT_REQUIRED"))
      }

      if (userAgent) {
        // Check blocked patterns
        if (options.blockedPatterns) {
          const isBlocked = options.blockedPatterns.some(pattern => pattern.test(userAgent))
          if (isBlocked) {
            logger.warn("Blocked user agent detected", {
              userAgent,
              requestId,
              ip: req.ip,
              path: req.path
            })
            return next(new ApiError(403, "Access denied", "USER_AGENT_BLOCKED"))
          }
        }

        // Check allowed patterns
        if (options.allowedPatterns) {
          const isAllowed = options.allowedPatterns.some(pattern => pattern.test(userAgent))
          if (!isAllowed) {
            logger.warn("User agent not in allowed list", {
              userAgent,
              requestId,
              ip: req.ip,
              path: req.path
            })
            return next(new ApiError(403, "Access denied", "USER_AGENT_NOT_ALLOWED"))
          }
        }
      }

      next()
    }
  }

  /**
   * Request ID middleware
   */
  public requestId = (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.headers['x-request-id'] as string || 
                     `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    ;(req as any).requestId = requestId
    res.setHeader('X-Request-ID', requestId)
    
    next()
  }

  /**
   * Security headers middleware
   */
  public securityHeaders = (req: Request, res: Response, next: NextFunction) => {
    // Remove sensitive headers
    res.removeHeader('X-Powered-By')
    
    // Add security headers
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-XSS-Protection', '1; mode=block')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
    
    next()
  }
}

// Create and export middleware instances
const securityMiddleware = new SecurityMiddleware()

export const configureCors = securityMiddleware.configureCors
export const configureHelmet = securityMiddleware.configureHelmet
export const ipWhitelist = securityMiddleware.ipWhitelist
export const ipBlacklist = securityMiddleware.ipBlacklist
export const requestSizeLimit = securityMiddleware.requestSizeLimit
export const sqlInjectionProtection = securityMiddleware.sqlInjectionProtection
export const xssProtection = securityMiddleware.xssProtection
export const csrfProtection = securityMiddleware.csrfProtection
export const validateContentType = securityMiddleware.validateContentType
export const validateUserAgent = securityMiddleware.validateUserAgent
export const requestId = securityMiddleware.requestId
export const securityHeaders = securityMiddleware.securityHeaders

// Export class for advanced usage
export { SecurityMiddleware }
