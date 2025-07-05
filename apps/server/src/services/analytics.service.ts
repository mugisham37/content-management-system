import { prisma } from "@cms-platform/database/client"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"

export interface SystemOverview {
  content: ContentStats
  media: MediaStats
  users: UserStats
  webhooks: WebhookStats
  workflows: WorkflowStats
  timestamp: Date
}

export interface ContentStats {
  totalCount: number
  byStatus: Record<string, number>
  recentActivity: any[]
}

export interface MediaStats {
  totalCount: number
  byType: Record<string, number>
  totalSize: number
  recentUploads: any[]
}

export interface UserStats {
  totalCount: number
  byRole: Record<string, number>
  activeCount: number
  inactiveCount: number
  recentLogins: any[]
}

export interface WebhookStats {
  totalDeliveries: number
  successCount: number
  failureCount: number
  successRate: number
  recentDeliveries: any[]
}

export interface WorkflowStats {
  totalCount: number
  byStatus: Record<string, number>
  recentEntries: any[]
}

export class AnalyticsService {
  private cacheService: any // Will be injected when cache service is available

  constructor() {
    // Initialize cache service when available
  }

  /**
   * Get system overview statistics with caching
   */
  async getSystemOverview(): Promise<SystemOverview> {
    const cacheKey = "analytics:system-overview"
    
    try {
      // Try to get from cache first (when cache service is available)
      // const cachedData = await this.cacheService?.get<SystemOverview>(cacheKey)
      // if (cachedData) return cachedData

      // Run aggregations in parallel for better performance
      const [contentStats, mediaStats, userStats, webhookStats, workflowStats] = await Promise.all([
        this.getContentStats(),
        this.getMediaStats(),
        this.getUserStats(),
        this.getWebhookStats(),
        this.getWorkflowStats(),
      ])

      const result: SystemOverview = {
        content: contentStats,
        media: mediaStats,
        users: userStats,
        webhooks: webhookStats,
        workflows: workflowStats,
        timestamp: new Date(),
      }

      // Cache the result for 5 minutes (when cache service is available)
      // await this.cacheService?.setObject(cacheKey, result, 300)

      return result
    } catch (error) {
      logger.error("Error getting system overview:", error)
      throw ApiError.internal("Failed to retrieve system overview")
    }
  }

  /**
   * Get comprehensive content statistics
   */
  async getContentStats(): Promise<ContentStats> {
    try {
      const [totalCount, statusCounts, recentActivity] = await Promise.all([
        // Total count
        prisma.content.count(),

        // Count by status with proper aggregation
        prisma.content.groupBy({
          by: ['status'],
          _count: {
            status: true,
          },
        }),

        // Recent activity with user information
        prisma.content.findMany({
          take: 10,
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            title: true,
            status: true,
            updatedAt: true,
            updatedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        }),
      ])

      // Format status counts
      const formattedStatusCounts: Record<string, number> = {}
      statusCounts.forEach((item) => {
        formattedStatusCounts[item.status] = item._count.status
      })

      return {
        totalCount,
        byStatus: formattedStatusCounts,
        recentActivity,
      }
    } catch (error) {
      logger.error("Error getting content stats:", error)
      throw ApiError.internal("Failed to retrieve content statistics")
    }
  }

  /**
   * Get comprehensive media statistics
   */
  async getMediaStats(): Promise<MediaStats> {
    try {
      const [totalCount, typeCounts, totalSizeResult, recentUploads] = await Promise.all([
        // Total count
        prisma.media.count(),

        // Count by type
        prisma.media.groupBy({
          by: ['mimeType'],
          _count: {
            mimeType: true,
          },
        }),

        // Total size aggregation
        prisma.media.aggregate({
          _sum: {
            size: true,
          },
        }),

        // Recent uploads with user information
        prisma.media.findMany({
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            filename: true,
            mimeType: true,
            size: true,
            createdAt: true,
            createdBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        }),
      ])

      // Format type counts by extracting main type from mimeType
      const formattedTypeCounts: Record<string, number> = {}
      typeCounts.forEach((item) => {
        const mainType = item.mimeType?.split('/')[0] || 'unknown'
        formattedTypeCounts[mainType] = (formattedTypeCounts[mainType] || 0) + item._count.mimeType
      })

      return {
        totalCount,
        byType: formattedTypeCounts,
        totalSize: totalSizeResult._sum.size || 0,
        recentUploads,
      }
    } catch (error) {
      logger.error("Error getting media stats:", error)
      throw ApiError.internal("Failed to retrieve media statistics")
    }
  }

