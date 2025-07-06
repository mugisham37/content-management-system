import { prisma } from "@cms-platform/database/client"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import { cacheService } from "./cache.service"
import { auditService } from "./audit.service"
import { EventEmitter } from "events"
import crypto from "crypto"
import axios, { AxiosRequestConfig, AxiosResponse } from "axios"

export interface WebhookServiceOptions {
  enableCache?: boolean
  cacheTtl?: number
  enableAudit?: boolean
  enableAnalytics?: boolean
  enableBatching?: boolean
  enableCircuitBreaker?: boolean
  enableRetryWithBackoff?: boolean
  maxRetries?: number
  batchSize?: number
  batchTimeout?: number
  circuitBreakerThreshold?: number
  circuitBreakerTimeout?: number
  enableSecurity?: boolean
  enableTransformation?: boolean
  enableFiltering?: boolean
  enableTemplates?: boolean
  queueConcurrency?: number
}

export interface WebhookEvent {
  id: string
  type: string
  timestamp: Date
  data: any
  metadata?: Record<string, any>
  tenantId?: string
  userId?: string
  source?: string
  version?: string
}

export interface WebhookDeliveryOptions {
  priority?: "low" | "normal" | "high" | "critical"
  delay?: number
  timeout?: number
  retries?: number
  headers?: Record<string, string>
  transformation?: string
  filter?: string
  batchable?: boolean
  securityLevel?: "none" | "basic" | "advanced"
}

export interface WebhookTemplate {
  id: string
  name: string
  description?: string
  url: string
  events: string[]
  headers?: Record<string, string>
  transformation?: string
  filter?: string
  isActive: boolean
  usageCount: number
  tenantId?: string
}

export interface WebhookAnalytics {
  webhookId: string
  deliveryStats: {
    total: number
    successful: number
    failed: number
    pending: number
    successRate: number
    averageResponseTime: number
    averageRetries: number
  }
  performanceMetrics: {
    throughput: number
    errorRate: number
    p95ResponseTime: number
    p99ResponseTime: number
    circuitBreakerTrips: number
  }
  eventDistribution: Record<string, number>
  timeSeriesData: Array<{
    timestamp: Date
    deliveries: number
    successes: number
    failures: number
    avgResponseTime: number
  }>
  topErrors: Array<{
    error: string
    count: number
    lastOccurrence: Date
  }>
}

export interface WebhookSecurity {
  signatureValidation: boolean
  ipWhitelist?: string[]
  rateLimiting?: {
    requests: number
    window: number
  }
  encryption?: {
    algorithm: string
    key: string
  }
  authentication?: {
    type: "bearer" | "basic" | "oauth2"
    credentials: Record<string, string>
  }
}

export interface CircuitBreakerState {
  state: "closed" | "open" | "half-open"
  failures: number
  lastFailureTime: number
  nextAttemptTime: number
  successCount: number
}

export interface WebhookBatch {
  id: string
  webhookId: string
  events: WebhookEvent[]
  createdAt: Date
  scheduledAt: Date
  status: "pending" | "processing" | "completed" | "failed"
  deliveryAttempts: number
}

export interface WebhookFilter {
  id: string
  name: string
  expression: string
  description?: string
  isActive: boolean
}

export interface WebhookTransformation {
  id: string
  name: string
  script: string
  description?: string
  isActive: boolean
  language: "javascript" | "jsonata" | "jq"
}

export class WebhookService extends EventEmitter {
  private options: WebhookServiceOptions
  private deliveryQueue: Map<string, any> = new Map()
  private batchQueue: Map<string, WebhookBatch> = new Map()
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map()
  private webhookTemplates: Map<string, WebhookTemplate> = new Map()
  private activeFilters: Map<string, WebhookFilter> = new Map()
  private activeTransformations: Map<string, WebhookTransformation> = new Map()
  private deliveryMetrics: Map<string, any> = new Map()
  private rateLimiters: Map<string, any> = new Map()
  private batchTimeouts: Map<string, NodeJS.Timeout> = new Map()

  constructor(options: WebhookServiceOptions = {}) {
    super()
    this.options = {
      enableCache: true,
      cacheTtl: 1800, // 30 minutes
      enableAudit: true,
      enableAnalytics: true,
      enableBatching: true,
      enableCircuitBreaker: true,
      enableRetryWithBackoff: true,
      maxRetries: 5,
      batchSize: 10,
      batchTimeout: 5000, // 5 seconds
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 60000, // 1 minute
      enableSecurity: true,
      enableTransformation: true,
      enableFiltering: true,
      enableTemplates: true,
      queueConcurrency: 10,
      ...options,
    }

    this.initializeCircuitBreakers()
    this.loadWebhookTemplates()
    this.startBatchProcessor()
    this.setMaxListeners(100)

    logger.info("Enhanced Webhook service initialized", this.options)
  }

