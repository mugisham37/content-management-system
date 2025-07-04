// =============================================================================
// TENANT REPOSITORY - POSTGRESQL
// =============================================================================
// Multi-tenant management with usage tracking and billing support

import { PrismaClient, Tenant, TenantPlan, TenantStatus, Prisma } from '@prisma/client'
import { BaseRepository } from './base.repository'

export type TenantCreateInput = Prisma.TenantCreateInput
export type TenantUpdateInput = Prisma.TenantUpdateInput

export interface TenantWithRelations extends Tenant {
  users?: any[]
  contents?: any[]
  contentTypes?: any[]
  media?: any[]
  apiKeys?: any[]
  webhooks?: any[]
  workflows?: any[]
}

export interface TenantUsageStats {
  users: number
  storage: number
  contentTypes: number
  contents: number
  apiRequests: number
  webhooks: number
  workflows: number
}

export class TenantRepository extends BaseRepository<Tenant, TenantCreateInput, TenantUpdateInput> {
  protected modelName = 'Tenant'
  protected model = this.prisma.tenant

  constructor(prisma: PrismaClient) {
    super(prisma)
  }

  /**
   * Find tenant by slug
   */
  async findBySlug(slug: string): Promise<Tenant | null> {
    return this.findFirst({ slug })
  }

  /**
   * Find tenant by slug or throw
   */
  async findBySlugOrThrow(slug: string): Promise<Tenant> {
    const tenant = await this.findBySlug(slug)
    if (!tenant) {
      throw new Error(`Tenant not found with slug: ${slug}`)
    }
    return tenant
  }

  /**
   * Check if tenant exists by slug
   */
  async existsBySlug(slug: string): Promise<boolean> {
    const count = await this.count({ slug })
    return count > 0
  }

  /**
   * Find tenants by plan
   */
  async findByPlan(plan: TenantPlan): Promise<Tenant[]> {
    return this.findMany({ plan }, undefined, { createdAt: 'desc' })
  }

  /**
   * Find tenants by status
   */
  async findByStatus(status: TenantStatus): Promise<Tenant[]> {
    return this.findMany({ status }, undefined, { createdAt: 'desc' })
  }

  /**
   * Find active tenants
   */
  async findActive(): Promise<Tenant[]> {
    return this.findMany({ status: TenantStatus.ACTIVE }, undefined, { createdAt: 'desc' })
  }

  /**
   * Find suspended tenants
   */
  async findSuspended(): Promise<Tenant[]> {
    return this.findMany({ status: TenantStatus.SUSPENDED }, undefined, { createdAt: 'desc' })
  }

