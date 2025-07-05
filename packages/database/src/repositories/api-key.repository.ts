// =============================================================================
// API KEY REPOSITORY - POSTGRESQL
// =============================================================================
// High-level abstraction for API key operations with comprehensive functionality

import { PrismaClient, ApiKey, ApiKeyScope, Prisma } from '@prisma/client'
import { BaseRepository } from './base.repository'

export interface CreateApiKeyInput {
  name: string
  key: string
  scopes?: ApiKeyScope[]
  expiresAt?: Date
  createdById: string
  tenantId?: string
}

export interface UpdateApiKeyInput {
  name?: string
  scopes?: ApiKeyScope[]
  expiresAt?: Date
  isActive?: boolean
}

export interface ApiKeyFilters {
  name?: string
  scopes?: ApiKeyScope[]
  isActive?: boolean
  isExpired?: boolean
  createdById?: string
  tenantId?: string
  search?: string
  dateFrom?: Date
  dateTo?: Date
}

export class ApiKeyRepository extends BaseRepository<ApiKey, CreateApiKeyInput, UpdateApiKeyInput> {
  protected modelName = 'ApiKey'
  protected model = this.prisma.apiKey

  constructor(prisma: PrismaClient) {
    super(prisma)
  }

  /**
   * Find API key by key string
   */
  async findByKey(key: string): Promise<ApiKey | null> {
    try {
      return await this.model.findUnique({
        where: { key },
        include: {
          createdBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      })
    } catch (error) {
      this.handleError(error, 'findByKey')
    }
  }

  /**
   * Find API key by key or throw error
   */
  async findByKeyOrThrow(key: string): Promise<ApiKey> {
    const apiKey = await this.findByKey(key)
    if (!apiKey) {
      throw new this.constructor.prototype.NotFoundError('ApiKey', key)
    }
    return apiKey
  }

  /**
   * Find API keys by tenant
   */
  async findByTenant(tenantId: string, includeInactive = false): Promise<ApiKey[]> {
    const where: any = { tenantId }
    if (!includeInactive) {
      where.isActive = true
    }

    try {
      return await this.model.findMany({
        where,
        include: {
          createdBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
    } catch (error) {
      this.handleError(error, 'findByTenant')
    }
  }

  /**
   * Find API keys by creator
   */
  async findByCreator(createdById: string): Promise<ApiKey[]> {
    try {
      return await this.model.findMany({
        where: { createdById },
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
    } catch (error) {
      this.handleError(error, 'findByCreator')
    }
  }

  /**
   * Find active API keys
   */
  async findActive(tenantId?: string): Promise<ApiKey[]> {
    const where: any = { isActive: true }
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        include: {
          createdBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
    } catch (error) {
      this.handleError(error, 'findActive')
    }
  }

  /**
   * Find expired API keys
   */
  async findExpired(tenantId?: string): Promise<ApiKey[]> {
    const where: any = {
      expiresAt: {
        lt: new Date(),
      },
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        include: {
          createdBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: { expiresAt: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'findExpired')
    }
  }

  /**
   * Find API keys by scope
   */
  async findByScope(scope: ApiKeyScope, tenantId?: string): Promise<ApiKey[]> {
    const where: any = {
      scopes: {
        has: scope,
      },
      isActive: true,
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        include: {
          createdBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
    } catch (error) {
      this.handleError(error, 'findByScope')
    }
  }

  /**
   * Update last used timestamp
   */
  async updateLastUsed(id: string): Promise<ApiKey> {
    try {
      return await this.model.update({
        where: { id },
        data: { lastUsedAt: new Date() },
      })
    } catch (error) {
      this.handleError(error, 'updateLastUsed')
    }
  }

  /**
   * Activate API key
   */
  async activate(id: string): Promise<ApiKey> {
    try {
      return await this.model.update({
        where: { id },
        data: { isActive: true },
      })
    } catch (error) {
      this.handleError(error, 'activate')
    }
  }

  /**
   * Deactivate API key
   */
  async deactivate(id: string): Promise<ApiKey> {
    try {
      return await this.model.update({
        where: { id },
        data: { isActive: false },
      })
    } catch (error) {
      this.handleError(error, 'deactivate')
    }
  }

  /**
   * Add scopes to API key
   */
  async addScopes(id: string, scopes: ApiKeyScope[]): Promise<ApiKey> {
    const apiKey = await this.findByIdOrThrow(id)
    const currentScopes = apiKey.scopes
    const uniqueScopes = [...new Set([...currentScopes, ...scopes])]

    try {
      return await this.model.update({
        where: { id },
        data: { scopes: uniqueScopes },
      })
    } catch (error) {
      this.handleError(error, 'addScopes')
    }
  }

  /**
   * Remove scopes from API key
   */
  async removeScopes(id: string, scopes: ApiKeyScope[]): Promise<ApiKey> {
    const apiKey = await this.findByIdOrThrow(id)
    const updatedScopes = apiKey.scopes.filter(scope => !scopes.includes(scope))

    try {
      return await this.model.update({
        where: { id },
        data: { scopes: updatedScopes },
      })
    } catch (error) {
      this.handleError(error, 'removeScopes')
    }
  }

  /**
   * Check if API key has specific scope
   */
  async hasScope(id: string, scope: ApiKeyScope): Promise<boolean> {
    const apiKey = await this.findByIdOrThrow(id)
    return apiKey.scopes.includes(scope)
  }

  /**
   * Check if API key is valid (active and not expired)
   */
  async isValid(key: string): Promise<boolean> {
    const apiKey = await this.findByKey(key)
    if (!apiKey || !apiKey.isActive) {
      return false
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return false
    }

    return true
  }

  /**
   * Search API keys with advanced filtering
   */
  async search(filters: ApiKeyFilters = {}): Promise<ApiKey[]> {
    const {
      name,
      scopes,
      isActive,
      isExpired,
      createdById,
      tenantId,
      search,
      dateFrom,
      dateTo,
    } = filters

    const where: any = {}

    if (name) {
      where.name = { contains: name, mode: 'insensitive' }
    }

    if (scopes && scopes.length > 0) {
      where.scopes = { hasSome: scopes }
    }

    if (isActive !== undefined) {
      where.isActive = isActive
    }

    if (isExpired !== undefined) {
      if (isExpired) {
        where.expiresAt = { lt: new Date() }
      } else {
        where.OR = [
          { expiresAt: null },
          { expiresAt: { gte: new Date() } },
        ]
      }
    }

    if (createdById) {
      where.createdById = createdById
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { key: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) {
        where.createdAt.gte = dateFrom
      }
      if (dateTo) {
        where.createdAt.lte = dateTo
      }
    }

    try {
      return await this.model.findMany({
        where,
        include: {
          createdBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
    } catch (error) {
      this.handleError(error, 'search')
    }
  }

  /**
   * Get API key usage statistics
   */
  async getUsageStats(tenantId?: string): Promise<{
    total: number
    active: number
    expired: number
    byScope: Record<string, number>
  }> {
    const where: any = {}
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      const [total, active, expired, allKeys] = await Promise.all([
        this.model.count({ where }),
        this.model.count({ where: { ...where, isActive: true } }),
        this.model.count({
          where: {
            ...where,
            expiresAt: { lt: new Date() },
          },
        }),
        this.model.findMany({
          where,
          select: { scopes: true },
        }),
      ])

      // Count by scope
      const byScope: Record<string, number> = {}
      allKeys.forEach(key => {
        key.scopes.forEach(scope => {
          byScope[scope] = (byScope[scope] || 0) + 1
        })
      })

      return {
        total,
        active,
        expired,
        byScope,
      }
    } catch (error) {
      this.handleError(error, 'getUsageStats')
    }
  }

  /**
   * Cleanup expired API keys
   */
  async cleanupExpired(tenantId?: string): Promise<{ count: number }> {
    const where: any = {
      expiresAt: { lt: new Date() },
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.deleteMany({ where })
    } catch (error) {
      this.handleError(error, 'cleanupExpired')
    }
  }
}
