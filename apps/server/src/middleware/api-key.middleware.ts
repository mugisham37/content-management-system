import type { Request, Response, NextFunction } from "express"
import { ApiKeyService } from "../services/api-key.service"
import { ApiKeyScope } from "../db/models/api-key.model"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import { config } from "../config"

export interface ApiKeyRequest extends Request {
  apiKey?: {
    id: string
    scopes: ApiKeyScope[]
    tenantId?: string
    name: string
    lastUsedAt?: Date
  }
  tenantId?: string
}

export class ApiKeyMiddleware {
  private apiKeyService: ApiKeyService

  constructor() {
    this.apiKeyService = new ApiKeyService()
  }

  /**
   * Middleware to authenticate requests using API key
   */
  public authenticate = async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId
    
    try {
      // Get API key from header
      const apiKey = req.headers["x-api-key"] as string

      if (!apiKey) {
        return next()
      }

      try {
        // Validate API key and update last used timestamp
        const validApiKey = await this.apiKeyService.validateApiKey(apiKey)

        // Check if API key is expired
        if (validApiKey.expiresAt && new Date() > validApiKey.expiresAt) {
          logger.warn("Expired API key used", { 
            apiKeyId: validApiKey._id,
            requestId,
            ip: req.ip 
          })
          return next()
        }

        // Update last used timestamp asynchronously
        this.apiKeyService.updateLastUsed(validApiKey._id).catch(error => {
          logger.error("Failed to update API key last used timestamp:", error)
        })

        // Attach API key info to request
        req.apiKey = {
          id: validApiKey._id,
          scopes: validApiKey.scopes,
          tenantId: validApiKey.tenantId,
          name: validApiKey.name,
          lastUsedAt: validApiKey.lastUsedAt,
        }

        // If API key has a tenant, attach it to the request
        if (validApiKey.tenantId) {
          req.tenantId = validApiKey.tenantId
        }

        // Log successful API key authentication
        logger.info("API key authenticated", {
          apiKeyId: validApiKey._id,
          apiKeyName: validApiKey.name,
          tenantId: validApiKey.tenantId,
          scopes: validApiKey.scopes,
          requestId,
          ip: req.ip
        })

        next()
      } catch (error) {
        // Log failed API key validation
        logger.warn("Invalid API key used", { 
          apiKey: apiKey.substring(0, 8) + "...",
          requestId,
          ip: req.ip,
          error: error.message 
        })
        
        // If API key is invalid, continue as unauthenticated
        return next()
      }
    } catch (error) {
      logger.error("API key middleware error:", error, { requestId })
      next(error)
    }
  }

  /**
   * Middleware to require API key authentication
   */
  public requireApiKey = (req: ApiKeyRequest, res: Response, next: NextFunction) => {
    if (!req.apiKey) {
      return next(new ApiError(401, "API key required", "API_KEY_REQUIRED"))
    }

    next()
  }

  /**
   * Middleware to require specific API key scopes
   */
  public requireScopes = (scopes: ApiKeyScope[]) => {
    return (req: ApiKeyRequest, res: Response, next: NextFunction) => {
      if (!req.apiKey) {
        return next(new ApiError(401, "API key required", "API_KEY_REQUIRED"))
      }

      const apiKeyScopes = req.apiKey.scopes

      // Check if API key has admin scope (which grants all permissions)
      if (apiKeyScopes.includes(ApiKeyScope.ADMIN)) {
        return next()
      }

      // Check if API key has all required scopes
      const hasRequiredScopes = scopes.every((scope) => apiKeyScopes.includes(scope))

      if (!hasRequiredScopes) {
        logger.warn("API key insufficient permissions", {
          apiKeyId: req.apiKey.id,
          requiredScopes: scopes,
          availableScopes: apiKeyScopes,
          requestId: (req as any).requestId
        })
        
        return next(new ApiError(403, "API key does not have the required permissions", "INSUFFICIENT_API_KEY_PERMISSIONS", {
          required: scopes,
          available: apiKeyScopes
        }))
      }

      next()
    }
  }

  /**
   * Middleware to check API key rate limits
   */
  public checkRateLimit = async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
    if (!req.apiKey) {
      return next()
    }

    try {
      const isAllowed = await this.apiKeyService.checkRateLimit(req.apiKey.id)
      
      if (!isAllowed) {
        logger.warn("API key rate limit exceeded", {
          apiKeyId: req.apiKey.id,
          requestId: (req as any).requestId,
          ip: req.ip
        })
        
        return next(new ApiError(429, "API key rate limit exceeded", "API_KEY_RATE_LIMIT_EXCEEDED"))
      }

      next()
    } catch (error) {
      logger.error("API key rate limit check error:", error)
      next(error)
    }
  }
}

// Create and export middleware instances
const apiKeyMiddleware = new ApiKeyMiddleware()
export const authenticateApiKey = apiKeyMiddleware.authenticate
export const requireApiKey = apiKeyMiddleware.requireApiKey
export const requireApiKeyScopes = apiKeyMiddleware.requireScopes
export const checkApiKeyRateLimit = apiKeyMiddleware.checkRateLimit