  /**
   * Search tenants
   */
  async search(
    query: string,
    options: {
      plan?: TenantPlan
      status?: TenantStatus
      limit?: number
      offset?: number
    } = {}
  ): Promise<Tenant[]> {
    const { plan, status, limit = 50, offset = 0 } = options

    const where: any = {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { slug: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    }

    if (plan) {
      where.plan = plan
    }

    if (status) {
      where.status = status
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
   * Update tenant plan
   */
  async updatePlan(tenantId: string, plan: TenantPlan): Promise<Tenant> {
    return this.update(tenantId, { plan })
  }

  /**
   * Update tenant status
   */
  async updateStatus(tenantId: string, status: TenantStatus): Promise<Tenant> {
    return this.update(tenantId, { status })
  }

  /**
   * Activate tenant
   */
  async activate(tenantId: string): Promise<Tenant> {
    return this.update(tenantId, { status: TenantStatus.ACTIVE })
  }

  /**
   * Suspend tenant
   */
  async suspend(tenantId: string): Promise<Tenant> {
    return this.update(tenantId, { status: TenantStatus.SUSPENDED })
  }

  /**
   * Archive tenant
   */
  async archive(tenantId: string): Promise<Tenant> {
    return this.update(tenantId, { status: TenantStatus.ARCHIVED })
  }

  /**
   * Update tenant usage limits
   */
  async updateUsageLimits(
    tenantId: string,
    limits: {
      maxUsers?: number
      maxStorage?: number
      maxContentTypes?: number
      maxContents?: number
      maxApiRequests?: number
      maxWebhooks?: number
      maxWorkflows?: number
    }
  ): Promise<Tenant> {
    const tenant = await this.findByIdOrThrow(tenantId)
    const currentLimits = tenant.usageLimits as any || {}

    return this.update(tenantId, {
      usageLimits: {
        ...currentLimits,
        ...limits,
      },
    })
  }

  /**
   * Update tenant current usage
   */
  async updateCurrentUsage(
    tenantId: string,
    usage: Partial<TenantUsageStats>
  ): Promise<Tenant> {
    const tenant = await this.findByIdOrThrow(tenantId)
    const currentUsage = tenant.currentUsage as any || {}

    return this.update(tenantId, {
      currentUsage: {
        ...currentUsage,
        ...usage,
        lastUpdated: new Date(),
      },
    })
  }

  /**
   * Get tenant usage statistics
   */
  async getUsageStatistics(tenantId: string): Promise<TenantUsageStats> {
    try {
      const [
        userCount,
        contentTypeCount,
        contentCount,
        mediaCount,
        webhookCount,
        workflowCount,
      ] = await Promise.all([
        this.prisma.user.count({ where: { tenantId } }),
        this.prisma.contentType.count({ where: { tenantId } }),
        this.prisma.content.count({ where: { tenantId } }),
        this.prisma.media.count({ where: { tenantId } }),
        this.prisma.webhook.count({ where: { tenantId } }),
        this.prisma.workflow.count({ where: { tenantId } }),
      ])

      // For now, return 0 for storage as we need to implement proper size tracking
      const storage = 0 // TODO: Implement proper storage calculation from media metadata

      return {
        users: userCount,
        storage,
        contentTypes: contentTypeCount,
        contents: contentCount,
        apiRequests: 0, // This would come from API usage tracking
        webhooks: webhookCount,
        workflows: workflowCount,
      }
    } catch (error) {
      this.handleError(error, 'getUsageStatistics')
    }
  }

  /**
   * Check if tenant has exceeded usage limits
   */
  async checkUsageLimits(tenantId: string): Promise<{
    exceeded: boolean
    limits: Record<string, { current: number; limit: number; exceeded: boolean }>
  }> {
    const tenant = await this.findByIdOrThrow(tenantId)
    const usage = await this.getUsageStatistics(tenantId)
    const limits = tenant.usageLimits as any || {}

    const checks = {
      users: {
        current: usage.users,
        limit: limits.maxUsers || Infinity,
        exceeded: usage.users > (limits.maxUsers || Infinity),
      },
      storage: {
        current: usage.storage,
        limit: limits.maxStorage || Infinity,
        exceeded: usage.storage > (limits.maxStorage || Infinity),
      },
      contentTypes: {
        current: usage.contentTypes,
        limit: limits.maxContentTypes || Infinity,
        exceeded: usage.contentTypes > (limits.maxContentTypes || Infinity),
      },
      contents: {
        current: usage.contents,
        limit: limits.maxContents || Infinity,
        exceeded: usage.contents > (limits.maxContents || Infinity),
      },
      webhooks: {
        current: usage.webhooks,
        limit: limits.maxWebhooks || Infinity,
        exceeded: usage.webhooks > (limits.maxWebhooks || Infinity),
      },
      workflows: {
        current: usage.workflows,
        limit: limits.maxWorkflows || Infinity,
        exceeded: usage.workflows > (limits.maxWorkflows || Infinity),
      },
    }

    const exceeded = Object.values(checks).some(check => check.exceeded)

    return { exceeded, limits: checks }
  }

  /**
   * Update tenant settings
   */
  async updateSettings(
    tenantId: string,
    settings: Record<string, any>
  ): Promise<Tenant> {
    const tenant = await this.findByIdOrThrow(tenantId)
    const currentSettings = tenant.settings as any || {}

    return this.update(tenantId, {
      settings: {
        ...currentSettings,
        ...settings,
      },
    })
  }

  /**
   * Update tenant billing info
   */
  async updateBillingInfo(
    tenantId: string,
    billingInfo: Record<string, any>
  ): Promise<Tenant> {
    const tenant = await this.findByIdOrThrow(tenantId)
    const currentBillingInfo = tenant.billingInfo as any || {}

    return this.update(tenantId, {
      billingInfo: {
        ...currentBillingInfo,
        ...billingInfo,
      },
    })
  }

  /**
   * Find tenants with relations
   */
  async findWithRelations(
    where?: Record<string, any>,
    includeRelations: {
      users?: boolean
      contents?: boolean
      contentTypes?: boolean
      media?: boolean
      apiKeys?: boolean
      webhooks?: boolean
      workflows?: boolean
    } = {}
  ): Promise<TenantWithRelations[]> {
    return this.findMany(where, includeRelations) as Promise<TenantWithRelations[]>
  }

  /**
   * Get tenant statistics
   */
  async getStatistics(): Promise<{
    total: number
    active: number
    suspended: number
    pending: number
    archived: number
    byPlan: Record<string, number>
  }> {
    try {
      const [
        total,
        active,
        suspended,
        pending,
        archived,
        planStats,
      ] = await Promise.all([
        this.count(),
        this.count({ status: TenantStatus.ACTIVE }),
        this.count({ status: TenantStatus.SUSPENDED }),
        this.count({ status: TenantStatus.PENDING }),
        this.count({ status: TenantStatus.ARCHIVED }),
        this.prisma.tenant.groupBy({
          by: ['plan'],
          _count: { _all: true },
        }),
      ])

      // Group by plan
      const byPlan: Record<string, number> = {}
      planStats.forEach(stat => {
        byPlan[stat.plan] = stat._count._all
      })

      return {
        total,
        active,
        suspended,
        pending,
        archived,
        byPlan,
      }
    } catch (error) {
      this.handleError(error, 'getStatistics')
    }
  }

  /**
   * Find tenants by creation date range
   */
  async findByCreationDate(startDate: Date, endDate: Date): Promise<Tenant[]> {
    return this.findMany({
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    }, undefined, { createdAt: 'desc' })
  }

  /**
   * Bulk update tenant status
   */
  async bulkUpdateStatus(tenantIds: string[], status: TenantStatus): Promise<number> {
    const result = await this.prisma.tenant.updateMany({
      where: {
        id: { in: tenantIds },
      },
      data: { status },
    })

    return result.count
  }

  /**
   * Bulk update tenant plan
   */
  async bulkUpdatePlan(tenantIds: string[], plan: TenantPlan): Promise<number> {
    const result = await this.prisma.tenant.updateMany({
      where: {
        id: { in: tenantIds },
      },
      data: { plan },
    })

    return result.count
  }
}
