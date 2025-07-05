import rateLimit from "express-rate-limit"
import RedisStore from "rate-limit-redis"
import { config } from "../config"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import { redisClient } from "../services/redis.service"

export interface RateLimitOptions {
  windowMs?: number
  max?: number
  message?: string
  skipSuccessfulRequests?: boolean
  skipFailedRequests?: boolean
  keyGenerator?: (req: any) => string
  onLimitReached?: (req: any, res: any) => void
}

export class RateLimitMiddleware {
  /**
   * Create Redis-backed rate limiter
   */
  private createRedisRateLimit(options: RateLimitOptions) {
    return rateLimit({
      store: new RedisStore({
        sendCommand: (...args: string[]) => redisClient.call(...args),
      }),
      windowMs: options.windowMs || config.security.rateLimitWindowMs,
      max: options.max || config.security.rateLimitMax,
      message: {
        success: false,
        error: {
          message: options.message || "Too many requests from this IP, please try again later",
          code: "RATE_LIMIT_EXCEEDED",
          statusCode: 429
        }
      },
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: options.skipSuccessfulRequests || false,
      skipFailedRequests: options.skipFailedRequests || false,
      keyGenerator: options.keyGenerator || ((req) => req.ip),
      handler: (req, res) => {
        const requestId = (req as any).requestId
        
        logger.warn("Rate limit exceeded", {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          path: req.path,
          method: req.method,
          userId: (req as any).user?._id,
          requestId
        })

        if (options.onLimitReached) {
          options.onLimitReached(req, res)
        }

        throw new ApiError(429, options.message || "Rate limit exceeded", "RATE_LIMIT_EXCEEDED")
      }
    })
  }

