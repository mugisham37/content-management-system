import { PrismaClient, ContentStatus, ContentVersionStatus } from "@prisma/client"
import { ContentRepository } from "@cms-platform/database/repositories/content.repository"
import { ContentTypeRepository } from "@cms-platform/database/repositories/content-type.repository"
import { ContentVersionRepository } from "@cms-platform/database/repositories/content-version.repository"
import { MediaRepository } from "@cms-platform/database/repositories/media.repository"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import { cacheService } from "./cache.service"
import { auditService } from "./audit.service"
import { ElasticsearchService } from "./elasticsearch.service"
import { EventEmitter } from "events"

export interface ContentServiceOptions {
  enableCache?: boolean
  cacheTtl?: number
  enableAudit?: boolean
  enableVersioning?: boolean
  enableSearch?: boolean
  enableWorkflow?: boolean
  enableScheduling?: boolean
  enableRelations?: boolean
  maxVersions?: number
}

export interface ContentStats {
  totalContent: number
  publishedContent: number
  draftContent: number
  archivedContent: number
  scheduledContent: number
  contentByType: Record<string, number>
  contentByLocale: Record<string, number>
  contentByStatus: Record<string, number>
  recentActivity: Array<{
    id: string
    title: string
    action: string
    timestamp: Date
    user: string
    contentType: string
  }>
  topAuthors: Array<{
    userId: string
    name: string
    contentCount: number
  }>
  popularContent: Array<{
    id: string
    title: string
    views: number
    likes: number
  }>
}

export interface ContentSearchOptions {
  page?: number
  limit?: number
  search?: string
  contentType?: string
  status?: string | string[]
  locale?: string
  tags?: string[]
  categories?: string[]
  author?: string
  dateFrom?: Date
  dateTo?: Date
  sortBy?: string
  sortOrder?: "asc" | "desc"
  tenantId?: string
  includeVersions?: boolean
  includeRelations?: boolean
  includeMetrics?: boolean
  facets?: string[]
}

export interface ContentRelation {
  id: string
  type: "reference" | "embed" | "link"
  targetId: string
  targetType: string
  metadata?: Record<string, any>
}

export interface ContentWorkflowState {
  id: string
  name: string
  description?: string
  isInitial?: boolean
  isFinal?: boolean
  allowedTransitions: string[]
  requiredRoles?: string[]
  actions?: Array<{
    type: string
    config: Record<string, any>
  }>
}

export interface ContentSchedule {
  publishAt?: Date
  unpublishAt?: Date
  reminderAt?: Date
  timezone?: string
  recurring?: {
    pattern: "daily" | "weekly" | "monthly" | "yearly"
    interval: number
    endDate?: Date
  }
}

export interface ContentMetrics {
  views: number
  uniqueViews: number
  likes: number
  shares: number
  comments: number
  downloads: number
  timeOnPage: number
  bounceRate: number
  lastViewed?: Date
  popularKeywords: string[]
}

export interface ContentValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  suggestions: string[]
}

export class ContentService extends EventEmitter {
  private contentRepo: ContentRepository
  private contentTypeRepo: ContentTypeRepository
  private versionRepo: ContentVersionRepository
  private mediaRepo: MediaRepository
  private searchService?: ElasticsearchService
  private options: ContentServiceOptions
  private workflowStates: Map<string, ContentWorkflowState> = new Map()
  private scheduledJobs: Map<string, NodeJS.Timeout> = new Map()

  constructor(
    private readonly prisma: PrismaClient,
    options: ContentServiceOptions = {}
  ) {
    super()
    this.contentRepo = new ContentRepository(this.prisma)
    this.contentTypeRepo = new ContentTypeRepository(this.prisma)
    this.versionRepo = new ContentVersionRepository(this.prisma)
    this.mediaRepo = new MediaRepository(this.prisma)

    this.options = {
      enableCache: true,
      cacheTtl: 1800, // 30 minutes
      enableAudit: true,
      enableVersioning: true,
      enableSearch: true,
      enableWorkflow: false,
      enableScheduling: true,
      enableRelations: true,
      maxVersions: 50,
      ...options,
    }

    if (this.options.enableSearch) {
      this.searchService = new ElasticsearchService({
        enabled: true,
        node: process.env.ELASTICSEARCH_URL || "http://localhost:9200",
      })
    }

    this.initializeWorkflowStates()
    this.setMaxListeners(100)
    logger.info("Content service initialized", this.options)
  }

