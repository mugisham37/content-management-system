// =============================================================================
// ROUTE REPOSITORY - POSTGRESQL
// =============================================================================
// High-level abstraction for route operations with comprehensive functionality

import { PrismaClient, Route, RouteMethod, RouteStatus, Prisma } from '@prisma/client'
import { BaseRepository } from './base.repository'

export interface CreateRouteInput {
  path: string
  method: RouteMethod
  target: string
  status?: RouteStatus
  description?: string
  isPublic?: boolean
  rateLimit?: {
    limit: number
    window: number
  }
  caching?: {
    enabled: boolean
    ttl: number
  }
  transformation?: {
    request?: string
    response?: string
  }
  tenantId?: string
}

export interface UpdateRouteInput {
  path?: string
  method?: RouteMethod
  target?: string
  status?: RouteStatus
  description?: string
  isPublic?: boolean
  rateLimit?: {
    limit: number
    window: number
  }
  caching?: {
    enabled: boolean
    ttl: number
  }
  transformation?: {
    request?: string
    response?: string
  }
}

export interface RouteFilters {
  path?: string
  method?: RouteMethod
  status?: RouteStatus
  isPublic?: boolean
  tenantId?: string
  search?: string
  hasRateLimit?: boolean
  hasCaching?: boolean
  hasTransformation?: boolean
}

export class RouteRepository extends BaseRepository<Route, CreateRouteInput, UpdateRouteInput> {
  protected modelName = 'Route'
  protected model = this.prisma.route

  constructor(prisma: PrismaClient) {
    super(prisma)
  }

