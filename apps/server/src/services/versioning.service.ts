import { prisma } from "@cms-platform/database/client"
import { logger } from "../utils/logger"
import { ApiError } from "../utils/errors"
import type { 
  ContentVersion, 
  ContentVersionStatus, 
  VersionType as PrismaVersionType,
  Prisma
} from "@cms-platform/database/types"
import { 
  VersionStatus,
  VersionTypeEnum as VersionType
} from "@cms-platform/database/types"

interface VersionDiff {
  field: string
  type: "added" | "removed" | "modified"
  oldValue?: any
  newValue?: any
  path: string[]
}

interface VersionComparison {
  versionA: {
    id: string
    version: string
    createdAt: Date
    status: string
    createdById: string
  }
  versionB: {
    id: string
    version: string
    createdAt: Date
    status: string
    createdById: string
  }
  differences: VersionDiff[]
  hasDifferences: boolean
  similarity: number
  summary: {
    added: number
    removed: number
    modified: number
  }
}

/**
 * Enhanced versioning service with advanced content version management
 */
export class VersioningService {
  private readonly MAX_VERSIONS_PER_CONTENT = 100
  private readonly AUTO_CLEANUP_THRESHOLD = 50

  /**
   * Create a new version of content
   */
  public async createVersion(
    contentId: string,
    data: any,
    options: {
      userId: string
      notes?: string
      status?: VersionStatus
      type?: VersionType
      tags?: string[]
      scheduledFor?: Date
      tenantId?: string
      metadata?: Record<string, any>
    },
  ): Promise<ContentVersion> {
    try {
      // Validate content exists
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        include: {
          contentVersions: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      })

      if (!content) {
        throw ApiError.notFound(`Content with ID ${contentId} not found`)
      }

      // Check tenant access if provided
      if (options.tenantId && content.tenantId !== options.tenantId) {
        throw ApiError.forbidden("Access denied to content in different tenant")
      }

      // Generate version number
      const versionNumber = await this.generateVersionNumber(contentId, options.type || VersionType.AUTO)

      // Create version with transaction
      const contentVersion = await prisma.$transaction(async (tx) => {
        // Create new version
        const newVersion = await tx.contentVersion.create({
          data: {
            contentId,
            version: versionNumber,
            data,
            status: options.status || VersionStatus.DRAFT,
            type: options.type || VersionType.AUTO,
            createdById: options.userId,
            notes: options.notes,
            tags: options.tags || [],
            scheduledFor: options.scheduledFor,
            metadata: options.metadata || {},
            ...(options.status === VersionStatus.PUBLISHED && {
              publishedAt: new Date(),
              publishedById: options.userId,
            }),
          },
        })

        // If this is a published version, update the content's current data
        if (options.status === VersionStatus.PUBLISHED) {
          await tx.content.update({
            where: { id: contentId },
            data: {
              data,
              status: "PUBLISHED",
              publishedAt: new Date(),
              publishedById: options.userId,
            },
          })
        }

        // Create audit log
        await tx.auditLog.create({
          data: {
            action: "content_version_created",
            resource: "content_version",
            resourceId: newVersion.id,
            entityType: "content_version",
            entityId: newVersion.id,
            userId: options.userId,
            tenantId: options.tenantId,
          },
        })

        // Auto-cleanup old versions if needed
        await this.autoCleanupVersions(contentId, tx)

        return newVersion
      })

      logger.info(`Created content version: ${versionNumber} for content ${contentId}`)
      return contentVersion as ContentVersion
    } catch (error) {
      logger.error("Failed to create content version:", error)
      throw error
    }
  }

  /**
   * Get all versions of content with advanced filtering
   */
  public async getContentVersions(
    contentId: string,
    options: {
      page?: number
      limit?: number
      status?: VersionStatus | VersionStatus[]
      type?: VersionType | VersionType[]
      tags?: string[]
      createdBy?: string
      dateFrom?: Date
      dateTo?: Date
      search?: string
      includeData?: boolean
      tenantId?: string
    } = {},
  ): Promise<{
    versions: ContentVersion[]
    total: number
    page: number
    limit: number
    totalPages: number
    stats: {
      byStatus: Record<VersionStatus, number>
      byType: Record<VersionType, number>
      totalSize: number
      latestVersion: string
    }
  }> {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        type,
        tags,
        createdBy,
        dateFrom,
        dateTo,
        search,
        includeData = false,
        tenantId,
      } = options

      // Build where clause
      const where: any = { contentId }

      if (status) {
        where.status = Array.isArray(status) ? { in: status } : status
      }

      if (type) {
        where.type = Array.isArray(type) ? { in: type } : type
      }

      if (tags && tags.length > 0) {
        where.tags = { hasEvery: tags }
      }

      if (createdBy) {
        where.createdById = createdBy
      }

      if (dateFrom || dateTo) {
        where.createdAt = {}
        if (dateFrom) where.createdAt.gte = dateFrom
        if (dateTo) where.createdAt.lte = dateTo
      }

      if (search) {
        where.OR = [
          { notes: { contains: search, mode: "insensitive" } },
          { version: { contains: search, mode: "insensitive" } },
        ]
      }

      // Validate tenant access
      if (tenantId) {
        const content = await prisma.content.findUnique({
          where: { id: contentId },
          select: { tenantId: true },
        })

        if (!content || content.tenantId !== tenantId) {
          throw ApiError.forbidden("Access denied to content in different tenant")
        }
      }

      // Get versions and stats in parallel
      const [versions, total, statusStats, typeStats, sizeStats, latestVersion] = await Promise.all([
        prisma.contentVersion.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            contentId: true,
            version: true,
            status: true,
            type: true,
            notes: true,
            tags: true,
            createdAt: true,
            updatedAt: true,
            publishedAt: true,
            scheduledFor: true,
            metadata: true,
            createdById: true,
            publishedById: true,
            size: true,
            ...(includeData && { data: true }),
          },
        }),
        prisma.contentVersion.count({ where }),
        prisma.contentVersion.groupBy({
          by: ["status"],
          where: { contentId },
          _count: { status: true },
        }),
        prisma.contentVersion.groupBy({
          by: ["type"],
          where: { contentId },
          _count: { type: true },
        }),
        prisma.contentVersion.aggregate({
          where: { contentId },
          _sum: { size: true },
        }),
        prisma.contentVersion.findFirst({
          where: { contentId },
          orderBy: { createdAt: "desc" },
          select: { version: true },
        }),
      ])

      // Build stats
      const byStatus = Object.values(VersionStatus).reduce(
        (acc, status) => {
          acc[status] = statusStats.find((s) => s.status === status)?._count.status || 0
          return acc
        },
        {} as Record<VersionStatus, number>,
      )

      const byType = Object.values(VersionType).reduce(
        (acc, type) => {
          acc[type] = typeStats.find((t) => t.type === type)?._count.type || 0
          return acc
        },
        {} as Record<VersionType, number>,
      )

      return {
        versions: versions as ContentVersion[],
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        stats: {
          byStatus,
          byType,
          totalSize: sizeStats._sum.size || 0,
          latestVersion: latestVersion?.version || "1.0.0",
        },
      }
    } catch (error) {
      logger.error("Failed to get content versions:", error)
      throw error
    }
  }

  /**
   * Get a specific version of content
   */
  public async getContentVersion(
    contentId: string,
    version: string,
    options: {
      includeData?: boolean
      tenantId?: string
    } = {},
  ): Promise<ContentVersion | null> {
    try {
      const { includeData = true, tenantId } = options

      // Validate tenant access
      if (tenantId) {
        const content = await prisma.content.findUnique({
          where: { id: contentId },
          select: { tenantId: true },
        })

        if (!content || content.tenantId !== tenantId) {
          throw ApiError.forbidden("Access denied to content in different tenant")
        }
      }

      const contentVersion = await prisma.contentVersion.findUnique({
        where: {
          contentId_version: {
            contentId,
            version,
          },
        },
        select: {
          id: true,
          contentId: true,
          version: true,
          status: true,
          type: true,
          notes: true,
          tags: true,
          createdAt: true,
          updatedAt: true,
          publishedAt: true,
          scheduledFor: true,
          metadata: true,
          size: true,
          checksum: true,
          createdById: true,
          publishedById: true,
          ...(includeData && { data: true }),
        },
      })

      return contentVersion as ContentVersion | null
    } catch (error) {
      logger.error("Failed to get content version:", error)
      throw error
    }
  }

  /**
   * Get the latest version of content
   */
  public async getLatestVersion(
    contentId: string,
    options: {
      status?: VersionStatus
      includeData?: boolean
      tenantId?: string
    } = {},
  ): Promise<ContentVersion | null> {
    try {
      const { status, includeData = true, tenantId } = options

      // Validate tenant access
      if (tenantId) {
        const content = await prisma.content.findUnique({
          where: { id: contentId },
          select: { tenantId: true },
        })

        if (!content || content.tenantId !== tenantId) {
          throw ApiError.forbidden("Access denied to content in different tenant")
        }
      }

      const where: any = { contentId }
      if (status) {
        where.status = status
      }

      const contentVersion = await prisma.contentVersion.findFirst({
        where,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          contentId: true,
          version: true,
          status: true,
          type: true,
          notes: true,
          tags: true,
          createdAt: true,
          updatedAt: true,
          publishedAt: true,
          scheduledFor: true,
          metadata: true,
          size: true,
          checksum: true,
          createdById: true,
          publishedById: true,
          ...(includeData && { data: true }),
        },
      })

      return contentVersion as ContentVersion | null
    } catch (error) {
      logger.error("Failed to get latest content version:", error)
      throw error
    }
  }

  /**
   * Publish a specific version
   */
  public async publishVersion(
    contentId: string,
    version: string,
    options: {
      userId: string
      notes?: string
      scheduledFor?: Date
      tenantId?: string
    },
  ): Promise<ContentVersion> {
    try {
      const { userId, notes, scheduledFor, tenantId } = options

      // Validate tenant access
      if (tenantId) {
        const content = await prisma.content.findUnique({
          where: { id: contentId },
          select: { tenantId: true },
        })

        if (!content || content.tenantId !== tenantId) {
          throw ApiError.forbidden("Access denied to content in different tenant")
        }
      }

      // Find the version
      const contentVersion = await prisma.contentVersion.findUnique({
        where: {
          contentId_version: {
            contentId,
            version,
          },
        },
      })

      if (!contentVersion) {
        throw ApiError.notFound(`Version ${version} of content ${contentId} not found`)
      }

      if (contentVersion.status === VersionStatus.PUBLISHED) {
        throw ApiError.badRequest("Version is already published")
      }

      // Update version and content with transaction
      const updatedVersion = await prisma.$transaction(async (tx) => {
        // Update version status
        const updated = await tx.contentVersion.update({
          where: { id: contentVersion.id },
          data: {
            status: scheduledFor ? VersionStatus.SCHEDULED : VersionStatus.PUBLISHED,
            publishedAt: scheduledFor || new Date(),
            publishedById: userId,
            scheduledFor,
            notes: notes || contentVersion.notes,
          },
        })

        // Update content if publishing immediately
        if (!scheduledFor) {
          await tx.content.update({
            where: { id: contentId },
            data: {
              data: contentVersion.data as Prisma.InputJsonValue,
              status: "PUBLISHED",
              publishedAt: new Date(),
              publishedById: userId,
            },
          })
        }

        // Create audit log
        await tx.auditLog.create({
          data: {
            action: scheduledFor ? "content_version_scheduled" : "content_version_published",
            resource: "content_version",
            resourceId: contentVersion.id,
            entityType: "content_version",
            entityId: contentVersion.id,
            userId,
            tenantId,
          },
        })

        return updated
      })

      logger.info(`${scheduledFor ? "Scheduled" : "Published"} content version: ${version} for content ${contentId}`)
      return updatedVersion as ContentVersion
    } catch (error) {
      logger.error("Failed to publish content version:", error)
      throw error
    }
  }

  /**
   * Revert to a specific version
   */
  public async revertToVersion(
    contentId: string,
    version: string,
    options: {
      userId: string
      notes?: string
      publish?: boolean
      tenantId?: string
    },
  ): Promise<ContentVersion> {
    try {
      const { userId, notes, publish = false, tenantId } = options

      // Find the version to revert to
      const targetVersion = await this.getContentVersion(contentId, version, {
        includeData: true,
        tenantId,
      })

      if (!targetVersion) {
        throw ApiError.notFound(`Version ${version} of content ${contentId} not found`)
      }

      // Create a new version with the data from the target version
      return this.createVersion(contentId, targetVersion.data, {
        userId,
        notes: notes || `Reverted to version ${version}`,
        status: publish ? VersionStatus.PUBLISHED : VersionStatus.DRAFT,
        type: VersionType.MAJOR,
        tags: ["reverted"],
        tenantId,
        metadata: {
          revertedFrom: version,
          revertedAt: new Date().toISOString(),
        },
      })
    } catch (error) {
      logger.error("Failed to revert to content version:", error)
      throw error
    }
  }

  /**
   * Compare two versions with advanced diff analysis
   */
  public async compareVersions(
    contentId: string,
    versionA: string,
    versionB: string,
    options: {
      tenantId?: string
      includeMetadata?: boolean
    } = {},
  ): Promise<VersionComparison> {
    try {
      const { tenantId, includeMetadata = false } = options

      // Get both versions
      const [versionADoc, versionBDoc] = await Promise.all([
        this.getContentVersion(contentId, versionA, { includeData: true, tenantId }),
        this.getContentVersion(contentId, versionB, { includeData: true, tenantId }),
      ])

      if (!versionADoc || !versionBDoc) {
        throw ApiError.notFound("One or both versions not found")
      }

      // Perform deep diff analysis
      const differences = this.performDeepDiff(versionADoc.data, versionBDoc.data, includeMetadata)

      // Calculate similarity score
      const similarity = this.calculateSimilarity(versionADoc.data, versionBDoc.data)

      // Generate summary
      const summary = {
        added: differences.filter((d) => d.type === "added").length,
        removed: differences.filter((d) => d.type === "removed").length,
        modified: differences.filter((d) => d.type === "modified").length,
      }

      return {
        versionA: {
          id: versionADoc.id,
          version: versionADoc.version,
          createdAt: versionADoc.createdAt,
          status: versionADoc.status,
        createdById: versionADoc.createdById || "",
      },
      versionB: {
        id: versionBDoc.id,
        version: versionBDoc.version,
        createdAt: versionBDoc.createdAt,
        status: versionBDoc.status,
        createdById: versionBDoc.createdById || "",
        },
        differences,
        hasDifferences: differences.length > 0,
        similarity,
        summary,
      }
    } catch (error) {
      logger.error("Failed to compare content versions:", error)
      throw error
    }
  }

  /**
   * Delete a specific version
   */
  public async deleteVersion(
    contentId: string,
    version: string,
    options: {
      userId: string
      force?: boolean
      tenantId?: string
    },
  ): Promise<void> {
    try {
      const { userId, force = false, tenantId } = options

      // Validate tenant access
      if (tenantId) {
        const content = await prisma.content.findUnique({
          where: { id: contentId },
          select: { tenantId: true },
        })

        if (!content || content.tenantId !== tenantId) {
          throw ApiError.forbidden("Access denied to content in different tenant")
        }
      }

      // Check if this is the only version
      const versionCount = await prisma.contentVersion.count({
        where: { contentId },
      })

      if (!force && versionCount <= 1) {
        throw ApiError.badRequest("Cannot delete the only version of content")
      }

      // Delete the version with transaction
      await prisma.$transaction(async (tx) => {
        const deletedVersion = await tx.contentVersion.delete({
          where: {
            contentId_version: {
              contentId,
              version,
            },
          },
        })

        // Create audit log
        await tx.auditLog.create({
          data: {
            action: "content_version_deleted",
            resource: "content_version",
            resourceId: deletedVersion.id,
            entityType: "content_version",
            entityId: deletedVersion.id,
            userId,
            tenantId,
          },
        })
      })

      logger.info(`Deleted content version: ${version} for content ${contentId}`)
    } catch (error) {
      logger.error("Failed to delete content version:", error)
      throw error
    }
  }

  /**
   * Delete all versions of content
   */
  public async deleteAllVersions(
    contentId: string,
    options: {
      userId: string
      tenantId?: string
    },
  ): Promise<number> {
    try {
      const { userId, tenantId } = options

      // Validate tenant access
      if (tenantId) {
        const content = await prisma.content.findUnique({
          where: { id: contentId },
          select: { tenantId: true },
        })

        if (!content || content.tenantId !== tenantId) {
          throw ApiError.forbidden("Access denied to content in different tenant")
        }
      }

      // Delete all versions with transaction
      const deletedCount = await prisma.$transaction(async (tx) => {
        const result = await tx.contentVersion.deleteMany({
          where: { contentId },
        })

        // Create audit log
        await tx.auditLog.create({
          data: {
            action: "content_versions_bulk_deleted",
            resource: "content",
            resourceId: contentId,
            entityType: "content",
            entityId: contentId,
            userId,
            tenantId,
          },
        })

        return result.count
      })

      logger.info(`Deleted ${deletedCount} versions for content ${contentId}`)
      return deletedCount
    } catch (error) {
      logger.error("Failed to delete all content versions:", error)
      throw error
    }
  }

  /**
   * Archive old versions based on retention policy
   */
  public async archiveOldVersions(
    contentId: string,
    options: {
      keepCount?: number
      olderThan?: Date
      userId: string
      tenantId?: string
    },
  ): Promise<number> {
    try {
      const { keepCount = 10, olderThan, userId, tenantId } = options

      // Build where clause for versions to archive
      const where: any = {
        contentId,
        status: { not: VersionStatus.PUBLISHED },
      }

      if (olderThan) {
        where.createdAt = { lt: olderThan }
      }

      // Get versions to archive (excluding the most recent ones)
      const versionsToArchive = await prisma.contentVersion.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: keepCount,
        select: { id: true, version: true },
      })

      if (versionsToArchive.length === 0) {
        return 0
      }

      // Archive versions with transaction
      const archivedCount = await prisma.$transaction(async (tx) => {
        const result = await tx.contentVersion.updateMany({
          where: {
            id: { in: versionsToArchive.map((v) => v.id) },
          },
          data: {
            status: VersionStatus.ARCHIVED,
          },
        })

        // Create audit log
        await tx.auditLog.create({
          data: {
            action: "content_versions_archived",
            resource: "content",
            resourceId: contentId,
            entityType: "content",
            entityId: contentId,
            userId,
            tenantId,
          },
        })

        return result.count
      })

      logger.info(`Archived ${archivedCount} old versions for content ${contentId}`)
      return archivedCount
    } catch (error) {
      logger.error("Failed to archive old versions:", error)
      throw error
    }
  }

  /**
   * Get version analytics
   */
  public async getVersionAnalytics(
    contentId: string,
    options: {
      tenantId?: string
      dateFrom?: Date
      dateTo?: Date
    } = {},
  ): Promise<{
    totalVersions: number
    versionsByStatus: Record<VersionStatus, number>
    versionsByType: Record<VersionType, number>
    averageVersionsPerDay: number
    mostActiveUsers: Array<{
      userId: string
      userName: string
      versionCount: number
    }>
    versionTimeline: Array<{
      date: string
      count: number
      status: VersionStatus
    }>
    sizeGrowth: Array<{
      version: string
      size: number
      date: Date
    }>
  }> {
    try {
      const { tenantId, dateFrom, dateTo } = options

      // Validate tenant access
      if (tenantId) {
        const content = await prisma.content.findUnique({
          where: { id: contentId },
          select: { tenantId: true },
        })

        if (!content || content.tenantId !== tenantId) {
          throw ApiError.forbidden("Access denied to content in different tenant")
        }
      }

      const where: any = { contentId }
      if (dateFrom || dateTo) {
        where.createdAt = {}
        if (dateFrom) where.createdAt.gte = dateFrom
        if (dateTo) where.createdAt.lte = dateTo
      }

      // Get analytics data in parallel
      const [totalVersions, statusStats, typeStats, userStats, sizeData, dateRange] = await Promise.all([
        prisma.contentVersion.count({ where }),
        prisma.contentVersion.groupBy({
          by: ["status"],
          where,
          _count: { status: true },
        }),
        prisma.contentVersion.groupBy({
          by: ["type"],
          where,
          _count: { type: true },
        }),
        prisma.contentVersion.groupBy({
          by: ["createdById"],
          where,
          _count: { createdById: true },
          orderBy: { _count: { createdById: "desc" } },
          take: 10,
        }),
        prisma.contentVersion.findMany({
          where,
          select: {
            version: true,
            size: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.contentVersion.aggregate({
          where,
          _min: { createdAt: true },
          _max: { createdAt: true },
        }),
      ])

      // Calculate average versions per day
      const daysDiff =
        dateRange._max.createdAt && dateRange._min.createdAt
          ? Math.ceil((dateRange._max.createdAt.getTime() - dateRange._min.createdAt.getTime()) / (1000 * 60 * 60 * 24))
          : 1
      const averageVersionsPerDay = totalVersions / Math.max(daysDiff, 1)

      // Get user details for most active users
      const userIds = userStats.map((u) => u.createdById).filter((id): id is string => Boolean(id))
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      })

      const mostActiveUsers = userStats
        .filter(stat => stat.createdById && stat._count?.createdById)
        .map((stat) => {
          const user = users.find((u) => u.id === stat.createdById)
          return {
            userId: stat.createdById!,
            userName: user ? `${user.firstName} ${user.lastName}` : "Unknown User",
            versionCount: stat._count.createdById || 0,
          }
        })

      // Build stats objects
      const versionsByStatus = Object.values(VersionStatus).reduce(
        (acc, status) => {
          acc[status] = statusStats.find((s) => s.status === status)?._count.status || 0
          return acc
        },
        {} as Record<VersionStatus, number>,
      )

      const versionsByType = Object.values(VersionType).reduce(
        (acc, type) => {
          acc[type] = typeStats.find((t) => t.type === type)?._count.type || 0
          return acc
        },
        {} as Record<VersionType, number>,
      )

      return {
        totalVersions,
        versionsByStatus,
        versionsByType,
        averageVersionsPerDay: Number.parseFloat(averageVersionsPerDay.toFixed(2)),
        mostActiveUsers,
        versionTimeline: [], // Simplified for now
        sizeGrowth: sizeData.map((item) => ({
          version: item.version,
          size: item.size || 0,
          date: item.createdAt,
        })),
      }
    } catch (error) {
      logger.error("Failed to get version analytics:", error)
      throw error
    }
  }

  // Private helper methods

  private async generateVersionNumber(contentId: string, type: VersionType): Promise<string> {
    const latestVersion = await prisma.contentVersion.findFirst({
      where: { contentId },
      orderBy: { createdAt: "desc" },
      select: { version: true },
    })

    if (!latestVersion) {
      return "1.0.0"
    }

    const versionParts = latestVersion.version.split(".").map(Number)
    const [major = 1, minor = 0, patch = 0] = versionParts

    switch (type) {
      case VersionType.MAJOR:
        return `${major + 1}.0.0`
      case VersionType.MINOR:
        return `${major}.${minor + 1}.0`
      case VersionType.PATCH:
        return `${major}.${minor}.${patch + 1}`
      case VersionType.AUTO:
      default:
        return `${major}.${minor}.${patch + 1}`
    }
  }

  private async autoCleanupVersions(contentId: string, tx: any): Promise<void> {
    const versionCount = await tx.contentVersion.count({
      where: { contentId },
    })

    if (versionCount > this.MAX_VERSIONS_PER_CONTENT) {
      // Archive old draft versions
      const oldVersions = await tx.contentVersion.findMany({
        where: {
          contentId,
          status: VersionStatus.DRAFT,
        },
        orderBy: { createdAt: "asc" },
        take: versionCount - this.AUTO_CLEANUP_THRESHOLD,
        select: { id: true },
      })

      if (oldVersions.length > 0) {
        await tx.contentVersion.updateMany({
          where: {
            id: { in: oldVersions.map((v: any) => v.id) },
          },
          data: {
            status: VersionStatus.ARCHIVED,
          },
        })

        logger.info(`Auto-archived ${oldVersions.length} old versions for content ${contentId}`)
      }
    }
  }

  private performDeepDiff(objA: any, objB: any, includeMetadata: boolean, path: string[] = []): VersionDiff[] {
    const differences: VersionDiff[] = []

    // Get all unique keys from both objects
    const allKeys = new Set([...Object.keys(objA || {}), ...Object.keys(objB || {})])

    for (const key of allKeys) {
      const currentPath = [...path, key]
      const valueA = objA?.[key]
      const valueB = objB?.[key]

      // Skip metadata fields if not requested
      if (!includeMetadata && (key.startsWith("_") || key === "metadata")) {
        continue
      }

      if (valueA === undefined && valueB !== undefined) {
        differences.push({
          field: key,
          type: "added",
          newValue: valueB,
          path: currentPath,
        })
      } else if (valueA !== undefined && valueB === undefined) {
        differences.push({
          field: key,
          type: "removed",
          oldValue: valueA,
          path: currentPath,
        })
      } else if (typeof valueA === "object" && typeof valueB === "object" && valueA !== null && valueB !== null) {
        // Recursively diff nested objects
        differences.push(...this.performDeepDiff(valueA, valueB, includeMetadata, currentPath))
      } else if (JSON.stringify(valueA) !== JSON.stringify(valueB)) {
        differences.push({
          field: key,
          type: "modified",
          oldValue: valueA,
          newValue: valueB,
          path: currentPath,
        })
      }
    }

    return differences
  }

  private calculateSimilarity(objA: any, objB: any): number {
    const strA = JSON.stringify(objA || {})
    const strB = JSON.stringify(objB || {})

    if (strA === strB) return 100

    // Simple similarity calculation based on string length difference
    const maxLength = Math.max(strA.length, strB.length)
    const minLength = Math.min(strA.length, strB.length)

    if (maxLength === 0) return 100

    return Number.parseFloat(((minLength / maxLength) * 100).toFixed(2))
  }
}

// Export singleton instance
export const versioningService = new VersioningService()