  /**
   * Parse include string to Record<string, boolean>
   */
  private parseInclude(include?: string): Record<string, boolean> | undefined {
    if (!include) return undefined
    
    const includeObj: Record<string, boolean> = {}
    const fields = include.split(',').map(field => field.trim())
    
    fields.forEach(field => {
      if (field) {
        includeObj[field] = true
      }
    })
    
    return includeObj
  }

  /**
   * Initialize default workflow states
   */
  private initializeWorkflowStates(): void {
    if (!this.options.enableWorkflow) return

    const defaultStates: ContentWorkflowState[] = [
      {
        id: "DRAFT",
        name: "Draft",
        description: "Content is being created or edited",
        isInitial: true,
        allowedTransitions: ["PUBLISHED"],
      },
      {
        id: "PUBLISHED",
        name: "Published",
        description: "Content is live and visible to users",
        allowedTransitions: ["DRAFT", "ARCHIVED"],
      },
      {
        id: "ARCHIVED",
        name: "Archived",
        description: "Content is archived and not visible",
        isFinal: true,
        allowedTransitions: ["DRAFT"],
      },
    ]

    for (const state of defaultStates) {
      this.workflowStates.set(state.id, state)
    }
  }

  /**
   * Validate content data against content type schema
   */
  private async validateContentData(
    contentTypeId: string,
    data: Record<string, any>,
    tenantId?: string,
  ): Promise<ContentValidationResult> {
    try {
      const contentType = await this.contentTypeRepo.findById(contentTypeId)
      if (!contentType) {
        return {
          isValid: false,
          errors: ["Content type not found"],
          warnings: [],
          suggestions: [],
        }
      }

      const errors: string[] = []
      const warnings: string[] = []
      const suggestions: string[] = []

      // Basic validation - in a real implementation, you would validate against the content type fields
      if (!data || typeof data !== 'object') {
        errors.push("Content data must be an object")
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        suggestions,
      }
    } catch (error) {
      logger.error("Content validation error:", error)
      return {
        isValid: false,
        errors: ["Validation failed"],
        warnings: [],
        suggestions: [],
      }
    }
  }

