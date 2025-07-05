import type { Request, Response, NextFunction } from "express"
import { auditService } from "../services/audit.service"
import { logger } from "../utils/logger"

export interface AuditableRequest extends Request {
  user?: {
    _id: string
    email: string
    tenantId?: string
  }
  tenant?: {
    _id: string
    name: string
  }
  apiKey?: {
    id: string
    name: string
    tenantId?: string
  }
}

/**
 * Create audit middleware with enhanced context tracking
 */
export const createAuditMiddleware = (options: {
  action: string
  entityType: string
  getEntityId: (req: Request) => string
  includeRequestBody?: boolean
  includeResponseBody?: boolean
  sensitiveFields?: string[]
}) => {
  return async (req: AuditableRequest, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId
    const startTime = Date.now()

    try {
      // Get entity ID
      const entityId = options.getEntityId(req)

      // Get user information
      const user = req.user
      const userId = user?._id?.toString()
      const userEmail = user?.email

      // Get API key information if present
      const apiKey = req.apiKey
      const apiKeyId = apiKey?.id
      const apiKeyName = apiKey?.name

      // Get tenant information
      const tenant = req.tenant
      const tenantId = tenant?._id || user?.tenantId || apiKey?.tenantId

      // Get request information
      const ipAddress = req.ip || req.connection.remoteAddress
      const userAgent = req.headers["user-agent"]
      const referer = req.headers.referer

      // Prepare request body (filter sensitive fields)
      let requestBody = req.body
      if (options.sensitiveFields && requestBody) {
        requestBody = { ...requestBody }
        options.sensitiveFields.forEach(field => {
          if (requestBody[field]) {
            requestBody[field] = "[REDACTED]"
          }
        })
      }

      // Store original response methods to capture response data
      const originalSend = res.send
      const originalJson = res.json
      let responseBody: any = null

      if (options.includeResponseBody) {
        res.send = function(body) {
          responseBody = body
          return originalSend.call(this, body)
        }

        res.json = function(body) {
          responseBody = body
          return originalJson.call(this, body)
        }
      }

      // Continue with the request
      res.on('finish', async () => {
        try {
          const responseTime = Date.now() - startTime

          // Create comprehensive audit log
          await auditService.log({
            action: options.action,
            entityType: options.entityType,
            entityId,
            userId,
            userEmail,
            apiKeyId,
            apiKeyName,
            tenantId,
            ipAddress,
            userAgent,
            referer,
            requestId,
            details: {
              method: req.method,
              path: req.path,
              originalUrl: req.originalUrl,
              statusCode: res.statusCode,
              responseTime,
              body: options.includeRequestBody ? requestBody : undefined,
              params: req.params,
              query: req.query,
              headers: {
                'content-type': req.headers['content-type'],
                'accept': req.headers.accept,
                'authorization': req.headers.authorization ? '[PRESENT]' : undefined,
                'x-api-key': req.headers['x-api-key'] ? '[PRESENT]' : undefined,
              },
              response: options.includeResponseBody ? responseBody : undefined,
            },
            timestamp: new Date(),
          })
        } catch (auditError) {
          logger.error("Audit logging failed:", auditError, {
            requestId,
            action: options.action,
            entityType: options.entityType,
            entityId
          })
        }
      })

      next()
    } catch (error) {
      // Don't block the request if audit logging fails
      logger.error("Audit middleware setup failed:", error, {
        requestId,
        action: options.action,
        entityType: options.entityType
      })
      next()
    }
  }
}

/**
 * Audit middleware for content operations
 */
export const contentAudit = {
  create: createAuditMiddleware({
    action: "content.create",
    entityType: "content",
    getEntityId: (req) => req.body.contentTypeId || "unknown",
    includeRequestBody: true,
    sensitiveFields: ["password", "token", "secret"]
  }),
  update: createAuditMiddleware({
    action: "content.update",
    entityType: "content",
    getEntityId: (req) => req.params.id,
    includeRequestBody: true,
    sensitiveFields: ["password", "token", "secret"]
  }),
  delete: createAuditMiddleware({
    action: "content.delete",
    entityType: "content",
    getEntityId: (req) => req.params.id,
  }),
  publish: createAuditMiddleware({
    action: "content.publish",
    entityType: "content",
    getEntityId: (req) => req.params.id,
  }),
  unpublish: createAuditMiddleware({
    action: "content.unpublish",
    entityType: "content",
    getEntityId: (req) => req.params.id,
  }),
  archive: createAuditMiddleware({
    action: "content.archive",
    entityType: "content",
    getEntityId: (req) => req.params.id,
  }),
  view: createAuditMiddleware({
    action: "content.view",
    entityType: "content",
    getEntityId: (req) => req.params.id,
  }),
}

/**
 * Audit middleware for content type operations
 */
