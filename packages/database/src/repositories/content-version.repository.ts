import { BaseRepository } from "./base.repository"
import { ContentVersion, ContentVersionStatus, Prisma, PrismaClient } from "@prisma/client"
import { DatabaseError } from "../utils/errors"
import {
  ContentVersionWithRelations,
  DifferenceItem,
  ModifiedDifferenceItem,
  VersionDifferences,
  CreateVersionInput,
  VersionStats,
  VersionComparisonResult,
  ContentVersionData
} from "../types/content-version.types"
import {
  ensureString,
  ensureStringOrUndefined,
  ensureId,
  ensureNumber,
  ensureInteger,
  ensureJsonObject,
  safeGetProperty,
  safeGetStringProperty
} from "../utils/type-guards"

type ContentVersionCreateInput = Prisma.ContentVersionCreateInput
type ContentVersionUpdateInput = Prisma.ContentVersionUpdateInput

export class ContentVersionRepository extends BaseRepository<ContentVersion, ContentVersionCreateInput, ContentVersionUpdateInput> {
  protected modelName = "ContentVersion"
  protected model: PrismaClient["contentVersion"]

  constructor(prisma: PrismaClient) {
    super(prisma)
    this.model = prisma.contentVersion
  }

  /**
   * Find versions by content ID
   */
  async findByContentId(contentId: string): Promise<ContentVersion[]> {
    try {
      return await this.prisma.contentVersion.findMany({
        where: { contentId },
        orderBy: { version: "desc" },
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          publishedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      })
    } catch (error: unknown) {
      throw new DatabaseError(`Failed to find versions for content ${contentId}`, undefined, error)
    }
  }

  /**
   * Find a specific version by content ID and version number
   */
  async findByContentIdAndVersion(contentId: string, version: number): Promise<ContentVersion | null> {
    try {
      return await this.prisma.contentVersion.findUnique({
        where: {
          contentId_version: {
            contentId,
            version,
          },
        },
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          publishedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      })
    } catch (error: unknown) {
      throw new DatabaseError(`Failed to find version ${version} for content ${contentId}`, undefined, error)
    }
  }

  /**
   * Find a specific version by content ID and version number or throw error
   */
  async findByContentIdAndVersionOrThrow(contentId: string, version: number): Promise<ContentVersion> {
    const contentVersion = await this.findByContentIdAndVersion(contentId, version)
    if (!contentVersion) {
      throw new DatabaseError(`Content version not found: content ${contentId}, version ${version}`)
    }
    return contentVersion
  }

  /**
   * Get the latest version for a content
   */
  async findLatestByContentId(contentId: string): Promise<ContentVersion | null> {
    try {
      return await this.prisma.contentVersion.findFirst({
        where: { contentId },
        orderBy: { version: "desc" },
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          publishedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      })
    } catch (error: unknown) {
      throw new DatabaseError(`Failed to find latest version for content ${contentId}`, undefined, error)
    }
  }

  /**
   * Get the next version number for a content
   */
  async getNextVersionNumber(contentId: string): Promise<number> {
    try {
      const latestVersion = await this.prisma.contentVersion.findFirst({
        where: { contentId },
        orderBy: { version: "desc" },
        select: { version: true },
      })
      return (latestVersion?.version || 0) + 1
    } catch (error: unknown) {
      throw new DatabaseError(`Failed to get next version number for content ${contentId}`, undefined, error)
    }
  }

  /**
   * Create a new version
   */
  async createVersion(data: {
    contentId: string
    data: any
    status?: ContentVersionStatus
    notes?: string
    createdById?: string
  }): Promise<ContentVersion> {
    try {
      const version = await this.getNextVersionNumber(data.contentId)
      
      return await this.prisma.contentVersion.create({
        data: {
          contentId: data.contentId,
          version,
          data: data.data,
          status: data.status || ContentVersionStatus.DRAFT,
          notes: data.notes,
          createdById: data.createdById,
        },
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      })
    } catch (error: unknown) {
      throw new DatabaseError("Failed to create content version", undefined, error)
    }
  }