  /**
   * Get comprehensive user statistics
   */
  async getUserStats(): Promise<UserStats> {
    try {
      const [totalCount, roleCounts, activeInactiveCount, recentLogins] = await Promise.all([
        // Total count
        prisma.user.count(),

        // Count by role
        prisma.user.groupBy({
          by: ['role'],
          _count: {
            role: true,
          },
        }),

        // Active vs inactive
        prisma.user.groupBy({
          by: ['isActive'],
          _count: {
            isActive: true,
          },
        }),

        // Recent logins
        prisma.user.findMany({
          where: {
            lastLogin: {
              not: null,
            },
          },
          take: 10,
          orderBy: { lastLogin: 'desc' },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            lastLogin: true,
          },
        }),
      ])

      // Format role counts
      const formattedRoleCounts: Record<string, number> = {}
      roleCounts.forEach((item) => {
        formattedRoleCounts[item.role] = item._count.role
      })

      // Format active/inactive counts
      const activeCount = activeInactiveCount.find((item) => item.isActive === true)?._count.isActive || 0
      const inactiveCount = activeInactiveCount.find((item) => item.isActive === false)?._count.isActive || 0

      return {
        totalCount,
        byRole: formattedRoleCounts,
        activeCount,
        inactiveCount,
        recentLogins,
      }
    } catch (error) {
      logger.error("Error getting user stats:", error)
      throw ApiError.internal("Failed to retrieve user statistics")
    }
  }

  /**
   * Get webhook delivery statistics
   */
  async getWebhookStats(): Promise<WebhookStats> {
    try {
      const [deliveryStats, recentDeliveries] = await Promise.all([
        // Delivery success/failure stats
        prisma.webhookDelivery.groupBy({
          by: ['success'],
          _count: {
            success: true,
          },
        }),

        // Recent deliveries with webhook information
        prisma.webhookDelivery.findMany({
          take: 10,
          orderBy: { timestamp: 'desc' },
          select: {
            id: true,
            success: true,
            statusCode: true,
            timestamp: true,
            webhook: {
              select: {
                id: true,
                name: true,
                url: true,
              },
            },
          },
        }),
      ])

      // Calculate delivery statistics
      const successCount = deliveryStats.find((item) => item.success === true)?._count.success || 0
      const failureCount = deliveryStats.find((item) => item.success === false)?._count.success || 0
      const totalCount = successCount + failureCount
      const successRate = totalCount > 0 ? (successCount / totalCount) * 100 : 0

      return {
        totalDeliveries: totalCount,
        successCount,
        failureCount,
        successRate: Math.round(successRate * 100) / 100, // Round to 2 decimal places
        recentDeliveries,
      }
    } catch (error) {
      logger.error("Error getting webhook stats:", error)
      throw ApiError.internal("Failed to retrieve webhook statistics")
    }
  }

  /**
   * Get workflow statistics
   */
  async getWorkflowStats(): Promise<WorkflowStats> {
    try {
      const [statusCounts, recentEntries] = await Promise.all([
        // Count by status
        prisma.workflowEntry.groupBy({
          by: ['status'],
          _count: {
            status: true,
          },
        }),

        // Recent entries with workflow and content information
        prisma.workflowEntry.findMany({
          take: 10,
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            status: true,
            updatedAt: true,
            workflow: {
              select: {
                id: true,
                name: true,
              },
            },
            content: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        }),
      ])

      // Format status counts
      const formattedStatusCounts: Record<string, number> = {}
      statusCounts.forEach((item) => {
        formattedStatusCounts[item.status] = item._count.status
      })

      const totalCount = statusCounts.reduce((sum, item) => sum + item._count.status, 0)

      return {
        totalCount,
        byStatus: formattedStatusCounts,
        recentEntries,
      }
    } catch (error) {
      logger.error("Error getting workflow stats:", error)
      throw ApiError.internal("Failed to retrieve workflow statistics")
    }
  }

  /**
   * Get content creation over time with flexible periods
   */
  async getContentCreationOverTime(
    period: "day" | "week" | "month" = "day",
    limit = 30
  ): Promise<{
    period: string
    data: Array<{ date: string; count: number }>
  }> {
    try {
      // Use raw SQL for complex date aggregations
      let dateFormat: string
      let groupBy: string

      switch (period) {
        case "day":
          dateFormat = "DATE(created_at)"
          groupBy = "DATE(created_at)"
          break
        case "week":
          dateFormat = "DATE_TRUNC('week', created_at)"
          groupBy = "DATE_TRUNC('week', created_at)"
          break
        case "month":
          dateFormat = "DATE_TRUNC('month', created_at)"
          groupBy = "DATE_TRUNC('month', created_at)"
          break
        default:
          dateFormat = "DATE(created_at)"
          groupBy = "DATE(created_at)"
      }

      const results = await prisma.$queryRaw`
        SELECT 
          ${dateFormat} as date,
          COUNT(*)::int as count
        FROM "Content"
        GROUP BY ${groupBy}
        ORDER BY date DESC
        LIMIT ${limit}
      ` as Array<{ date: Date; count: number }>

      return {
        period,
        data: results.map((item) => ({
          date: item.date.toISOString().split('T')[0],
          count: item.count,
        })).reverse(), // Reverse to show chronological order
      }
    } catch (error) {
      logger.error("Error getting content creation over time:", error)
      throw ApiError.internal("Failed to retrieve content creation timeline")
    }
  }

  /**
   * Get user activity over time
   */
  async getUserActivityOverTime(
    period: "day" | "week" | "month" = "day",
    limit = 30
  ): Promise<{
    period: string
    data: Array<{ date: string; count: number }>
  }> {
    try {
      let dateFormat: string
      let groupBy: string

      switch (period) {
        case "day":
          dateFormat = "DATE(last_login)"
          groupBy = "DATE(last_login)"
          break
        case "week":
          dateFormat = "DATE_TRUNC('week', last_login)"
          groupBy = "DATE_TRUNC('week', last_login)"
          break
        case "month":
          dateFormat = "DATE_TRUNC('month', last_login)"
          groupBy = "DATE_TRUNC('month', last_login)"
          break
        default:
          dateFormat = "DATE(last_login)"
          groupBy = "DATE(last_login)"
      }

      const results = await prisma.$queryRaw`
        SELECT 
          ${dateFormat} as date,
          COUNT(DISTINCT id)::int as count
        FROM "User"
        WHERE last_login IS NOT NULL
        GROUP BY ${groupBy}
        ORDER BY date DESC
        LIMIT ${limit}
      ` as Array<{ date: Date; count: number }>

      return {
        period,
        data: results.map((item) => ({
          date: item.date.toISOString().split('T')[0],
          count: item.count,
        })).reverse(),
      }
    } catch (error) {
      logger.error("Error getting user activity over time:", error)
      throw ApiError.internal("Failed to retrieve user activity timeline")
    }
  }

  /**
   * Get content status distribution
   */
  async getContentStatusDistribution(): Promise<Array<{ status: string; count: number }>> {
    try {
      const results = await prisma.content.groupBy({
        by: ['status'],
        _count: {
          status: true,
        },
      })

      return results.map((item) => ({
        status: item.status,
        count: item._count.status,
      }))
    } catch (error) {
      logger.error("Error getting content status distribution:", error)
      throw ApiError.internal("Failed to retrieve content status distribution")
    }
  }

  /**
   * Get media type distribution with size information
   */
  async getMediaTypeDistribution(): Promise<Array<{ type: string; count: number; totalSize: number }>> {
    try {
      const results = await prisma.media.groupBy({
        by: ['mimeType'],
        _count: {
          mimeType: true,
        },
        _sum: {
          size: true,
        },
      })

      return results.map((item) => ({
        type: item.mimeType?.split('/')[0] || 'unknown',
        count: item._count.mimeType,
        totalSize: item._sum.size || 0,
      }))
    } catch (error) {
      logger.error("Error getting media type distribution:", error)
      throw ApiError.internal("Failed to retrieve media type distribution")
    }
  }

  /**
   * Get user role distribution
   */
  async getUserRoleDistribution(): Promise<Array<{ role: string; count: number }>> {
    try {
      const results = await prisma.user.groupBy({
        by: ['role'],
        _count: {
          role: true,
        },
      })

      return results.map((item) => ({
        role: item.role,
        count: item._count.role,
      }))
    } catch (error) {
      logger.error("Error getting user role distribution:", error)
      throw ApiError.internal("Failed to retrieve user role distribution")
    }
  }

  /**
   * Get top content creators
   */
  async getTopContentCreators(limit = 10): Promise<Array<{
    userId: string
    count: number
    user: {
      firstName: string | null
      lastName: string | null
      email: string
    } | null
  }>> {
    try {
      const results = await prisma.content.groupBy({
        by: ['createdById'],
        _count: {
          createdById: true,
        },
        orderBy: {
          _count: {
            createdById: 'desc',
          },
        },
        take: limit,
        where: {
          createdById: {
            not: null,
          },
        },
      })

      // Get user information for each creator
      const userIds = results.map(r => r.createdById).filter(Boolean) as string[]
      const users = await prisma.user.findMany({
        where: {
          id: {
            in: userIds,
          },
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      })

      const userMap = new Map(users.map(u => [u.id, u]))

      return results.map((item) => ({
        userId: item.createdById!,
        count: item._count.createdById,
        user: userMap.get(item.createdById!) || null,
      }))
    } catch (error) {
      logger.error("Error getting top content creators:", error)
      throw ApiError.internal("Failed to retrieve top content creators")
    }
  }

  /**
   * Get webhook success rate over time
   */
  async getWebhookSuccessRateOverTime(
    period: "day" | "week" | "month" = "day",
    limit = 30
  ): Promise<{
    period: string
    data: Array<{ date: string; total: number; success: number; rate: number }>
  }> {
    try {
      let dateFormat: string
      let groupBy: string

      switch (period) {
        case "day":
          dateFormat = "DATE(timestamp)"
          groupBy = "DATE(timestamp)"
          break
        case "week":
          dateFormat = "DATE_TRUNC('week', timestamp)"
          groupBy = "DATE_TRUNC('week', timestamp)"
          break
        case "month":
          dateFormat = "DATE_TRUNC('month', timestamp)"
          groupBy = "DATE_TRUNC('month', timestamp)"
          break
        default:
          dateFormat = "DATE(timestamp)"
          groupBy = "DATE(timestamp)"
      }

      const results = await prisma.$queryRaw`
        SELECT 
          ${dateFormat} as date,
          COUNT(*)::int as total,
          SUM(CASE WHEN success = true THEN 1 ELSE 0 END)::int as success
        FROM "WebhookDelivery"
        GROUP BY ${groupBy}
        ORDER BY date DESC
        LIMIT ${limit}
      ` as Array<{ date: Date; total: number; success: number }>

      return {
        period,
        data: results.map((item) => ({
          date: item.date.toISOString().split('T')[0],
          total: item.total,
          success: item.success,
          rate: item.total > 0 ? Math.round((item.success / item.total) * 10000) / 100 : 0,
        })).reverse(),
      }
    } catch (error) {
      logger.error("Error getting webhook success rate over time:", error)
      throw ApiError.internal("Failed to retrieve webhook success rate timeline")
    }
  }

  /**
   * Get workflow completion statistics
   */
  async getWorkflowCompletionStats(): Promise<Array<{
    workflowId: string
    workflowName: string
    statuses: Record<string, { count: number; avgDurationMs: number | null }>
  }>> {
    try {
      const results = await prisma.$queryRaw`
        SELECT 
          we.workflow_id as "workflowId",
          w.name as "workflowName",
          we.status,
          COUNT(*)::int as count,
          AVG(
            CASE 
              WHEN we.status IN ('approved', 'rejected', 'canceled') 
                AND we.updated_at IS NOT NULL 
                AND we.created_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (we.updated_at - we.created_at)) * 1000
              ELSE NULL
            END
          )::int as "avgDurationMs"
        FROM "WorkflowEntry" we
        LEFT JOIN "Workflow" w ON we.workflow_id = w.id
        GROUP BY we.workflow_id, w.name, we.status
        ORDER BY w.name, we.status
      ` as Array<{
        workflowId: string
        workflowName: string
        status: string
        count: number
        avgDurationMs: number | null
      }>

      // Group by workflow
      const workflowMap = new Map<string, {
        workflowId: string
        workflowName: string
        statuses: Record<string, { count: number; avgDurationMs: number | null }>
      }>()

      results.forEach((item) => {
        if (!workflowMap.has(item.workflowId)) {
          workflowMap.set(item.workflowId, {
            workflowId: item.workflowId,
            workflowName: item.workflowName,
            statuses: {},
          })
        }

        const workflow = workflowMap.get(item.workflowId)!
        workflow.statuses[item.status] = {
          count: item.count,
          avgDurationMs: item.avgDurationMs,
        }
      })

      return Array.from(workflowMap.values())
    } catch (error) {
      logger.error("Error getting workflow completion stats:", error)
      throw ApiError.internal("Failed to retrieve workflow completion statistics")
    }
  }

  /**
   * Get performance metrics for the analytics service
   */
  async getPerformanceMetrics(): Promise<{
    databaseConnections: number
    averageQueryTime: number
    cacheHitRate: number
    systemLoad: {
      cpu: number
      memory: number
    }
  }> {
    try {
      // This would integrate with monitoring tools in a real implementation
      // For now, return mock data structure
      return {
        databaseConnections: 10, // Would get from connection pool
        averageQueryTime: 45, // Would calculate from query logs
        cacheHitRate: 85.5, // Would get from cache service
        systemLoad: {
          cpu: 25.3, // Would get from system monitoring
          memory: 67.8, // Would get from system monitoring
        },
      }
    } catch (error) {
      logger.error("Error getting performance metrics:", error)
      throw ApiError.internal("Failed to retrieve performance metrics")
    }
  }
}

// Export singleton instance
export const analyticsService = new AnalyticsService()
