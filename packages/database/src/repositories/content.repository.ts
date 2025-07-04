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
   * Search content
   */
  async search(
    query: string, 
    contentTypeId?: string, 
    tenantId?: string,
    options: {
      status?: ContentStatus
      locale?: string
      limit?: number
      offset?: number
    } = {}
  ): Promise<Content[]> {
    const { status, locale, limit = 50, offset = 0 } = options

    const where: any = {
      OR: [
        { 
          data: {
            path: ['title'],
            string_contains: query,
          }
        },
        { 
          data: {
            path: ['name'],
            string_contains: query,
          }
        },
        { 
          data: {
            path: ['description'],
            string_contains: query,
          }
        },
        { slug: { contains: query, mode: 'insensitive' } },
      ],
    }

    if (contentTypeId) {
      where.contentTypeId = contentTypeId
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    if (status) {
      where.status = status
    }

    if (locale) {
      where.locale = locale
    }

    // Note: For complex queries with take/skip, we need to use the model directly
    try {
      return await this.model.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { updatedAt: 'desc' },
      })
    } catch (error) {
      this.handleError(error, 'search')
    }
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
}
