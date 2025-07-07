// =============================================================================
// MEDIA REPOSITORY - POSTGRESQL
// =============================================================================
// Media file management with metadata and multi-tenant support

import { PrismaClient, Media, MediaType, Prisma } from '@prisma/client'
import { BaseRepository } from './base.repository'
import { 
  MediaFile, 
  MediaCreateInput, 
  MediaUpdateInput, 
  MediaSearchOptions, 
  MediaSearchResult, 
  MediaStats 
} from '../types/media.types'

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
   * Map Prisma Media to MediaFile interface
   */
  private mapToMediaFile(media: Media): MediaFile {
    return {
      id: media.id,
      filename: media.filename,
      originalName: media.originalName,
      path: media.path,
      url: media.url,
      type: media.type,
      mimeType: media.mimeType,
      size: media.size,
      width: media.width || undefined,
      height: media.height || undefined,
      duration: media.duration || undefined,
      alt: media.alt || undefined,
      caption: media.caption || undefined,
      tags: media.tags,
      metadata: media.metadata as Record<string, any>,
      tenantId: media.tenantId || undefined,
      uploadedById: media.uploadedById,
      createdAt: media.createdAt,
      updatedAt: media.updatedAt,
    }
  }

  /**
   * Create media file
   */
  async createMedia(data: MediaCreateInput, include?: Record<string, boolean>): Promise<MediaFile> {
    try {
      const media = await this.model.create({
        data: {
          ...data,
          metadata: data.metadata || {},
        },
        include,
      })
      return this.mapToMediaFile(media)
    } catch (error) {
      this.handleError(error, 'createMedia')
    }
  }

  /**
   * Find media by ID
   */
  async findMediaById(id: string, include?: Record<string, boolean>): Promise<MediaFile | null> {
    try {
      const media = await this.model.findUnique({
        where: { id },
        include,
      })
      return media ? this.mapToMediaFile(media) : null
    } catch (error) {
      this.handleError(error, 'findMediaById')
    }
  }

  /**
   * Update media file
   */
  async updateMedia(id: string, data: MediaUpdateInput, include?: Record<string, boolean>): Promise<MediaFile> {
    try {
      const media = await this.model.update({
        where: { id },
        data: {
          ...data,
          metadata: data.metadata !== undefined ? data.metadata : undefined,
        },
        include,
      })
      return this.mapToMediaFile(media)
    } catch (error) {
      this.handleError(error, 'updateMedia')
    }
  }

  /**
   * Search media files with pagination
   */
  async searchMedia(options: MediaSearchOptions): Promise<MediaSearchResult> {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      type, 
      mimeType, 
      tags, 
      tenantId, 
      uploadedById,
      sortBy = 'createdAt', 
      sortOrder = 'desc' 
    } = options
    
    const skip = (page - 1) * limit

    try {
      const where: any = {}
      
      if (tenantId) where.tenantId = tenantId
      if (type) where.type = type
      if (mimeType) where.mimeType = { contains: mimeType, mode: 'insensitive' }
      if (uploadedById) where.uploadedById = uploadedById
      if (tags && tags.length > 0) where.tags = { hasEvery: tags }
      
      if (search) {
        where.OR = [
          { filename: { contains: search, mode: 'insensitive' } },
          { originalName: { contains: search, mode: 'insensitive' } },
          { alt: { contains: search, mode: 'insensitive' } },
          { caption: { contains: search, mode: 'insensitive' } }
        ]
      }

      const [media, total] = await Promise.all([
        this.model.findMany({
          where,
          skip,
          take: limit,
          orderBy: { [sortBy]: sortOrder },
        }),
        this.model.count({ where })
      ])

      return {
        media: media.map(this.mapToMediaFile.bind(this)),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    } catch (error) {
      this.handleError(error, 'searchMedia')
    }
  }

  /**
   * Get media statistics
   */
  async getStats(tenantId?: string): Promise<MediaStats> {
    try {
      const where = tenantId ? { tenantId } : {}
      
      const [total, media] = await Promise.all([
        this.model.count({ where }),
        this.model.findMany({
          where,
          select: { type: true, size: true, mimeType: true }
        })
      ])

      const totalSize = media.reduce((sum, m) => sum + m.size, 0)
      
      const filesByType = media.reduce((acc, m) => {
        acc[m.type] = (acc[m.type] || 0) + 1
        return acc
      }, {} as Record<string, number>)

      const sizeByType = media.reduce((acc, m) => {
        acc[m.type] = (acc[m.type] || 0) + m.size
        return acc
      }, {} as Record<string, number>)

      return {
        totalFiles: total,
        totalSize,
        filesByType,
        sizeByType,
        averageSize: total > 0 ? totalSize / total : 0
      }
    } catch (error) {
      this.handleError(error, 'getStats')
    }
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
      mimeType: { contains: mimeType, mode: 'insensitive' }
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
      size: {
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
      where.size = size
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }
}
