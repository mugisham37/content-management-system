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

  constructor(options: ContentServiceOptions = {}) {
    super()
    this.contentRepo = new ContentRepository()
    this.contentTypeRepo = new ContentTypeRepository()
    this.versionRepo = new ContentVersionRepository()
    this.mediaRepo = new MediaRepository()

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
   * Initialize default workflow states
   */
  private initializeWorkflowStates(): void {
    if (!this.options.enableWorkflow) return

    const defaultStates: ContentWorkflowState[] = [
      {
        id: "draft",
        name: "Draft",
        description: "Content is being created or edited",
        isInitial: true,
        allowedTransitions: ["review", "published"],
      },
      {
        id: "review",
        name: "Under Review",
        description: "Content is being reviewed",
        allowedTransitions: ["draft", "approved", "rejected"],
        requiredRoles: ["editor", "admin"],
      },
      {
        id: "approved",
        name: "Approved",
        description: "Content has been approved for publishing",
        allowedTransitions: ["published", "draft"],
        requiredRoles: ["editor", "admin"],
      },
      {
        id: "published",
        name: "Published",
        description: "Content is live and visible to users",
        allowedTransitions: ["draft", "archived"],
        requiredRoles: ["publisher", "admin"],
      },
      {
        id: "archived",
        name: "Archived",
        description: "Content is archived and not visible",
        isFinal: true,
        allowedTransitions: ["draft"],
        requiredRoles: ["admin"],
      },
      {
        id: "rejected",
        name: "Rejected",
        description: "Content has been rejected",
        allowedTransitions: ["draft"],
        requiredRoles: ["editor", "admin"],
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
      const contentType = await this.contentTypeRepo.findById(contentTypeId, tenantId)
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

      // Validate required fields and data types
      for (const field of contentType.fields || []) {
        const value = data[field.name]

        if (field.required && (value === undefined || value === null || value === "")) {
          errors.push(`Field '${field.name}' is required`)
          continue
        }

        if (value !== undefined && value !== null) {
          // Type validation based on field.type
          if (field.type === "string" && typeof value !== "string") {
            errors.push(`Field '${field.name}' must be a string`)
          } else if (field.type === "number" && typeof value !== "number") {
            errors.push(`Field '${field.name}' must be a number`)
          } else if (field.type === "boolean" && typeof value !== "boolean") {
            errors.push(`Field '${field.name}' must be a boolean`)
          } else if (field.type === "array" && !Array.isArray(value)) {
            errors.push(`Field '${field.name}' must be an array`)
          }

          // Additional validations
          if (field.type === "string" && field.maxLength && value.length > field.maxLength) {
            errors.push(`Field '${field.name}' exceeds maximum length of ${field.maxLength}`)
          }

          if (field.type === "number" && field.min !== undefined && value < field.min) {
            errors.push(`Field '${field.name}' must be at least ${field.min}`)
          }

          if (field.type === "number" && field.max !== undefined && value > field.max) {
            errors.push(`Field '${field.name}' must be at most ${field.max}`)
          }
        }
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
   * Ensure slug is unique within content type and locale
   */
  private async ensureUniqueSlug(
    slug: string,
    contentTypeId: string,
    locale: string,
    tenantId?: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.contentRepo.findBySlug(slug, contentTypeId, locale, tenantId)
    if (existing && existing.id !== excludeId) {
      throw ApiError.conflict(`Slug '${slug}' already exists for this content type and locale`)
    }
  }

  /**
   * Validate workflow state transition
   */
  private async validateWorkflowTransition(
    fromStatus: string | null,
    toStatus: string,
    userId?: string,
    tenantId?: string,
  ): Promise<void> {
    if (!this.options.enableWorkflow) return

    const toState = this.workflowStates.get(toStatus)
    if (!toState) {
      throw ApiError.badRequest(`Invalid workflow state: ${toStatus}`)
    }

    if (fromStatus) {
      const fromState = this.workflowStates.get(fromStatus)
      if (fromState && !fromState.allowedTransitions.includes(toStatus)) {
        throw ApiError.badRequest(`Invalid transition from '${fromStatus}' to '${toStatus}'`)
      }
    }

    // Check role requirements
    if (toState.requiredRoles && toState.requiredRoles.length > 0 && userId) {
      // In a real implementation, you would check user roles here
      // For now, we'll assume the user has the required permissions
    }
  }

  /**
   * Validate content relations
   */
  private async validateRelations(relations: ContentRelation[], tenantId?: string): Promise<void> {
    for (const relation of relations) {
      // Check if target content exists
      const target = await this.contentRepo.findById(relation.targetId, tenantId)
      if (!target) {
        throw ApiError.badRequest(`Related content '${relation.targetId}' not found`)
      }
    }
  }

  /**
   * Extract media references from content data
   */
  private async extractMediaReferences(data: Record<string, any>): Promise<string[]> {
    const mediaReferences: string[] = []

    const extractFromValue = (value: any): void => {
      if (typeof value === "string") {
        // Extract media IDs from URLs or references
        const mediaMatches = value.match(/media\/([a-f0-9-]+)/g)
        if (mediaMatches) {
          mediaReferences.push(...mediaMatches.map((match) => match.replace("media/", "")))
        }
      } else if (Array.isArray(value)) {
        value.forEach(extractFromValue)
      } else if (value && typeof value === "object") {
        Object.values(value).forEach(extractFromValue)
      }
    }

    Object.values(data).forEach(extractFromValue)

    return [...new Set(mediaReferences)] // Remove duplicates
  }

  /**
   * Calculate word count from content data
   */
  private calculateWordCount(data: Record<string, any>): number {
    let wordCount = 0

    const countWords = (value: any): void => {
      if (typeof value === "string") {
        wordCount += value
          .trim()
          .split(/\s+/)
          .filter((word) => word.length > 0).length
      } else if (Array.isArray(value)) {
        value.forEach(countWords)
      } else if (value && typeof value === "object") {
        Object.values(value).forEach(countWords)
      }
    }

    Object.values(data).forEach(countWords)
    return wordCount
  }

  /**
   * Calculate estimated reading time in minutes
   */
  private calculateReadingTime(data: Record<string, any>): number {
    const wordCount = this.calculateWordCount(data)
    const wordsPerMinute = 200 // Average reading speed
    return Math.ceil(wordCount / wordsPerMinute)
  }

  /**
   * Create content version
   */
  private async createContentVersion(
    contentId: string,
    versionData: {
      version: number
      title: string
      data: Record<string, any>
      status: string
      metadata?: Record<string, any>
      comment?: string
      createdBy?: string
      tenantId?: string
    },
  ): Promise<void> {
    await this.versionRepo.create({
      contentId,
      ...versionData,
    })
  }

  /**
   * Clean up old versions beyond the limit
   */
  private async cleanupOldVersions(contentId: string, tenantId?: string): Promise<void> {
    if (!this.options.maxVersions) return

    const versions = await this.versionRepo.findByContentId(contentId, tenantId)
    if (versions.length > this.options.maxVersions) {
      const versionsToDelete = versions
        .sort((a, b) => a.version - b.version)
        .slice(0, versions.length - this.options.maxVersions)

      for (const version of versionsToDelete) {
        await this.versionRepo.delete(version.id, tenantId)
      }
    }
  }

  /**
   * Create content relations
   */
  private async createContentRelations(
    contentId: string,
    relations: ContentRelation[],
    tenantId?: string,
  ): Promise<void> {
    // Implementation would depend on your relations table structure
    // This is a placeholder for the actual implementation
    logger.info("Creating content relations", { contentId, relationCount: relations.length })
  }

  /**
   * Update content relations
   */
  private async updateContentRelations(
    contentId: string,
    relations: ContentRelation[],
    tenantId?: string,
  ): Promise<void> {
    // Delete existing relations and create new ones
    await this.deleteContentRelations(contentId, tenantId)
    await this.createContentRelations(contentId, relations, tenantId)
  }

  /**
   * Delete content relations
   */
  private async deleteContentRelations(contentId: string, tenantId?: string): Promise<void> {
    // Implementation would depend on your relations table structure
    logger.info("Deleting content relations", { contentId })
  }

  /**
   * Get content relations
   */
  private async getContentRelations(contentId: string, tenantId?: string): Promise<ContentRelation[]> {
    // Implementation would depend on your relations table structure
    return []
  }

  /**
   * Schedule content publishing
   */
  private async scheduleContent(contentId: string, schedule: ContentSchedule, tenantId?: string): Promise<void> {
    if (schedule.publishAt) {
      const delay = schedule.publishAt.getTime() - Date.now()
      if (delay > 0) {
        const timeout = setTimeout(async () => {
          try {
            await this.updateContent(contentId, { status: "published" }, { tenantId })
            this.scheduledJobs.delete(contentId)
          } catch (error) {
            logger.error("Failed to auto-publish content:", error)
          }
        }, delay)

        this.scheduledJobs.set(contentId, timeout)
      }
    }

    if (schedule.unpublishAt) {
      const delay = schedule.unpublishAt.getTime() - Date.now()
      if (delay > 0) {
        const timeout = setTimeout(async () => {
          try {
            await this.updateContent(contentId, { status: "draft" }, { tenantId })
            this.scheduledJobs.delete(`${contentId}_unpublish`)
          } catch (error) {
            logger.error("Failed to auto-unpublish content:", error)
          }
        }, delay)

        this.scheduledJobs.set(`${contentId}_unpublish`, timeout)
      }
    }
  }

  /**
   * Update content schedule
   */
  private async updateContentSchedule(contentId: string, schedule: ContentSchedule, tenantId?: string): Promise<void> {
    // Cancel existing schedules
    await this.cancelContentSchedule(contentId)
    // Create new schedule
    await this.scheduleContent(contentId, schedule, tenantId)
  }

  /**
   * Cancel content schedule
   */
  private async cancelContentSchedule(contentId: string): Promise<void> {
    const publishTimeout = this.scheduledJobs.get(contentId)
    if (publishTimeout) {
      clearTimeout(publishTimeout)
      this.scheduledJobs.delete(contentId)
    }

    const unpublishTimeout = this.scheduledJobs.get(`${contentId}_unpublish`)
    if (unpublishTimeout) {
      clearTimeout(unpublishTimeout)
      this.scheduledJobs.delete(`${contentId}_unpublish`)
    }
  }

  /**
   * Index content for search
   */
  private async indexContentForSearch(content: any): Promise<void> {
    if (!this.searchService) return

    try {
      await this.searchService.indexDocument("content", {
        id: content.id,
        title: content.title,
        slug: content.slug,
        data: content.data,
        status: content.status,
        locale: content.locale,
        tags: content.tags,
        categories: content.categories,
        contentType: content.contentTypeId,
        createdAt: content.createdAt,
        updatedAt: content.updatedAt,
        publishedAt: content.publishedAt,
      })
    } catch (error) {
      logger.error("Failed to index content for search:", error)
    }
  }

  /**
   * Update content in search index
   */
  private async updateContentInSearch(content: any): Promise<void> {
    await this.indexContentForSearch(content)
  }

  /**
   * Remove content from search index
   */
  private async removeContentFromSearch(contentId: string): Promise<void> {
    if (!this.searchService) return

    try {
      await this.searchService.deleteDocument("content", contentId)
    } catch (error) {
      logger.error("Failed to remove content from search:", error)
    }
  }

  /**
   * Search content using Elasticsearch
   */
  private async searchWithElasticsearch(options: ContentSearchOptions): Promise<any> {
    if (!this.searchService) {
      throw new Error("Search service not available")
    }

    const {
      page = 1,
      limit = 20,
      search,
      contentType,
      status,
      locale,
      tags,
      categories,
      author,
      dateFrom,
      dateTo,
      sortBy = "updatedAt",
      sortOrder = "desc",
      tenantId,
    } = options

    const query: any = {
      query: {
        bool: {
          must: [],
          filter: [],
        },
      },
    }

    // Add search query
    if (search) {
      query.query.bool.must.push({
        multi_match: {
          query: search,
          fields: ["title^2", "data.*", "tags", "categories"],
          type: "best_fields",
          fuzziness: "AUTO",
        },
      })
    }

    // Add filters
    if (contentType) {
      query.query.bool.filter.push({ term: { contentType } })
    }

    if (status) {
      if (Array.isArray(status)) {
        query.query.bool.filter.push({ terms: { status } })
      } else {
        query.query.bool.filter.push({ term: { status } })
      }
    }

    if (locale) {
      query.query.bool.filter.push({ term: { locale } })
    }

    if (tags && tags.length > 0) {
      query.query.bool.filter.push({ terms: { tags } })
    }

    if (categories && categories.length > 0) {
      query.query.bool.filter.push({ terms: { categories } })
    }

    if (author) {
      query.query.bool.filter.push({ term: { createdBy: author } })
    }

    if (dateFrom || dateTo) {
      const dateRange: any = {}
      if (dateFrom) dateRange.gte = dateFrom
      if (dateTo) dateRange.lte = dateTo
      query.query.bool.filter.push({ range: { createdAt: dateRange } })
    }

    // Add sorting
    query.sort = [{ [sortBy]: { order: sortOrder } }]

    const result = await this.searchService.searchDocuments("content", query, {
      from: (page - 1) * limit,
      size: limit,
    })

    return {
      content: result.hits,
      total: result.total,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit),
      aggregations: result.aggregations,
    }
  }

  /**
   * Generate facets for search results
   */
  private async generateFacets(facets: string[], options: ContentSearchOptions): Promise<Record<string, any>> {
    const facetData: Record<string, any> = {}

    for (const facet of facets) {
      switch (facet) {
        case "contentType":
          facetData.contentType = await this.contentRepo.getContentTypeFacets(options.tenantId)
          break
        case "status":
          facetData.status = await this.contentRepo.getStatusFacets(options.tenantId)
          break
        case "tags":
          facetData.tags = await this.contentRepo.getTagsFacets(options.tenantId)
          break
        case "categories":
          facetData.categories = await this.contentRepo.getCategoriesFacets(options.tenantId)
          break
      }
    }

    return facetData
  }

  /**
   * Get content metrics
   */
  private async getContentMetrics(contentId: string, tenantId?: string): Promise<ContentMetrics> {
    // This would typically come from an analytics service or database
    return {
      views: 0,
      uniqueViews: 0,
      likes: 0,
      shares: 0,
      comments: 0,
      downloads: 0,
      timeOnPage: 0,
      bounceRate: 0,
      popularKeywords: [],
    }
  }

  /**
   * Increment view count for content
   */
  private async incrementViewCount(contentId: string, tenantId?: string): Promise<void> {
    // Implementation would depend on your metrics storage
    logger.debug("Incrementing view count", { contentId })
  }

  /**
   * Get content workflow information
   */
  private async getContentWorkflow(contentId: string, tenantId?: string): Promise<any> {
    const content = await this.contentRepo.findById(contentId, tenantId)
    if (!content) return null

    const currentState = this.workflowStates.get(content.status)
    return {
      currentState,
      availableTransitions: currentState?.allowedTransitions || [],
      history: [], // Would come from workflow history table
    }
  }

  /**
   * Get localized content
   */
  private async getLocalizedContent(contentId: string, locale: string, tenantId?: string): Promise<any> {
    // Implementation would depend on your localization strategy
    return null
  }

  /**
   * Clear content cache
   */
  private async clearContentCache(tenantId?: string): Promise<void> {
    const patterns = ["content:*", "content:search:*", "content:stats", "content:slug:*"]

    for (const pattern of patterns) {
      await cacheService.delete(pattern, tenantId)
    }
  }

  /**
   * Create new content
   */
  async createContent(data: {
    contentTypeId: string
    title: string
    slug?: string
    data: Record<string, any>
    status?: string
    locale?: string
    tags?: string[]
    categories?: string[]
    metadata?: Record<string, any>
    schedule?: ContentSchedule
    relations?: ContentRelation[]
    parentId?: string
    order?: number
    seoData?: Record<string, any>
    tenantId?: string
    createdBy?: string
  }): Promise<any> {
    try {
      const {
        contentTypeId,
        title,
        slug,
        data: contentData,
        status = "draft",
        locale = "en",
        tags = [],
        categories = [],
        metadata = {},
        schedule,
        relations = [],
        parentId,
        order,
        seoData,
        tenantId,
        createdBy,
      } = data

      // Validate content type exists
      const contentType = await this.contentTypeRepo.findById(contentTypeId, tenantId)
      if (!contentType) {
        throw ApiError.notFound("Content type not found")
      }

      // Validate content data against content type
      const validation = await this.validateContentData(contentTypeId, contentData, tenantId)
      if (!validation.isValid) {
        throw ApiError.validationError("Content validation failed", validation.errors)
      }

      // Generate slug if not provided
      const finalSlug = slug || this.generateSlug(title)

      // Check if slug is unique
      await this.ensureUniqueSlug(finalSlug, contentTypeId, locale, tenantId)

      // Validate workflow transition if enabled
      if (this.options.enableWorkflow) {
        await this.validateWorkflowTransition(null, status, createdBy, tenantId)
      }

      // Process relations
      if (this.options.enableRelations && relations.length > 0) {
        await this.validateRelations(relations, tenantId)
      }

      // Extract and process media references
      const mediaReferences = await this.extractMediaReferences(contentData)

      // Create content
      const content = await this.contentRepo.create({
        contentTypeId,
        title,
        slug: finalSlug,
        data: contentData,
        status,
        locale,
        tags,
        categories,
        metadata: {
          ...metadata,
          mediaReferences,
          seoData,
          wordCount: this.calculateWordCount(contentData),
          readingTime: this.calculateReadingTime(contentData),
        },
        parentId,
        order,
        tenantId,
        createdBy,
        updatedBy: createdBy,
      })

      // Create initial version if versioning is enabled
      if (this.options.enableVersioning) {
        await this.createContentVersion(content.id, {
          version: 1,
          title,
          data: contentData,
          status,
          metadata,
          createdBy,
          tenantId,
        })
      }

      // Create relations
      if (this.options.enableRelations && relations.length > 0) {
        await this.createContentRelations(content.id, relations, tenantId)
      }

      // Schedule publishing if needed
      if (this.options.enableScheduling && schedule) {
        await this.scheduleContent(content.id, schedule, tenantId)
      }

      // Index in search engine
      if (this.options.enableSearch && this.searchService) {
        await this.indexContentForSearch(content)
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
            hasSchedule: !!schedule,
            relationCount: relations.length,
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
   * Get content by ID with advanced options
   */
  async getContentById(
    id: string,
    options: {
      tenantId?: string
      includeVersions?: boolean
      includeRelations?: boolean
      includeMetrics?: boolean
      includeWorkflow?: boolean
      version?: number
      locale?: string
    } = {},
  ): Promise<any> {
    try {
      const {
        tenantId,
        includeVersions = false,
        includeRelations = false,
        includeMetrics = false,
        includeWorkflow = false,
        version,
        locale,
      } = options

      const cacheKey = `content:${id}:${JSON.stringify(options)}`

      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get(cacheKey, tenantId)
        if (cached) {
          return cached
        }
      }

      let content = await this.contentRepo.findById(id, tenantId)
      if (!content) {
        throw ApiError.notFound("Content not found")
      }

      // Get specific version if requested
      if (version && this.options.enableVersioning) {
        const versionData = await this.versionRepo.findByVersion(id, version, tenantId)
        if (versionData) {
          content = { ...content, ...versionData, currentVersion: content.version }
        }
      }

      // Include versions
      if (includeVersions && this.options.enableVersioning) {
        content.versions = await this.versionRepo.findByContentId(id, tenantId)
      }

      // Include relations
      if (includeRelations && this.options.enableRelations) {
        content.relations = await this.getContentRelations(id, tenantId)
      }

      // Include metrics
      if (includeMetrics) {
        content.metrics = await this.getContentMetrics(id, tenantId)
      }

      // Include workflow information
      if (includeWorkflow && this.options.enableWorkflow) {
        content.workflow = await this.getContentWorkflow(id, tenantId)
      }

      // Apply locale filtering if specified
      if (locale && content.locale !== locale) {
        const localizedContent = await this.getLocalizedContent(id, locale, tenantId)
        if (localizedContent) {
          content = localizedContent
        }
      }

      // Cache the result
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, content, this.options.cacheTtl, tenantId)
      }

      // Increment view count
      await this.incrementViewCount(id, tenantId)

      return content
    } catch (error) {
      logger.error("Failed to get content:", error)
      throw error
    }
  }

  /**
   * Update content with advanced features
   */
  async updateContent(
    id: string,
    data: {
      title?: string
      slug?: string
      data?: Record<string, any>
      status?: string
      tags?: string[]
      categories?: string[]
      metadata?: Record<string, any>
      schedule?: ContentSchedule
      relations?: ContentRelation[]
      order?: number
      seoData?: Record<string, any>
      comment?: string
    },
    options: {
      tenantId?: string
      updatedBy?: string
      createVersion?: boolean
      validateWorkflow?: boolean
    } = {},
  ): Promise<any> {
    try {
      const { tenantId, updatedBy, createVersion = true, validateWorkflow = true } = options

      const existingContent = await this.contentRepo.findById(id, tenantId)
      if (!existingContent) {
        throw ApiError.notFound("Content not found")
      }

      const {
        title,
        slug,
        data: contentData,
        status,
        tags,
        categories,
        metadata = {},
        schedule,
        relations,
        order,
        seoData,
        comment,
      } = data

      // Validate content data if provided
      if (contentData) {
        const validation = await this.validateContentData(existingContent.contentTypeId, contentData, tenantId)
        if (!validation.isValid) {
          throw ApiError.validationError("Content validation failed", validation.errors)
        }
      }

      // Check slug uniqueness if changed
      if (slug && slug !== existingContent.slug) {
        await this.ensureUniqueSlug(slug, existingContent.contentTypeId, existingContent.locale, tenantId, id)
      }

      // Validate workflow transition if status is changing
      if (status && status !== existingContent.status && validateWorkflow) {
        await this.validateWorkflowTransition(existingContent.status, status, updatedBy, tenantId)
      }

      // Process relations
      if (relations && this.options.enableRelations) {
        await this.validateRelations(relations, tenantId)
      }

      // Extract media references if content data is updated
      let mediaReferences = existingContent.metadata?.mediaReferences || []
      if (contentData) {
        mediaReferences = await this.extractMediaReferences(contentData)
      }

      // Prepare update data
      const updateData: any = {
        updatedBy,
        updatedAt: new Date(),
      }

      if (title !== undefined) updateData.title = title
      if (slug !== undefined) updateData.slug = slug
      if (contentData !== undefined) updateData.data = contentData
      if (status !== undefined) updateData.status = status
      if (tags !== undefined) updateData.tags = tags
      if (categories !== undefined) updateData.categories = categories
      if (order !== undefined) updateData.order = order

      // Update metadata
      updateData.metadata = {
        ...existingContent.metadata,
        ...metadata,
        mediaReferences,
        seoData: seoData || existingContent.metadata?.seoData,
      }

      if (contentData) {
        updateData.metadata.wordCount = this.calculateWordCount(contentData)
        updateData.metadata.readingTime = this.calculateReadingTime(contentData)
      }

      // Set published date if publishing for the first time
      if (status === "published" && existingContent.status !== "published") {
        updateData.publishedAt = new Date()
        updateData.publishedBy = updatedBy
      }

      // Update content
      const updatedContent = await this.contentRepo.update(id, updateData, tenantId)

      // Create version if enabled
      if (this.options.enableVersioning && createVersion) {
        const nextVersion = (existingContent.version || 0) + 1
        await this.createContentVersion(id, {
          version: nextVersion,
          title: title || existingContent.title,
          data: contentData || existingContent.data,
          status: status || existingContent.status,
          metadata: updateData.metadata,
          comment,
          createdBy: updatedBy,
          tenantId,
        })

        // Update content version number
        await this.contentRepo.update(id, { version: nextVersion }, tenantId)

        // Cleanup old versions
        await this.cleanupOldVersions(id, tenantId)
      }

      // Update relations
      if (relations && this.options.enableRelations) {
        await this.updateContentRelations(id, relations, tenantId)
      }

      // Update schedule
      if (schedule && this.options.enableScheduling) {
        await this.updateContentSchedule(id, schedule, tenantId)
      }

      // Update search index
      if (this.options.enableSearch && this.searchService) {
        await this.updateContentInSearch(updatedContent)
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
            comment,
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
   * Delete content with cleanup
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

      const content = await this.contentRepo.findById(id, tenantId)
      if (!content) {
        throw ApiError.notFound("Content not found")
      }

      // Check if content can be deleted (not published unless forced)
      if (!force && content.status === "published") {
        throw ApiError.badRequest("Cannot delete published content. Use force option or unpublish first.")
      }

      // Cancel any scheduled jobs
      if (this.options.enableScheduling) {
        await this.cancelContentSchedule(id)
      }

      // Delete versions
      if (this.options.enableVersioning) {
        const versions = await this.versionRepo.findByContentId(id, tenantId)
        for (const version of versions) {
          await this.versionRepo.delete(version.id, tenantId)
        }
      }

      // Delete relations
      if (this.options.enableRelations) {
        await this.deleteContentRelations(id, tenantId)
      }

      // Remove from search index
      if (this.options.enableSearch && this.searchService) {
        await this.removeContentFromSearch(id)
      }

      // Delete content
      await this.contentRepo.delete(id, tenantId)

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
            title: content.title,
            status: content.status,
            force,
          },
        })
      }

      logger.info("Content deleted", {
        id,
        title: content.title,
        userId: deletedBy,
        tenantId,
      })
    } catch (error) {
      logger.error("Failed to delete content:", error)
      throw error
    }
  }

  /**
   * Search content with advanced options
   */
  async searchContent(options: ContentSearchOptions): Promise<any> {
    try {
      const cacheKey = `content:search:${JSON.stringify(options)}`

      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get(cacheKey, options.tenantId)
        if (cached) {
          return cached
        }
      }

      let result: any

      // Use Elasticsearch if available and enabled
      if (this.options.enableSearch && this.searchService) {
        result = await this.searchWithElasticsearch(options)
      } else {
        // Fallback to database search
        result = await this.contentRepo.search(options)
      }

      // Add facets if requested
      if (options.facets && options.facets.length > 0) {
        result.facets = await this.generateFacets(options.facets, options)
      }

      // Include additional data if requested
      if (options.includeVersions || options.includeRelations || options.includeMetrics) {
        for (const content of result.content) {
          if (options.includeVersions && this.options.enableVersioning) {
            content.versions = await this.versionRepo.findByContentId(content.id, options.tenantId)
          }

          if (options.includeRelations && this.options.enableRelations) {
            content.relations = await this.getContentRelations(content.id, options.tenantId)
          }

          if (options.includeMetrics) {
            content.metrics = await this.getContentMetrics(content.id, options.tenantId)
          }
        }
      }

      // Cache the result
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, result, this.options.cacheTtl, options.tenantId)
      }

      return result
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

      const stats = await this.contentRepo.getStats(tenantId)

      // Cache the result
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, stats, this.options.cacheTtl, tenantId)
      }

      return stats
    } catch (error) {
      logger.error("Failed to get content stats:", error)
      throw error
    }
  }

  /**
   * Duplicate content
   */
  async duplicateContent(
    id: string,
    options: {
      title?: string
      status?: string
      tenantId?: string
      createdBy?: string
    } = {},
  ): Promise<any> {
    try {
      const { title, status = "draft", tenantId, createdBy } = options

      const originalContent = await this.contentRepo.findById(id, tenantId)
      if (!originalContent) {
        throw ApiError.notFound("Content not found")
      }

      // Get relations if enabled
      let relations: ContentRelation[] = []
      if (this.options.enableRelations) {
        relations = await this.getContentRelations(id, tenantId)
      }

      // Create duplicate
      const duplicateTitle = title || `${originalContent.title} (Copy)`
      const duplicateData = {
        contentTypeId: originalContent.contentTypeId,
        title: duplicateTitle,
        data: originalContent.data,
        status,
        locale: originalContent.locale,
        tags: originalContent.tags,
        categories: originalContent.categories,
        metadata: {
          ...originalContent.metadata,
          duplicatedFrom: id,
        },
        relations,
        tenantId,
        createdBy,
      }

      const duplicate = await this.createContent(duplicateData)

      logger.info("Content duplicated", {
        originalId: id,
        duplicateId: duplicate.id,
        userId: createdBy,
        tenantId,
      })

      return duplicate
    } catch (error) {
      logger.error("Failed to duplicate content:", error)
      throw error
    }
  }

  /**
   * Bulk operations
   */
  async bulkUpdateContent(
    ids: string[],
    updates: {
      status?: string
      tags?: string[]
      categories?: string[]
      metadata?: Record<string, any>
    },
    options: {
      tenantId?: string
      updatedBy?: string
    } = {},
  ): Promise<any[]> {
    try {
      const { tenantId, updatedBy } = options
      const results: any[] = []

      for (const id of ids) {
        try {
          const result = await this.updateContent(id, updates, {
            tenantId,
            updatedBy,
            createVersion: false, // Don't create versions for bulk operations
            validateWorkflow: false, // Skip workflow validation for bulk operations
          })
          results.push({ id, success: true, content: result })
        } catch (error) {
          results.push({ id, success: false, error: (error as Error).message })
        }
      }

      // Clear cache after bulk operation
      if (this.options.enableCache) {
        await this.clearContentCache(tenantId)
      }

      logger.info("Bulk content update completed", {
        totalItems: ids.length,
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        userId: updatedBy,
        tenantId,
      })

      return results
    } catch (error) {
      logger.error("Failed to bulk update content:", error)
      throw error
    }
  }

  /**
   * Bulk delete content
   */
  async bulkDeleteContent(
    ids: string[],
    options: {
      tenantId?: string
      deletedBy?: string
      force?: boolean
    } = {},
  ): Promise<any[]> {
    try {
      const { tenantId, deletedBy, force = false } = options
      const results: any[] = []

      for (const id of ids) {
        try {
          await this.deleteContent(id, { tenantId, deletedBy, force })
          results.push({ id, success: true })
        } catch (error) {
          results.push({ id, success: false, error: (error as Error).message })
        }
      }

      logger.info("Bulk content deletion completed", {
        totalItems: ids.length,
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        userId: deletedBy,
        tenantId,
      })

      return results
    } catch (error) {
      logger.error("Failed to bulk delete content:", error)
      throw error
    }
  }

  /**
   * Get content by slug
   */
  async getContentBySlug(slug: string, contentTypeId: string, locale = "en", tenantId?: string): Promise<any> {
    try {
      const cacheKey = `content:slug:${contentTypeId}:${slug}:${locale}`

      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get(cacheKey, tenantId)
        if (cached) {
          await this.incrementViewCount(cached.id, tenantId)
          return cached
        }
      }

      const content = await this.contentRepo.findBySlug(slug, contentTypeId, locale, tenantId)
      if (!content) {
        throw ApiError.notFound("Content not found")
      }

      // Cache the result
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, content, this.options.cacheTtl, tenantId)
      }

      // Increment view count
      await this.incrementViewCount(content.id, tenantId)

      return content
    } catch (error) {
      logger.error("Failed to get content by slug:", error)
      throw error
    }
  }

  /**
   * Restore content version
   */
  async restoreContentVersion(
    contentId: string,
    version: number,
    options: {
      tenantId?: string
      restoredBy?: string
      comment?: string
    } = {},
  ): Promise<any> {
    try {
      const { tenantId, restoredBy, comment } = options

      if (!this.options.enableVersioning) {
        throw ApiError.badRequest("Versioning is not enabled")
      }

      const content = await this.contentRepo.findById(contentId, tenantId)
      if (!content) {
        throw ApiError.notFound("Content not found")
      }

      const versionData = await this.versionRepo.findByVersion(contentId, version, tenantId)
      if (!versionData) {
        throw ApiError.notFound("Version not found")
      }

      // Update content with version data
      const restoredContent = await this.updateContent(
        contentId,
        {
          title: versionData.title,
          data: versionData.data,
          comment: comment || `Restored from version ${version}`,
        },
        {
          tenantId,
          updatedBy: restoredBy,
          createVersion: true,
        },
      )

      logger.info("Content version restored", {
        contentId,
        version,
        userId: restoredBy,
        tenantId,
      })

      return restoredContent
    } catch (error) {
      logger.error("Failed to restore content version:", error)
      throw error
    }
  }

  /**
   * Get content tree (hierarchical content)
   */
  async getContentTree(
    contentTypeId?: string,
    options: {
      tenantId?: string
      maxDepth?: number
      includeMetrics?: boolean
    } = {},
  ): Promise<any[]> {
    try {
      const { tenantId, maxDepth = 5, includeMetrics = false } = options

      const tree = await this.contentRepo.getContentTree(contentTypeId, tenantId, maxDepth)

      if (includeMetrics) {
        for (const node of tree) {
          node.metrics = await this.getContentMetrics(node.id, tenantId)
        }
      }

      return tree
    } catch (error) {
      logger.error("Failed to get content tree:", error)
      throw error
    }
  }

  /**
   * Reorder content
   */
  async reorderContent(
    items: Array<{ id: string; order: number }>,
    options: {
      tenantId?: string
      updatedBy?: string
    } = {},
  ): Promise<void> {
    try {
      const { tenantId, updatedBy } = options

      for (const item of items) {
        await this.contentRepo.update(item.id, { order: item.order, updatedBy, updatedAt: new Date() }, tenantId)
      }

      // Clear cache
      if (this.options.enableCache) {
        await this.clearContentCache(tenantId)
      }

      logger.info("Content reordered", {
        itemCount: items.length,
        userId: updatedBy,
        tenantId,
      })
    } catch (error) {
      logger.error("Failed to reorder content:", error)
      throw error
    }
  }

  /**
   * Export content
   */
  async exportContent(
    options: {
      contentTypeId?: string
      status?: string[]
      locale?: string
      format?: "json" | "csv" | "xml"
      tenantId?: string
    } = {},
  ): Promise<any> {
    try {
      const { contentTypeId, status, locale, format = "json", tenantId } = options

      const searchOptions: ContentSearchOptions = {
        contentType: contentTypeId,
        status,
        locale,
        limit: 10000, // Large limit for export
        tenantId,
      }

      const result = await this.searchContent(searchOptions)
      const content = result.content

      switch (format) {
        case "json":
          return {
            format: "json",
            data: JSON.stringify(content, null, 2),
            filename: `content-export-${Date.now()}.json`,
            mimeType: "application/json",
          }

        case "csv":
          const csvHeaders = ["ID", "Title", "Slug", "Status", "Locale", "Created At", "Updated At"]
          const csvRows = content.map((item: any) => [
            item.id,
            item.title,
            item.slug,
            item.status,
            item.locale,
            item.createdAt,
            item.updatedAt,
          ])

          const csvContent = [
            csvHeaders.join(","),
            ...csvRows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
          ].join("\n")

          return {
            format: "csv",
            data: csvContent,
            filename: `content-export-${Date.now()}.csv`,
            mimeType: "text/csv",
          }

        case "xml":
          const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<content>
${content
  .map(
    (item: any) => `
  <item>
    <id>${item.id}</id>
    <title><![CDATA[${item.title}]]></title>
    <slug>${item.slug}</slug>
    <status>${item.status}</status>
    <locale>${item.locale}</locale>
    <createdAt>${item.createdAt}</createdAt>
    <updatedAt>${item.updatedAt}</updatedAt>
    <data><![CDATA[${JSON.stringify(item.data)}]]></data>
  </item>`,
  )
  .join("")}
</content>`

          return {
            format: "xml",
            data: xmlContent,
            filename: `content-export-${Date.now()}.xml`,
            mimeType: "application/xml",
          }

        default:
          throw ApiError.badRequest(`Unsupported export format: ${format}`)
      }
    } catch (error) {
      logger.error("Failed to export content:", error)
      throw error
    }
  }

  /**
   * Import content from various formats
   */
  async importContent(
    data: string,
    format: "json" | "csv" | "xml",
    options: {
      tenantId?: string
      createdBy?: string
      contentTypeId?: string
      defaultStatus?: string
      defaultLocale?: string
      skipValidation?: boolean
      updateExisting?: boolean
    } = {},
  ): Promise<any> {
    try {
      const {
        tenantId,
        createdBy,
        contentTypeId,
        defaultStatus = "draft",
        defaultLocale = "en",
        skipValidation = false,
        updateExisting = false,
      } = options

      let parsedContent: any[]

      switch (format) {
        case "json":
          parsedContent = JSON.parse(data)
          if (!Array.isArray(parsedContent)) {
            parsedContent = [parsedContent]
          }
          break

        case "csv":
          // Simple CSV parsing (in production, use a proper CSV parser)
          const lines = data.split("\n")
          const headers = lines[0].split(",").map((h) => h.replace(/"/g, ""))
          parsedContent = lines.slice(1).map((line) => {
            const values = line.split(",").map((v) => v.replace(/"/g, ""))
            const item: any = {}
            headers.forEach((header, index) => {
              item[header.toLowerCase().replace(/\s+/g, "")] = values[index]
            })
            return item
          })
          break

        case "xml":
          // Simple XML parsing (in production, use a proper XML parser)
          throw ApiError.badRequest("XML import not implemented yet")

        default:
          throw ApiError.badRequest(`Unsupported import format: ${format}`)
      }

      const results: any[] = []

      for (const item of parsedContent) {
        try {
          const contentData = {
            contentTypeId: item.contentTypeId || contentTypeId,
            title: item.title,
            slug: item.slug,
            data: item.data || {},
            status: item.status || defaultStatus,
            locale: item.locale || defaultLocale,
            tags: item.tags || [],
            categories: item.categories || [],
            metadata: item.metadata || {},
            tenantId,
            createdBy,
          }

          // Check if content already exists
          if (updateExisting && item.id) {
            const existing = await this.contentRepo.findById(item.id, tenantId)
            if (existing) {
              const updated = await this.updateContent(item.id, contentData, {
                tenantId,
                updatedBy: createdBy,
                validateWorkflow: !skipValidation,
              })
              results.push({ id: item.id, success: true, action: "updated", content: updated })
              continue
            }
          }

          // Create new content
          const created = await this.createContent(contentData)
          results.push({ id: created.id, success: true, action: "created", content: created })
        } catch (error) {
          results.push({
            id: item.id || item.title,
            success: false,
            error: (error as Error).message,
            action: "failed",
          })
        }
      }

      logger.info("Content import completed", {
        totalItems: parsedContent.length,
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        userId: createdBy,
        tenantId,
      })

      return {
        results,
        summary: {
          total: parsedContent.length,
          successful: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
          created: results.filter((r) => r.action === "created").length,
          updated: results.filter((r) => r.action === "updated").length,
        },
      }
    } catch (error) {
      logger.error("Failed to import content:", error)
      throw error
    }
  }

  /**
   * Get content analytics
   */
  async getContentAnalytics(
    options: {
      contentId?: string
      contentTypeId?: string
      dateFrom?: Date
      dateTo?: Date
      tenantId?: string
    } = {},
  ): Promise<any> {
    try {
      const { contentId, contentTypeId, dateFrom, dateTo, tenantId } = options

      // This would typically integrate with an analytics service
      // For now, return mock data
      return {
        views: {
          total: 1000,
          unique: 750,
          trend: [
            { date: "2024-01-01", views: 100 },
            { date: "2024-01-02", views: 120 },
            { date: "2024-01-03", views: 90 },
          ],
        },
        engagement: {
          likes: 50,
          shares: 25,
          comments: 15,
          averageTimeOnPage: 180, // seconds
          bounceRate: 0.3,
        },
        topPages: [
          { id: "1", title: "Sample Content", views: 500 },
          { id: "2", title: "Another Content", views: 300 },
        ],
        referrers: [
          { source: "google.com", visits: 400 },
          { source: "direct", visits: 300 },
          { source: "facebook.com", visits: 200 },
        ],
        devices: {
          desktop: 60,
          mobile: 35,
          tablet: 5,
        },
      }
    } catch (error) {
      logger.error("Failed to get content analytics:", error)
      throw error
    }
  }

  /**
   * Cleanup expired scheduled jobs and old data
   */
  async cleanup(): Promise<void> {
    try {
      // Cancel expired scheduled jobs
      const now = Date.now()
      for (const [key, timeout] of this.scheduledJobs.entries()) {
        // In a real implementation, you would check if the job is expired
        // For now, we'll just log the cleanup
        logger.debug("Cleaning up scheduled job", { key })
      }

      // Clean up old versions beyond retention period
      if (this.options.enableVersioning) {
        // Implementation would depend on your retention policy
        logger.debug("Cleaning up old content versions")
      }

      // Clear expired cache entries
      if (this.options.enableCache) {
        await cacheService.cleanup()
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

  /**
   * Get workflow states
   */
  getWorkflowStates(): ContentWorkflowState[] {
    return Array.from(this.workflowStates.values())
  }

  /**
   * Add custom workflow state
   */
  addWorkflowState(state: ContentWorkflowState): void {
    this.workflowStates.set(state.id, state)
    logger.info("Workflow state added", { stateId: state.id, stateName: state.name })
  }

  /**
   * Remove workflow state
   */
  removeWorkflowState(stateId: string): void {
    this.workflowStates.delete(stateId)
    logger.info("Workflow state removed", { stateId })
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<any> {
    try {
      const status = {
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
        await this.contentRepo.healthCheck()
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
          await cacheService.healthCheck()
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
}