  /**
   * Find route by path and method
   */
  async findByPathAndMethod(path: string, method: RouteMethod, tenantId?: string): Promise<Route | null> {
    const where: any = { path, method }
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findFirst({ where })
    } catch (error) {
      this.handleError(error, 'findByPathAndMethod')
    }
  }

  /**
   * Find route by path and method or throw error
   */
  async findByPathAndMethodOrThrow(path: string, method: RouteMethod, tenantId?: string): Promise<Route> {
    const route = await this.findByPathAndMethod(path, method, tenantId)
    if (!route) {
      throw new this.constructor.prototype.NotFoundError('Route', `${method} ${path}`)
    }
    return route
  }

  /**
   * Find routes by path pattern
   */
  async findByPathPattern(pattern: string, tenantId?: string): Promise<Route[]> {
    const where: any = {
      path: { contains: pattern, mode: 'insensitive' }
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: [{ path: 'asc' }, { method: 'asc' }],
      })
    } catch (error) {
      this.handleError(error, 'findByPathPattern')
    }
  }

  /**
   * Find routes by method
   */
  async findByMethod(method: RouteMethod, tenantId?: string): Promise<Route[]> {
    const where: any = { method }
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: { path: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'findByMethod')
    }
  }

  /**
   * Find routes by status
   */
  async findByStatus(status: RouteStatus, tenantId?: string): Promise<Route[]> {
    const where: any = { status }
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: [{ path: 'asc' }, { method: 'asc' }],
      })
    } catch (error) {
      this.handleError(error, 'findByStatus')
    }
  }

  /**
   * Find active routes
   */
  async findActive(tenantId?: string): Promise<Route[]> {
    return this.findByStatus(RouteStatus.ACTIVE, tenantId)
  }

  /**
   * Find inactive routes
   */
  async findInactive(tenantId?: string): Promise<Route[]> {
    return this.findByStatus(RouteStatus.INACTIVE, tenantId)
  }

  /**
   * Find deprecated routes
   */
  async findDeprecated(tenantId?: string): Promise<Route[]> {
    return this.findByStatus(RouteStatus.DEPRECATED, tenantId)
  }

  /**
   * Find public routes
   */
  async findPublic(tenantId?: string): Promise<Route[]> {
    const where: any = { isPublic: true }
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: [{ path: 'asc' }, { method: 'asc' }],
      })
    } catch (error) {
      this.handleError(error, 'findPublic')
    }
  }

  /**
   * Find private routes
   */
  async findPrivate(tenantId?: string): Promise<Route[]> {
    const where: any = { isPublic: false }
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: [{ path: 'asc' }, { method: 'asc' }],
      })
    } catch (error) {
      this.handleError(error, 'findPrivate')
    }
  }

  /**
   * Find routes by tenant
   */
  async findByTenant(tenantId: string): Promise<Route[]> {
    try {
      return await this.model.findMany({
        where: { tenantId },
        orderBy: [{ path: 'asc' }, { method: 'asc' }],
      })
    } catch (error) {
      this.handleError(error, 'findByTenant')
    }
  }

  /**
   * Find routes with rate limiting
   */
  async findWithRateLimit(tenantId?: string): Promise<Route[]> {
    const where: any = {
      rateLimit: {
        not: null,
      },
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: [{ path: 'asc' }, { method: 'asc' }],
      })
    } catch (error) {
      this.handleError(error, 'findWithRateLimit')
    }
  }

  /**
   * Find routes with caching enabled
   */
  async findWithCaching(tenantId?: string): Promise<Route[]> {
    const where: any = {
      caching: {
        path: ['enabled'],
        equals: true,
      },
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: [{ path: 'asc' }, { method: 'asc' }],
      })
    } catch (error) {
      this.handleError(error, 'findWithCaching')
    }
  }

  /**
   * Find routes with transformations
   */
  async findWithTransformations(tenantId?: string): Promise<Route[]> {
    const where: any = {
      OR: [
        {
          transformation: {
            path: ['request'],
            not: null,
          },
        },
        {
          transformation: {
            path: ['response'],
            not: null,
          },
        },
      ],
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: [{ path: 'asc' }, { method: 'asc' }],
      })
    } catch (error) {
      this.handleError(error, 'findWithTransformations')
    }
  }

  /**
   * Search routes with advanced filtering
   */
  async search(filters: RouteFilters = {}): Promise<Route[]> {
    const {
      path,
      method,
      status,
      isPublic,
      tenantId,
      search,
      hasRateLimit,
      hasCaching,
      hasTransformation,
    } = filters

    const where: any = {}

    if (path) {
      where.path = { contains: path, mode: 'insensitive' }
    }

    if (method) {
      where.method = method
    }

    if (status) {
      where.status = status
    }

    if (isPublic !== undefined) {
      where.isPublic = isPublic
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    if (hasRateLimit) {
      where.rateLimit = { not: null }
    }

    if (hasCaching) {
      where.caching = {
        path: ['enabled'],
        equals: true,
      }
    }

    if (hasTransformation) {
      where.OR = [
        {
          transformation: {
            path: ['request'],
            not: null,
          },
        },
        {
          transformation: {
            path: ['response'],
            not: null,
          },
        },
      ]
    }

    if (search) {
      const searchConditions = [
        { path: { contains: search, mode: 'insensitive' } },
        { target: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]

      if (where.OR) {
        where.AND = [
          { OR: where.OR },
          { OR: searchConditions },
        ]
        delete where.OR
      } else {
        where.OR = searchConditions
      }
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: [{ path: 'asc' }, { method: 'asc' }],
      })
    } catch (error) {
      this.handleError(error, 'search')
    }
  }

  /**
   * Activate route
   */
  async activate(id: string): Promise<Route> {
    try {
      return await this.model.update({
        where: { id },
        data: { status: RouteStatus.ACTIVE },
      })
    } catch (error) {
      this.handleError(error, 'activate')
    }
  }

  /**
   * Deactivate route
   */
  async deactivate(id: string): Promise<Route> {
    try {
      return await this.model.update({
        where: { id },
        data: { status: RouteStatus.INACTIVE },
      })
    } catch (error) {
      this.handleError(error, 'deactivate')
    }
  }

  /**
   * Mark route as deprecated
   */
  async deprecate(id: string): Promise<Route> {
    try {
      return await this.model.update({
        where: { id },
        data: { status: RouteStatus.DEPRECATED },
      })
    } catch (error) {
      this.handleError(error, 'deprecate')
    }
  }

  /**
   * Update route rate limit
   */
  async updateRateLimit(id: string, rateLimit: { limit: number; window: number } | null): Promise<Route> {
    try {
      return await this.model.update({
        where: { id },
        data: { rateLimit: rateLimit === null ? Prisma.JsonNull : rateLimit },
      })
    } catch (error) {
      this.handleError(error, 'updateRateLimit')
    }
  }

  /**
   * Update route caching
   */
  async updateCaching(id: string, caching: { enabled: boolean; ttl: number } | null): Promise<Route> {
    try {
      return await this.model.update({
        where: { id },
        data: { caching: caching === null ? Prisma.JsonNull : caching },
      })
    } catch (error) {
      this.handleError(error, 'updateCaching')
    }
  }

  /**
   * Update route transformation
   */
  async updateTransformation(
    id: string,
    transformation: { request?: string; response?: string } | null
  ): Promise<Route> {
    try {
      return await this.model.update({
        where: { id },
        data: { transformation: transformation === null ? Prisma.JsonNull : transformation },
      })
    } catch (error) {
      this.handleError(error, 'updateTransformation')
    }
  }

  /**
   * Get route statistics
   */
  async getStats(tenantId?: string): Promise<{
    total: number
    byMethod: Record<string, number>
    byStatus: Record<string, number>
    public: number
    private: number
    withRateLimit: number
    withCaching: number
    withTransformation: number
  }> {
    const where: any = {}
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      const [
        total,
        publicRoutes,
        withRateLimit,
        withCaching,
        withTransformation,
        allRoutes,
      ] = await Promise.all([
        this.model.count({ where }),
        this.model.count({ where: { ...where, isPublic: true } }),
        this.model.count({
          where: {
            ...where,
            rateLimit: { not: null },
          },
        }),
        this.model.count({
          where: {
            ...where,
            caching: {
              path: ['enabled'],
              equals: true,
            },
          },
        }),
        this.model.count({
          where: {
            ...where,
            OR: [
              {
                transformation: {
                  path: ['request'],
                  not: null,
                },
              },
              {
                transformation: {
                  path: ['response'],
                  not: null,
                },
              },
            ],
          },
        }),
        this.model.findMany({
          where,
          select: { method: true, status: true },
        }),
      ])

      const privateRoutes = total - publicRoutes

      // Count by method
      const byMethod: Record<string, number> = {}
      allRoutes.forEach(route => {
        byMethod[route.method] = (byMethod[route.method] || 0) + 1
      })

      // Count by status
      const byStatus: Record<string, number> = {}
      allRoutes.forEach(route => {
        byStatus[route.status] = (byStatus[route.status] || 0) + 1
      })

      return {
        total,
        byMethod,
        byStatus,
        public: publicRoutes,
        private: privateRoutes,
        withRateLimit,
        withCaching,
        withTransformation,
      }
    } catch (error) {
      this.handleError(error, 'getStats')
    }
  }

  /**
   * Check for route conflicts
   */
  async checkConflicts(path: string, method: RouteMethod, tenantId?: string, excludeId?: string): Promise<Route[]> {
    const where: any = {
      path,
      method,
      status: { not: RouteStatus.INACTIVE },
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    if (excludeId) {
      where.id = { not: excludeId }
    }

    try {
      return await this.model.findMany({ where })
    } catch (error) {
      this.handleError(error, 'checkConflicts')
    }
  }

  /**
   * Bulk update route status
   */
  async bulkUpdateStatus(ids: string[], status: RouteStatus): Promise<{ count: number }> {
    try {
      return await this.model.updateMany({
        where: { id: { in: ids } },
        data: { status },
      })
    } catch (error) {
      this.handleError(error, 'bulkUpdateStatus')
    }
  }

  /**
   * Bulk delete routes
   */
  async bulkDelete(ids: string[]): Promise<{ count: number }> {
    try {
      return await this.model.deleteMany({
        where: { id: { in: ids } },
      })
    } catch (error) {
      this.handleError(error, 'bulkDelete')
    }
  }

  /**
   * Get routes for API documentation
   */
  async getApiDocumentation(tenantId?: string): Promise<Route[]> {
    const where: any = {
      status: RouteStatus.ACTIVE,
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: [{ path: 'asc' }, { method: 'asc' }],
      })
    } catch (error) {
      this.handleError(error, 'getApiDocumentation')
    }
  }

  /**
   * Validate route configuration
   */
  async validateRoute(routeData: CreateRouteInput): Promise<{
    isValid: boolean
    errors: string[]
    warnings: string[]
  }> {
    const errors: string[] = []
    const warnings: string[] = []

    // Check for conflicts
    const conflicts = await this.checkConflicts(
      routeData.path,
      routeData.method,
      routeData.tenantId
    )

    if (conflicts.length > 0) {
      errors.push(`Route conflict: ${routeData.method} ${routeData.path} already exists`)
    }

    // Validate path format
    if (!routeData.path.startsWith('/')) {
      errors.push('Route path must start with "/"')
    }

    // Validate rate limit
    if (routeData.rateLimit) {
      if (routeData.rateLimit.limit <= 0) {
        errors.push('Rate limit must be greater than 0')
      }
      if (routeData.rateLimit.window <= 0) {
        errors.push('Rate limit window must be greater than 0')
      }
    }

    // Validate caching
    if (routeData.caching) {
      if (routeData.caching.ttl <= 0) {
        errors.push('Cache TTL must be greater than 0')
      }
    }

    // Validate transformation code (basic check)
    if (routeData.transformation?.request) {
      try {
        new Function(routeData.transformation.request)
      } catch (e) {
        errors.push('Invalid request transformation code')
      }
    }

    if (routeData.transformation?.response) {
      try {
        new Function(routeData.transformation.response)
      } catch (e) {
        errors.push('Invalid response transformation code')
      }
    }

    // Warnings
    if (routeData.status === RouteStatus.DEPRECATED) {
      warnings.push('Route is marked as deprecated')
    }

    if (!routeData.description) {
      warnings.push('Route description is recommended for documentation')
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    }
  }
}
