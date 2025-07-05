import type { Request, Response, NextFunction } from "express"
import { monitoringService } from "../services/monitoring.service"
import { logger } from "../utils/logger"
import { config } from "../config"

export interface MonitoringRequest extends Request {
  startTime?: number
  user?: {
    _id: string
    email: string
    role: string
    tenantId?: string
  }
  tenant?: {
    _id: string
    name: string
  }
  apiKey?: {
    id: string
    name: string
  }
}

export class MonitoringMiddleware {
  /**
   * API metrics tracking middleware
   */
  public trackApiMetrics = (req: MonitoringRequest, res: Response, next: NextFunction) => {
    // Record start time
    req.startTime = Date.now()
    const requestId = (req as any).requestId

    // Store original response methods
    const originalSend = res.send
    const originalJson = res.json
    const originalEnd = res.end

    let responseSize = 0
    let responseBody: any = null

    // Override response methods to capture metrics
    res.send = function(body) {
      responseBody = body
      responseSize = Buffer.byteLength(body || '', 'utf8')
      return originalSend.call(this, body)
    }

    res.json = function(body) {
      responseBody = body
      responseSize = Buffer.byteLength(JSON.stringify(body || {}), 'utf8')
      return originalJson.call(this, body)
    }

    res.end = function(...args: any[]) {
      if (args[0] && typeof args[0] === 'string') {
        responseSize = Buffer.byteLength(args[0], 'utf8')
      }
      return originalEnd.apply(this, args)
    }

    // Record metrics when response finishes
    res.on('finish', async () => {
      try {
        const responseTime = Date.now() - (req.startTime || Date.now())
        
        await monitoringService.recordApiMetrics({
          path: req.path,
          method: req.method,
          statusCode: res.statusCode,
          responseTime,
          requestSize: req.headers['content-length'] ? parseInt(req.headers['content-length']) : 0,
          responseSize,
          userId: req.user?._id,
          tenantId: req.tenant?._id || req.user?.tenantId,
          apiKeyId: req.apiKey?.id,
          userAgent: req.headers['user-agent'],
          ipAddress: req.ip,
          requestId,
          timestamp: new Date()
        })
      } catch (error) {
        logger.error("Error recording API metrics:", error, { requestId })
      }
    })

    next()
  }

  /**
   * Performance monitoring middleware
   */
  public trackPerformance = (req: MonitoringRequest, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId
    const startTime = process.hrtime.bigint()
    const startMemory = process.memoryUsage()

    res.on('finish', async () => {
      try {
        const endTime = process.hrtime.bigint()
        const endMemory = process.memoryUsage()
        
        const executionTime = Number(endTime - startTime) / 1000000 // Convert to milliseconds
        const memoryDelta = {
          rss: endMemory.rss - startMemory.rss,
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          heapTotal: endMemory.heapTotal - startMemory.heapTotal,
          external: endMemory.external - startMemory.external
        }

        await monitoringService.recordPerformanceMetrics({
          path: req.path,
          method: req.method,
          executionTime,
          memoryUsage: endMemory,
          memoryDelta,
          cpuUsage: process.cpuUsage(),
          statusCode: res.statusCode,
          userId: req.user?._id,
          tenantId: req.tenant?._id || req.user?.tenantId,
          requestId,
          timestamp: new Date()
        })

        // Log slow requests
        if (executionTime > 1000) { // Requests taking more than 1 second
          logger.warn("Slow request detected", {
            path: req.path,
            method: req.method,
            executionTime,
            statusCode: res.statusCode,
            userId: req.user?._id,
            requestId
          })
        }
      } catch (error) {
        logger.error("Error recording performance metrics:", error, { requestId })
      }
    })

    next()
  }

  /**
   * Database query monitoring middleware
   */
  public trackDatabaseQueries = (req: MonitoringRequest, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId
    const queries: any[] = []

    // Hook into Prisma query events (this would need to be set up in the Prisma client)
    const originalQuery = (global as any).prismaQueryHook
    if (originalQuery) {
      (global as any).prismaQueryHook = (query: any) => {
        queries.push({
          query: query.query,
          params: query.params,
          duration: query.duration,
          timestamp: new Date()
        })
        return originalQuery(query)
      }
    }

    res.on('finish', async () => {
      try {
        if (queries.length > 0) {
          await monitoringService.recordDatabaseMetrics({
            path: req.path,
            method: req.method,
            queries,
            totalQueries: queries.length,
            totalQueryTime: queries.reduce((sum, q) => sum + (q.duration || 0), 0),
            userId: req.user?._id,
            tenantId: req.tenant?._id || req.user?.tenantId,
            requestId,
            timestamp: new Date()
          })

          // Log excessive database queries
          if (queries.length > 10) {
            logger.warn("Excessive database queries detected", {
              path: req.path,
              method: req.method,
              queryCount: queries.length,
              userId: req.user?._id,
              requestId
            })
          }
        }
      } catch (error) {
        logger.error("Error recording database metrics:", error, { requestId })
      }
    })

    next()
  }

  /**
   * Error rate monitoring middleware
   */
  public trackErrorRate = (req: MonitoringRequest, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId

    res.on('finish', async () => {
      try {
        const isError = res.statusCode >= 400
        
        await monitoringService.recordErrorRate({
          path: req.path,
          method: req.method,
          statusCode: res.statusCode,
          isError,
          userId: req.user?._id,
          tenantId: req.tenant?._id || req.user?.tenantId,
          requestId,
          timestamp: new Date()
        })
      } catch (error) {
        logger.error("Error recording error rate:", error, { requestId })
      }
    })

    next()
  }

