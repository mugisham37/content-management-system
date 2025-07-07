import { prisma } from "@cms-platform/database/client"
import { EventEmitter } from "events"
import { logger } from "../utils/logger"
import { cacheService } from "./cache.service"
import { auditService } from "./audit.service"
import { ApiError } from "../utils/errors"
import crypto from "crypto"
import {
  NotificationType,
  NotificationChannel,
  NotificationStatus,
  NotificationPriority,
  INotification,
  INotificationTemplate,
  INotificationPreferences,
  INotificationAnalytics,
  INotificationResponse,
  NotificationBatch,
  NotificationRule,
  NotificationAnalytics,
  NotificationServiceOptions,
} from "../types/notification.types"

// Re-export for backward compatibility
export {
  NotificationType,
  NotificationChannel,
  NotificationStatus,
  NotificationPriority,
} from "../types/notification.types"

export class NotificationService extends EventEmitter {
  private options: NotificationServiceOptions
  private templates: Map<string, INotificationTemplate> = new Map()
  private rules: Map<string, NotificationRule> = new Map()
  private preferences: Map<string, INotificationPreferences> = new Map()
  private batchQueue: Map<string, NotificationBatch> = new Map()
  private rateLimiters: Map<string, any> = new Map()
  private realtimeConnections: Map<string, any> = new Map()
  private scheduledNotifications: Map<string, NodeJS.Timeout> = new Map()

  constructor(options: NotificationServiceOptions = {}) {
    super()
    this.options = {
      enableCache: true,
      cacheTtl: 3600,
      enableAudit: true,
      enableAnalytics: true,
      enableBatching: true,
      enableTemplates: true,
      enableRules: true,
      enableRealtime: true,
      enableDigest: true,
      batchSize: 100,
      batchTimeout: 5000,
      maxRetries: 3,
      enableDeduplication: true,
      enableRateLimiting: true,
      enablePersonalization: true,
      ...options,
    }
    this.setMaxListeners(100)
    this.initializeDefaultTemplates()
    this.loadNotificationRules()
    this.startBatchProcessor()
    this.startDigestProcessor()
    logger.info("Enhanced Notification service initialized", this.options)
  }