export const contentTypeAudit = {
  create: createAuditMiddleware({
    action: "contentType.create",
    entityType: "contentType",
    getEntityId: (req) => req.body.name || "unknown",
    includeRequestBody: true,
  }),
  update: createAuditMiddleware({
    action: "contentType.update",
    entityType: "contentType",
    getEntityId: (req) => req.params.id,
    includeRequestBody: true,
  }),
  delete: createAuditMiddleware({
    action: "contentType.delete",
    entityType: "contentType",
    getEntityId: (req) => req.params.id,
  }),
  view: createAuditMiddleware({
    action: "contentType.view",
    entityType: "contentType",
    getEntityId: (req) => req.params.id,
  }),
}

/**
 * Audit middleware for user operations
 */
export const userAudit = {
  create: createAuditMiddleware({
    action: "user.create",
    entityType: "user",
    getEntityId: (req) => req.body.email || "unknown",
    includeRequestBody: true,
    sensitiveFields: ["password", "passwordConfirm"]
  }),
  update: createAuditMiddleware({
    action: "user.update",
    entityType: "user",
    getEntityId: (req) => req.params.id,
    includeRequestBody: true,
    sensitiveFields: ["password", "passwordConfirm"]
  }),
  delete: createAuditMiddleware({
    action: "user.delete",
    entityType: "user",
    getEntityId: (req) => req.params.id,
  }),
  changeRole: createAuditMiddleware({
    action: "user.changeRole",
    entityType: "user",
    getEntityId: (req) => req.params.id,
    includeRequestBody: true,
  }),
  changePassword: createAuditMiddleware({
    action: "user.changePassword",
    entityType: "user",
    getEntityId: (req) => req.params.id || req.user?._id?.toString() || "unknown",
    sensitiveFields: ["password", "newPassword", "currentPassword", "passwordConfirm"]
  }),
  view: createAuditMiddleware({
    action: "user.view",
    entityType: "user",
    getEntityId: (req) => req.params.id,
  }),
}

/**
 * Audit middleware for media operations
 */
export const mediaAudit = {
  upload: createAuditMiddleware({
    action: "media.upload",
    entityType: "media",
    getEntityId: (req) => req.body.filename || req.file?.filename || "unknown",
  }),
  update: createAuditMiddleware({
    action: "media.update",
    entityType: "media",
    getEntityId: (req) => req.params.id,
    includeRequestBody: true,
  }),
  delete: createAuditMiddleware({
    action: "media.delete",
    entityType: "media",
    getEntityId: (req) => req.params.id,
  }),
  view: createAuditMiddleware({
    action: "media.view",
    entityType: "media",
    getEntityId: (req) => req.params.id,
  }),
}

/**
 * Audit middleware for webhook operations
 */
export const webhookAudit = {
  create: createAuditMiddleware({
    action: "webhook.create",
    entityType: "webhook",
    getEntityId: (req) => req.body.name || "unknown",
    includeRequestBody: true,
    sensitiveFields: ["secret", "token"]
  }),
  update: createAuditMiddleware({
    action: "webhook.update",
    entityType: "webhook",
    getEntityId: (req) => req.params.id,
    includeRequestBody: true,
    sensitiveFields: ["secret", "token"]
  }),
  delete: createAuditMiddleware({
    action: "webhook.delete",
    entityType: "webhook",
    getEntityId: (req) => req.params.id,
  }),
  trigger: createAuditMiddleware({
    action: "webhook.trigger",
    entityType: "webhook",
    getEntityId: (req) => req.params.id,
  }),
}

/**
 * Audit middleware for workflow operations
 */
export const workflowAudit = {
  create: createAuditMiddleware({
    action: "workflow.create",
    entityType: "workflow",
    getEntityId: (req) => req.body.name || "unknown",
    includeRequestBody: true,
  }),
  update: createAuditMiddleware({
    action: "workflow.update",
    entityType: "workflow",
    getEntityId: (req) => req.params.id,
    includeRequestBody: true,
  }),
  delete: createAuditMiddleware({
    action: "workflow.delete",
    entityType: "workflow",
    getEntityId: (req) => req.params.id,
  }),
  transition: createAuditMiddleware({
    action: "workflow.transition",
    entityType: "workflow",
    getEntityId: (req) => req.params.id,
    includeRequestBody: true,
  }),
  approve: createAuditMiddleware({
    action: "workflow.approve",
    entityType: "workflow",
    getEntityId: (req) => req.params.id,
    includeRequestBody: true,
  }),
  reject: createAuditMiddleware({
    action: "workflow.reject",
    entityType: "workflow",
    getEntityId: (req) => req.params.id,
    includeRequestBody: true,
  }),
}

/**
 * Audit middleware for authentication operations
 */
export const authAudit = {
  login: createAuditMiddleware({
    action: "auth.login",
    entityType: "user",
    getEntityId: (req) => req.body.email || "unknown",
    sensitiveFields: ["password"]
  }),
  logout: createAuditMiddleware({
    action: "auth.logout",
    entityType: "user",
    getEntityId: (req) => req.user?._id?.toString() || "unknown",
  }),
  refreshToken: createAuditMiddleware({
    action: "auth.
