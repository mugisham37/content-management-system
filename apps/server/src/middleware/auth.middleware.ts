import type { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"
import { config } from "../config"
import { UserModel } from "../db/models/user.model"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import { redisClient } from "../services/redis.service"
import { sessionService } from "../services/session.service"

export interface AuthenticatedRequest extends Request {
  user?: {
    _id: string
    email: string
    firstName: string
    lastName: string
    role: string
    tenantId?: string
    isActive: boolean
    permissions?: string[]
    lastLoginAt?: Date
    sessionId?: string
  }
  session?: {
    id: string
    userId: string
    tenantId?: string
    expiresAt: Date
    ipAddress: string
    userAgent: string
    isActive: boolean
  }
  refreshToken?: string
}

export class AuthMiddleware {
  /**
   * Main authentication middleware
   */
  public authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId
    
    try {
      // Skip authentication for certain routes
      const skipAuthRoutes = [
        "/health",
        "/api/v1/auth/login",
        "/api/v1/auth/register",
        "/api/v1/auth/forgot-password",
        "/api/v1/auth/reset-password",
        "/api/v1/auth/verify-email",
        "/api/v1/auth/refresh-token",
        "/api-docs",
        "/graphql",
        "/webhooks",
      ]

      const shouldSkipAuth = skipAuthRoutes.some((route) => req.path.startsWith(route))
      if (shouldSkipAuth) {
        return next()
      }

      // Get token from header
      const authHeader = req.headers.authorization
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return next()
      }

      const token = authHeader.substring(7)

      try {
        // Verify JWT token
        const decoded = jwt.verify(token, config.jwt.secret) as any

        // Check if token is blacklisted
        const isBlacklisted = await this.isTokenBlacklisted(token)
        if (isBlacklisted) {
          logger.warn("Blacklisted token used", { 
            userId: decoded.userId,
            requestId,
            ip: req.ip 
          })
          return next()
        }

        // Get user from database with full details
        const user = await UserModel.findById(decoded.userId)
          .select("-password")
          .populate("tenant", "name slug plan status")

        if (!user) {
          logger.warn("Token valid but user not found", { 
            userId: decoded.userId,
            requestId 
          })
          return next()
        }

        // Check if user is active
        if (!user.isActive) {
          logger.warn("Inactive user attempted access", { 
            userId: user._id,
            email: user.email,
            requestId 
          })
          return next()
        }

        // Check if user account is locked
        if (user.lockUntil && user.lockUntil > new Date()) {
          logger.warn("Locked user attempted access", { 
            userId: user._id,
            email: user.email,
            lockUntil: user.lockUntil,
            requestId 
          })
          return next()
        }

        // Validate session if session ID is present
        if (decoded.sessionId) {
          const session = await sessionService.validateSession(decoded.sessionId, user._id)
          if (!session) {
            logger.warn("Invalid session", { 
              userId: user._id,
              sessionId: decoded.sessionId,
              requestId 
            })
            return next()
          }
          req.session = session
        }

        // Load user permissions
        const permissions = await this.loadUserPermissions(user._id, user.role, user.tenantId)

        // Attach user to request with enhanced information
        req.user = {
          _id: user._id.toString(),
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tenantId: user.tenantId?.toString(),
          isActive: user.isActive,
          permissions,
          lastLoginAt: user.lastLoginAt,
          sessionId: decoded.sessionId,
        }

        // Update last activity timestamp asynchronously
        this.updateLastActivity(user._id, req.ip, req.headers["user-agent"]).catch(error => {
          logger.error("Failed to update last activity:", error)
        })

        // Log successful authentication
        logger.info("User authenticated", {
          userId: user._id,
          email: user.email,
          role: user.role,
          tenantId: user.tenantId,
          sessionId: decoded.sessionId,
          requestId,
          ip: req.ip
        })

        next()
      } catch (error) {
        // Handle specific JWT errors
        if (error.name === "TokenExpiredError") {
          logger.info("Expired token used", { requestId, ip: req.ip })
        } else if (error.name === "JsonWebTokenError") {
          logger.warn("Invalid token used", { requestId, ip: req.ip })
        } else {
          logger.error("Token verification error:", error, { requestId })
        }
        
        // Token is invalid, continue without user
        next()
      }
    } catch (error) {
      logger.error("Auth middleware error:", error, { requestId })
      next(error)
    }
  }

  /**
   * Require authentication middleware
   */
  public requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required", "AUTHENTICATION_REQUIRED"))
    }
    next()
  }

  /**
   * Require specific roles
   */
  public requireRole = (roles: string[]) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      if (!req.user) {
        return next(new ApiError(401, "Authentication required", "AUTHENTICATION_REQUIRED"))
      }

      if (!roles.includes(req.user.role)) {
        logger.warn("Insufficient role permissions", {
          userId: req.user._id,
          userRole: req.user.role,
          requiredRoles: roles,
          requestId: (req as any).requestId
        })
        
        return next(new ApiError(403, "Insufficient permissions", "INSUFFICIENT_ROLE_PERMISSIONS", {
          required: roles,
          current: req.user.role
        }))
      }

      next()
    }
  }

  /**
   * Require specific permissions
   */
  public requirePermissions = (permissions: string[]) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      if (!req.user) {
        return next(new ApiError(401, "Authentication required", "AUTHENTICATION_REQUIRED"))
      }

      const userPermissions = req.user.permissions || []
      const hasAllPermissions = permissions.every(permission => 
        userPermissions.includes(permission) || userPermissions.includes("*")
      )

      if (!hasAllPermissions) {
        logger.warn("Insufficient permissions", {
          userId: req.user._id,
          userPermissions,
          requiredPermissions: permissions,
          requestId: (req as any).requestId
        })
        
        return next(new ApiError(403, "Insufficient permissions", "INSUFFICIENT_PERMISSIONS", {
          required: permissions,
          available: userPermissions
        }))
      }

      next()
    }
  }

  /**
   * Require user to own resource or have admin role
   */
  public requireOwnershipOrAdmin = (getUserIdFromRequest: (req: Request) => string) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      if (!req.user) {
        return next(new ApiError(401, "Authentication required", "AUTHENTICATION_REQUIRED"))
      }

      const resourceUserId = getUserIdFromRequest(req)
      const isOwner = req.user._id === resourceUserId
      const isAdmin = ["SUPER_ADMIN", "ADMIN"].includes(req.user.role)

      if (!isOwner && !isAdmin) {
        logger.warn("Ownership or admin access required", {
          userId: req.user._id,
          resourceUserId,
          userRole: req.user.role,
          requestId: (req as any).requestId
        })
        
        return next(new ApiError(403, "Access denied", "ACCESS_DENIED"))
      }

      next()
    }
  }

  /**
   * Validate refresh token
   */
  public validateRefreshToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const refreshToken = req.body.refreshToken || req.cookies.refreshToken

      if (!refreshToken) {
        return next(new ApiError(400, "Refresh token required", "REFRESH_TOKEN_REQUIRED"))
      }

      // Verify refresh token
      const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as any

      // Check if refresh token is blacklisted
      const isBlacklisted = await this.isTokenBlacklisted(refreshToken)
      if (isBlacklisted) {
        return next(new ApiError(401, "Invalid refresh token", "INVALID_REFRESH_TOKEN"))
      }

      // Get user
      const user = await UserModel.findById(decoded.userId).select("-password")
      if (!user || !user.isActive) {
        return next(new ApiError(401, "Invalid refresh token", "INVALID_REFRESH_TOKEN"))
      }

      req.user = {
        _id: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId?.toString(),
        isActive: user.isActive,
      }

      req.refreshToken = refreshToken

      next()
    } catch (error) {
      logger.error("Refresh token validation error:", error)
      next(new ApiError(401, "Invalid refresh token", "INVALID_REFRESH_TOKEN"))
    }
  }

  /**
   * Check if token is blacklisted
   */
  private async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      const result = await redisClient.get(`blacklist:${token}`)
      return result !== null
    } catch (error) {
      logger.error("Error checking token blacklist:", error)
      return false
    }
  }

  /**
   * Load user permissions based on role and tenant
   */
  private async loadUserPermissions(userId: string, role: string, tenantId?: string): Promise<string[]> {
    try {
      // Base permissions by role
      const rolePermissions: Record<string, string[]> = {
        SUPER_ADMIN: ["*"],
        ADMIN: [
          "users:read", "users:write", "users:delete",
          "content:read", "content:write", "content:delete", "content:publish",
          "content-types:read", "content-types:write", "content-types:delete",
          "media:read", "media:write", "media:delete",
          "webhooks:read", "webhooks:write", "webhooks:delete",
          "workflows:read", "workflows:write", "workflows:delete",
          "settings:read", "settings:write",
          "analytics:read"
        ],
        EDITOR: [
          "content:read", "content:write", "content:publish",
          "content-types:read",
          "media:read", "media:write",
          "workflows:read", "workflows:write"
        ],
        AUTHOR: [
          "content:read", "content:write",
          "content-types:read",
          "media:read", "media:write"
        ],
        VIEWER: [
          "content:read",
          "content-types:read",
          "media:read"
        ]
      }

      let permissions = rolePermissions[role] || []

      // Load additional tenant-specific permissions if applicable
      if (tenantId) {
        const tenantPermissions = await this.loadTenantPermissions(userId, tenantId)
        permissions = [...permissions, ...tenantPermissions]
      }

      // Remove duplicates
      return [...new Set(permissions)]
    } catch (error) {
      logger.error("Error loading user permissions:", error)
      return []
    }
  }

  /**
   * Load tenant-specific permissions
   */
  private async loadTenantPermissions(userId: string, tenantId: string): Promise<string[]> {
    try {
      // This would typically load from a tenant_user_permissions table
      // For now, return empty array
      return []
    } catch (error) {
      logger.error("Error loading tenant permissions:", error)
      return []
    }
  }

  /**
   * Update user's last activity
   */
  private async updateLastActivity(userId: string, ipAddress?: string, userAgent?: string): Promise<void> {
    try {
      await UserModel.findByIdAndUpdate(userId, {
        lastLoginAt: new Date(),
        $push: {
          loginHistory: {
            timestamp: new Date(),
            ipAddress,
            userAgent,
          }
        }
      })
    } catch (error) {
      logger.error("Error updating last activity:", error)
    }
  }
}

// Create and export middleware instances
const authMiddleware = new AuthMiddleware()
export const authenticate = authMiddleware.authenticate
export const requireAuth = authMiddleware.requireAuth
export const requireRole = authMiddleware.requireRole
export const requirePermissions = authMiddleware.requirePermissions
export const requireOwnershipOrAdmin = authMiddleware.requireOwnershipOrAdmin
export const validateRefreshToken = authMiddleware.validateRefreshToken

// Legacy export for backward compatibility
export default authMiddleware.authenticate