  /**
   * Initialize default notification templates
   */
  private async initializeDefaultTemplates(): Promise<void> {
    if (!this.options.enableTemplates) return

    const defaultTemplates: INotificationTemplate[] = [
      {
        id: "content-published",
        name: "Content Published",
        type: NotificationType.CONTENT_PUBLISHED,
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        subject: "Content Published: {{title}}",
        body: "Your content '{{title}}' has been published successfully.",
        htmlContent: "<p>Your content '<strong>{{title}}</strong>' has been published successfully.</p>",
        variables: ["title", "contentType", "publishedBy", "publishedAt"],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "workflow-assignment",
        name: "Workflow Assignment",
        type: NotificationType.WORKFLOW_ASSIGNMENT,
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        subject: "New Task Assigned: {{workflowName}}",
        body: "You have been assigned a new task in workflow '{{workflowName}}'.",
        htmlContent: "<p>You have been assigned a new task in workflow '<strong>{{workflowName}}</strong>'.</p>",
        variables: ["workflowName", "stepName", "assignedBy", "dueDate"],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "user-welcome",
        name: "User Welcome",
        type: NotificationType.USER_CREATED,
        channels: [NotificationChannel.EMAIL],
        subject: "Welcome to {{platformName}}!",
        body: "Welcome {{firstName}}! Your account has been created successfully.",
        htmlContent: "<h2>Welcome {{firstName}}!</h2><p>Your account has been created successfully.</p>",
        variables: ["firstName", "lastName", "email", "platformName"],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "security-alert",
        name: "Security Alert",
        type: NotificationType.SECURITY,
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        subject: "Security Alert: {{alertType}}",
        body: "Security alert: {{message}}",
        htmlContent: "<div style='color: red;'><strong>Security Alert:</strong> {{message}}</div>",
        variables: ["alertType", "message", "timestamp", "ipAddress"],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    for (const template of defaultTemplates) {
      this.templates.set(template.id, template)
    }

    logger.info("Default notification templates initialized", { count: defaultTemplates.length })
  }

  /**
   * Load notification rules from database
   */
  private async loadNotificationRules(): Promise<void> {
    if (!this.options.enableRules) return

    try {
      const defaultRules: NotificationRule[] = [
        {
          id: "high-priority-content",
          name: "High Priority Content Notifications",
          description: "Send immediate notifications for high priority content",
          conditions: {
            type: "content_published",
            priority: "high",
          },
          actions: [
            {
              type: "create_notification",
              config: {
                channels: ["in_app", "email", "push"],
                priority: "high",
              },
            },
          ],
          isActive: true,
          priority: 1,
        },
        {
          id: "workflow-escalation",
          name: "Workflow Escalation",
          description: "Escalate overdue workflow tasks",
          conditions: {
            type: "workflow_assignment",
            overdue: true,
          },
          actions: [
            {
              type: "create_notification",
              config: {
                channels: ["email"],
                priority: "urgent",
              },
            },
            {
              type: "trigger_webhook",
              config: {
                url: "/api/webhooks/escalation",
              },
            },
          ],
          isActive: true,
          priority: 2,
        },
      ]

      for (const rule of defaultRules) {
        this.rules.set(rule.id, rule)
      }

      logger.info("Notification rules loaded", { count: defaultRules.length })
    } catch (error) {
      logger.error("Failed to load notification rules:", error)
    }
  }

  /**
   * Start batch processor for efficient notification delivery
   */
  private startBatchProcessor(): void {
    if (!this.options.enableBatching) return

    setInterval(() => {
      this.processPendingBatches()
    }, this.options.batchTimeout!)
  }

  /**
   * Start digest processor for periodic notification summaries
   */
  private startDigestProcessor(): void {
    if (!this.options.enableDigest) return

    // Process daily digests at 9 AM
    setInterval(() => {
      const now = new Date()
      if (now.getHours() === 9 && now.getMinutes() === 0) {
        this.processDigestNotifications()
      }
    }, 60000) // Check every minute
  }

  /**
   * Send a notification with advanced features
   */
  public async sendNotification(params: {
    userId: string | string[]
    type: NotificationType
    title: string
    message: string
    priority?: NotificationPriority
    channels?: NotificationChannel[]
    data?: Record<string, any>
    metadata?: Record<string, any>
    expiresAt?: Date
    scheduledAt?: Date
    actionUrl?: string
    imageUrl?: string
    templateId?: string
    tenantId?: string
    relatedEntityType?: string
    relatedEntityId?: string
    batchable?: boolean
    deduplicationKey?: string
  }): Promise<INotification[]> {
    try {
      const {
        userId,
        type,
        title,
        message,
        priority = NotificationPriority.MEDIUM,
        channels = [NotificationChannel.IN_APP],
        data = {},
        metadata = {},
        expiresAt,
        scheduledAt,
        actionUrl,
        imageUrl,
        templateId,
        tenantId,
        relatedEntityType,
        relatedEntityId,
        batchable = false,
        deduplicationKey,
      } = params

      const userIds = Array.isArray(userId) ? userId : [userId]
      const notifications: INotification[] = []

      for (const uid of userIds) {
        // Check user preferences
        const userChannels = await this.getUserChannelsForType(uid, type, tenantId)
        const finalChannels = channels.filter((c) => userChannels.includes(c))

        if (finalChannels.length === 0) {
          logger.debug("No enabled channels for user", { userId: uid, type })
          continue
        }

        // Check rate limiting
        if (this.options.enableRateLimiting && (await this.isRateLimited(uid, type))) {
          logger.warn("Rate limit exceeded for user", { userId: uid, type })
          continue
        }

        // Check deduplication
        if (this.options.enableDeduplication && deduplicationKey) {
          const exists = await this.checkDuplicateNotification(uid, deduplicationKey, tenantId)
          if (exists) {
            logger.debug("Duplicate notification skipped", { userId: uid, deduplicationKey })
            continue
          }
        }

        // Apply template if specified
        let finalTitle = title
        let finalMessage = message
        let finalHtmlContent: string | undefined

        if (templateId) {
          const template = this.templates.get(templateId)
          if (template && template.subject) {
            finalTitle = this.processTemplate(template.subject, data)
            finalMessage = this.processTemplate(template.body, data)
            finalHtmlContent = template.htmlContent ? this.processTemplate(template.htmlContent, data) : undefined
          }
        }

        // Apply personalization
        if (this.options.enablePersonalization) {
          const personalizedContent = await this.personalizeContent(uid, finalTitle, finalMessage, data)
          finalTitle = personalizedContent.title
          finalMessage = personalizedContent.message
        }

        const notification: INotification = {
          id: this.generateId(),
          userId: uid,
          type,
          title: finalTitle,
          message: finalMessage,
          status: NotificationStatus.UNREAD,
          priority,
          channels: finalChannels,
          data: {
            ...data,
            htmlContent: finalHtmlContent,
          },
          metadata: {
            ...metadata,
            deduplicationKey,
            templateId,
          },
          expiresAt,
          scheduledAt,
          actionUrl,
          imageUrl,
          tenantId,
          relatedEntityType,
          relatedEntityId,
          createdAt: new Date(),
          updatedAt: new Date(),
        }

        // Handle scheduling
        if (scheduledAt && scheduledAt > new Date()) {
          await this.scheduleNotification(notification)
        } else if (batchable && this.options.enableBatching) {
          await this.addToBatch(notification)
        } else {
          await this.deliverNotification(notification)
        }

        notifications.push(notification)
      }

      // Apply notification rules
      if (this.options.enableRules) {
        await this.applyNotificationRules(notifications)
      }

      // Emit event
      this.emit("notifications:sent", {
        notifications,
        type,
        tenantId,
      })

      // Audit log
      if (this.options.enableAudit) {
        await auditService.log({
          action: "notification.send",
          entityType: "Notification",
          entityId: notifications.map((n) => n.id).join(","),
          details: {
            type,
            userCount: userIds.length,
            channels,
            priority,
            batchable,
          },
        })
      }

      logger.info("Notifications sent", {
        count: notifications.length,
        type,
        priority,
        channels,
        tenantId,
      })

      return notifications
    } catch (error) {
      logger.error("Failed to send notification:", error)
      throw error
    }
  }

  /**
   * Get notifications for a user with advanced filtering
   */
  public async getUserNotifications(params: {
    userId: string
    status?: NotificationStatus | NotificationStatus[]
    type?: NotificationType | NotificationType[]
    priority?: NotificationPriority | NotificationPriority[]
    channels?: NotificationChannel | NotificationChannel[]
    dateFrom?: Date
    dateTo?: Date
    search?: string
    relatedEntityType?: string
    relatedEntityId?: string
    page?: number
    limit?: number
    sortBy?: string
    sortOrder?: "asc" | "desc"
    tenantId?: string
    includeExpired?: boolean
    includeRead?: boolean
  }): Promise<{
    notifications: INotification[]
    total: number
    unreadCount: number
    page: number
    limit: number
    pages: number
    aggregations?: Record<string, any>
  }> {
    try {
      const {
        userId,
        status,
        type,
        priority,
        channels,
        dateFrom,
        dateTo,
        search,
        relatedEntityType,
        relatedEntityId,
        page = 1,
        limit = 20,
        sortBy = "createdAt",
        sortOrder = "desc",
        tenantId,
        includeExpired = false,
        includeRead = true,
      } = params

      const cacheKey = `notifications:${userId}:${JSON.stringify(params)}`

      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get(cacheKey, tenantId)
        if (cached) {
          return cached
        }
      }

      // Build query filters
      const where: any = { userId }
      if (tenantId) where.tenantId = tenantId

      if (status) {
        where.status = Array.isArray(status) ? { in: status } : status
      }

      if (type) {
        where.type = Array.isArray(type) ? { in: type } : type
      }

      if (priority) {
        where.priority = Array.isArray(priority) ? { in: priority } : priority
      }

      if (channels) {
        const channelArray = Array.isArray(channels) ? channels : [channels]
        where.channels = { hasSome: channelArray }
      }

      if (dateFrom || dateTo) {
        where.createdAt = {}
        if (dateFrom) where.createdAt.gte = dateFrom
        if (dateTo) where.createdAt.lte = dateTo
      }

      if (search) {
        where.OR = [
          { title: { contains: search, mode: "insensitive" } },
          { message: { contains: search, mode: "insensitive" } },
        ]
      }

      if (relatedEntityType) where.relatedEntityType = relatedEntityType
      if (relatedEntityId) where.relatedEntityId = relatedEntityId

      if (!includeExpired) {
        where.OR = [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      }

      if (!includeRead) {
        where.status = { not: NotificationStatus.READ }
      }

      // Execute queries
      const [notifications, total, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({
          where: {
            userId,
            status: NotificationStatus.UNREAD,
            ...(tenantId && { tenantId }),
          },
        }),
      ])

      const result: INotificationResponse = {
        notifications: notifications as INotification[],
        total,
        unreadCount,
        page,
        limit,
        pages: Math.ceil(total / limit),
        aggregations: this.options.enableAnalytics ? await this.getNotificationAggregations(userId, where) : undefined,
      }

      // Cache result
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, result, {
          ttl: this.options.cacheTtl! / 4,
          namespace: tenantId,
        })
      }

      return result
    } catch (error) {
      logger.error("Failed to get user notifications:", error)
      throw error
    }
  }

  /**
   * Mark notification as read with analytics tracking
   */
  public async markAsRead(id: string, userId?: string, tenantId?: string): Promise<INotification> {
    try {
      const notification = await this.getNotificationById(id, tenantId)
      if (!notification) {
        throw ApiError.notFound("Notification not found")
      }

      if (userId && notification.userId !== userId) {
        throw ApiError.forbidden("Cannot mark another user's notification as read")
      }

      if (notification.status === NotificationStatus.READ) {
        return notification // Already read
      }

      const updatedNotification = await prisma.notification.update({
        where: { id },
        data: {
          status: NotificationStatus.READ,
          readAt: new Date(),
          updatedAt: new Date(),
        },
      })

      // Track analytics
      if (this.options.enableAnalytics) {
        await this.trackNotificationEvent("read", updatedNotification as INotification)
      }

      // Emit event
      this.emit("notification:read", updatedNotification)

      // Clear cache
      if (this.options.enableCache) {
        await this.clearUserNotificationCache(updatedNotification.userId, tenantId)
      }

      // Audit log
      if (this.options.enableAudit) {
        await auditService.log({
          action: "notification.read",
          entityType: "Notification",
          entityId: id,
          userId: updatedNotification.userId,
          tenantId,
        })
      }

      return updatedNotification as INotification
    } catch (error) {
      logger.error("Failed to mark notification as read:", error)
      throw error
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  public async markAllAsRead(params: {
    userId: string
    type?: NotificationType
    olderThan?: Date
    tenantId?: string
  }): Promise<number> {
    try {
      const { userId, type, olderThan, tenantId } = params

      const where: any = {
        userId,
        status: NotificationStatus.UNREAD,
      }

      if (tenantId) where.tenantId = tenantId
      if (type) where.type = type
      if (olderThan) where.createdAt = { lt: olderThan }

      const result = await prisma.notification.updateMany({
        where,
        data: {
          status: NotificationStatus.READ,
          readAt: new Date(),
          updatedAt: new Date(),
        },
      })

      // Clear cache
      if (this.options.enableCache) {
        await this.clearUserNotificationCache(userId, tenantId)
      }

      // Emit event
      this.emit("notifications:all_read", { userId, type, count: result.count, tenantId })

      // Audit log
      if (this.options.enableAudit) {
        await auditService.log({
          action: "notification.mark_all_read",
          entityType: "Notification",
          entityId: `user:${userId}`,
          userId,
          tenantId,
          details: { type, count: result.count },
        })
      }

      logger.info("All notifications marked as read", {
        userId,
        type,
        count: result.count,
        tenantId,
      })

      return result.count
    } catch (error) {
      logger.error("Failed to mark all notifications as read:", error)
      throw error
    }
  }

  /**
   * Get notification analytics for admin dashboard
   */
  public async getNotificationAnalytics(params: {
    dateFrom?: Date
    dateTo?: Date
    tenantId?: string
    userId?: string
    groupBy?: "day" | "week" | "month"
  }): Promise<NotificationAnalytics> {
    try {
      if (!this.options.enableAnalytics) {
        throw ApiError.badRequest("Analytics not enabled")
      }

      const {
        dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        dateTo = new Date(),
        tenantId,
        userId,
        groupBy = "day",
      } = params

      const cacheKey = `notification:analytics:${JSON.stringify(params)}`

      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get<NotificationAnalytics>(cacheKey, tenantId)
        if (cached) {
          return cached
        }
      }

      // Build base query conditions
      const where: any = {
        createdAt: {
          gte: dateFrom,
          lte: dateTo,
        },
      }

      if (tenantId) where.tenantId = tenantId
      if (userId) where.userId = userId

      // Execute analytics queries in parallel
      const [totalStats, channelDistribution, typeDistribution, priorityDistribution, timeSeriesData, topUsers] =
        await Promise.all([
          this.getTotalStats(where),
          this.getChannelDistribution(where),
          this.getTypeDistribution(where),
          this.getPriorityDistribution(where),
          this.getTimeSeriesData(where, groupBy),
          this.getTopUsers(where),
        ])

      const readRate = totalStats.totalSent > 0 ? (totalStats.totalRead / totalStats.totalSent) * 100 : 0

      const analytics: NotificationAnalytics = {
        totalSent: totalStats.totalSent,
        totalRead: totalStats.totalRead,
        totalUnread: totalStats.totalUnread,
        readRate,
        channelDistribution,
        typeDistribution,
        priorityDistribution,
        timeSeriesData,
        topUsers,
      }

      // Cache result
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, analytics, {
          ttl: this.options.cacheTtl! / 2,
          namespace: tenantId,
        })
      }

      return analytics
    } catch (error) {
      logger.error("Failed to get notification analytics:", error)
      throw error
    }
  }

  /**
   * Create or update notification template
   */
  public async upsertTemplate(
    template: Omit<INotificationTemplate, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): Promise<INotificationTemplate> {
    try {
      const templateId = template.id || this.generateId()
      const fullTemplate: INotificationTemplate = {
        ...template,
        id: templateId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      this.templates.set(templateId, fullTemplate)

      // Store in database
      await prisma.notificationTemplate.upsert({
        where: { id: templateId },
        update: {
          name: template.name,
          type: template.type,
          channels: template.channels,
          subject: template.subject,
          body: template.body,
          htmlContent: template.htmlContent,
          variables: template.variables,
          isActive: template.isActive,
          conditions: template.conditions,
          tenantId: template.tenantId,
          updatedAt: new Date(),
        },
        create: {
          id: templateId,
          name: template.name,
          type: template.type,
          channels: template.channels,
          subject: template.subject,
          body: template.body,
          htmlContent: template.htmlContent,
          variables: template.variables,
          isActive: template.isActive,
          conditions: template.conditions,
          tenantId: template.tenantId,
        },
      })

      logger.info("Notification template upserted", { templateId, name: template.name })
      return fullTemplate
    } catch (error) {
      logger.error("Failed to upsert notification template:", error)
      throw error
    }
  }

  /**
   * Set user notification preferences
   */
  public async setUserPreferences(
    userId: string,
    preferences: Partial<INotificationPreferences>,
    tenantId?: string,
  ): Promise<INotificationPreferences> {
    try {
      const existingPrefs = this.preferences.get(userId) || {
        id: this.generateId(),
        userId,
        channels: this.getDefaultChannelPreferences(),
        frequency: "immediate" as const,
        categories: {},
        enabled: true,
        tenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const updatedPrefs: INotificationPreferences = {
        ...existingPrefs,
        ...preferences,
        userId,
        tenantId,
        updatedAt: new Date(),
      }

      this.preferences.set(userId, updatedPrefs)

      // Store in database
      await prisma.notificationPreferences.upsert({
        where: { 
          userId_tenantId: {
            userId,
            tenantId: tenantId || null,
          }
        },
        update: {
          channels: updatedPrefs.channels,
          quietHours: updatedPrefs.quietHours,
          frequency: updatedPrefs.frequency,
          categories: updatedPrefs.categories,
          enabled: updatedPrefs.enabled,
          tenantId: updatedPrefs.tenantId || null,
          updatedAt: new Date(),
        },
        create: {
          userId,
          channels: updatedPrefs.channels,
          quietHours: updatedPrefs.quietHours,
          frequency: updatedPrefs.frequency,
          categories: updatedPrefs.categories,
          enabled: updatedPrefs.enabled,
          tenantId: updatedPrefs.tenantId || null,
        },
      })

      // Clear cache
      if (this.options.enableCache) {
        await cacheService.delete(`user:preferences:${userId}`, tenantId)
      }

      logger.info("User notification preferences updated", { userId, tenantId })
      return updatedPrefs
    } catch (error) {
      logger.error("Failed to set user preferences:", error)
      throw error
    }
  }

  /**
   * Get user notification preferences
   */
  public async getUserPreferences(userId: string, tenantId?: string): Promise<INotificationPreferences> {
    try {
      const cacheKey = `user:preferences:${userId}`

      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get<INotificationPreferences>(cacheKey, tenantId)
        if (cached) {
          return cached
        }
      }

      // Check memory cache
      const memoryPrefs = this.preferences.get(userId)
      if (memoryPrefs) {
        return memoryPrefs
      }

      // Load from database
      const dbPrefs = await prisma.notificationPreferences.findUnique({
        where: { 
          userId_tenantId: {
            userId,
            tenantId: tenantId || null,
          }
        },
      })

      const preferences: INotificationPreferences = dbPrefs
        ? {
            id: dbPrefs.id,
            userId: dbPrefs.userId,
            channels: dbPrefs.channels as Record<NotificationType, NotificationChannel[]>,
            quietHours: dbPrefs.quietHours as any,
            frequency: dbPrefs.frequency as any,
            categories: dbPrefs.categories as Record<string, boolean>,
            enabled: dbPrefs.enabled,
            tenantId: dbPrefs.tenantId || undefined,
            createdAt: dbPrefs.createdAt,
            updatedAt: dbPrefs.updatedAt,
          }
        : {
            id: this.generateId(),
            userId,
            channels: this.getDefaultChannelPreferences(),
            frequency: "immediate",
            categories: {},
            enabled: true,
            tenantId,
            createdAt: new Date(),
            updatedAt: new Date(),
          }

      // Cache result
      this.preferences.set(userId, preferences)
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, preferences, {
          ttl: this.options.cacheTtl!,
          namespace: tenantId,
        })
      }

      return preferences
    } catch (error) {
      logger.error("Failed to get user preferences:", error)
      throw error
    }
  }

  /**
   * Delete notification
   */
  public async deleteNotification(id: string, userId?: string, tenantId?: string): Promise<void> {
    try {
      const notification = await this.getNotificationById(id, tenantId)
      if (!notification) {
        throw ApiError.notFound("Notification not found")
      }

      if (userId && notification.userId !== userId) {
        throw ApiError.forbidden("Cannot delete another user's notification")
      }

      await prisma.notification.update({
        where: { id },
        data: {
          status: NotificationStatus.DELETED,
          updatedAt: new Date(),
        },
      })

      // Clear cache
      if (this.options.enableCache) {
        await this.clearUserNotificationCache(notification.userId, tenantId)
      }

      // Emit event
      this.emit("notification:deleted", { id, userId: notification.userId, tenantId })

      // Audit log
      if (this.options.enableAudit) {
        await auditService.log({
          action: "notification.delete",
          entityType: "Notification",
          entityId: id,
          userId: notification.userId,
          tenantId,
        })
      }

      logger.info("Notification deleted", { id, userId: notification.userId, tenantId })
    } catch (error) {
      logger.error("Failed to delete notification:", error)
      throw error
    }
  }

  /**
   * Archive notification
   */
  public async archiveNotification(id: string, userId?: string, tenantId?: string): Promise<INotification> {
    try {
      const notification = await this.getNotificationById(id, tenantId)
      if (!notification) {
        throw ApiError.notFound("Notification not found")
      }

      if (userId && notification.userId !== userId) {
        throw ApiError.forbidden("Cannot archive another user's notification")
      }

      const updatedNotification = await prisma.notification.update({
        where: { id },
        data: {
          status: NotificationStatus.ARCHIVED,
          archivedAt: new Date(),
          updatedAt: new Date(),
        },
      })

      // Clear cache
      if (this.options.enableCache) {
        await this.clearUserNotificationCache(notification.userId, tenantId)
      }

      // Emit event
      this.emit("notification:archived", updatedNotification)

      return updatedNotification as INotification
    } catch (error) {
      logger.error("Failed to archive notification:", error)
      throw error
    }
  }

  /**
   * Bulk operations on notifications
   */
  public async bulkOperation(params: {
    userId: string
    operation: "read" | "archive" | "delete"
    notificationIds?: string[]
    filters?: {
      type?: NotificationType
      priority?: NotificationPriority
      olderThan?: Date
    }
    tenantId?: string
  }): Promise<number> {
    try {
      const { userId, operation, notificationIds, filters, tenantId } = params

      const where: any = { userId }
      if (tenantId) where.tenantId = tenantId

      if (notificationIds && notificationIds.length > 0) {
        where.id = { in: notificationIds }
      }

      if (filters) {
        if (filters.type) where.type = filters.type
        if (filters.priority) where.priority = filters.priority
        if (filters.olderThan) where.createdAt = { lt: filters.olderThan }
      }

      const updateData: any = { updatedAt: new Date() }

      switch (operation) {
        case "read":
          updateData.status = NotificationStatus.READ
          updateData.readAt = new Date()
          break
        case "archive":
          updateData.status = NotificationStatus.ARCHIVED
          updateData.archivedAt = new Date()
          break
        case "delete":
          updateData.status = NotificationStatus.DELETED
          break
      }

      const result = await prisma.notification.updateMany({
        where,
        data: updateData,
      })

      // Clear cache
      if (this.options.enableCache) {
        await this.clearUserNotificationCache(userId, tenantId)
      }

      // Emit event
      this.emit(`notifications:bulk_${operation}`, {
        userId,
        count: result.count,
        tenantId,
      })

      // Audit log
      if (this.options.enableAudit) {
        await auditService.log({
          action: `notification.bulk_${operation}`,
          entityType: "Notification",
          entityId: `user:${userId}`,
          userId,
          tenantId,
          details: { count: result.count, filters },
        })
      }

      logger.info(`Bulk ${operation} operation completed`, {
        userId,
        count: result.count,
        tenantId,
      })

      return result.count
    } catch (error) {
      logger.error(`Failed to perform bulk ${params.operation} operation:`, error)
      throw error
    }
  }

  // Helper methods

  private async getUserChannelsForType(
    userId: string,
    type: NotificationType,
    tenantId?: string,
  ): Promise<NotificationChannel[]> {
    const preferences = await this.getUserPreferences(userId, tenantId)
    return preferences.channels[type] || [NotificationChannel.IN_APP]
  }

  private async isRateLimited(userId: string, type: NotificationType): Promise<boolean> {
    const key = `rate_limit:${userId}:${type}`
    const limiter = this.rateLimiters.get(key)

    if (!limiter) {
      // Create new rate limiter (simple implementation)
      this.rateLimiters.set(key, {
        count: 1,
        resetTime: Date.now() + 60000, // 1 minute
      })
      return false
    }

    if (Date.now() > limiter.resetTime) {
      limiter.count = 1
      limiter.resetTime = Date.now() + 60000
      return false
    }

    if (limiter.count >= 10) {
      // Max 10 notifications per minute
      return true
    }

    limiter.count++
    return false
  }

  private async checkDuplicateNotification(
    userId: string,
    deduplicationKey: string,
    tenantId?: string,
  ): Promise<boolean> {
    const where: any = {
      userId,
      metadata: {
        path: ["deduplicationKey"],
        equals: deduplicationKey,
      },
      createdAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      },
    }

    if (tenantId) where.tenantId = tenantId

    const existing = await prisma.notification.findFirst({ where })
    return !!existing
  }

  private processTemplate(template: string, data: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return data[key] || match
    })
  }

  private async personalizeContent(
    userId: string,
    title: string,
    message: string,
    data: Record<string, any>,
  ): Promise<{ title: string; message: string }> {
    // Simple personalization - in a real implementation, this could use ML/AI
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, timezone: true },
    })

    if (user) {
      const personalizedTitle = title.replace(/\{\{firstName\}\}/g, user.firstName || "")
      const personalizedMessage = message.replace(/\{\{firstName\}\}/g, user.firstName || "")

      return {
        title: personalizedTitle,
        message: personalizedMessage,
      }
    }

    return { title, message }
  }

  private async scheduleNotification(notification: INotification): Promise<void> {
    if (!notification.scheduledAt) return

    const delay = notification.scheduledAt.getTime() - Date.now()
    if (delay <= 0) {
      await this.deliverNotification(notification)
      return
    }

    const timeout = setTimeout(async () => {
      await this.deliverNotification(notification)
      this.scheduledNotifications.delete(notification.id)
    }, delay)

    this.scheduledNotifications.set(notification.id, timeout)
  }

  private async addToBatch(notification: INotification): Promise<void> {
    const batchId = `batch_${Date.now()}`
    let batch = this.batchQueue.get(batchId)

    if (!batch) {
      batch = {
        id: batchId,
        notifications: [],
        status: "pending",
        scheduledAt: new Date(),
      }
      this.batchQueue.set(batchId, batch)
    }

    batch.notifications.push(notification)

    if (batch.notifications.length >= this.options.batchSize!) {
      await this.processBatch(batch)
      this.batchQueue.delete(batchId)
    }
  }

  private async deliverNotification(notification: INotification): Promise<void> {
    try {
      // Store in database
      await prisma.notification.create({
        data: {
          id: notification.id,
          userId: notification.userId,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          status: notification.status,
          priority: notification.priority,
          channels: notification.channels,
          data: notification.data,
          metadata: notification.metadata,
          expiresAt: notification.expiresAt,
          scheduledAt: notification.scheduledAt,
          actionUrl: notification.actionUrl,
          imageUrl: notification.imageUrl,
          tenantId: notification.tenantId,
          templateId: notification.templateId,
          batchId: notification.batchId,
          parentId: notification.parentId,
          relatedEntityType: notification.relatedEntityType,
          relatedEntityId: notification.relatedEntityId,
        },
      })

      // Send through channels
      for (const channel of notification.channels) {
        await this.sendThroughChannel(notification, channel)
      }

      // Update sent timestamp
      await prisma.notification.update({
        where: { id: notification.id },
        data: { sentAt: new Date() },
      })

      // Track analytics
      if (this.options.enableAnalytics) {
        await this.trackNotificationEvent("sent", notification)
      }

      // Emit realtime event
      if (this.options.enableRealtime) {
        this.emit("notification:delivered", notification)
      }
    } catch (error) {
      logger.error("Failed to deliver notification:", error)
      throw error
    }
  }

  private async sendThroughChannel(notification: INotification, channel: NotificationChannel): Promise<void> {
    try {
      switch (channel) {
        case NotificationChannel.IN_APP:
          // Already stored in database
          break
        case NotificationChannel.EMAIL:
          await this.sendEmail(notification)
          break
        case NotificationChannel.SMS:
          await this.sendSMS(notification)
          break
        case NotificationChannel.PUSH:
          await this.sendPush(notification)
          break
        case NotificationChannel.WEBHOOK:
          await this.sendWebhook(notification)
          break
        case NotificationChannel.SLACK:
          await this.sendSlack(notification)
          break
        case NotificationChannel.DISCORD:
          await this.sendDiscord(notification)
          break
      }
    } catch (error) {
      logger.error(`Failed to send notification through ${channel}:`, error)
    }
  }

  private async sendEmail(notification: INotification): Promise<void> {
    // Implementation would integrate with email service
    logger.info("Email notification sent", { notificationId: notification.id })
  }

  private async sendSMS(notification: INotification): Promise<void> {
    // Implementation would integrate with SMS service
    logger.info("SMS notification sent", { notificationId: notification.id })
  }

  private async sendPush(notification: INotification): Promise<void> {
    // Implementation would integrate with push notification service
    logger.info("Push notification sent", { notificationId: notification.id })
  }

  private async sendWebhook(notification: INotification): Promise<void> {
    // Implementation would send HTTP webhook
    logger.info("Webhook notification sent", { notificationId: notification.id })
  }

  private async sendSlack(notification: INotification): Promise<void> {
    // Implementation would integrate with Slack API
    logger.info("Slack notification sent", { notificationId: notification.id })
  }

  private async sendDiscord(notification: INotification): Promise<void> {
    // Implementation would integrate with Discord API
    logger.info("Discord notification sent", { notificationId: notification.id })
  }

  private async processPendingBatches(): Promise<void> {
    for (const [batchId, batch] of this.batchQueue.entries()) {
      if (batch.status === "pending") {
        await this.processBatch(batch)
        this.batchQueue.delete(batchId)
      }
    }
  }

  private async processBatch(batch: NotificationBatch): Promise<void> {
    try {
      batch.status = "processing"
      batch.processedAt = new Date()

      for (const notification of batch.notifications) {
        notification.batchId = batch.id
        await this.deliverNotification(notification)
      }

      batch.status = "completed"
      logger.info("Batch processed successfully", { batchId: batch.id, count: batch.notifications.length })
    } catch (error) {
      batch.status = "failed"
      batch.errors = [error instanceof Error ? error.message : String(error)]
      logger.error("Failed to process batch:", error)
    }
  }

  private async processDigestNotifications(): Promise<void> {
    try {
      // Get users who prefer digest notifications
      const digestUsers = await prisma.notificationPreferences.findMany({
        where: { frequency: "daily" },
      })

      for (const userPrefs of digestUsers) {
        await this.sendDigestNotification(userPrefs.userId, userPrefs.tenantId || undefined)
      }

      logger.info("Digest notifications processed", { userCount: digestUsers.length })
    } catch (error) {
      logger.error("Failed to process digest notifications:", error)
    }
  }

  private async sendDigestNotification(userId: string, tenantId?: string): Promise<void> {
    try {
      // Get unread notifications from last 24 hours
      const notifications = await prisma.notification.findMany({
        where: {
          userId,
          status: NotificationStatus.UNREAD,
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
          ...(tenantId && { tenantId }),
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      })

      if (notifications.length === 0) return

      const digestNotification: INotification = {
        id: this.generateId(),
        userId,
        type: NotificationType.SYSTEM,
        title: `Daily Digest - ${notifications.length} unread notifications`,
        message: `You have ${notifications.length} unread notifications from the last 24 hours.`,
        status: NotificationStatus.UNREAD,
        priority: NotificationPriority.LOW,
        channels: [NotificationChannel.EMAIL],
        data: {
          notifications: notifications.slice(0, 5), // Include top 5
          totalCount: notifications.length,
        },
        tenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      await this.deliverNotification(digestNotification)
    } catch (error) {
      logger.error("Failed to send digest notification:", error)
    }
  }

  private async applyNotificationRules(notifications: INotification[]): Promise<void> {
    for (const notification of notifications) {
      for (const [ruleId, rule] of this.rules.entries()) {
        if (!rule.isActive) continue

        if (this.matchesRuleConditions(notification, rule.conditions)) {
          await this.executeRuleActions(notification, rule.actions)
        }
      }
    }
  }

  private matchesRuleConditions(notification: INotification, conditions: Record<string, any>): boolean {
    for (const [key, value] of Object.entries(conditions)) {
      if (notification[key as keyof INotification] !== value) {
        return false
      }
    }
    return true
  }

  private async executeRuleActions(notification: INotification, actions: any[]): Promise<void> {
    for (const action of actions) {
      try {
        switch (action.type) {
          case "create_notification":
            // Create additional notification based on rule
            break
          case "send_email":
            await this.sendEmail(notification)
            break
          case "trigger_webhook":
            await this.sendWebhook(notification)
            break
        }
      } catch (error) {
        logger.error("Failed to execute rule action:", error)
      }
    }
  }

  private async trackNotificationEvent(event: string, notification: INotification): Promise<void> {
    if (!this.options.enableAnalytics) return

    try {
      await prisma.notificationAnalytics.create({
        data: {
          notificationId: notification.id,
          userId: notification.userId,
          event,
          timestamp: new Date(),
          metadata: {
            type: notification.type,
            priority: notification.priority,
            channels: notification.channels,
          },
          tenantId: notification.tenantId,
        },
      })
    } catch (error) {
      logger.error("Failed to track notification event:", error)
    }
  }

  private async getNotificationById(id: string, tenantId?: string): Promise<INotification | null> {
    const where: any = { id }
    if (tenantId) where.tenantId = tenantId

    const notification = await prisma.notification.findFirst({ where })
    return notification as INotification | null
  }

  private async clearUserNotificationCache(userId: string, tenantId?: string): Promise<void> {
    if (!this.options.enableCache) return

    const patterns = [`notifications:${userId}:*`, `user:preferences:${userId}`]

    for (const pattern of patterns) {
      await cacheService.deletePattern(pattern, tenantId)
    }
  }

  private getDefaultChannelPreferences(): Record<NotificationType, NotificationChannel[]> {
    const defaultChannels = [NotificationChannel.IN_APP]
    const preferences: Record<NotificationType, NotificationChannel[]> = {} as Record<NotificationType, NotificationChannel[]>

    for (const type of Object.values(NotificationType)) {
      preferences[type] = [...defaultChannels]
    }

    return preferences
  }

  private async getNotificationAggregations(userId: string, where: any): Promise<Record<string, any>> {
    // Implementation for notification aggregations
    return {}
  }

  private async getTotalStats(where: any): Promise<{ totalSent: number; totalRead: number; totalUnread: number }> {
    const [total, read, unread] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...where, status: NotificationStatus.READ } }),
      prisma.notification.count({ where: { ...where, status: NotificationStatus.UNREAD } }),
    ])

    return {
      totalSent: total,
      totalRead: read,
      totalUnread: unread,
    }
  }

  private async getChannelDistribution(where: any): Promise<Record<NotificationChannel, number>> {
    // Implementation for channel distribution analytics
    const distribution: Record<NotificationChannel, number> = {} as any
    for (const channel of Object.values(NotificationChannel)) {
      distribution[channel] = 0
    }
    return distribution
  }

  private async getTypeDistribution(where: any): Promise<Record<NotificationType, number>> {
    // Implementation for type distribution analytics
    const distribution: Record<NotificationType, number> = {} as any
    for (const type of Object.values(NotificationType)) {
      distribution[type] = 0
    }
    return distribution
  }

  private async getPriorityDistribution(where: any): Promise<Record<NotificationPriority, number>> {
    // Implementation for priority distribution analytics
    const distribution: Record<NotificationPriority, number> = {} as any
    for (const priority of Object.values(NotificationPriority)) {
      distribution[priority] = 0
    }
    return distribution
  }

  private async getTimeSeriesData(where: any, groupBy: string): Promise<any[]> {
    // Implementation for time series analytics
    return []
  }

  private async getTopUsers(where: any): Promise<any[]> {
    // Implementation for top users analytics
    return []
  }

  private generateId(): string {
    return crypto.randomUUID()
  }

  /**
   * Cleanup expired notifications
   */
  public async cleanupExpiredNotifications(tenantId?: string): Promise<number> {
    try {
      const where: any = {
        expiresAt: {
          lt: new Date(),
        },
        status: {
          not: NotificationStatus.DELETED,
        },
      }

      if (tenantId) where.tenantId = tenantId

      const result = await prisma.notification.updateMany({
        where,
        data: {
          status: NotificationStatus.DELETED,
          updatedAt: new Date(),
        },
      })

      logger.info("Expired notifications cleaned up", { count: result.count, tenantId })
      return result.count
    } catch (error) {
      logger.error("Failed to cleanup expired notifications:", error)
      throw error
    }
  }

  /**
   * Get notification statistics
   */
  public async getNotificationStats(params: {
    userId?: string
    tenantId?: string
    dateFrom?: Date
    dateTo?: Date
  }): Promise<{
    total: number
    unread: number
    read: number
    archived: number
    byType: Record<NotificationType, number>
    byPriority: Record<NotificationPriority, number>
  }> {
    try {
      const { userId, tenantId, dateFrom, dateTo } = params

      const where: any = {}
      if (userId) where.userId = userId
      if (tenantId) where.tenantId = tenantId
      if (dateFrom || dateTo) {
        where.createdAt = {}
        if (dateFrom) where.createdAt.gte = dateFrom
        if (dateTo) where.createdAt.lte = dateTo
      }

      const [total, unread, read, archived] = await Promise.all([
        prisma.notification.count({ where }),
        prisma.notification.count({ where: { ...where, status: NotificationStatus.UNREAD } }),
        prisma.notification.count({ where: { ...where, status: NotificationStatus.READ } }),
        prisma.notification.count({ where: { ...where, status: NotificationStatus.ARCHIVED } }),
      ])

      // Get type and priority distributions
      const byType: Record<NotificationType, number> = {} as any
      const byPriority: Record<NotificationPriority, number> = {} as any

      for (const type of Object.values(NotificationType)) {
        byType[type] = await prisma.notification.count({ where: { ...where, type } })
      }

      for (const priority of Object.values(NotificationPriority)) {
        byPriority[priority] = await prisma.notification.count({ where: { ...where, priority } })
      }

      return {
        total,
        unread,
        read,
        archived,
        byType,
        byPriority,
      }
    } catch (error) {
      logger.error("Failed to get notification stats:", error)
      throw error
    }
  }

  /**
   * Shutdown the service gracefully
   */
  public async shutdown(): Promise<void> {
    try {
      // Clear all scheduled notifications
      for (const [id, timeout] of this.scheduledNotifications.entries()) {
        clearTimeout(timeout)
        this.scheduledNotifications.delete(id)
      }

      // Process remaining batches
      await this.processPendingBatches()

      // Clear all listeners
      this.removeAllListeners()

      logger.info("Notification service shutdown completed")
    } catch (error) {
      logger.error("Error during notification service shutdown:", error)
      throw error
    }
  }
}

// Export singleton instance
export const notificationService = new NotificationService()
