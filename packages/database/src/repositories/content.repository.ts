// =============================================================================
// CONTENT REPOSITORY - POSTGRESQL
// =============================================================================
// Dynamic content management with versioning and multi-tenant support

import { PrismaClient, Content, ContentStatus, Prisma } from '@prisma/client'
import { BaseRepository } from './base.repository'

export type ContentCreateInput = Prisma.ContentCreateInput
export type ContentUpdateInput = Prisma.ContentUpdateInput

export interface ContentWithRelations extends Content {
  contentType?: any
  tenant?: any
  createdBy?: any
  updatedBy?: any
  publishedBy?: any
  workflowEntries?: any[]
}

export interface ContentVersion {
  id: string
  version: number
  data: any
  createdAt: Date
  createdBy?: string
  comment?: string
}

export class ContentRepository extends BaseRepository<Content, ContentCreateInput, ContentUpdateInput> {
  protected modelName = 'Content'
  protected model = this.prisma.content

  constructor(prisma: PrismaClient) {
    super(prisma)
  }

  /**
   * Find content by content type
   */
  async findByContentType(contentTypeId: string, tenantId?: string): Promise<Content[]> {
    const where: any = { contentTypeId }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where)
  }

  /**
   * Find content by slug
   */
  async findBySlug(
    contentTypeId: string, 
    slug: string, 
    locale = 'en',
    tenantId?: string
  ): Promise<Content | null> {
    const where: any = {
      contentTypeId,
      slug,
      locale,
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findFirst(where)
  }

  /**
   * Find content by slug or throw error
   */
  async findBySlugOrThrow(
    contentTypeId: string, 
    slug: string, 
    locale = 'en',
    tenantId?: string
  ): Promise<Content> {
    const content = await this.findBySlug(contentTypeId, slug, locale, tenantId)
    if (!content) {
      throw new Error(`Content not found with slug: ${slug}`)
    }
    return content
  }

  /**
   * Find published content
   */
  async findPublished(contentTypeId?: string, tenantId?: string): Promise<Content[]> {
    const where: any = { status: ContentStatus.PUBLISHED }
    if (contentTypeId) {
      where.contentTypeId = contentTypeId
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { publishedAt: 'desc' })
  }

  /**
   * Find draft content
   */
  async findDrafts(contentTypeId?: string, tenantId?: string): Promise<Content[]> {
    const where: any = { status: ContentStatus.DRAFT }
    if (contentTypeId) {
      where.contentTypeId = contentTypeId
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { updatedAt: 'desc' })
  }

  /**
   * Find archived content
   */
  async findArchived(contentTypeId?: string, tenantId?: string): Promise<Content[]> {
    const where: any = { status: ContentStatus.ARCHIVED }
    if (contentTypeId) {
      where.contentTypeId = contentTypeId
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { updatedAt: 'desc' })
  }

  /**
   * Publish content
   */
  async publish(contentId: string, userId?: string, scheduledAt?: Date): Promise<Content> {
    const content = await this.findByIdOrThrow(contentId)

    if (content.status === ContentStatus.ARCHIVED) {
      throw new Error('Cannot publish archived content')
    }

    const updateData: any = {
      status: ContentStatus.PUBLISHED,
      publishedAt: scheduledAt || new Date(),
    }

    if (userId) {
      updateData.publishedBy = { connect: { id: userId } }
    }

    return this.update(contentId, updateData)
  }

  /**
   * Unpublish content
   */
  async unpublish(contentId: string): Promise<Content> {
    const content = await this.findByIdOrThrow(contentId)

    if (content.status !== ContentStatus.PUBLISHED) {
      throw new Error('Content is not published')
    }

    return this.update(contentId, {
      status: ContentStatus.DRAFT,
      publishedAt: null,
      publishedBy: { disconnect: true },
    })
  }

  /**
   * Archive content
   */
  async archive(contentId: string): Promise<Content> {
    return this.update(contentId, {
      status: ContentStatus.ARCHIVED,
    })
  }

  /**
   * Restore archived content
   */
  async restore(contentId: string): Promise<Content> {
    const content = await this.findByIdOrThrow(contentId)

    if (content.status !== ContentStatus.ARCHIVED) {
      throw new Error('Content is not archived')
    }

    return this.update(contentId, {
      status: ContentStatus.DRAFT,
    })
  }

  /**
   * Create content version
   */
  async createVersion(
    contentId: string, 
    data: any, 
    userId?: string, 
    comment?: string
  ): Promise<Content> {
    const content = await this.findByIdOrThrow(contentId)
    
    // Get current version number
    const versions = (content.versions as unknown as ContentVersion[]) || []
    const nextVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version)) + 1 : 1

    // Create new version
    const newVersion: ContentVersion = {
      id: `version_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      version: nextVersion,
      data,
      createdAt: new Date(),
      createdBy: userId,
      comment,
    }

    // Add version to content
    const updatedVersions = [...versions, newVersion]

    // Keep only last 50 versions
    if (updatedVersions.length > 50) {
      updatedVersions.splice(0, updatedVersions.length - 50)
    }

    return this.update(contentId, {
      data,
      versions: updatedVersions as any,
    })
  }

  /**
   * Restore content version
   */
  async restoreVersion(contentId: string, versionId: string): Promise<Content> {
    const content = await this.findByIdOrThrow(contentId)
    const versions = (content.versions as unknown as ContentVersion[]) || []

    // Find the version
    const version = versions.find(v => v.id === versionId)
    if (!version) {
      throw new Error(`Version not found with ID: ${versionId}`)
    }

    // Update content data with version data
    return this.update(contentId, {
      data: version.data as any,
    })
  }

  /**
   * Get content versions
   */
  async getVersions(contentId: string): Promise<ContentVersion[]> {
    const content = await this.findByIdOrThrow(contentId)
    return (content.versions as unknown as ContentVersion[]) || []
  }


  /**
   * Find content by creator
   */
  async findByCreator(userId: string, tenantId?: string): Promise<Content[]> {
    const where: any = { createdById: userId }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Find content updated by user
   */
  async findByUpdater(userId: string, tenantId?: string): Promise<Content[]> {
    const where: any = { updatedById: userId }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { updatedAt: 'desc' })
  }

  /**
   * Find content published by user
   */
  async findByPublisher(userId: string, tenantId?: string): Promise<Content[]> {
    const where: any = { publishedById: userId }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { publishedAt: 'desc' })
  }

  /**
   * Find content by date range
   */
  async findByDateRange(
    startDate: Date, 
    endDate: Date, 
    dateField: 'createdAt' | 'updatedAt' | 'publishedAt' = 'createdAt',
    tenantId?: string
  ): Promise<Content[]> {
    const where: any = {
      [dateField]: {
        gte: startDate,
        lte: endDate,
      },
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    // For dynamic orderBy, we need to use the model directly
    try {
      return await this.model.findMany({
        where,
        orderBy: { [dateField]: 'desc' },
      })
    } catch (error) {
      this.handleError(error, 'findByDateRange')
    }
  }

  /**
   * Find content with relations
   */
  async findWithRelations(
    where?: Record<string, any>,
    includeRelations: {
      contentType?: boolean
      tenant?: boolean
      createdBy?: boolean
      updatedBy?: boolean
      publishedBy?: boolean
      versions?: boolean
      workflowEntries?: boolean
    } = {}
  ): Promise<ContentWithRelations[]> {
    return this.findMany(where, includeRelations) as Promise<ContentWithRelations[]>
  }

  /**
   * Get content statistics
   */
  async getStatistics(tenantId?: string): Promise<{
    total: number
    published: number
    draft: number
    archived: number
    byContentType: Record<string, number>
    byLocale: Record<string, number>
  }> {
    const where: any = {}
    if (tenantId) {
      where.tenantId = tenantId
    }

    const [
      total,
      published,
      draft,
      archived,
      contentTypeStats,
      localeStats,
    ] = await Promise.all([
      this.count(where),
      this.count({ ...where, status: ContentStatus.PUBLISHED }),
      this.count({ ...where, status: ContentStatus.DRAFT }),
      this.count({ ...where, status: ContentStatus.ARCHIVED }),
      this.prisma.content.groupBy({
        by: ['contentTypeId'],
        where,
        _count: true,
      }),
      this.prisma.content.groupBy({
        by: ['locale'],
        where,
        _count: true,
      }),
    ])

    const byContentType: Record<string, number> = {}
    contentTypeStats.forEach(stat => {
      byContentType[stat.contentTypeId] = stat._count
    })

    const byLocale: Record<string, number> = {}
    localeStats.forEach(stat => {
      byLocale[stat.locale] = stat._count
    })

    return {
      total,
      published,
      draft,
      archived,
      byContentType,
      byLocale,
    }
  }

  /**
   * Duplicate content
   */
  async duplicate(
    contentId: string, 
    newSlug?: string,
    userId?: string
  ): Promise<Content> {
    const originalContent = await this.findByIdOrThrow(contentId)

    // Generate new slug if not provided
    const slug = newSlug || `${originalContent.slug}-copy-${Date.now()}`

    // Check if slug already exists
    const existingContent = await this.findBySlug(
      originalContent.contentTypeId, 
      slug, 
      originalContent.locale,
      originalContent.tenantId || undefined
    )

    if (existingContent) {
      throw new Error(`Content with slug '${slug}' already exists`)
    }

    // Create duplicate
    const duplicateData: ContentCreateInput = {
      contentType: { connect: { id: originalContent.contentTypeId } },
      data: originalContent.data as any,
      status: ContentStatus.DRAFT, // Always create as draft
      locale: originalContent.locale,
      slug,
      tenant: originalContent.tenantId ? { connect: { id: originalContent.tenantId } } : undefined,
      createdBy: userId ? { connect: { id: userId } } : undefined,
    }

    return this.create(duplicateData)
  }

  /**
   * Bulk update content status
   */
  async bulkUpdateStatus(
    contentIds: string[], 
    status: ContentStatus,
    userId?: string
  ): Promise<number> {
    const updateData: any = { status }

    if (status === ContentStatus.PUBLISHED) {
      updateData.publishedAt = new Date()
      if (userId) {
        updateData.publishedById = userId
      }
    } else if (status === ContentStatus.DRAFT) {
      updateData.publishedAt = null
      updateData.publishedById = null
    }

    const result = await this.prisma.content.updateMany({
      where: {
        id: { in: contentIds },
      },
      data: updateData,
    })

    return result.count
  }

  /**
   * Bulk delete content
   */
  async bulkDelete(contentIds: string[]): Promise<number> {
    const result = await this.prisma.content.deleteMany({
      where: {
        id: { in: contentIds },
      },
    })

    return result.count
  }

  /**
   * Get content type facets for search
   */
  async getContentTypeFacets(tenantId?: string): Promise<any[]> {
    const where: any = {}
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      const result = await this.prisma.content.groupBy({
        by: ['contentTypeId'],
        where,
        _count: true
      } as any)
      return result
    } catch (error) {
      console.error('Error getting content type facets:', error)
      return []
    }
  }

  /**
   * Get status facets for search
   */
  async getStatusFacets(tenantId?: string): Promise<any[]> {
    const where: any = {}
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      const result = await this.prisma.content.groupBy({
        by: ['status'],
        where,
        _count: true
      } as any)
      return result
    } catch (error) {
      console.error('Error getting status facets:', error)
      return []
    }
  }

  /**
   * Get tags facets for search
   */
  async getTagsFacets(tenantId?: string): Promise<any[]> {
    // This would need to be implemented based on your tag structure
    // For now, return empty array
    return []
  }

  /**
   * Get categories facets for search
   */
  async getCategoriesFacets(tenantId?: string): Promise<any[]> {
    // This would need to be implemented based on your category structure
    // For now, return empty array
    return []
  }

  /**
   * Get content statistics
   */
  async getStats(tenantId?: string): Promise<any> {
    const where: any = {}
    if (tenantId) {
      where.tenantId = tenantId
    }

    const [total, published, draft, archived] = await Promise.all([
      this.prisma.content.count({ where }),
      this.prisma.content.count({ where: { ...where, status: ContentStatus.PUBLISHED } }),
      this.prisma.content.count({ where: { ...where, status: ContentStatus.DRAFT } }),
      this.prisma.content.count({ where: { ...where, status: ContentStatus.ARCHIVED } })
    ])

    return {
      totalContent: total,
      publishedContent: published,
      draftContent: draft,
      archivedContent: archived,
      scheduledContent: 0, // Would need to be implemented based on scheduling logic
      contentByType: {},
      contentByLocale: {},
      contentByStatus: {
        published,
        draft,
        archived
      },
      recentActivity: [],
      topAuthors: [],
      popularContent: []
    }
  }

  /**
   * Get content tree (hierarchical content)
   */
  async getContentTree(contentTypeId?: string, tenantId?: string, maxDepth: number = 5): Promise<any[]> {
    const where: any = {}
    if (contentTypeId) {
      where.contentTypeId = contentTypeId
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    // For now, return flat structure - would need to implement hierarchy based on your schema
    return this.prisma.content.findMany({
      where,
      include: {
        contentType: true
      }
    })
  }

  /**
   * Health check for repository
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { status: 'healthy', timestamp: new Date().toISOString() }
    } catch (error) {
      return { status: 'unhealthy', timestamp: new Date().toISOString() }
    }
  }

  /**
   * Search content with advanced options
   */
  async search(options: any): Promise<any> {
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
      sortBy = 'updatedAt',
      sortOrder = 'desc',
      tenantId
    } = options

    const where: any = {}
    
    if (tenantId) {
      where.tenantId = tenantId
    }

    if (contentType) {
      where.contentTypeId = contentType
    }

    if (status) {
      if (Array.isArray(status)) {
        where.status = { in: status }
      } else {
        where.status = status
      }
    }

    if (locale) {
      where.locale = locale
    }

    if (author) {
      where.createdById = author
    }

    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) where.createdAt.gte = dateFrom
      if (dateTo) where.createdAt.lte = dateTo
    }

    if (search) {
      where.OR = [
        { slug: { contains: search, mode: 'insensitive' } },
        // Add more search fields as needed
      ]
    }

    const [content, total] = await Promise.all([
      this.prisma.content.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      this.prisma.content.count({ where })
    ])

    return {
      content,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  }
}
