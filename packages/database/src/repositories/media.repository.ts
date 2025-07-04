// =============================================================================
// MEDIA REPOSITORY - POSTGRESQL
// =============================================================================
// Media file management with metadata and multi-tenant support

import { PrismaClient, Media, MediaType, Prisma } from '@prisma/client'
import { BaseRepository } from './base.repository'

export type MediaCreateInput = Prisma.MediaCreateInput
export type MediaUpdateInput = Prisma.MediaUpdateInput

export interface MediaWithRelations extends Media {
  tenant?: any
  uploadedBy?: any
}

export class MediaRepository extends BaseRepository<Media, MediaCreateInput, MediaUpdateInput> {
  protected modelName = 'Media'
  protected model = this.prisma.media

  constructor(prisma: PrismaClient) {
    super(prisma)
  }

  /**
   * Find media by type
   */
  async findByType(type: MediaType, tenantId?: string): Promise<Media[]> {
    const where: any = { type }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Find media by MIME type
   */
  async findByMimeType(mimeType: string, tenantId?: string): Promise<Media[]> {
    const where: any = { 
      metadata: {
        path: ['mimeType'],
        string_contains: mimeType,
      }
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Find media by tags
   */
  async findByTags(tags: string[], tenantId?: string): Promise<Media[]> {
    const where: any = {
      tags: {
        hasSome: tags,
      },
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Find media by uploader
   */
  async findByUploader(userId: string, tenantId?: string): Promise<Media[]> {
    const where: any = { uploadedById: userId }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Search media
   */
  async search(
    query: string, 
    tenantId?: string,
    options: {
      type?: MediaType
      limit?: number
      offset?: number
    } = {}
  ): Promise<Media[]> {
    const { type, limit = 50, offset = 0 } = options

    const where: any = {
      OR: [
        { filename: { contains: query, mode: 'insensitive' } },
        { originalName: { contains: query, mode: 'insensitive' } },
        { alt: { contains: query, mode: 'insensitive' } },
        { caption: { contains: query, mode: 'insensitive' } },
        { tags: { has: query } },
      ],
    }

    if (type) {
      where.type = type
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
   * Add tags to media
   */
  async addTags(mediaId: string, tags: string[]): Promise<Media> {
    const media = await this.findByIdOrThrow(mediaId)
    const currentTags = media.tags || []
    const uniqueTags = [...new Set([...currentTags, ...tags])]

    return this.update(mediaId, { tags: uniqueTags })
  }

  /**
   * Remove tags from media
   */
  async removeTags(mediaId: string, tags: string[]): Promise<Media> {
    const media = await this.findByIdOrThrow(mediaId)
    const currentTags = media.tags || []
    const updatedTags = currentTags.filter(tag => !tags.includes(tag))

    return this.update(mediaId, { tags: updatedTags })
  }

  /**
   * Update media metadata
   */
  async updateMetadata(mediaId: string, metadata: any): Promise<Media> {
    return this.update(mediaId, { metadata })
  }

  /**
   * Find media by size range
   */
  async findBySizeRange(
    minSize: number, 
    maxSize: number, 
    tenantId?: string
  ): Promise<Media[]> {
    const where: any = {
      metadata: {
        path: ['size'],
        gte: minSize,
        lte: maxSize,
      },
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Find media by date range
   */
  async findByDateRange(
    startDate: Date, 
    endDate: Date, 
    tenantId?: string
  ): Promise<Media[]> {
    const where: any = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Find media with relations
   */
  async findWithRelations(
    where?: Record<string, any>,
    includeRelations: {
      tenant?: boolean
      uploadedBy?: boolean
    } = {}
  ): Promise<MediaWithRelations[]> {
    return this.findMany(where, includeRelations) as Promise<MediaWithRelations[]>
  }

  /**
   * Get media statistics
   */
  async getStatistics(tenantId?: string): Promise<{
    total: number
    totalSize: number
    byType: Record<string, number>
    byMimeType: Record<string, number>
    averageSize: number
  }> {
    const where: any = {}
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      const [
        total,
        typeStats,
        allMedia,
      ] = await Promise.all([
        this.count(where),
        this.prisma.media.groupBy({
          by: ['type'],
          where,
          _count: { _all: true },
        }),
        this.prisma.media.findMany({
          where,
          select: { metadata: true },
        }),
      ])

      // Calculate size statistics from metadata
      let totalSize = 0
      const byMimeType: Record<string, number> = {}
      
      allMedia.forEach(media => {
        const metadata = media.metadata as any
        if (metadata?.size) {
          totalSize += metadata.size
        }
        if (metadata?.mimeType) {
          byMimeType[metadata.mimeType] = (byMimeType[metadata.mimeType] || 0) + 1
        }
      })

      const averageSize = total > 0 ? totalSize / total : 0

      // Group by type
      const byType: Record<string, number> = {}
      typeStats.forEach(stat => {
        byType[stat.type] = stat._count._all
      })

      return {
        total,
        totalSize,
        averageSize,
        byType,
        byMimeType,
      }
    } catch (error) {
      this.handleError(error, 'getStatistics')
    }
  }

  /**
   * Find unused media (not referenced by any content)
   */
  async findUnused(tenantId?: string): Promise<Media[]> {
    // This would require a more complex query to check references
    // For now, we'll return media older than 30 days with no recent access
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const where: any = {
      createdAt: { lt: thirtyDaysAgo },
      // Add additional conditions based on your reference tracking
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'asc' })
  }

  /**
   * Bulk delete media
   */
  async bulkDelete(mediaIds: string[]): Promise<number> {
    const result = await this.prisma.media.deleteMany({
      where: {
        id: { in: mediaIds },
      },
    })

    return result.count
  }

  /**
   * Find duplicate media by hash or filename
   */
  async findDuplicates(
    filename?: string, 
    size?: number, 
    tenantId?: string
  ): Promise<Media[]> {
    const where: any = {}
    
    if (filename) {
      where.filename = filename
    }
    
    if (size) {
      where.metadata = {
        path: ['size'],
        equals: size,
      }
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }
}
