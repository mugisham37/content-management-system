// =============================================================================
// WEBHOOK REPOSITORY - POSTGRESQL
// =============================================================================
// Webhook management with delivery tracking and event filtering

import { PrismaClient, Webhook, WebhookDelivery, WebhookEvent, WebhookStatus, Prisma } from '@prisma/client'
import { BaseRepository } from './base.repository'

export type WebhookCreateInput = Prisma.WebhookCreateInput
export type WebhookUpdateInput = Prisma.WebhookUpdateInput
export type WebhookDeliveryCreateInput = Prisma.WebhookDeliveryCreateInput

export interface WebhookWithRelations extends Webhook {
  deliveries?: WebhookDelivery[]
  tenant?: any
}

export class WebhookRepository extends BaseRepository<Webhook, WebhookCreateInput, WebhookUpdateInput> {
  protected modelName = 'Webhook'
  protected model = this.prisma.webhook

  constructor(prisma: PrismaClient) {
    super(prisma)
  }

  /**
   * Find webhooks by event
   */
  async findByEvent(event: WebhookEvent, tenantId?: string): Promise<Webhook[]> {
    const where: any = {
      events: { has: event },
      status: WebhookStatus.ACTIVE,
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Find webhooks by content type
   */
  async findByContentType(contentTypeId: string, tenantId?: string): Promise<Webhook[]> {
    const where: any = {
      OR: [
        { contentTypeIds: { has: contentTypeId } },
        { contentTypeIds: { isEmpty: true } }, // Global webhooks
      ],
      status: WebhookStatus.ACTIVE,
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Find webhooks by event and content type
   */
  async findByEventAndContentType(
    event: WebhookEvent,
    contentTypeId: string,
    tenantId?: string
  ): Promise<Webhook[]> {
    const where: any = {
      events: { has: event },
      OR: [
        { contentTypeIds: { has: contentTypeId } },
        { contentTypeIds: { isEmpty: true } }, // Global webhooks
      ],
      status: WebhookStatus.ACTIVE,
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Find active webhooks
   */
  async findActive(tenantId?: string): Promise<Webhook[]> {
    const where: any = { status: WebhookStatus.ACTIVE }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Find inactive webhooks
   */
  async findInactive(tenantId?: string): Promise<Webhook[]> {
    const where: any = { status: WebhookStatus.INACTIVE }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Activate webhook
   */
  async activate(webhookId: string): Promise<Webhook> {
    return this.update(webhookId, { status: WebhookStatus.ACTIVE })
  }

  /**
   * Deactivate webhook
   */
  async deactivate(webhookId: string): Promise<Webhook> {
    return this.update(webhookId, { status: WebhookStatus.INACTIVE })
  }

  /**
   * Add events to webhook
   */
  async addEvents(webhookId: string, events: WebhookEvent[]): Promise<Webhook> {
    const webhook = await this.findByIdOrThrow(webhookId)
    const currentEvents = webhook.events || []
    const uniqueEvents = [...new Set([...currentEvents, ...events])]

    return this.update(webhookId, { events: uniqueEvents })
  }

  /**
   * Remove events from webhook
   */
  async removeEvents(webhookId: string, events: WebhookEvent[]): Promise<Webhook> {
    const webhook = await this.findByIdOrThrow(webhookId)
    const currentEvents = webhook.events || []
    const updatedEvents = currentEvents.filter(event => !events.includes(event))

    return this.update(webhookId, { events: updatedEvents })
  }

  /**
   * Add content types to webhook
   */
  async addContentTypes(webhookId: string, contentTypeIds: string[]): Promise<Webhook> {
    const webhook = await this.findByIdOrThrow(webhookId)
    const currentContentTypes = webhook.contentTypeIds || []
    const uniqueContentTypes = [...new Set([...currentContentTypes, ...contentTypeIds])]

    return this.update(webhookId, { contentTypeIds: uniqueContentTypes })
  }

  /**
   * Remove content types from webhook
   */
  async removeContentTypes(webhookId: string, contentTypeIds: string[]): Promise<Webhook> {
    const webhook = await this.findByIdOrThrow(webhookId)
    const currentContentTypes = webhook.contentTypeIds || []
    const updatedContentTypes = currentContentTypes.filter(ct => !contentTypeIds.includes(ct))

    return this.update(webhookId, { contentTypeIds: updatedContentTypes })
  }

  /**
   * Search webhooks
   */
  async search(
    query: string,
    tenantId?: string,
    options: {
      status?: WebhookStatus
      event?: WebhookEvent
      limit?: number
      offset?: number
    } = {}
  ): Promise<Webhook[]> {
    const { status, event, limit = 50, offset = 0 } = options

    const where: any = {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { url: { contains: query, mode: 'insensitive' } },
      ],
    }

    if (status) {
      where.status = status
    }

    if (event) {
      where.events = { has: event }
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      })
    } catch (error) {
      this.handleError(error, 'search')
    }
  }

  /**
   * Find webhooks with relations
   */
  async findWithRelations(
    where?: Record<string, any>,
    includeRelations: {
      deliveries?: boolean
      tenant?: boolean
    } = {}
  ): Promise<WebhookWithRelations[]> {
    return this.findMany(where, includeRelations) as Promise<WebhookWithRelations[]>
  }

  /**
   * Get webhook statistics
   */
  async getStatistics(tenantId?: string): Promise<{
    total: number
    active: number
    inactive: number
    byEvent: Record<string, number>
    totalDeliveries: number
    successfulDeliveries: number
    failedDeliveries: number
  }> {
    const where: any = {}
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      const [
        total,
        active,
        inactive,
        totalDeliveries,
        successfulDeliveries,
        failedDeliveries,
      ] = await Promise.all([
        this.count(where),
        this.count({ ...where, status: WebhookStatus.ACTIVE }),
        this.count({ ...where, status: WebhookStatus.INACTIVE }),
        this.prisma.webhookDelivery.count({
          where: tenantId ? { webhook: { tenantId } } : {},
        }),
        this.prisma.webhookDelivery.count({
          where: {
            success: true,
            ...(tenantId ? { webhook: { tenantId } } : {}),
          },
        }),
        this.prisma.webhookDelivery.count({
          where: {
            success: false,
            ...(tenantId ? { webhook: { tenantId } } : {}),
          },
        }),
      ])

      // Get event statistics (simplified for now)
      const byEvent: Record<string, number> = {}

      return {
        total,
        active,
        inactive,
        byEvent,
        totalDeliveries,
        successfulDeliveries,
        failedDeliveries,
      }
    } catch (error) {
      this.handleError(error, 'getStatistics')
    }
  }
}

export class WebhookDeliveryRepository extends BaseRepository<WebhookDelivery, WebhookDeliveryCreateInput, Prisma.WebhookDeliveryUpdateInput> {
  protected modelName = 'WebhookDelivery'
  protected model = this.prisma.webhookDelivery

  constructor(prisma: PrismaClient) {
    super(prisma)
  }

  /**
   * Find deliveries by webhook
   */
  async findByWebhook(webhookId: string, limit = 50): Promise<WebhookDelivery[]> {
    try {
      return await this.model.findMany({
        where: { webhookId },
        orderBy: { timestamp: 'desc' },
        take: limit,
      })
    } catch (error) {
      this.handleError(error, 'findByWebhook')
    }
  }

  /**
   * Find successful deliveries
   */
  async findSuccessful(webhookId?: string, limit = 50): Promise<WebhookDelivery[]> {
    const where: any = { success: true }
    if (webhookId) {
      where.webhookId = webhookId
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
      })
    } catch (error) {
      this.handleError(error, 'findSuccessful')
    }
  }

  /**
   * Find failed deliveries
   */
  async findFailed(webhookId?: string, limit = 50): Promise<WebhookDelivery[]> {
    const where: any = { success: false }
    if (webhookId) {
      where.webhookId = webhookId
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
      })
    } catch (error) {
      this.handleError(error, 'findFailed')
    }
  }