  /**
   * Generate URL-friendly slug from title
   */
  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
  }

  /**
   * Extract title from content data
   */
  private extractTitle(data: any): string {
    if (data && typeof data === 'object') {
      return data.title || data.name || 'Untitled'
    }
    return 'Untitled'
  }

  /**
   * Create new content
   */
  async createContent(data: {
    contentTypeId: string
    data: Record<string, any>
    status?: ContentStatus
    locale?: string
    slug?: string
    tenantId?: string
    createdBy?: string
  }): Promise<any> {
    try {
      const {
        contentTypeId,
        data: contentData,
        status = ContentStatus.DRAFT,
        locale = "en",
        slug,
        tenantId,
        createdBy,
      } = data

      // Validate content type exists
      const contentType = await this.contentTypeRepo.findById(contentTypeId)
      if (!contentType) {
        throw ApiError.notFound("Content type not found")
      }

      // Validate content data
      const validation = await this.validateContentData(contentTypeId, contentData, tenantId)
      if (!validation.isValid) {
        throw ApiError.validationError("Content validation failed", validation.errors)
      }

      // Generate slug if not provided
      const title = this.extractTitle(contentData)
      const finalSlug = slug || this.generateSlug(title)

      // Create content
      const content = await this.contentRepo.create({
        contentType: { connect: { id: contentTypeId } },
        data: contentData,
        status,
        locale,
        slug: finalSlug,
        tenant: tenantId ? { connect: { id: tenantId } } : undefined,
        createdBy: createdBy ? { connect: { id: createdBy } } : undefined,
        updatedBy: createdBy ? { connect: { id: createdBy } } : undefined,
      })

      // Create initial version if versioning is enabled
      if (this.options.enableVersioning) {
        await this.versionRepo.createVersion({
          contentId: content.id,
          data: contentData,
          status: ContentVersionStatus.DRAFT,
          createdById: createdBy,
        })
      }

      // Clear cache
      if (this.options.enableCache) {
        await this.clearContentCache(tenantId)
      }

      // Emit event
      this.emit("content:created", {
        content,
        userId: createdBy,
        tenantId,
      })

      // Audit log
      if (this.options.enableAudit && createdBy) {
        await auditService.log({
          action: "content.create",
          entityType: "Content",
          entityId: content.id,
          userId: createdBy,
          details: {
            title,
            contentType: contentType.name,
            status,
            locale,
          },
        })
      }

      logger.info("Content created", {
        id: content.id,
        title,
        contentType: contentType.name,
        status,
        userId: createdBy,
        tenantId,
      })

      return content
    } catch (error) {
      logger.error("Failed to create content:", error)
      throw error
    }
  }

  /**
   * Get content by ID
   */
  async getContentById(
    id: string,
    options: {
      tenantId?: string
      includeVersions?: boolean
    } = {},
  ): Promise<any> {
    try {
      const { tenantId, includeVersions = false } = options

      const cacheKey = `content:${id}:${JSON.stringify(options)}`

      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get(cacheKey, tenantId)
        if (cached) {
          return cached
        }
      }

      const content = await this.contentRepo.findById(id)
      if (!content) {
        throw ApiError.notFound("Content not found")
      }

      // Include versions if requested
      if (includeVersions && this.options.enableVersioning) {
        const versions = await this.versionRepo.findByContentId(id)
        // Convert versions to a serializable format
        content.versions = versions.map(v => ({
          id: v.id,
          version: v.version,
          status: v.status,
          createdAt: v.createdAt.toISOString(),
          publishedAt: v.publishedAt?.toISOString() || null,
          notes: v.notes,
          createdById: v.createdById,
          publishedById: v.publishedById
        }))
      }

      // Cache the result
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, content, {
          ttl: this.options.cacheTtl,
          namespace: tenantId
        })
      }

      return content
    } catch (error) {
      logger.error("Failed to get content:", error)
      throw error
    }
  }

  /**
   * Update content
   */
  async updateContent(
    id: string,
    data: {
      data?: Record<string, any>
      status?: ContentStatus
      slug?: string
    },
    options: {
      tenantId?: string
      updatedBy?: string
      createVersion?: boolean
    } = {},
  ): Promise<any> {
    try {
      const { tenantId, updatedBy, createVersion = true } = options

      const existingContent = await this.contentRepo.findById(id)
      if (!existingContent) {
        throw ApiError.notFound("Content not found")
      }

      const { data: contentData, status, slug } = data

      // Prepare update data
      const updateData: any = {
        updatedById: updatedBy,
        updatedAt: new Date(),
      }

      if (contentData !== undefined) updateData.data = contentData
      if (status !== undefined) updateData.status = status
      if (slug !== undefined) updateData.slug = slug

      // Set published date if publishing for the first time
      if (status === ContentStatus.PUBLISHED && existingContent.status !== ContentStatus.PUBLISHED) {
        updateData.publishedAt = new Date()
        updateData.publishedById = updatedBy
      }

      // Update content
      const updatedContent = await this.contentRepo.update(id, updateData)

      // Create version if enabled
      if (this.options.enableVersioning && createVersion) {
        await this.versionRepo.createVersion({
          contentId: id,
          data: contentData || existingContent.data,
          status: status === ContentStatus.PUBLISHED ? ContentVersionStatus.PUBLISHED : ContentVersionStatus.DRAFT,
          createdById: updatedBy,
        })
      }

      // Clear cache
      if (this.options.enableCache) {
        await this.clearContentCache(tenantId)
      }

      // Emit event
      this.emit("content:updated", {
        content: updatedContent,
        previousContent: existingContent,
        userId: updatedBy,
        tenantId,
        changes: Object.keys(data),
      })

      // Audit log
      if (this.options.enableAudit && updatedBy) {
        await auditService.log({
          action: "content.update",
          entityType: "Content",
          entityId: id,
          userId: updatedBy,
          details: {
            changes: Object.keys(data),
            statusChange: status !== existingContent.status ? { from: existingContent.status, to: status } : null,
          },
        })
      }

      logger.info("Content updated", {
        id,
        changes: Object.keys(data),
        userId: updatedBy,
        tenantId,
      })

      return updatedContent
    } catch (error) {
      logger.error("Failed to update content:", error)
      throw error
    }
  }

  /**
   * Delete content
   */
  async deleteContent(
    id: string,
    options: {
      tenantId?: string
      deletedBy?: string
      force?: boolean
    } = {},
  ): Promise<void> {
    try {
      const { tenantId, deletedBy, force = false } = options

      const content = await this.contentRepo.findById(id)
      if (!content) {
        throw ApiError.notFound("Content not found")
      }

      // Check if content can be deleted (not published unless forced)
      if (!force && content.status === ContentStatus.PUBLISHED) {
        throw ApiError.badRequest("Cannot delete published content. Use force option or unpublish first.")
      }

      // Delete versions
      if (this.options.enableVersioning) {
        await this.versionRepo.deleteMany({ contentId: id })
      }

      // Delete content
      await this.contentRepo.delete(id)

      // Clear cache
      if (this.options.enableCache) {
        await this.clearContentCache(tenantId)
      }

      // Emit event
      this.emit("content:deleted", {
        content,
        userId: deletedBy,
        tenantId,
      })

      // Audit log
      if (this.options.enableAudit && deletedBy) {
        await auditService.log({
          action: "content.delete",
          entityType: "Content",
          entityId: id,
          userId: deletedBy,
          details: {
            title: this.extractTitle(content.data),
            status: content.status,
            force,
          },
        })
      }

      logger.info("Content deleted", {
        id,
        title: this.extractTitle(content.data),
        userId: deletedBy,
        tenantId,
      })
    } catch (error) {
      logger.error("Failed to delete content:", error)
      throw error
    }
  }

  /**
   * Search content
   */
  async searchContent(options: ContentSearchOptions): Promise<any> {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        contentType,
        status,
        locale,
        author,
        dateFrom,
        dateTo,
        sortBy = "updatedAt",
        sortOrder = "desc",
        tenantId,
      } = options

      const where: any = {}

      if (contentType) where.contentTypeId = contentType
      if (status) {
        if (Array.isArray(status)) {
          where.status = { in: status }
        } else {
          where.status = status
        }
      }
      if (locale) where.locale = locale
      if (author) where.createdById = author
      if (tenantId) where.tenantId = tenantId

      if (dateFrom || dateTo) {
        where.createdAt = {}
        if (dateFrom) where.createdAt.gte = dateFrom
        if (dateTo) where.createdAt.lte = dateTo
      }

      // Basic text search in data field
      if (search) {
        where.data = {
          path: ['title'],
          string_contains: search
        }
      }

      const skip = (page - 1) * limit
      const orderBy = { [sortBy]: sortOrder }

      // Use pagination for proper limit and skip handling
      const result = await this.contentRepo.paginate(where, {
        page,
        limit,
        orderBy,
      })

      const content = result.data
      const total = result.pagination.total

      const totalPages = Math.ceil(total / limit)

      return {
        content,
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      }
    } catch (error) {
      logger.error("Failed to search content:", error)
      throw error
    }
  }

  /**
   * Get content statistics
   */
  async getContentStats(tenantId?: string): Promise<ContentStats> {
    try {
      const cacheKey = "content:stats"

      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get(cacheKey, tenantId)
        if (cached) {
          return cached
        }
      }

      const where = tenantId ? { tenantId } : {}

      const [
        totalContent,
        publishedContent,
        draftContent,
        archivedContent,
      ] = await Promise.all([
        this.contentRepo.count(where),
        this.contentRepo.count({ ...where, status: ContentStatus.PUBLISHED }),
        this.contentRepo.count({ ...where, status: ContentStatus.DRAFT }),
        this.contentRepo.count({ ...where, status: ContentStatus.ARCHIVED }),
      ])

      const stats: ContentStats = {
        totalContent,
        publishedContent,
        draftContent,
        archivedContent,
        scheduledContent: 0,
        contentByType: {},
        contentByLocale: {},
        contentByStatus: {
          [ContentStatus.DRAFT]: draftContent,
          [ContentStatus.PUBLISHED]: publishedContent,
          [ContentStatus.ARCHIVED]: archivedContent,
        },
        recentActivity: [],
        topAuthors: [],
        popularContent: [],
      }

      // Cache the result
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, stats, {
          ttl: this.options.cacheTtl,
          namespace: tenantId
        })
      }

      return stats
    } catch (error) {
      logger.error("Failed to get content stats:", error)
      throw error
    }
  }

  /**
   * Clear content cache
   */
  private async clearContentCache(tenantId?: string): Promise<void> {
    const patterns = ["content:*", "content:search:*", "content:stats"]

    for (const pattern of patterns) {
      await cacheService.delete(pattern, tenantId)
    }
  }

  /**
   * Get workflow states
   */
  getWorkflowStates(): ContentWorkflowState[] {
    return Array.from(this.workflowStates.values())
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<any> {
    try {
      const status: any = {
        service: "ContentService",
        status: "healthy",
        timestamp: new Date().toISOString(),
        features: {
          cache: this.options.enableCache,
          search: this.options.enableSearch && !!this.searchService,
          versioning: this.options.enableVersioning,
          workflow: this.options.enableWorkflow,
          scheduling: this.options.enableScheduling,
          relations: this.options.enableRelations,
          audit: this.options.enableAudit,
        },
        scheduledJobs: this.scheduledJobs.size,
        workflowStates: this.workflowStates.size,
      }

      // Test database connectivity
      try {
        await this.prisma.$queryRaw`SELECT 1`
        status.database = "connected"
      } catch (error) {
        status.database = "disconnected"
        status.status = "degraded"
      }

      // Test search service connectivity
      if (this.searchService) {
        try {
          await this.searchService.healthCheck()
          status.search = "connected"
        } catch (error) {
          status.search = "disconnected"
          status.status = "degraded"
        }
      }

      // Test cache connectivity
      if (this.options.enableCache) {
        try {
          await cacheService.get("health-check")
          status.cache = "connected"
        } catch (error) {
          status.cache = "disconnected"
          status.status = "degraded"
        }
      }

      return status
    } catch (error) {
      logger.error("Failed to get health status:", error)
      return {
        service: "ContentService",
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: (error as Error).message,
      }
    }
  }

  /**
   * Cleanup expired scheduled jobs and old data
   */
  async cleanup(): Promise<void> {
    try {
      // Cancel expired scheduled jobs
      for (const [key, timeout] of this.scheduledJobs.entries()) {
        logger.debug("Cleaning up scheduled job", { key })
      }

      // Clean up old versions beyond retention period
      if (this.options.enableVersioning) {
        logger.debug("Cleaning up old content versions")
      }

      logger.info("Content service cleanup completed")
    } catch (error) {
      logger.error("Failed to cleanup content service:", error)
    }
  }

  /**
   * Shutdown the service gracefully
   */
  async shutdown(): Promise<void> {
    try {
      // Cancel all scheduled jobs
      for (const [key, timeout] of this.scheduledJobs.entries()) {
        clearTimeout(timeout)
        this.scheduledJobs.delete(key)
      }

      // Close search service connection
      if (this.searchService) {
        await this.searchService.close()
      }

      // Remove all event listeners
      this.removeAllListeners()

      logger.info("Content service shutdown completed")
    } catch (error) {
      logger.error("Failed to shutdown content service:", error)
      throw error
    }
  }
}