  /**
   * Initialize circuit breakers for all webhooks
   */
  private async initializeCircuitBreakers(): Promise<void> {
    if (!this.options.enableCircuitBreaker) return

    try {
      const webhooks = await prisma.webhook.findMany({
        where: { status: "ACTIVE" },
      })

      for (const webhook of webhooks) {
        this.circuitBreakers.set(webhook.id, {
          state: "closed",
          failures: 0,
          lastFailureTime: 0,
          nextAttemptTime: 0,
          successCount: 0,
        })
      }

      logger.info("Circuit breakers initialized", { count: webhooks.length })
    } catch (error) {
      logger.error("Failed to initialize circuit breakers:", error)
    }
  }

  /**
   * Load webhook templates
   */
  private async loadWebhookTemplates(): Promise<void> {
    if (!this.options.enableTemplates) return

    try {
      // Load built-in templates
      const builtInTemplates: WebhookTemplate[] = [
        {
          id: "slack-notification",
          name: "Slack Notification",
          description: "Send notifications to Slack channels",
          url: "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK",
          events: ["content.published", "content.updated", "user.created"],
          headers: { "Content-Type": "application/json" },
          transformation: `{
            "text": "Content Update: " + data.title,
            "channel": "#general",
            "username": "CMS Bot",
            "attachments": [{
              "color": "good",
              "fields": [{
                "title": "Content Type",
                "value": data.contentType,
                "short": true
              }, {
                "title": "Status",
                "value": data.status,
                "short": true
              }]
            }]
          }`,
          isActive: true,
          usageCount: 0,
        },
        {
          id: "discord-notification",
          name: "Discord Notification",
          description: "Send notifications to Discord channels",
          url: "https://discord.com/api/webhooks/YOUR/DISCORD/WEBHOOK",
          events: ["content.published", "media.uploaded"],
          headers: { "Content-Type": "application/json" },
          transformation: `{
            "content": "📢 **" + event.type + "**\\n" + data.title,
            "embeds": [{
              "title": data.title,
              "description": data.description || "No description",
              "color": 5814783,
              "timestamp": new Date().toISOString(),
              "footer": {
                "text": "CMS Notification"
              }
            }]
          }`,
          isActive: true,
          usageCount: 0,
        },
        {
          id: "email-notification",
          name: "Email Notification",
          description: "Send email notifications via webhook",
          url: "https://api.emailservice.com/send",
          events: ["user.created", "content.published"],
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer YOUR_API_KEY",
          },
          transformation: `{
            "to": data.email || "admin@example.com",
            "subject": "CMS Notification: " + event.type,
            "html": "<h2>" + event.type + "</h2><p>" + JSON.stringify(data) + "</p>",
            "from": "noreply@cms.com"
          }`,
          isActive: true,
          usageCount: 0,
        },
      ]

      for (const template of builtInTemplates) {
        this.webhookTemplates.set(template.id, template)
      }

      logger.info("Webhook templates loaded", { count: builtInTemplates.length })
    } catch (error) {
      logger.error("Failed to load webhook templates:", error)
    }
  }

  /**
   * Start batch processor
   */
  private startBatchProcessor(): void {
    if (!this.options.enableBatching) return

    setInterval(() => {
      this.processPendingBatches()
    }, this.options.batchTimeout!)
  }

  /**
   * Create webhook with advanced configuration
   */
  async createWebhook(data: {
    name: string
    url: string
    events: string[]
    secret?: string
    contentTypeIds?: string[]
    status?: "ACTIVE" | "INACTIVE"
    security?: WebhookSecurity
    deliveryOptions?: WebhookDeliveryOptions
    templateId?: string
    tenantId?: string
    createdBy?: string
  }): Promise<any> {
    try {
      const {
        name,
        url,
        events,
        secret,
        contentTypeIds = [],
        status = "ACTIVE",
        security,
        deliveryOptions,
        templateId,
        tenantId,
        createdBy,
      } = data

      // Validate URL
      this.validateUrl(url)

      // Apply template if specified
      let webhookData = { ...data }
      if (templateId) {
        const template = this.webhookTemplates.get(templateId)
        if (template) {
          webhookData = this.applyWebhookTemplate(webhookData, template)
        }
      }

      // Generate secret if not provided
      const webhookSecret = secret || this.generateWebhookSecret()

      // Create webhook
      const webhook = await prisma.webhook.create({
        data: {
          name: webhookData.name,
          url: webhookData.url,
          secret: webhookSecret,
          events: webhookData.events as any[],
          status,
          contentTypeIds,
          tenantId,
        },
      })

      // Store advanced configuration
      if (security || deliveryOptions) {
        await this.storeWebhookConfiguration(webhook.id, {
          security,
          deliveryOptions,
          templateId,
        })
      }

      // Initialize circuit breaker
      if (this.options.enableCircuitBreaker) {
        this.circuitBreakers.set(webhook.id, {
          state: "closed",
          failures: 0,
          lastFailureTime: 0,
          nextAttemptTime: 0,
          successCount: 0,
        })
      }

      // Clear cache
      if (this.options.enableCache) {
        await this.clearWebhookCache(tenantId)
      }

      // Emit event
      this.emit("webhook:created", {
        webhook,
        tenantId,
        createdBy,
      })

      // Audit log
      if (this.options.enableAudit) {
        await auditService.log({
          action: "webhook.create",
          entityType: "Webhook",
          entityId: webhook.id,
          userId: createdBy,
          tenantId,
          details: {
            name,
            url,
            events,
            templateId,
          },
        })
      }

      logger.info("Webhook created", {
        id: webhook.id,
        name,
        url,
        events,
        tenantId,
      })

      return webhook
    } catch (error) {
      logger.error("Failed to create webhook:", error)
      throw error
    }
  }

  /**
   * Trigger webhook with advanced delivery options
   */
  async triggerWebhook(
    event: WebhookEvent,
    options: WebhookDeliveryOptions = {}
  ): Promise<{ queued: number; filtered: number; failed: number }> {
    try {
      const { tenantId } = event
      let queued = 0
      let filtered = 0
      let failed = 0

      // Find matching webhooks
      const webhooks = await this.findMatchingWebhooks(event, tenantId)

      for (const webhook of webhooks) {
        try {
          // Check circuit breaker
          if (this.options.enableCircuitBreaker && !this.isCircuitBreakerClosed(webhook.id)) {
            logger.warn("Circuit breaker open, skipping webhook", { webhookId: webhook.id })
            failed++
            continue
          }

          // Apply filters
          if (this.options.enableFiltering && !(await this.passesFilters(event, webhook))) {
            filtered++
            continue
          }

          // Transform event data
          let transformedData = event.data
          if (this.options.enableTransformation) {
            transformedData = await this.transformEventData(event, webhook)
          }

          // Check if batchable
          if (this.options.enableBatching && options.batchable) {
            await this.addToBatch(webhook.id, { ...event, data: transformedData })
          } else {
            // Queue for immediate delivery
            await this.queueWebhookDelivery(webhook, { ...event, data: transformedData }, options)
          }

          queued++
        } catch (error) {
          logger.error("Failed to process webhook", { webhookId: webhook.id, error })
          failed++
        }
      }

      return { queued, filtered, failed }
    } catch (error) {
      logger.error("Failed to trigger webhooks:", error)
      throw error
    }
  }

  /**
   * Get webhook analytics
   */
  async getWebhookAnalytics(
    webhookId: string,
    timeRange: { start: Date; end: Date },
    tenantId?: string
  ): Promise<WebhookAnalytics> {
    try {
      const deliveries = await prisma.webhookDelivery.findMany({
        where: {
          webhookId,
          timestamp: {
            gte: timeRange.start,
            lte: timeRange.end,
          },
        },
        orderBy: { timestamp: "desc" },
      })

      const total = deliveries.length
      const successful = deliveries.filter(d => d.success).length
      const failed = total - successful
      const pending = 0 // Would track from queue in real implementation

      const successRate = total > 0 ? (successful / total) * 100 : 0
      const averageResponseTime = deliveries.length > 0 
        ? deliveries.reduce((sum, d) => sum + (d.statusCode || 0), 0) / deliveries.length 
        : 0

      // Group deliveries by hour for time series
      const timeSeriesData = this.groupDeliveriesByHour(deliveries)

      // Get top errors
      const errorCounts = new Map<string, { count: number; lastOccurrence: Date }>()
      deliveries.filter(d => !d.success && d.error).forEach(d => {
        const error = d.error!
        const existing = errorCounts.get(error) || { count: 0, lastOccurrence: new Date(0) }
        existing.count++
        if (d.timestamp > existing.lastOccurrence) {
          existing.lastOccurrence = d.timestamp
        }
        errorCounts.set(error, existing)
      })

      const topErrors = Array.from(errorCounts.entries())
        .map(([error, data]) => ({ error, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)

      return {
        webhookId,
        deliveryStats: {
          total,
          successful,
          failed,
          pending,
          successRate,
          averageResponseTime,
          averageRetries: 0, // Would calculate from retry data
        },
        performanceMetrics: {
          throughput: total / ((timeRange.end.getTime() - timeRange.start.getTime()) / (1000 * 60 * 60)), // per hour
          errorRate: (failed / total) * 100,
          p95ResponseTime: this.calculatePercentile(deliveries.map(d => d.statusCode || 0), 95),
          p99ResponseTime: this.calculatePercentile(deliveries.map(d => d.statusCode || 0), 99),
          circuitBreakerTrips: 0, // Would track from circuit breaker events
        },
        eventDistribution: {},
        timeSeriesData,
        topErrors,
      }
    } catch (error) {
      logger.error("Failed to get webhook analytics:", error)
      throw error
    }
  }

  /**
   * Get all webhooks with filtering
   */
  async getAllWebhooks(
    filter: {
      search?: string
      event?: string
      status?: string
      contentTypeId?: string
      tenantId?: string
    } = {},
    pagination: {
      page?: number
      limit?: number
    } = {}
  ): Promise<{
    webhooks: any[]
    totalCount: number
    page: number
    totalPages: number
  }> {
    try {
      const { page = 1, limit = 20 } = pagination
      const skip = (page - 1) * limit

      // Build where clause
      const where: any = {}
      if (filter.tenantId) where.tenantId = filter.tenantId
      if (filter.status) where.status = filter.status
      if (filter.contentTypeId) {
        where.contentTypeIds = { has: filter.contentTypeId }
      }
      if (filter.event) {
        where.events = { has: filter.event }
      }
      if (filter.search) {
        where.OR = [
          { name: { contains: filter.search, mode: "insensitive" } },
          { url: { contains: filter.search, mode: "insensitive" } },
        ]
      }

      const [webhooks, totalCount] = await Promise.all([
        prisma.webhook.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            deliveries: {
              take: 5,
              orderBy: { timestamp: "desc" },
            },
          },
        }),
        prisma.webhook.count({ where }),
      ])

      const totalPages = Math.ceil(totalCount / limit)

      return {
        webhooks,
        totalCount,
        page,
        totalPages,
      }
    } catch (error) {
      logger.error("Failed to get webhooks:", error)
      throw error
    }
  }

  /**
   * Update webhook
   */
  async updateWebhook(
    id: string,
    data: {
      name?: string
      url?: string
      secret?: string
      events?: string[]
      contentTypeIds?: string[]
      status?: "ACTIVE" | "INACTIVE"
    },
    tenantId?: string,
    updatedBy?: string
  ): Promise<any> {
    try {
      // Validate URL if provided
      if (data.url) {
        this.validateUrl(data.url)
      }

      const webhook = await prisma.webhook.update({
        where: { id, tenantId },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      })

      // Clear cache
      if (this.options.enableCache) {
        await this.clearWebhookCache(tenantId)
      }

      // Audit log
      if (this.options.enableAudit && updatedBy) {
        await auditService.log({
          action: "webhook.update",
          entityType: "Webhook",
          entityId: id,
          userId: updatedBy,
          tenantId,
          details: data,
        })
      }

      logger.info("Webhook updated", { id, tenantId })
      return webhook
    } catch (error) {
      logger.error("Failed to update webhook:", error)
      throw error
    }
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(id: string, tenantId?: string, deletedBy?: string): Promise<void> {
    try {
      await prisma.webhook.delete({
        where: { id, tenantId },
      })

      // Remove circuit breaker
      this.circuitBreakers.delete(id)

      // Clear cache
      if (this.options.enableCache) {
        await this.clearWebhookCache(tenantId)
      }

      // Audit log
      if (this.options.enableAudit && deletedBy) {
        await auditService.log({
          action: "webhook.delete",
          entityType: "Webhook",
          entityId: id,
          userId: deletedBy,
          tenantId,
          details: {},
        })
      }

      logger.info("Webhook deleted", { id, tenantId })
    } catch (error) {
      logger.error("Failed to delete webhook:", error)
      throw error
    }
  }

  /**
   * Test webhook
   */
  async testWebhook(id: string, tenantId?: string): Promise<any> {
    try {
      const webhook = await prisma.webhook.findFirst({
        where: { id, tenantId },
      })

      if (!webhook) {
        throw ApiError.notFound("Webhook not found")
      }

      const testEvent: WebhookEvent = {
        id: crypto.randomUUID(),
        type: "test",
        timestamp: new Date(),
        data: {
          message: "This is a test webhook delivery",
          timestamp: new Date().toISOString(),
        },
        tenantId,
      }

      const result = await this.deliverWebhook(webhook, testEvent)
      return result
    } catch (error) {
      logger.error("Failed to test webhook:", error)
      throw error
    }
  }

  // Private helper methods

  private validateUrl(url: string): void {
    try {
      new URL(url)
    } catch (error) {
      throw ApiError.badRequest("Invalid URL format")
    }
  }

  private generateWebhookSecret(): string {
    return crypto.randomBytes(32).toString("hex")
  }

  private applyWebhookTemplate(data: any, template: WebhookTemplate): any {
    return {
      ...data,
      url: data.url || template.url,
      events: data.events || template.events,
      headers: { ...template.headers, ...data.headers },
      transformation: data.transformation || template.transformation,
    }
  }

  private async storeWebhookConfiguration(webhookId: string, config: any): Promise<void> {
    // Store in cache or separate configuration table
    await cacheService.set(`webhook:config:${webhookId}`, config, {
      ttl: this.options.cacheTtl,
    })
  }

  private async clearWebhookCache(tenantId?: string): Promise<void> {
    await cacheService.deletePattern("webhook:*", tenantId)
  }

  private async findMatchingWebhooks(event: WebhookEvent, tenantId?: string): Promise<any[]> {
    return prisma.webhook.findMany({
      where: {
        status: "ACTIVE",
        tenantId,
        events: { has: event.type },
      },
    })
  }

  private isCircuitBreakerClosed(webhookId: string): boolean {
    const breaker = this.circuitBreakers.get(webhookId)
    if (!breaker) return true

    const now = Date.now()

    switch (breaker.state) {
      case "closed":
        return true
      case "open":
        if (now >= breaker.nextAttemptTime) {
          breaker.state = "half-open"
          breaker.successCount = 0
          return true
        }
        return false
      case "half-open":
        return true
      default:
        return true
    }
  }

  private async passesFilters(event: WebhookEvent, webhook: any): Promise<boolean> {
    // Simple filter implementation - would be more sophisticated in production
    return true
  }

  private async transformEventData(event: WebhookEvent, webhook: any): Promise<any> {
    // Simple transformation - would use proper transformation engine in production
    return event.data
  }

  private async addToBatch(webhookId: string, event: WebhookEvent): Promise<void> {
    let batch = this.batchQueue.get(webhookId)
    
    if (!batch) {
      batch = {
        id: crypto.randomUUID(),
        webhookId,
        events: [],
        createdAt: new Date(),
        scheduledAt: new Date(Date.now() + this.options.batchTimeout!),
        status: "pending",
        deliveryAttempts: 0,
      }
      this.batchQueue.set(webhookId, batch)
    }

    batch.events.push(event)

    // Process batch if it reaches the size limit
    if (batch.events.length >= this.options.batchSize!) {
      await this.processBatch(batch)
      this.batchQueue.delete(webhookId)
    }
  }

  private async queueWebhookDelivery(webhook: any, event: WebhookEvent, options: WebhookDeliveryOptions): Promise<void> {
    const deliveryId = crypto.randomUUID()
    this.deliveryQueue.set(deliveryId, {
      webhook,
      event,
      options,
      attempts: 0,
      scheduledAt: new Date(Date.now() + (options.delay || 0)),
    })

    // Process immediately if no delay
    if (!options.delay) {
      setTimeout(() => this.processWebhookDelivery(deliveryId), 0)
    } else {
      setTimeout(() => this.processWebhookDelivery(deliveryId), options.delay)
    }
  }

  private async processWebhookDelivery(deliveryId: string): Promise<any> {
    const delivery = this.deliveryQueue.get(deliveryId)
    if (!delivery) return

    try {
      const result = await this.deliverWebhook(delivery.webhook, delivery.event)
      this.handleDeliverySuccess(delivery, result)
      this.deliveryQueue.delete(deliveryId)
      return result
    } catch (error) {
      this.handleDeliveryFailure(delivery, error)
      
      // Retry logic
      delivery.attempts++
      if (delivery.attempts < this.options.maxRetries!) {
        const delay = Math.pow(2, delivery.attempts) * 1000 // Exponential backoff
        setTimeout(() => this.processWebhookDelivery(deliveryId), delay)
      } else {
        this.deliveryQueue.delete(deliveryId)
      }
    }
  }

  private async processPendingBatches(): Promise<void> {
    const now = new Date()
    
    for (const [webhookId, batch] of this.batchQueue.entries()) {
      if (batch.scheduledAt <= now) {
        await this.processBatch(batch)
        this.batchQueue.delete(webhookId)
      }
    }
  }

  private async processBatch(batch: WebhookBatch): Promise<void> {
    try {
      const webhook = await prisma.webhook.findUnique({
        where: { id: batch.webhookId },
      })

      if (!webhook) return

      batch.status = "processing"
      
      const batchEvent: WebhookEvent = {
        id: batch.id,
        type: "batch",
        timestamp: new Date(),
        data: {
          events: batch.events,
          batchId: batch.id,
          eventCount: batch.events.length,
        },
      }

      await this.deliverWebhook(webhook, batchEvent)
      batch.status = "completed"
    } catch (error) {
      batch.status = "failed"
      logger.error("Failed to process batch:", error)
    }
  }

  private async deliverWebhook(webhook: any, event: WebhookEvent): Promise<any> {
    const startTime = Date.now()

    try {
      // Prepare payload
      const payload = {
        id: event.id,
        type: event.type,
        timestamp: event.timestamp.toISOString(),
        data: event.data,
        metadata: event.metadata,
      }

      // Prepare headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "CMS-Webhook/1.0",
        "X-Webhook-ID": webhook.id,
        "X-Webhook-Event": event.type,
        "X-Webhook-Timestamp": event.timestamp.toISOString(),
      }

      // Add signature if secret is provided
      if (webhook.secret) {
        const signature = this.generateSignature(JSON.stringify(payload), webhook.secret)
        headers["X-Webhook-Signature"] = `sha256=${signature}`
      }

      // Make HTTP request
      const response = await axios.post(webhook.url, payload, {
        headers,
        timeout: 30000,
        validateStatus: () => true, // Don't throw on HTTP error status
      })

      const endTime = Date.now()
      const responseTime = endTime - startTime

      // Record delivery
      await this.recordDelivery(webhook.id, {
        success: response.status >= 200 && response.status < 300,
        statusCode: response.status,
        request: JSON.stringify({ url: webhook.url, headers, payload }),
        response: JSON.stringify({
          status: response.status,
          headers: response.headers,
          data: response.data,
        }),
        responseTime,
      })

      // Update circuit breaker
      if (this.options.enableCircuitBreaker) {
        this.updateCircuitBreaker(webhook.id, response.status >= 200 && response.status < 300)
      }

      return {
        success: response.status >= 200 && response.status < 300,
        statusCode: response.status,
        responseTime,
        response: response.data,
      }
    } catch (error) {
      const endTime = Date.now()
      const responseTime = endTime - startTime

      // Record failed delivery
      await this.recordDelivery(webhook.id, {
        success: false,
        statusCode: 0,
        request: JSON.stringify({ url: webhook.url, headers, payload }),
        error: (error as Error).message,
        responseTime,
      })

      // Update circuit breaker
      if (this.options.enableCircuitBreaker) {
        this.updateCircuitBreaker(webhook.id, false)
      }

      throw error
    }
  }

  private generateSignature(payload: string, secret: string): string {
    return crypto.createHmac("sha256", secret).update(payload).digest("hex")
  }

  private async recordDelivery(webhookId: string, data: {
    success: boolean
    statusCode?: number
    request?: string
    response?: string
    error?: string
    responseTime?: number
  }): Promise<void> {
    try {
      await prisma.webhookDelivery.create({
        data: {
          webhookId,
          success: data.success,
          statusCode: data.statusCode,
          request: data.request,
          response: data.response,
          error: data.error,
          timestamp: new Date(),
        },
      })
    } catch (error) {
      logger.error("Failed to record webhook delivery:", error)
    }
  }

  private updateCircuitBreaker(webhookId: string, success: boolean): void {
    const breaker = this.circuitBreakers.get(webhookId)
    if (!breaker) return

    const now = Date.now()

    if (success) {
      if (breaker.state === "half-open") {
        breaker.successCount++
        if (breaker.successCount >= 3) {
          breaker.state = "closed"
          breaker.failures = 0
        }
      } else if (breaker.state === "closed") {
        breaker.failures = 0
      }
    } else {
      breaker.failures++
      breaker.lastFailureTime = now

      if (breaker.state === "closed" && breaker.failures >= this.options.circuitBreakerThreshold!) {
        breaker.state = "open"
        breaker.nextAttemptTime = now + this.options.circuitBreakerTimeout!
      } else if (breaker.state === "half-open") {
        breaker.state = "open"
        breaker.nextAttemptTime = now + this.options.circuitBreakerTimeout!
      }
    }
  }

  private handleDeliverySuccess(delivery: any, result: any): void {
    this.emit("webhook:delivery:success", {
      webhookId: delivery.webhook.id,
      eventId: delivery.event.id,
      result,
    })
  }

  private handleDeliveryFailure(delivery: any, error: any): void {
    this.emit("webhook:delivery:failure", {
      webhookId: delivery.webhook.id,
      eventId: delivery.event.id,
      error: (error as Error).message,
      attempts: delivery.attempts,
    })
  }

  private groupDeliveriesByHour(deliveries: any[]): Array<{
    timestamp: Date
    deliveries: number
    successes: number
    failures: number
    avgResponseTime: number
  }> {
    const groups = new Map<string, {
      deliveries: number
      successes: number
      failures: number
      totalResponseTime: number
    }>()

    deliveries.forEach((delivery) => {
      const hour = new Date(delivery.timestamp)
      hour.setMinutes(0, 0, 0)
      const key = hour.toISOString()

      const existing = groups.get(key) || {
        deliveries: 0,
        successes: 0,
        failures: 0,
        totalResponseTime: 0,
      }

      existing.deliveries++
      if (delivery.success) {
        existing.successes++
      } else {
        existing.failures++
      }
      existing.totalResponseTime += delivery.statusCode || 0

      groups.set(key, existing)
    })

    return Array.from(groups.entries()).map(([timestamp, data]) => ({
      timestamp: new Date(timestamp),
      deliveries: data.deliveries,
      successes: data.successes,
      failures: data.failures,
      avgResponseTime: data.deliveries > 0 ? data.totalResponseTime / data.deliveries : 0,
    }))
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0
    
    const sorted = values.sort((a, b) => a - b)
    const index = Math.ceil((percentile / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)]
  }

  /**
   * Get webhook templates
   */
  async getWebhookTemplates(): Promise<WebhookTemplate[]> {
    return Array.from(this.webhookTemplates.values())
  }

  /**
   * Create webhook from template
   */
  async createWebhookFromTemplate(
    templateId: string,
    overrides: {
      name?: string
      url?: string
      events?: string[]
      tenantId?: string
      createdBy?: string
    }
  ): Promise<any> {
    const template = this.webhookTemplates.get(templateId)
    if (!template) {
      throw ApiError.notFound("Webhook template not found")
    }

    return this.createWebhook({
      name: overrides.name || template.name,
      url: overrides.url || template.url,
      events: overrides.events || template.events,
      templateId,
      tenantId: overrides.tenantId,
      createdBy: overrides.createdBy,
    })
  }

  /**
   * Bulk trigger webhooks
   */
  async bulkTriggerWebhooks(
    events: WebhookEvent[],
    options: WebhookDeliveryOptions = {}
  ): Promise<{
    totalEvents: number
    totalQueued: number
    totalFiltered: number
    totalFailed: number
  }> {
    let totalQueued = 0
    let totalFiltered = 0
    let totalFailed = 0

    for (const event of events) {
      try {
        const result = await this.triggerWebhook(event, options)
        totalQueued += result.queued
        totalFiltered += result.filtered
        totalFailed += result.failed
      } catch (error) {
        totalFailed++
        logger.error("Failed to trigger webhook for event", { eventId: event.id, error })
      }
    }

    return {
      totalEvents: events.length,
      totalQueued,
      totalFiltered,
      totalFailed,
    }
  }

  /**
   * Get webhook delivery history
   */
  async getWebhookDeliveries(
    webhookId: string,
    options: {
      page?: number
      limit?: number
      success?: boolean
      dateFrom?: Date
      dateTo?: Date
      tenantId?: string
    } = {}
  ): Promise<{
    deliveries: any[]
    total: number
    page: number
    totalPages: number
  }> {
    try {
      const { page = 1, limit = 20, success, dateFrom, dateTo } = options
      const skip = (page - 1) * limit

      const where: any = { webhookId }
      if (success !== undefined) where.success = success
      if (dateFrom || dateTo) {
        where.timestamp = {}
        if (dateFrom) where.timestamp.gte = dateFrom
        if (dateTo) where.timestamp.lte = dateTo
      }

      const [deliveries, total] = await Promise.all([
        prisma.webhookDelivery.findMany({
          where,
          skip,
          take: limit,
          orderBy: { timestamp: "desc" },
        }),
        prisma.webhookDelivery.count({ where }),
      ])

      const totalPages = Math.ceil(total / limit)

      return {
        deliveries,
        total,
        page,
        totalPages,
      }
    } catch (error) {
      logger.error("Failed to get webhook deliveries:", error)
      throw error
    }
  }

  /**
   * Retry failed webhook delivery
   */
  async retryWebhookDelivery(deliveryId: string, tenantId?: string): Promise<any> {
    try {
      const delivery = await prisma.webhookDelivery.findFirst({
        where: { id: deliveryId },
        include: { webhook: true },
      })

      if (!delivery) {
        throw ApiError.notFound("Webhook delivery not found")
      }

      if (!delivery.webhook) {
        throw ApiError.notFound("Associated webhook not found")
      }

      // Parse the original request to recreate the event
      const requestData = JSON.parse(delivery.request || "{}")
      const event: WebhookEvent = {
        id: crypto.randomUUID(),
        type: "retry",
        timestamp: new Date(),
        data: requestData.payload?.data || {},
        tenantId,
      }

      const result = await this.deliverWebhook(delivery.webhook, event)
      return result
    } catch (error) {
      logger.error("Failed to retry webhook delivery:", error)
      throw error
    }
  }

  /**
   * Get webhook health status
   */
  async getWebhookHealth(webhookId: string, tenantId?: string): Promise<{
    status: "healthy" | "degraded" | "unhealthy"
    circuitBreakerState: string
    recentSuccessRate: number
    averageResponseTime: number
    lastDelivery?: Date
    errorCount: number
  }> {
    try {
      const webhook = await prisma.webhook.findFirst({
        where: { id: webhookId, tenantId },
      })

      if (!webhook) {
        throw ApiError.notFound("Webhook not found")
      }

      // Get recent deliveries (last 24 hours)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const recentDeliveries = await prisma.webhookDelivery.findMany({
        where: {
          webhookId,
          timestamp: { gte: oneDayAgo },
        },
        orderBy: { timestamp: "desc" },
      })

      const totalDeliveries = recentDeliveries.length
      const successfulDeliveries = recentDeliveries.filter(d => d.success).length
      const recentSuccessRate = totalDeliveries > 0 ? (successfulDeliveries / totalDeliveries) * 100 : 100

      const averageResponseTime = recentDeliveries.length > 0
        ? recentDeliveries.reduce((sum, d) => sum + (d.statusCode || 0), 0) / recentDeliveries.length
        : 0

      const errorCount = recentDeliveries.filter(d => !d.success).length
      const lastDelivery = recentDeliveries[0]?.timestamp

      const circuitBreaker = this.circuitBreakers.get(webhookId)
      const circuitBreakerState = circuitBreaker?.state || "closed"

      let status: "healthy" | "degraded" | "unhealthy" = "healthy"
      if (circuitBreakerState === "open" || recentSuccessRate < 50) {
        status = "unhealthy"
      } else if (recentSuccessRate < 80 || errorCount > 5) {
        status = "degraded"
      }

      return {
        status,
        circuitBreakerState,
        recentSuccessRate,
        averageResponseTime,
        lastDelivery,
        errorCount,
      }
    } catch (error) {
      logger.error("Failed to get webhook health:", error)
      throw error
    }
  }

  /**
   * Export webhook configuration
   */
  async exportWebhookConfig(webhookId: string, tenantId?: string): Promise<{
    webhook: any
    configuration: any
    deliveryStats: any
  }> {
    try {
      const webhook = await prisma.webhook.findFirst({
        where: { id: webhookId, tenantId },
      })

      if (!webhook) {
        throw ApiError.notFound("Webhook not found")
      }

      const configuration = await cacheService.get(`webhook:config:${webhookId}`)
      const deliveryStats = await this.getWebhookAnalytics(
        webhookId,
        {
          start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
          end: new Date(),
        },
        tenantId
      )

      return {
        webhook,
        configuration,
        deliveryStats,
      }
    } catch (error) {
      logger.error("Failed to export webhook config:", error)
      throw error
    }
  }

  /**
   * Import webhook configuration
   */
  async importWebhookConfig(
    config: {
      webhook: any
      configuration?: any
    },
    tenantId?: string,
    importedBy?: string
  ): Promise<any> {
    try {
      const { webhook: webhookConfig, configuration } = config

      const webhook = await this.createWebhook({
        name: webhookConfig.name,
        url: webhookConfig.url,
        events: webhookConfig.events,
        secret: webhookConfig.secret,
        contentTypeIds: webhookConfig.contentTypeIds,
        status: webhookConfig.status,
        security: configuration?.security,
        deliveryOptions: configuration?.deliveryOptions,
        tenantId,
        createdBy: importedBy,
      })

      logger.info("Webhook configuration imported", {
        webhookId: webhook.id,
        importedBy,
        tenantId,
      })

      return webhook
    } catch (error) {
      logger.error("Failed to import webhook config:", error)
      throw error
    }
  }

  /**
   * Get service health status
   */
  async getServiceHealth(): Promise<{
    status: "healthy" | "degraded" | "unhealthy"
    timestamp: string
    metrics: {
      totalWebhooks: number
      activeWebhooks: number
      queueSize: number
      batchQueueSize: number
      circuitBreakersOpen: number
    }
    features: Record<string, boolean>
  }> {
    try {
      const totalWebhooks = await prisma.webhook.count()
      const activeWebhooks = await prisma.webhook.count({
        where: { status: "ACTIVE" },
      })

      const circuitBreakersOpen = Array.from(this.circuitBreakers.values()).filter(
        cb => cb.state === "open"
      ).length

      let status: "healthy" | "degraded" | "unhealthy" = "healthy"
      if (circuitBreakersOpen > activeWebhooks * 0.5) {
        status = "unhealthy"
      } else if (circuitBreakersOpen > 0) {
        status = "degraded"
      }

      return {
        status,
        timestamp: new Date().toISOString(),
        metrics: {
          totalWebhooks,
          activeWebhooks,
          queueSize: this.deliveryQueue.size,
          batchQueueSize: this.batchQueue.size,
          circuitBreakersOpen,
        },
        features: {
          cache: this.options.enableCache!,
          analytics: this.options.enableAnalytics!,
          batching: this.options.enableBatching!,
          circuitBreaker: this.options.enableCircuitBreaker!,
          security: this.options.enableSecurity!,
          transformation: this.options.enableTransformation!,
          filtering: this.options.enableFiltering!,
          templates: this.options.enableTemplates!,
        },
      }
    } catch (error) {
      logger.error("Failed to get service health:", error)
      return {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        metrics: {
          totalWebhooks: 0,
          activeWebhooks: 0,
          queueSize: 0,
          batchQueueSize: 0,
          circuitBreakersOpen: 0,
        },
        features: {},
      }
    }
  }
}

// Export singleton instance
export const webhookService = new WebhookService()