  /**
   * Create delivery record
   */
  async createDelivery(
    webhookId: string,
    success: boolean,
    request: string,
    response?: string,
    statusCode?: number,
    error?: string
  ): Promise<WebhookDelivery> {
    return this.create({
      webhook: { connect: { id: webhookId } },
      timestamp: new Date(),
      success,
      request,
      response,
      statusCode,
      error,
    })
  }

  /**
   * Find deliveries by date range
   */
  async findByDateRange(
    startDate: Date,
    endDate: Date,
    webhookId?: string
  ): Promise<WebhookDelivery[]> {
    const where: any = {
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    }
    if (webhookId) {
      where.webhookId = webhookId
    }

    return this.findMany(where, undefined, { timestamp: 'desc' })
  }

  /**
   * Get delivery statistics
   */
  async getStats(webhookId?: string): Promise<{
    total: number
    successful: number
    failed: number
    successRate: number
    averageResponseTime?: number
  }> {
    const where: any = {}
    if (webhookId) {
      where.webhookId = webhookId
    }

    try {
      const [total, successful] = await Promise.all([
        this.count(where),
        this.count({ ...where, success: true }),
      ])

      const failed = total - successful
      const successRate = total > 0 ? (successful / total) * 100 : 0

      return {
        total,
        successful,
        failed,
        successRate,
      }
    } catch (error) {
      this.handleError(error, 'getStats')
    }
  }

  /**
   * Clean up old deliveries
   */
  async cleanupOldDeliveries(olderThanDays = 30): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

    const result = await this.prisma.webhookDelivery.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate,
        },
      },
    })

    return result.count
  }

  /**
   * Get recent deliveries for dashboard
   */
  async getRecentDeliveries(limit = 20): Promise<WebhookDelivery[]> {
    try {
      return await this.model.findMany({
        include: { webhook: true },
        orderBy: { timestamp: 'desc' },
        take: limit,
      })
    } catch (error) {
      this.handleError(error, 'getRecentDeliveries')
    }
  }
}