  /**
   * General API rate limiting
   */
  public apiRateLimit = this.createRedisRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per window
    message: "API rate limit exceeded",
    keyGenerator: (req) => {
      // Use API key if present, otherwise IP
      const apiKey = req.headers['x-api-key']
      const userId = req.user?._id
      return apiKey ? `api:${apiKey}` : userId ? `user:${userId}` : `ip:${req.ip}`
    }
  })

  /**
   * Authentication rate limiting
   */
  public authRateLimit = this.createRedisRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    skipSuccessfulRequests: true,
    message: "Too many authentication attempts, please try again later",
    keyGenerator: (req) => `auth:${req.ip}:${req.body?.email || 'unknown'}`,
    onLimitReached: (req, res) => {
      // Log security event
      logger.security("Authentication rate limit exceeded", {
        ip: req.ip,
        email: req.body?.email,
        userAgent: req.get('User-Agent'),
        timestamp: new Date()
      })
    }
  })

  /**
   * Password reset rate limiting
   */
  public passwordResetRateLimit = this.createRedisRateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 attempts per hour
    message: "Too many password reset attempts, please try again later",
    keyGenerator: (req) => `password-reset:${req.ip}:${req.body?.email || 'unknown'}`
  })

  /**
   * Registration rate limiting
   */
  public registrationRateLimit = this.createRedisRateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 registrations per hour per IP
    message: "Too many registration attempts, please try again later",
    keyGenerator: (req) => `registration:${req.ip}`
  })

  /**
   * Content creation rate limiting
   */
  public contentCreationRateLimit = this.createRedisRateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 content items per minute
    message: "Content creation rate limit exceeded",
    keyGenerator: (req) => {
      const userId = req.user?._id
      const tenantId = req.tenant?._id || req.user?.tenantId
      return `content:${tenantId}:${userId}`
    }
  })

  /**
   * File upload rate limiting
   */
  public uploadRateLimit = this.createRedisRateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 uploads per minute
    message: "File upload rate limit exceeded",
    keyGenerator: (req) => {
      const userId = req.user?._id
      const tenantId = req.tenant?._id || req.user?.tenantId
      return `upload:${tenantId}:${userId}`
    }
  })

  /**
   * API key creation rate limiting
   */
  public apiKeyCreationRateLimit = this.createRedisRateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 10, // 10 API keys per day
    message: "API key creation rate limit exceeded",
    keyGenerator: (req) => {
      const userId = req.user?._id
      const tenantId = req.tenant?._id || req.user?.tenantId
      return `api-key-creation:${tenantId}:${userId}`
    }
  })

  /**
   * Webhook creation rate limiting
   */
  public webhookCreationRateLimit = this.createRedisRateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 webhooks per hour
    message: "Webhook creation rate limit exceeded",
    keyGenerator: (req) => {
      const userId = req.user?._id
      const tenantId = req.tenant?._id || req.user?.tenantId
      return `webhook-creation:${tenantId}:${userId}`
    }
  })

  /**
   * Search rate limiting
   */
  public searchRateLimit = this.createRedisRateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 searches per minute
    message: "Search rate limit exceeded",
    keyGenerator: (req) => {
      const userId = req.user?._id
      const apiKey = req.headers['x-api-key']
      return apiKey ? `search:api:${apiKey}` : userId ? `search:user:${userId}` : `search:ip:${req.ip}`
    }
  })

  /**
   * Export rate limiting
   */
  public exportRateLimit = this.createRedisRateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 exports per hour
    message: "Export rate limit exceeded",
    keyGenerator: (req) => {
      const userId = req.user?._id
      const tenantId = req.tenant?._id || req.user?.tenantId
      return `export:${tenantId}:${userId}`
    }
  })

  /**
   * Bulk operations rate limiting
   */
  public bulkOperationRateLimit = this.createRedisRateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 bulk operations per hour
    message: "Bulk operation rate limit exceeded",
    keyGenerator: (req) => {
      const userId = req.user?._id
      const tenantId = req.tenant?._id || req.user?.tenantId
      return `bulk:${tenantId}:${userId}`
    }
  })

  /**
   * Tenant-specific rate limiting
   */
  public createTenantRateLimit = (options: RateLimitOptions & { tenantLimits?: Record<string, number> }) => {
    return this.createRedisRateLimit({
      ...options,
      max: (req) => {
        const tenantId = req.tenant?._id || req.user?.tenantId
        const tenantPlan = req.tenant?.plan || 'FREE'
        
        // Different limits based on tenant plan
        const planLimits = {
          FREE: options.max || 100,
          BASIC: (options.max || 100) * 5,
          PROFESSIONAL: (options.max || 100) * 20,
          ENTERPRISE: (options.max || 100) * 100
        }

        return options.tenantLimits?.[tenantId] || planLimits[tenantPlan] || planLimits.FREE
      },
      keyGenerator: (req) => {
        const tenantId = req.tenant?._id || req.user?.tenantId
        const userId = req.user?._id
        return `tenant:${tenantId}:${userId || req.ip}`
      }
    })
  }

  /**
   * Dynamic rate limiting based on user role
   */
  public createRoleBasedRateLimit = (options: RateLimitOptions & { roleLimits?: Record<string, number> }) => {
    return this.createRedisRateLimit({
      ...options,
      max: (req) => {
        const userRole = req.user?.role || 'VIEWER'
        
        const roleLimits = {
          SUPER_ADMIN: (options.max || 100) * 10,
          ADMIN: (options.max || 100) * 5,
          EDITOR: (options.max || 100) * 3,
          AUTHOR: (options.max || 100) * 2,
          VIEWER: options.max || 100
        }

        return options.roleLimits?.[userRole] || roleLimits[userRole] || roleLimits.VIEWER
      },
      keyGenerator: (req) => {
        const userId = req.user?._id
        const role = req.user?.role
        return userId ? `role:${role}:${userId}` : `ip:${req.ip}`
      }
    })
  }

  /**
   * Sliding window rate limiter with Redis
   */
  public createSlidingWindowRateLimit = (options: {
    windowMs: number
    max: number
    keyGenerator?: (req: any) => string
  }) => {
    return async (req: any, res: any, next: any) => {
      try {
        const key = options.keyGenerator ? options.keyGenerator(req) : `sliding:${req.ip}`
        const now = Date.now()
        const window = options.windowMs
        const limit = options.max

        // Remove old entries
        await redisClient.zremrangebyscore(key, 0, now - window)

        // Count current requests
        const current = await redisClient.zcard(key)

        if (current >= limit) {
          logger.warn("Sliding window rate limit exceeded", {
            key,
            current,
            limit,
            ip: req.ip,
            path: req.path
          })

          return res.status(429).json({
            success: false,
            error: {
              message: "Rate limit exceeded",
              code: "RATE_LIMIT_EXCEEDED",
              statusCode: 429
            }
          })
        }

        // Add current request
        await redisClient.zadd(key, now, `${now}-${Math.random()}`)
        await redisClient.expire(key, Math.ceil(window / 1000))

        next()
      } catch (error) {
        logger.error("Sliding window rate limit error:", error)
        next() // Continue on error to avoid blocking requests
      }
    }
  }

  /**
   * Adaptive rate limiting based on system load
   */
  public createAdaptiveRateLimit = (baseOptions: RateLimitOptions) => {
    return this.createRedisRateLimit({
      ...baseOptions,
      max: (req) => {
        // Get system metrics
        const memoryUsage = process.memoryUsage()
        const cpuUsage = process.cpuUsage()
        
        // Calculate load factor (simplified)
        const memoryLoadFactor = memoryUsage.heapUsed / memoryUsage.heapTotal
        const loadFactor = Math.max(memoryLoadFactor, 0.1)
        
        // Adjust rate limit based on load
        const baseMax = baseOptions.max || 100
        const adjustedMax = Math.floor(baseMax * (2 - loadFactor))
        
        return Math.max(adjustedMax, Math.floor(baseMax * 0.1)) // Minimum 10% of base limit
      }
    })
  }
}

// Create and export middleware instances
const rateLimitMiddleware = new RateLimitMiddleware()

export const apiRateLimit = rateLimitMiddleware.apiRateLimit
export const authRateLimit = rateLimitMiddleware.authRateLimit
export const passwordResetRateLimit = rateLimitMiddleware.passwordResetRateLimit
export const registrationRateLimit = rateLimitMiddleware.registrationRateLimit
export const contentCreationRateLimit = rateLimitMiddleware.contentCreationRateLimit
export const uploadRateLimit = rateLimitMiddleware.uploadRateLimit
export const apiKeyCreationRateLimit = rateLimitMiddleware.apiKeyCreationRateLimit
export const webhookCreationRateLimit = rateLimitMiddleware.webhookCreationRateLimit
export const searchRateLimit = rateLimitMiddleware.searchRateLimit
export const exportRateLimit = rateLimitMiddleware.exportRateLimit
export const bulkOperationRateLimit = rateLimitMiddleware.bulkOperationRateLimit

export const createTenantRateLimit = rateLimitMiddleware.createTenantRateLimit
export const createRoleBasedRateLimit = rateLimitMiddleware.createRoleBasedRateLimit
export const createSlidingWindowRateLimit = rateLimitMiddleware.createSlidingWindowRateLimit
export const createAdaptiveRateLimit = rateLimitMiddleware.createAdaptiveRateLimit

// Export class for advanced usage
export { RateLimitMiddleware }

// Legacy exports for backward compatibility
export const rateLimitMiddleware as default = rateLimitMiddleware.apiRateLimit
