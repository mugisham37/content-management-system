import type { Request, Response, NextFunction } from "express"
import { TenantService } from "../services/tenant.service"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import type { TenantUserRole } from "../db/models/tenant.model"

export interface TenantRequest extends Request {
  tenant?: {
    _id: string
    name: string
    slug: string
    plan: string
    status: string
    settings: any
    usageLimits: any
    currentUsage: any
  }
  user?: {
    _id: string
    email: string
    role: string
    tenantId?: string
  }
  tenantRole?: TenantUserRole
}

const tenantService = new TenantService()

export class TenantMiddleware {
  /**
   * Middleware to resolve tenant from request
   * This middleware will attach the tenant to the request object if a tenant ID is provided
   */
  public resolveTenant = async (req: TenantRequest, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId
    
    try {
      // Check for tenant ID in various sources (priority order)
      const tenantId = 
        req.headers["x-tenant-id"] as string ||
        req.query.tenantId as string ||
        req.params.tenantId as string ||
        req.body.tenantId as string ||
        req.user?.tenantId

      // Check for tenant slug in subdomain or custom domain
      const host = req.headers.host
      const subdomain = host?.split('.')[0]
      
      if (!tenantId && !subdomain) {
        return next()
      }

      try {
        let tenant
        
        if (tenantId) {
          tenant = await tenantService.getTenantById(tenantId)
        } else if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
          tenant = await tenantService.getTenantBySlug(subdomain)
        }

        if (tenant) {
          // Check tenant status
          if (tenant.status === 'SUSPENDED') {
            logger.warn("Suspended tenant access attempt", {
              tenantId: tenant._id,
              tenantName: tenant.name,
              requestId,
              ip: req.ip
            })
            return next(new ApiError(403, "Tenant account is suspended", "TENANT_SUSPENDED"))
          }

          if (tenant.status === 'ARCHIVED') {
            logger.warn("Archived tenant access attempt", {
              tenantId: tenant._id,
              tenantName: tenant.name,
              requestId,
              ip: req.ip
            })
            return next(new ApiError(403, "Tenant account is archived", "TENANT_ARCHIVED"))
          }

          // Attach tenant to request
          req.tenant = {
            _id: tenant._id.toString(),
            name: tenant.name,
            slug: tenant.slug,
            plan: tenant.plan,
            status: tenant.status,
            settings: tenant.settings,
            usageLimits: tenant.usageLimits,
            currentUsage: tenant.currentUsage
          }

          logger.info("Tenant resolved", {
            tenantId: tenant._id,
            tenantName: tenant.name,
            tenantSlug: tenant.slug,
            requestId
          })
        }
      } catch (error) {
        // If tenant not found, continue without attaching tenant
        logger.warn(`Tenant not found: ${tenantId || subdomain}`, { requestId })
      }

      next()
    } catch (error) {
      logger.error("Error resolving tenant:", error, { requestId })
      next(error)
    }
  }

  /**
   * Middleware to require tenant
   * This middleware will ensure a tenant is attached to the request
   */
  public requireTenant = (req: TenantRequest, res: Response, next: NextFunction) => {
    if (!req.tenant) {
      return next(new ApiError(400, "Tenant ID is required", "TENANT_REQUIRED"))
    }

    next()
  }

  /**
   * Middleware to check if user is a member of the tenant
   */
  public checkTenantMembership = async (req: TenantRequest, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId
    
    try {
      if (!req.tenant) {
        return next(new ApiError(400, "Tenant ID is required", "TENANT_REQUIRED"))
      }

      if (!req.user) {
        return next(new ApiError(401, "Authentication required", "AUTHENTICATION_REQUIRED"))
      }

      const tenantId = req.tenant._id
      const userId = req.user._id

      const isMember = await tenantService.isUserMemberOfTenant(tenantId, userId)

      if (!isMember) {
        logger.warn("Non-member tenant access attempt", {
          userId,
          tenantId,
          requestId,
          ip: req.ip
        })
        return next(new ApiError(403, "You are not a member of this tenant", "NOT_TENANT_MEMBER"))
      }

      next()
    } catch (error) {
      logger.error("Error checking tenant membership:", error, { requestId })
      next(error)
    }
  }

  /**
   * Middleware to check if user has specific role in tenant
   */
  public checkTenantRole = (roles: TenantUserRole[]) => {
    return async (req: TenantRequest, res: Response, next: NextFunction) => {
      const requestId = (req as any).requestId
      
      try {
        if (!req.tenant) {
          return next(new ApiError(400, "Tenant ID is required", "TENANT_REQUIRED"))
        }

        if (!req.user) {
          return next(new ApiError(401, "Authentication required", "AUTHENTICATION_REQUIRED"))
        }

        const tenantId = req.tenant._id
        const userId = req.user._id

        const userRole = await tenantService.getUserRoleInTenant(tenantId, userId)

        if (!userRole || !roles.includes(userRole)) {
          logger.warn("Insufficient tenant role", {
            userId,
            tenantId,
            userRole,
            requiredRoles: roles,
            requestId
          })
          return next(new ApiError(403, `This action requires one of the following roles: ${roles.join(", ")}`, "INSUFFICIENT_TENANT_ROLE"))
        }

        // Attach role to request for convenience
        req.tenantRole = userRole

        next()
      } catch (error) {
        logger.error("Error checking tenant role:", error, { requestId })
        next(error)
      }
    }
  }

  /**
   * Middleware to track API requests for tenant
   */
  public trackTenantApiRequest = async (req: TenantRequest, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId
    
    try {
      if (req.tenant) {
        const tenantId = req.tenant._id

        // Increment API request count asynchronously
        // We don't await this to avoid blocking the request
        tenantService.incrementApiRequestCount(tenantId).catch((error) => {
          logger.error(`Error incrementing API request count for tenant ${tenantId}:`, error, { requestId })
        })
      }

      next()
    } catch (error) {
      logger.error("Error tracking tenant API request:", error, { requestId })
      next()
    }
  }

  /**
   * Middleware to check if tenant has reached usage limit
   */
  public checkTenantLimit = (limitType: string) => {
    return async (req: TenantRequest, res: Response, next: NextFunction) => {
      const requestId = (req as any).requestId
      
      try {
        if (!req.tenant) {
          return next(new ApiError(400, "Tenant ID is required", "TENANT_REQUIRED"))
        }

        const tenantId = req.tenant._id

        const { hasReachedLimit, currentUsage, limit } = await tenantService.checkTenantLimit(tenantId, limitType as any)

        if (hasReachedLimit) {
          logger.warn("Tenant usage limit reached", {
            tenantId,
            limitType,
            currentUsage,
            limit,
            requestId
          })
          return next(new ApiError(403, `Tenant has reached the ${limitType} limit (${currentUsage}/${limit})`, "TENANT_LIMIT_REACHED", {
            limitType,
            currentUsage,
            limit
          }))
        }

        next()
      } catch (error) {
        logger.error(`Error checking tenant ${limitType} limit:`, error, { requestId })
        next(error)
      }
    }
  }

  /**
   * Middleware to check storage limit before file uploads
   */
  public checkStorageLimit = async (req: TenantRequest, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId
    
    try {
      if (!req.tenant) {
        return next()
      }

      const tenantId = req.tenant._id
      const fileSize = req.headers['content-length'] ? parseInt(req.headers['content-length']) : 0

      const { hasReachedLimit, currentUsage, limit } = await tenantService.checkTenantLimit(tenantId, 'storage')

      // Check if adding this file would exceed the limit
      if (currentUsage + fileSize > limit) {
        logger.warn("Tenant storage limit would be exceeded", {
          tenantId,
          currentUsage,
          limit,
          fileSize,
          requestId
        })
        return next(new ApiError(413, `File upload would exceed storage limit (${Math.round((currentUsage + fileSize) / 1024 / 1024)}MB / ${Math.round(limit / 1024 / 1024)}MB)`, "STORAGE_LIMIT_EXCEEDED"))
      }

      next()
    } catch (error) {
      logger.error("Error checking storage limit:", error, { requestId })
      next(error)
    }
  }

  /**
   * Middleware to validate tenant plan features
   */
  public requirePlanFeature = (feature: string) => {
    return (req: TenantRequest, res: Response, next: NextFunction) => {
      if (!req.tenant) {
        return next(new ApiError(400, "Tenant ID is required", "TENANT_REQUIRED"))
      }

      const plan = req.tenant.plan
      const planFeatures = this.getPlanFeatures(plan)

      if (!planFeatures.includes(feature)) {
        logger.warn("Plan feature not available", {
          tenantId: req.tenant._id,
          plan,
          feature,
          requestId: (req as any).requestId
        })
        return next(new ApiError(403, `Feature '${feature}' is not available in your current plan`, "FEATURE_NOT_AVAILABLE", {
          feature,
          plan,
          availableFeatures: planFeatures
        }))
      }

      next()
    }
  }

  /**
   * Middleware to enforce tenant isolation
   */
  public enforceTenantIsolation = (req: TenantRequest, res: Response, next: NextFunction) => {
    // Ensure that any resource IDs in the request belong to the current tenant
    const tenantId = req.tenant?._id
    
    if (!tenantId) {
      return next()
    }

    // This would typically validate that resource IDs in params/body belong to the tenant
    // Implementation would depend on your specific resource structure
    
    next()
  }

  /**
   * Get features available for a plan
   */
  private getPlanFeatures(plan: string): string[] {
    const planFeatures: Record<string, string[]> = {
      FREE: ['basic_content', 'basic_media'],
      BASIC: ['basic_content', 'basic_media', 'webhooks', 'api_access'],
      PROFESSIONAL: ['basic_content', 'basic_media', 'webhooks', 'api_access', 'workflows', 'advanced_analytics'],
      ENTERPRISE: ['basic_content', 'basic_media', 'webhooks', 'api_access', 'workflows', 'advanced_analytics', 'custom_domains', 'sso', 'priority_support']
    }

    return planFeatures[plan] || planFeatures.FREE
  }

  /**
   * Middleware to log tenant activity
   */
  public logTenantActivity = (action: string) => {
    return (req: TenantRequest, res: Response, next: NextFunction) => {
      if (req.tenant) {
        res.on('finish', () => {
          if (res.statusCode < 400) {
            tenantService.logTenantActivity({
              tenantId: req.tenant!._id,
              action,
              userId: req.user?._id,
              metadata: {
                path: req.path,
                method: req.method,
                statusCode: res.statusCode,
                ip: req.ip,
                userAgent: req.headers['user-agent']
              },
              timestamp: new Date()
            }).catch(error => {
              logger.error("Error logging tenant activity:", error)
            })
          }
        })
      }
      next()
    }
  }
}

// Create and export middleware instances
const tenantMiddleware = new TenantMiddleware()

export const resolveTenant = tenantMiddleware.resolveTenant
export const requireTenant = tenantMiddleware.requireTenant
export const checkTenantMembership = tenantMiddleware.checkTenantMembership
export const checkTenantRole = tenantMiddleware.checkTenantRole
export const trackTenantApiRequest = tenantMiddleware.trackTenantApiRequest
export const checkTenantLimit = tenantMiddleware.checkTenantLimit
export const checkStorageLimit = tenantMiddleware.checkStorageLimit
export const requirePlanFeature = tenantMiddleware.requirePlanFeature
export const enforceTenantIsolation = tenantMiddleware.enforceTenantIsolation
export const logTenantActivity = tenantMiddleware.logTenantActivity

// Export class for advanced usage
export { TenantMiddleware }