  /**
   * Publish a version
   */
  async publishVersion(
    contentId: string,
    version: number,
    publishedById?: string
  ): Promise<ContentVersion> {
    try {
      return await this.prisma.contentVersion.update({
        where: {
          contentId_version: {
            contentId,
            version,
          },
        },
        data: {
          status: ContentVersionStatus.PUBLISHED,
          publishedAt: new Date(),
          publishedById: ensureStringOrUndefined(publishedById),
        },
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          publishedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      })
    } catch (error: unknown) {
      throw new DatabaseError(`Failed to publish version ${version} for content ${contentId}`, undefined, error)
    }
  }

  /**
   * Archive a version
   */
  async archiveVersion(contentId: string, version: number): Promise<ContentVersion> {
    try {
      return await this.prisma.contentVersion.update({
        where: {
          contentId_version: {
            contentId,
            version,
          },
        },
        data: {
          status: ContentVersionStatus.ARCHIVED,
        },
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          publishedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      })
    } catch (error: unknown) {
      throw new DatabaseError(`Failed to archive version ${version} for content ${contentId}`, undefined, error)
    }
  }

  /**
   * Find published versions
   */
  async findPublishedVersions(contentId?: string): Promise<ContentVersion[]> {
    try {
      const where: Prisma.ContentVersionWhereInput = {
        status: ContentVersionStatus.PUBLISHED,
      }
      
      if (contentId) {
        where.contentId = contentId
      }

      return await this.prisma.contentVersion.findMany({
        where,
        orderBy: [{ contentId: "asc" }, { version: "desc" }],
        include: {
          content: {
            select: {
              id: true,
              slug: true,
              contentType: {
                select: {
                  id: true,
                  name: true,
                  displayName: true,
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          publishedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      })
    } catch (error: unknown) {
      throw new DatabaseError("Failed to find published versions", undefined, error)
    }
  }

  /**
   * Find draft versions
   */
  async findDraftVersions(contentId?: string): Promise<ContentVersion[]> {
    try {
      const where: Prisma.ContentVersionWhereInput = {
        status: ContentVersionStatus.DRAFT,
      }
      
      if (contentId) {
        where.contentId = contentId
      }

      return await this.prisma.contentVersion.findMany({
        where,
        orderBy: [{ contentId: "asc" }, { version: "desc" }],
        include: {
          content: {
            select: {
              id: true,
              slug: true,
              contentType: {
                select: {
                  id: true,
                  name: true,
                  displayName: true,
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      })
    } catch (error: unknown) {
      throw new DatabaseError("Failed to find draft versions", undefined, error)
    }
  }

  /**
   * Find archived versions
   */
  async findArchivedVersions(contentId?: string): Promise<ContentVersion[]> {
    try {
      const where: Prisma.ContentVersionWhereInput = {
        status: ContentVersionStatus.ARCHIVED,
      }
      
      if (contentId) {
        where.contentId = contentId
      }

      return await this.prisma.contentVersion.findMany({
        where,
        orderBy: [{ contentId: "asc" }, { version: "desc" }],
        include: {
          content: {
            select: {
              id: true,
              slug: true,
              contentType: {
                select: {
                  id: true,
                  name: true,
                  displayName: true,
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      })
    } catch (error: unknown) {
      throw new DatabaseError("Failed to find archived versions", undefined, error)
    }
  }

  /**
   * Delete old versions (keep only the latest N versions)
   */
  async cleanupOldVersions(contentId: string, keepCount: number = 50): Promise<number> {
    try {
      // Get versions to delete (all except the latest keepCount)
      const versionsToDelete = await this.prisma.contentVersion.findMany({
        where: { contentId },
        orderBy: { version: "desc" },
        skip: keepCount,
        select: { id: true },
      })

      if (versionsToDelete.length === 0) {
        return 0
      }

      const result = await this.prisma.contentVersion.deleteMany({
        where: {
          id: {
            in: versionsToDelete.map(v => v.id),
          },
        },
      })

      return result.count
    } catch (error: unknown) {
      throw new DatabaseError(`Failed to cleanup old versions for content ${contentId}`, undefined, error)
    }
  }

  /**
   * Compare two versions
   */
  async compareVersions(
    contentId: string,
    version1: number,
    version2: number
  ): Promise<VersionComparisonResult> {
    try {
      const [v1, v2] = await Promise.all([
        this.findByContentIdAndVersionOrThrow(contentId, version1),
        this.findByContentIdAndVersionOrThrow(contentId, version2),
      ])

      // Initialize properly typed differences object
      const differences: VersionDifferences = {
        added: [] as DifferenceItem[],
        removed: [] as DifferenceItem[],
        modified: [] as ModifiedDifferenceItem[],
      }

      // Convert data to safe objects for comparison
      const data1 = ensureJsonObject(v1.data)
      const data2 = ensureJsonObject(v2.data)

      // Get all keys from both versions
      const keys1 = Object.keys(data1)
      const keys2 = Object.keys(data2)
      const allKeys = [...new Set([...keys1, ...keys2])]

      for (const key of allKeys) {
        const val1 = safeGetProperty(data1, key)
        const val2 = safeGetProperty(data2, key)

        if (val1 === undefined && val2 !== undefined) {
          differences.added.push({ key: ensureString(key), value: val2 })
        } else if (val1 !== undefined && val2 === undefined) {
          differences.removed.push({ key: ensureString(key), value: val1 })
        } else if (JSON.stringify(val1) !== JSON.stringify(val2)) {
          differences.modified.push({ 
            key: ensureString(key), 
            oldValue: val1, 
            newValue: val2 
          })
        }
      }

      return {
        version1: v1 as ContentVersionWithRelations,
        version2: v2 as ContentVersionWithRelations,
        differences,
      }
    } catch (error: unknown) {
      throw new DatabaseError(`Failed to compare versions ${version1} and ${version2} for content ${ensureString(contentId)}`, undefined, error)
    }
  }

  /**
   * Find versions by creator
   */
  async findByCreator(userId: string): Promise<ContentVersion[]> {
    try {
      return await this.prisma.contentVersion.findMany({
        where: { createdById: userId },
        orderBy: { createdAt: "desc" },
        include: {
          content: {
            select: {
              id: true,
              slug: true,
              contentType: {
                select: {
                  id: true,
                  name: true,
                  displayName: true,
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      })
    } catch (error: unknown) {
      throw new DatabaseError(`Failed to find versions created by user ${userId}`, undefined, error)
    }
  }

  /**
   * Find versions created within a date range
   */
  async findByCreationDate(startDate: Date, endDate: Date): Promise<ContentVersion[]> {
    try {
      return await this.prisma.contentVersion.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: { createdAt: "desc" },
        include: {
          content: {
            select: {
              id: true,
              slug: true,
              contentType: {
                select: {
                  id: true,
                  name: true,
                  displayName: true,
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      })
    } catch (error: unknown) {
      throw new DatabaseError("Failed to find versions by creation date", undefined, error)
    }
  }

  /**
   * Get version statistics for a content
   */
  async getVersionStats(contentId: string): Promise<{
    totalVersions: number
    draftVersions: number
    publishedVersions: number
    archivedVersions: number
    latestVersion: number
  }> {
    try {
      const [total, drafts, published, archived, latest] = await Promise.all([
        this.prisma.contentVersion.count({ where: { contentId } }),
        this.prisma.contentVersion.count({ 
          where: { contentId, status: ContentVersionStatus.DRAFT } 
        }),
        this.prisma.contentVersion.count({ 
          where: { contentId, status: ContentVersionStatus.PUBLISHED } 
        }),
        this.prisma.contentVersion.count({ 
          where: { contentId, status: ContentVersionStatus.ARCHIVED } 
        }),
        this.prisma.contentVersion.findFirst({
          where: { contentId },
          orderBy: { version: "desc" },
          select: { version: true },
        }),
      ])

      return {
        totalVersions: total,
        draftVersions: drafts,
        publishedVersions: published,
        archivedVersions: archived,
        latestVersion: latest?.version || 0,
      }
    } catch (error: unknown) {
      throw new DatabaseError(`Failed to get version stats for content ${contentId}`, undefined, error)
    }
  }

  /**
   * Find version by content ID and version number (alias for findByContentIdAndVersion)
   */
  async findByVersion(contentId: string, version: number): Promise<ContentVersion | null> {
    return this.findByContentIdAndVersion(contentId, version)
  }
}
