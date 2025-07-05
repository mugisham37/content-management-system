/**
 * Comprehensive Middleware Layer for Content Management System
 * 
 * This file orchestrates all middleware components providing a unified interface
 * for authentication, authorization, security, monitoring, validation, and more.
 */

// Core middleware exports
export * from './auth.middleware'
export * from './api-key.middleware'
export * from './tenant.middleware'
export * from './validation.middleware'
export * from './security.middleware'
export * from './error.middleware'
export * from './monitoring.middleware'
export * from './rate-limit.middleware'
export * from './audit.middleware'

// Import middleware classes for advanced configuration
import { AuthMiddleware } from './auth.middleware'
import { ApiKeyMiddleware } from './api-key.middleware'
import { TenantMiddleware } from './tenant.middleware'
import { ValidationMiddleware } from './validation.middleware'
import { SecurityMiddleware } from './security.middleware'
import { ErrorMiddleware } from './error.middleware'
import { MonitoringMiddleware } from './monitoring.middleware'
import { RateLimitMiddleware } from './rate-limit.middleware'

import type { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger'
import { config } from '../config'

/**
 * Middleware orchestration class for high-level middleware management
 */
export class MiddlewareOrchestrator {
  private authMiddleware: AuthMiddleware
  private apiKeyMiddleware: ApiKeyMiddleware
  private tenantMiddleware: TenantMiddleware
  private validationMiddleware: ValidationMiddleware
  private securityMiddleware: SecurityMiddleware
  private errorMiddleware: ErrorMiddleware
  private monitoringMiddleware: MonitoringMiddleware
  private rateLimitMiddleware: RateLimitMiddleware

  constructor() {
    this.authMiddleware = new AuthMiddleware()
    this.apiKeyMiddleware = new ApiKeyMiddleware()
    this.tenantMiddleware = new TenantMiddleware()
    this.validationMiddleware = new ValidationMiddleware()
    this.securityMiddleware = new SecurityMiddleware()
    this.errorMiddleware = new ErrorMiddleware()
    this.monitoringMiddleware = new MonitoringMiddleware()
    this.rateLimitMiddleware = new RateLimitMiddleware()
  }

  /**
   * Get core middleware stack for basic API protection
   */
  public getCoreMiddlewareStack() {
    return [
      // Request context and security
      this.securityMiddleware.requestId,
      this.securityMiddleware.securityHeaders,
      this.securityMiddleware.configureCors(),
      this.securityMiddleware.configureHelmet(),
      
      // Request validation and sanitization
      this.validationMiddleware.sanitizeInput,
      this.securityMiddleware.sqlInjectionProtection,
      this.securityMiddleware.xssProtection,
      
      // Rate limiting
      this.rateLimitMiddleware.apiRateLimit,
      
      // Authentication and tenant resolution
      this.authMiddleware.authenticate,
      this.apiKeyMiddleware.authenticate,
      this.tenantMiddleware.resolveTenant,
      
      // Monitoring and tracking
      this.monitoringMiddleware.trackApiMetrics,
      this.monitoringMiddleware.trackPerformance,
      this.tenantMiddleware.trackTenantApiRequest,
    ]
  }

  /**
   * Get authentication middleware stack
   */
  public getAuthMiddlewareStack() {
    return [
      this.rateLimitMiddleware.authRateLimit,
      this.validationMiddleware.sanitizeInput,
      this.securityMiddleware.sqlInjectionProtection,
      this.securityMiddleware.xssProtection,
    ]
  }

  /**
   * Get content management middleware stack
   */
  public getContentMiddlewareStack() {
    return [
      this.authMiddleware.requireAuth,
      this.tenantMiddleware.requireTenant,
      this.tenantMiddleware.checkTenantMembership,
      this.rateLimitMiddleware.contentCreationRateLimit,
      this.tenantMiddleware.checkTenantLimit('content'),
      this.validationMiddleware.validatePagination(),
      this.validationMiddleware.validateSorting(['title', 'createdAt', 'updatedAt', 'status']),
      this.validationMiddleware.validateSearch({ minLength: 2, maxLength: 100 }),
    ]
  }

  /**
   * Get file upload middleware stack
   */
  public getFileUploadMiddlewareStack(options: {
    maxSize?: number
    allowedTypes?: string[]
    allowedExtensions?: string[]
    maxFiles?: number
  } = {}) {
    return [
      this.authMiddleware.requireAuth,
      this.tenantMiddleware.requireTenant,
      this.tenantMiddleware.checkTenantMembership,
      this.rateLimitMiddleware.uploadRateLimit,
      this.tenantMiddleware.checkStorageLimit,
      this.validationMiddleware.validateFileUpload({
        maxSize: options.maxSize || 10 * 1024 * 1024, // 10MB
        allowedMimeTypes: options.allowedTypes || [
          'image/jpeg', 'image/png', 'image/gif', 'image/webp',
          'application/pdf', 'text/plain', 'application/json'
        ],
        allowedExtensions: options.allowedExtensions || [
          'jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'txt', 'json'
        ],
        maxFiles: options.maxFiles || 5
      }),
    ]
  }

  /**
   * Get admin middleware stack
   */
  public getAdminMiddlewareStack() {
    return [
      this.authMiddleware.requireAuth,
      this.authMiddleware.requireRole(['SUPER_ADMIN', 'ADMIN']),
      this.tenantMiddleware.requireTenant,
      this.tenantMiddleware.checkTenantRole(['OWNER', 'ADMIN']),
    ]
  }

  /**
   * Get API key middleware stack
   */
  public getApiKeyMiddlewareStack(requiredScopes: string[] = []) {
    return [
      this.apiKeyMiddleware.requireApiKey,
      ...(requiredScopes.length > 0 ? [this.apiKeyMiddleware.requireScopes(requiredScopes)] : []),
      this.tenantMiddleware.resolveTenant,
    ]
  }

  /**
   * Get webhook middleware stack
   */
  public getWebhookMiddlewareStack() {
    return [
      this.securityMiddleware.requestId,
      this.securityMiddleware.validateContentType(['application/json']),
      this.securityMiddleware.requestSizeLimit(1024 * 1024), // 1MB limit for webhooks
      this.validationMiddleware.sanitizeInput,
      this.rateLimitMiddleware.webhookCreationRateLimit,
    ]
  }

  /**
   * Get monitoring middleware stack
   */
  public getMonitoringMiddlewareStack() {
    return [
      this.monitoringMiddleware.trackApiMetrics,
      this.monitoringMiddleware.trackPerformance,
      this.monitoringMiddleware.trackErrorRate,
      this.monitoringMiddleware.trackUserActivity,
      this.monitoringMiddleware.trackResourceUsage,
      this.monitoringMiddleware.trackBusinessMetrics,
    ]
  }

  /**
   * Get security middleware stack for high-security endpoints
   */
  public getHighSecurityMiddlewareStack() {
    return [
      this.securityMiddleware.requestId,
      this.securityMiddleware.securityHeaders,
      this.securityMiddleware.validateUserAgent({ required: true }),
      this.securityMiddleware.validateContentType(['application/json']),
      this.securityMiddleware.requestSizeLimit(512 * 1024), // 512KB limit
      this.validationMiddleware.sanitizeInput,
      this.securityMiddleware.sqlInjectionProtection,
      this.securityMiddleware.xssProtection,
      this.securityMiddleware.csrfProtection,
      this.rateLimitMiddleware.createAdaptiveRateLimit({ max: 10, windowMs: 60000 }),
    ]
  }

  /**
   * Create custom middleware stack
   */
  public createCustomStack(middlewares: Array<(req: Request, res: Response, next: NextFunction) => void>) {
    return middlewares
  }

  /**
   * Apply audit middleware to any stack
   */
  public withAudit(stack: any[], auditConfig: {
    action: string
    entityType: string
    getEntityId: (req: Request) => string
  }) {
    const { createAuditMiddleware } = require('./audit.middleware')
    return [
      ...stack,
      createAuditMiddleware(auditConfig)
    ]
  }

  /**
   * Apply tenant feature validation to any stack
   */
  public withTenantFeature(stack: any[], feature: string) {
    return [
      ...stack,
      this.tenantMiddleware.requirePlanFeature(feature)
    ]
  }

  /**
   * Apply permission validation to any stack
   */
  public withPermissions(stack: any[], permissions: string[]) {
    return [
      ...stack,
      this.authMiddleware.requirePermissions(permissions)
    ]
  }

  /**
   * Apply ownership validation to any stack
   */
  public withOwnership(stack: any[], getUserId: (req: Request) => string) {
    return [
      ...stack,
      this.authMiddleware.requireOwnershipOrAdmin(getUserId)
    ]
  }
}

/**
 * Pre-configured middleware stacks for common use cases
 */
export class MiddlewareStacks {
  private static orchestrator = new MiddlewareOrchestrator()

  // Public API endpoints
  static readonly PUBLIC_API = [
    ...MiddlewareStacks.orchestrator.getCoreMiddlewareStack(),
  ]

  // Protected API endpoints
  static readonly PROTECTED_API = [
    ...MiddlewareStacks.orchestrator.getCoreMiddlewareStack(),
    ...MiddlewareStacks.orchestrator.getAuthMiddlewareStack(),
  ]

  // Content management endpoints
  static readonly CONTENT_MANAGEMENT = [
    ...MiddlewareStacks.orchestrator.getCoreMiddlewareStack(),
    ...MiddlewareStacks.orchestrator.getContentMiddlewareStack(),
  ]

  // File upload endpoints
  static readonly FILE_UPLOAD = [
    ...MiddlewareStacks.orchestrator.getCoreMiddlewareStack(),
    ...MiddlewareStacks.orchestrator.getFileUploadMiddlewareStack(),
  ]

  // Admin endpoints
  static readonly ADMIN = [
    ...MiddlewareStacks.orchestrator.getCoreMiddlewareStack(),
    ...MiddlewareStacks.orchestrator.getAdminMiddlewareStack(),
  ]

  // API key endpoints
  static readonly API_KEY = [
    ...MiddlewareStacks.orchestrator.getCoreMiddlewareStack(),
    ...MiddlewareStacks.orchestrator.getApiKeyMiddlewareStack(),
  ]

  // Webhook endpoints
  static readonly WEBHOOK = [
    ...MiddlewareStacks.orchestrator.getWebhookMiddlewareStack(),
  ]

  // High security endpoints
  static readonly HIGH_SECURITY = [
    ...MiddlewareStacks.orchestrator.getCoreMiddlewareStack(),
    ...MiddlewareStacks.orchestrator.getHighSecurityMiddlewareStack(),
  ]

  // Monitoring endpoints
  static readonly MONITORING = [
    ...MiddlewareStacks.orchestrator.getMonitoringMiddlewareStack(),
  ]
}

/**
 * Middleware utilities for common operations
 */
export class MiddlewareUtils {
  /**
   * Combine multiple middleware stacks
   */
  static combine(...stacks: any[][]) {
    return stacks.flat()
  }

  /**
   * Apply middleware conditionally
   */
  static conditional(
    condition: (req: Request) => boolean,
    middleware: (req: Request, res: Response, next: NextFunction) => void
  ) {
    return (req: Request, res: Response, next: NextFunction) => {
      if (condition(req)) {
        return middleware(req, res, next)
      }
      next()
    }
  }

  /**
   * Skip middleware for specific paths
   */
  static skipForPaths(
    paths: string[],
    middleware: (req: Request, res: Response, next: NextFunction) => void
  ) {
    return (req: Request, res: Response, next: NextFunction) => {
      if (paths.some(path => req.path.startsWith(path))) {
        return next()
      }
      return middleware(req, res, next)
    }
  }

  /**
   * Apply middleware only for specific methods
   */
  static forMethods(
    methods: string[],
    middleware: (req: Request, res: Response, next: NextFunction) => void
  ) {
    return (req: Request, res: Response, next: NextFunction) => {
      if (methods.includes(req.method)) {
        return middleware(req, res, next)
      }
      next()
    }
  }

  /**
   * Log middleware execution time
   */
  static withTiming(name: string) {
    return (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now()
      const requestId = (req as any).requestId

      res.on('finish', () => {
        const duration = Date.now() - start
        logger.debug(`Middleware ${name} execution time`, {
          duration,
          requestId,
          path: req.path,
          method: req.method
        })
      })

      next()
    }
  }
}

// Export singleton instance
export const middlewareOrchestrator = new MiddlewareOrchestrator()

// Export commonly used middleware stacks
export const {
  PUBLIC_API,
  PROTECTED_API,
  CONTENT_MANAGEMENT,
  FILE_UPLOAD,
  ADMIN,
  API_KEY,
  WEBHOOK,
  HIGH_SECURITY,
  MONITORING
} = MiddlewareStacks

// Export utilities
export const {
  combine,
  conditional,
  skipForPaths,
  forMethods,
  withTiming
} = MiddlewareUtils

/**
 * Default export for easy importing
 */
export default {
  MiddlewareOrchestrator,
  MiddlewareStacks,
  MiddlewareUtils,
  middlewareOrchestrator,
  stacks: MiddlewareStacks,
  utils: MiddlewareUtils
}