  /**
   * User activity tracking middleware
   */
  public trackUserActivity = (req: MonitoringRequest, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId

    // Only track authenticated users
    if (!req.user) {
      return next()
    }

    res.on('finish', async () => {
      try {
        await monitoringService.recordUserActivity({
          userId: req.user!._id,
          action: `${req.method} ${req.path}`,
          path: req.path,
          method: req.method,
          statusCode: res.statusCode,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          tenantId: req.tenant?._id || req.user!.tenantId,
          requestId,
          timestamp: new Date()
        })
      } catch (error) {
        logger.error("Error recording user activity:", error, { requestId })
      }
    })

    next()
  }

  /**
   * Resource usage monitoring middleware
   */
  public trackResourceUsage = (req: MonitoringRequest, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId

    res.on('finish', async () => {
      try {
        const memoryUsage = process.memoryUsage()
        const cpuUsage = process.cpuUsage()
        
        await monitoringService.recordResourceUsage({
          memory: {
            rss: memoryUsage.rss,
            heapUsed: memoryUsage.heapUsed,
            heapTotal: memoryUsage.heapTotal,
            external: memoryUsage.external
          },
          cpu: {
            user: cpuUsage.user,
            system: cpuUsage.system
          },
          uptime: process.uptime(),
          activeHandles: (process as any)._getActiveHandles?.()?.length || 0,
          activeRequests: (process as any)._getActiveRequests?.()?.length || 0,
          requestId,
          timestamp: new Date()
        })
      } catch (error) {
        logger.error("Error recording resource usage:", error, { requestId })
      }
    })

    next()
  }

  /**
   * Business metrics tracking middleware
   */
  public trackBusinessMetrics = (req: MonitoringRequest, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId

    res.on('finish', async () => {
      try {
        // Track content operations
        if (req.path.includes('/content') && req.method === 'POST' && res.statusCode < 400) {
          await monitoringService.recordBusinessMetric({
            metric: 'content_created',
            value: 1,
            userId: req.user?._id,
            tenantId: req.tenant?._id || req.user?.tenantId,
            metadata: {
              contentType: req.body?.contentTypeId,
              path: req.path
            },
            timestamp: new Date()
          })
        }

        // Track user registrations
        if (req.path.includes('/auth/register') && req.method === 'POST' && res.statusCode < 400) {
          await monitoringService.recordBusinessMetric({
            metric: 'user_registered',
            value: 1,
            tenantId: req.tenant?._id,
            metadata: {
              email: req.body?.email,
              source: req.headers.referer
            },
            timestamp: new Date()
          })
        }

        // Track API key usage
        if (req.apiKey) {
          await monitoringService.recordBusinessMetric({
            metric: 'api_key_usage',
            value: 1,
            apiKeyId: req.apiKey.id,
            tenantId: req.tenant?._id,
            metadata: {
              path: req.path,
              method: req.method,
              statusCode: res.statusCode
            },
            timestamp: new Date()
          })
        }
      } catch (error) {
        logger.error("Error recording business metrics:", error, { requestId })
      }
    })

    next()
  }

  /**
   * Health check metrics middleware
   */
  public trackHealthMetrics = (req: MonitoringRequest, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId

    // Only track health check endpoints
    if (!req.path.includes('/health')) {
      return next()
    }

    res.on('finish', async () => {
      try {
        await monitoringService.recordHealthMetrics({
          endpoint: req.path,
          statusCode: res.statusCode,
          responseTime: Date.now() - (req.startTime || Date.now()),
          isHealthy: res.statusCode < 400,
          timestamp: new Date()
        })
      } catch (error) {
        logger.error("Error recording health metrics:", error, { requestId })
      }
    })

    next()
  }

  /**
   * Comprehensive monitoring middleware that combines all tracking
   */
  public comprehensiveMonitoring = (req: MonitoringRequest, res: Response, next: NextFunction) => {
    // Skip monitoring for certain paths to reduce overhead
    const skipPaths = ['/health', '/metrics', '/favicon.ico']
    if (skipPaths.some(path => req.path.includes(path))) {
      return next()
    }

    // Apply all monitoring middleware
    this.trackApiMetrics(req, res, () => {
      this.trackPerformance(req, res, () => {
        this.trackErrorRate(req, res, () => {
          this.trackUserActivity(req, res, () => {
            this.trackBusinessMetrics(req, res, () => {
              next()
            })
          })
        })
      })
    })
  }
}

// Create and export middleware instances
const monitoringMiddleware = new MonitoringMiddleware()
export const trackApiMetrics = monitoringMiddleware.trackApiMetrics
export const trackPerformance = monitoringMiddleware.trackPerformance
export const trackDatabaseQueries = monitoringMiddleware.trackDatabaseQueries
export const trackErrorRate = monitoringMiddleware.trackErrorRate
export const trackUserActivity = monitoringMiddleware.trackUserActivity
export const trackResourceUsage = monitoringMiddleware.trackResourceUsage
export const trackBusinessMetrics = monitoringMiddleware.trackBusinessMetrics
export const trackHealthMetrics = monitoringMiddleware.trackHealthMetrics
export const comprehensiveMonitoring = monitoringMiddleware.comprehensiveMonitoring

// Export class for advanced usage
export { MonitoringMiddleware }
