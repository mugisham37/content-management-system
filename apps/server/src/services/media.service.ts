import { MediaRepository } from "@cms-platform/database/repositories/media.repository"
import { 
  MediaFile, 
  MediaCreateInput, 
  MediaUpdateInput, 
  MediaSearchOptions, 
  MediaSearchResult, 
  MediaStats,
  MediaVariant,
  MediaUploadOptions,
  ImageProcessingOptions,
  MediaFolder
} from "@cms-platform/database/types/media.types"
import { PrismaClient } from "@prisma/client"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import { cacheService } from "./cache.service"
import { auditService } from "./audit.service"
import { FileService } from "./file.service"
import { EventEmitter } from "events"
import sharp from "sharp"
import path from "path"
import fs from "fs/promises"
import crypto from "crypto"

export interface MediaServiceOptions {
  enableCache?: boolean
  cacheTtl?: number
  enableAudit?: boolean
  enableImageProcessing?: boolean
  enableVideoProcessing?: boolean
  enableMetadataExtraction?: boolean
  enableThumbnails?: boolean
  enableWatermarks?: boolean
  maxFileSize?: number
  allowedMimeTypes?: string[]
  imageQuality?: number
  thumbnailSizes?: Array<{ name: string; width: number; height: number }>
  watermarkConfig?: {
    enabled: boolean
    imagePath?: string
    text?: string
    position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center"
    opacity: number
  }
}

export class MediaService extends EventEmitter {
  private mediaRepo: MediaRepository
  private fileService: FileService
  private options: MediaServiceOptions
  private prisma: PrismaClient

  constructor(options: MediaServiceOptions = {}) {
    super()
    this.prisma = new PrismaClient()
    this.mediaRepo = new MediaRepository(this.prisma)
    this.fileService = new FileService()
    this.options = {
      enableCache: true,
      cacheTtl: 1800, // 30 minutes
      enableAudit: true,
      enableImageProcessing: true,
      enableVideoProcessing: false,
      enableMetadataExtraction: true,
      enableThumbnails: true,
      enableWatermarks: false,
      maxFileSize: 50 * 1024 * 1024, // 50MB
      allowedMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/svg+xml",
        "video/mp4",
        "video/webm",
        "audio/mp3",
        "audio/wav",
        "application/pdf",
        "text/plain",
        "application/json",
      ],
      imageQuality: 85,
      thumbnailSizes: [
        { name: "small", width: 150, height: 150 },
        { name: "medium", width: 300, height: 300 },
        { name: "large", width: 600, height: 600 },
      ],
      watermarkConfig: {
        enabled: false,
        position: "bottom-right",
        opacity: 0.5,
      },
      ...options,
    }

    this.setMaxListeners(100)
    logger.info("Media service initialized", this.options)
  }

  /**
   * Get MediaType from MIME type
   */
  private getMediaTypeFromMimeType(mimeType: string): 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'OTHER' {
    if (mimeType.startsWith('image/')) return 'IMAGE'
    if (mimeType.startsWith('video/')) return 'VIDEO'
    if (mimeType.startsWith('audio/')) return 'AUDIO'
    if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text')) return 'DOCUMENT'
    return 'OTHER'
  }

  /**
   * Validate file before upload
   */
  private validateFile(file: Express.Multer.File): void {
    // Check file size
    if (file.size > this.options.maxFileSize!) {
      throw ApiError.badRequest(
        `File size ${file.size} exceeds maximum allowed size of ${this.options.maxFileSize} bytes`
      )
    }

    // Check MIME type
    if (!this.options.allowedMimeTypes!.includes(file.mimetype)) {
      throw ApiError.badRequest(`File type ${file.mimetype} is not allowed`)
    }

    // Check filename
    if (!file.originalname || file.originalname.trim().length === 0) {
      throw ApiError.badRequest("Filename is required")
    }
  }

  /**
   * Generate unique filename
   */
  private generateFilename(originalFilename: string): string {
    const ext = path.extname(originalFilename)
    const name = path.basename(originalFilename, ext)
    const timestamp = Date.now()
    const random = crypto.randomBytes(4).toString("hex")
    return `${name}-${timestamp}-${random}${ext}`
  }

  /**
   * Extract metadata from file
   */
  private async extractMetadata(filePath: string, mimeType: string): Promise<Record<string, any>> {
    const metadata: Record<string, any> = {}

    try {
      if (mimeType.startsWith("image/") && this.options.enableMetadataExtraction) {
        const imageMetadata = await sharp(filePath).metadata()
        metadata.width = imageMetadata.width
        metadata.height = imageMetadata.height
        metadata.format = imageMetadata.format
        metadata.channels = imageMetadata.channels
        metadata.density = imageMetadata.density
        metadata.hasAlpha = imageMetadata.hasAlpha
        metadata.orientation = imageMetadata.orientation

        // Extract EXIF data if available
        if (imageMetadata.exif) {
          metadata.exif = imageMetadata.exif
        }
      }

      // Get file stats
      const stats = await fs.stat(filePath)
      metadata.fileSize = stats.size
      metadata.createdAt = stats.birthtime
      metadata.modifiedAt = stats.mtime

      return metadata
    } catch (error) {
      logger.error("Failed to extract metadata:", error)
      return metadata
    }
  }

  /**
   * Generate thumbnails for images
   */
  private async generateThumbnails(
    filePath: string,
    filename: string,
    mimeType: string
  ): Promise<MediaVariant[]> {
    if (!mimeType.startsWith("image/") || !this.options.enableThumbnails) {
      return []
    }

    const thumbnails: MediaVariant[] = []
    const baseDir = path.dirname(filePath)
    const ext = path.extname(filename)
    const baseName = path.basename(filename, ext)

    try {
      for (const size of this.options.thumbnailSizes!) {
        const thumbnailFilename = `${baseName}_${size.name}${ext}`
        const thumbnailPath = path.join(baseDir, "thumbnails", thumbnailFilename)

        // Ensure thumbnails directory exists
        await fs.mkdir(path.dirname(thumbnailPath), { recursive: true })

        // Generate thumbnail
        const thumbnailBuffer = await sharp(filePath)
          .resize(size.width, size.height, {
            fit: "cover",
            position: "center",
          })
          .jpeg({ quality: this.options.imageQuality })
          .toBuffer()

        await fs.writeFile(thumbnailPath, thumbnailBuffer)

        // Get thumbnail metadata
        const thumbnailMetadata = await sharp(thumbnailPath).metadata()

        thumbnails.push({
          id: crypto.randomUUID(),
          name: size.name,
          url: `/uploads/thumbnails/${thumbnailFilename}`,
          width: thumbnailMetadata.width,
          height: thumbnailMetadata.height,
          size: thumbnailBuffer.length,
          format: "jpeg",
          quality: this.options.imageQuality,
          metadata: {
            originalSize: size,
          },
        })
      }

      return thumbnails
    } catch (error) {
      logger.error("Failed to generate thumbnails:", error)
      return []
    }
  }

  /**
   * Apply watermark to image
   */
  private async applyWatermark(filePath: string, outputPath: string): Promise<void> {
    if (!this.options.enableWatermarks || !this.options.watermarkConfig?.enabled) {
      return
    }

    try {
      const image = sharp(filePath)
      const { width, height } = await image.metadata()

      if (!width || !height) {
        throw new Error("Could not get image dimensions")
      }

      let watermarkBuffer: Buffer

      if (this.options.watermarkConfig.imagePath) {
        // Use image watermark
        watermarkBuffer = await fs.readFile(this.options.watermarkConfig.imagePath)
      } else if (this.options.watermarkConfig.text) {
        // Create text watermark
        const textSvg = `
          <svg width="200" height="50">
            <text x="10" y="30" font-family="Arial" font-size="16" fill="white" opacity="${this.options.watermarkConfig.opacity}">
              ${this.options.watermarkConfig.text}
            </text>
          </svg>
        `
        watermarkBuffer = Buffer.from(textSvg)
      } else {
        return
      }

      // Calculate watermark position
      let left = 0
      let top = 0

      switch (this.options.watermarkConfig.position) {
        case "top-left":
          left = 10
          top = 10
          break
        case "top-right":
          left = width - 210
          top = 10
          break
        case "bottom-left":
          left = 10
          top = height - 60
          break
        case "bottom-right":
          left = width - 210
          top = height - 60
          break
        case "center":
          left = Math.floor(width / 2) - 100
          top = Math.floor(height / 2) - 25
          break
      }

      await image
        .composite([
          {
            input: watermarkBuffer,
            left: Math.max(0, left),
            top: Math.max(0, top),
          },
        ])
        .toFile(outputPath)
    } catch (error) {
      logger.error("Failed to apply watermark:", error)
      throw error
    }
  }

  /**
   * Process image with various options
   */
  private async processImage(
    inputPath: string,
    outputPath: string,
    options: ImageProcessingOptions
  ): Promise<void> {
    try {
      let image = sharp(inputPath)

      // Apply transformations
      if (options.width || options.height) {
        image = image.resize(options.width, options.height, {
          fit: options.fit || "cover",
          position: options.position || "center",
          background: options.background || { r: 255, g: 255, b: 255, alpha: 1 },
        })
      }

      if (options.rotate) {
        image = image.rotate(options.rotate)
      }

      if (options.flip) {
        image = image.flip()
      }

      if (options.flop) {
        image = image.flop()
      }

      if (options.blur) {
        image = image.blur(options.blur)
      }

      if (options.sharpen) {
        image = image.sharpen()
      }

      if (options.grayscale) {
        image = image.grayscale()
      }

      if (options.normalize) {
        image = image.normalize()
      }

      // Apply format and quality
      switch (options.format) {
        case "jpeg":
          image = image.jpeg({ quality: options.quality || this.options.imageQuality })
          break
        case "png":
          image = image.png({ quality: options.quality || this.options.imageQuality })
          break
        case "webp":
          image = image.webp({ quality: options.quality || this.options.imageQuality })
          break
        case "avif":
          image = image.avif({ quality: options.quality || this.options.imageQuality })
          break
      }

      await image.toFile(outputPath)
    } catch (error) {
      logger.error("Failed to process image:", error)
      throw error
    }
  }

  /**
   * Upload media file
   */
  async uploadMedia(
    file: Express.Multer.File,
    options: MediaUploadOptions = {}
  ): Promise<MediaFile> {
    try {
      // Validate file
      this.validateFile(file)

      const {
        folder,
        alt,
        title,
        description,
        tags = [],
        generateThumbnails = true,
        generateVariants = false,
        applyWatermark = false,
        quality,
        tenantId,
        uploadedBy,
      } = options

      // Generate unique filename
      const filename = this.generateFilename(file.originalname)
      const uploadPath = folder ? path.join("uploads", folder, filename) : path.join("uploads", filename)

      // Process and save file using FileService
      const fileResult = await this.fileService.processUpload(file)

      // Extract metadata
      const metadata = await this.extractMetadata(fileResult.path, file.mimetype)

      // Generate thumbnails if enabled
      let thumbnails: MediaVariant[] = []
      if (generateThumbnails && file.mimetype.startsWith("image/")) {
        thumbnails = await this.generateThumbnails(fileResult.path, filename, file.mimetype)
      }

      // Apply watermark if enabled
      if (applyWatermark && file.mimetype.startsWith("image/")) {
        const watermarkedPath = fileResult.path.replace(/(\.[^.]+)$/, "_watermarked$1")
        await this.applyWatermark(fileResult.path, watermarkedPath)
        // Update file path to watermarked version
        fileResult.path = watermarkedPath
      }

      // Create media record
      const mediaFile = await this.mediaRepo.createMedia({
        filename,
        originalName: file.originalname,
        path: fileResult.path,
        url: fileResult.url,
        type: this.getMediaTypeFromMimeType(file.mimetype),
        mimeType: file.mimetype,
        size: file.size,
        width: metadata.width || null,
        height: metadata.height || null,
        alt,
        caption: description,
        tags,
        metadata,
        tenantId,
        uploadedById: uploadedBy || '',
      })

      // Clear cache
      if (this.options.enableCache) {
        await this.clearMediaCache(tenantId)
      }

      // Emit event
      this.emit("media:uploaded", {
        mediaFile,
        userId: uploadedBy,
        tenantId,
      })

      // Audit log
      if (this.options.enableAudit && uploadedBy) {
        await auditService.log({
          action: "media.upload",
          entityType: "Media",
          entityId: mediaFile.id,
          userId: uploadedBy,
          details: {
            filename: file.originalname,
            size: file.size,
            mimeType: file.mimetype,
            folder,
          },
        })
      }

      logger.info("Media uploaded", {
        id: mediaFile.id,
        filename: file.originalname,
        size: file.size,
        userId: uploadedBy,
        tenantId,
      })

      return mediaFile
    } catch (error) {
      logger.error("Failed to upload media:", error)
      throw error
    }
  }

  /**
   * Get media file by ID
   */
  async getMediaById(id: string, tenantId?: string): Promise<MediaFile | null> {
    try {
      const cacheKey = `media:${id}`

      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get<MediaFile>(cacheKey, tenantId)
        if (cached) {
          return cached
        }
      }

      const mediaFile = await this.mediaRepo.findMediaById(id)

      // Cache result
      if (this.options.enableCache && mediaFile) {
        await cacheService.set(cacheKey, mediaFile, {
          ttl: this.options.cacheTtl,
          namespace: tenantId,
        })
      }

      return mediaFile
    } catch (error) {
      logger.error("Failed to get media by ID:", error)
      throw error
    }
  }

  /**
   * Search media files
   */
  async searchMedia(options: MediaSearchOptions): Promise<{
    media: MediaFile[]
    total: number
    page: number
    limit: number
    totalPages: number
  }> {
    try {
      const cacheKey = `media:search:${JSON.stringify(options)}`

      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get(cacheKey, options.tenantId)
        if (cached) {
          return cached
        }
      }

      const result = await this.mediaRepo.searchMedia(options)

      // Cache result
      if (this.options.enableCache && result) {
        await cacheService.set(cacheKey, result, {
          ttl: this.options.cacheTtl! / 2, // Shorter TTL for search results
          namespace: options.tenantId,
        })
      }

      return result
    } catch (error) {
      logger.error("Failed to search media:", error)
      throw error
    }
  }

  /**
   * Update media metadata
   */
  async updateMedia(
    id: string,
    updates: {
      alt?: string
      title?: string
      description?: string
      tags?: string[]
      folder?: string
      metadata?: Record<string, any>
    },
    tenantId?: string,
    updatedBy?: string
  ): Promise<MediaFile> {
    try {
      const existingMedia = await this.mediaRepo.findMediaById(id)
      if (!existingMedia) {
        throw ApiError.notFound("Media file not found")
      }

      const updatedMedia = await this.mediaRepo.updateMedia(id, {
        ...updates,
      })

      // Clear cache
      if (this.options.enableCache) {
        await this.clearMediaCache(tenantId)
      }

      // Emit event
      this.emit("media:updated", {
        mediaFile: updatedMedia,
        previousMedia: existingMedia,
        userId: updatedBy,
        tenantId,
      })

      // Audit log
      if (this.options.enableAudit && updatedBy) {
        await auditService.log({
          action: "media.update",
          entityType: "Media",
          entityId: id,
          userId: updatedBy,
          details: {
            changes: Object.keys(updates),
          },
        })
      }

      logger.info("Media updated", {
        id,
        changes: Object.keys(updates),
        userId: updatedBy,
        tenantId,
      })

      return updatedMedia
    } catch (error) {
      logger.error("Failed to update media:", error)
      throw error
    }
  }

  /**
   * Clear media cache
   */
  private async clearMediaCache(tenantId?: string): Promise<void> {
    const patterns = ["media:*", "media:search:*"]
    for (const pattern of patterns) {
      await cacheService.deletePattern(pattern, tenantId)
    }
  }

  /**
   * Delete media file
   */
  async deleteMedia(id: string, tenantId?: string, deletedBy?: string): Promise<void> {
    try {
      const mediaFile = await this.mediaRepo.findMediaById(id)
      if (!mediaFile) {
        throw ApiError.notFound("Media file not found")
      }

      // Delete physical file
      try {
        await this.fileService.deleteFile(mediaFile.url)
      } catch (error) {
        logger.warn("Failed to delete physical file:", error)
      }

      // Delete from database
      await this.mediaRepo.delete(id)

      // Clear cache
      if (this.options.enableCache) {
        await this.clearMediaCache(tenantId)
      }

      // Emit event
      this.emit("media:deleted", {
        mediaFile,
        userId: deletedBy,
        tenantId,
      })

      // Audit log
      if (this.options.enableAudit && deletedBy) {
        await auditService.log({
          action: "media.delete",
          entityType: "Media",
          entityId: id,
          userId: deletedBy,
          details: {
            filename: mediaFile.filename,
            size: mediaFile.size,
          },
        })
      }

      logger.info("Media deleted", {
        id,
        filename: mediaFile.filename,
        userId: deletedBy,
        tenantId,
      })
    } catch (error) {
      logger.error("Failed to delete media:", error)
      throw error
    }
  }

  /**
   * Get media statistics
   */
  async getMediaStats(tenantId?: string): Promise<MediaStats> {
    try {
      const cacheKey = "media:stats"

      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get<MediaStats>(cacheKey, tenantId)
        if (cached) {
          return cached
        }
      }

      const stats = await this.mediaRepo.getStats(tenantId)

      // Cache result
      if (this.options.enableCache && stats) {
        await cacheService.set(cacheKey, stats, {
          ttl: this.options.cacheTtl! / 4, // Shorter TTL for stats
          namespace: tenantId,
        })
      }

      return stats
    } catch (error) {
      logger.error("Failed to get media stats:", error)
      throw error
    }
  }

  /**
   * Process image on demand
   */
  async processImageOnDemand(
    id: string,
    options: ImageProcessingOptions,
    tenantId?: string
  ): Promise<{ url: string; metadata: Record<string, any> }> {
    try {
      const mediaFile = await this.mediaRepo.findMediaById(id)
      if (!mediaFile) {
        throw ApiError.notFound("Media file not found")
      }

      if (!mediaFile.mimeType.startsWith("image/")) {
        throw ApiError.badRequest("File is not an image")
      }

      // Generate processed filename
      const ext = path.extname(mediaFile.filename)
      const baseName = path.basename(mediaFile.filename, ext)
      const optionsHash = crypto.createHash("md5").update(JSON.stringify(options)).digest("hex")
      const processedFilename = `${baseName}_${optionsHash}${ext}`
      const processedPath = path.join("uploads", "processed", processedFilename)

      // Check if processed version already exists
      try {
        await fs.access(processedPath)
        return {
          url: `/uploads/processed/${processedFilename}`,
          metadata: options,
        }
      } catch {
        // File doesn't exist, process it
      }

      // Ensure processed directory exists
      await fs.mkdir(path.dirname(processedPath), { recursive: true })

      // Process image
      await this.processImage(mediaFile.url, processedPath, options)

      // Get processed image metadata
      const processedMetadata = await this.extractMetadata(processedPath, mediaFile.mimeType)

      return {
        url: `/uploads/processed/${processedFilename}`,
        metadata: {
          ...options,
          ...processedMetadata,
        },
      }
    } catch (error) {
      logger.error("Failed to process image on demand:", error)
      throw error
    }
  }

  /**
   * Bulk upload media files
   */
  async bulkUploadMedia(
    files: Express.Multer.File[],
    options: MediaUploadOptions = {}
  ): Promise<{
    successful: MediaFile[]
    failed: Array<{ filename: string; error: string }>
  }> {
    try {
      const successful: MediaFile[] = []
      const failed: Array<{ filename: string; error: string }> = []

      for (const file of files) {
        try {
          const mediaFile = await this.uploadMedia(file, options)
          successful.push(mediaFile)
        } catch (error) {
          failed.push({
            filename: file.originalname,
            error: (error as Error).message,
          })
        }
      }

      logger.info("Bulk upload completed", {
        total: files.length,
        successful: successful.length,
        failed: failed.length,
        tenantId: options.tenantId,
      })

      return { successful, failed }
    } catch (error) {
      logger.error("Failed to bulk upload media:", error)
      throw error
    }
  }

  /**
   * Create media folder
   */
  async createFolder(
    data: {
      name: string
      path: string
      parentId?: string
      description?: string
      isPublic?: boolean
      permissions?: Record<string, string[]>
      metadata?: Record<string, any>
      tenantId?: string
    },
    createdBy?: string
  ): Promise<MediaFolder> {
    try {
      // Implementation would depend on your folder structure
      // This is a placeholder for the actual implementation
      const folder: MediaFolder = {
        id: crypto.randomUUID(),
        name: data.name,
        path: data.path,
        parentId: data.parentId,
        description: data.description,
        isPublic: data.isPublic || false,
        permissions: data.permissions,
        metadata: data.metadata,
        tenantId: data.tenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy,
      }

      logger.info("Media folder created", {
        id: folder.id,
        name: folder.name,
        path: folder.path,
        createdBy,
      })

      return folder
    } catch (error) {
      logger.error("Failed to create media folder:", error)
      throw error
    }
  }

  /**
   * Get media folders
   */
  async getFolders(tenantId?: string): Promise<MediaFolder[]> {
    try {
      // Implementation would depend on your folder structure
      // This is a placeholder for the actual implementation
      return []
    } catch (error) {
      logger.error("Failed to get media folders:", error)
      throw error
    }
  }

  /**
   * Generate signed URL for secure access
   */
  async generateSignedUrl(
    id: string,
    expiresIn = 3600,
    tenantId?: string
  ): Promise<{ url: string; expiresAt: Date }> {
    try {
      const mediaFile = await this.mediaRepo.findMediaById(id)
      if (!mediaFile) {
        throw ApiError.notFound("Media file not found")
      }

      // Generate signed URL (implementation would depend on your storage provider)
      const expiresAt = new Date(Date.now() + expiresIn * 1000)
      const signature = crypto
        .createHmac("sha256", "your-secret-key")
        .update(`${mediaFile.url}:${expiresAt.getTime()}`)
        .digest("hex")

      const signedUrl = `${mediaFile.url}?expires=${expiresAt.getTime()}&signature=${signature}`

      return {
        url: signedUrl,
        expiresAt,
      }
    } catch (error) {
      logger.error("Failed to generate signed URL:", error)
      throw error
    }
  }

  /**
   * Get media usage analytics
   */
  async getMediaAnalytics(
    options: {
      dateFrom?: Date
      dateTo?: Date
      tenantId?: string
    } = {}
  ): Promise<{
    totalViews: number
    totalDownloads: number
    popularFiles: Array<{
      id: string
      filename: string
      views: number
      downloads: number
    }>
    usageByType: Record<string, number>
    usageOverTime: Array<{
      date: string
      views: number
      downloads: number
    }>
  }> {
    try {
      // This would typically integrate with an analytics service
      // For now, return mock data
      return {
        totalViews: 0,
        totalDownloads: 0,
        popularFiles: [],
        usageByType: {},
        usageOverTime: [],
      }
    } catch (error) {
      logger.error("Failed to get media analytics:", error)
      throw error
    }
  }

  /**
   * Optimize media files
   */
  async optimizeMedia(
    id: string,
    options: {
      quality?: number
      format?: "jpeg" | "png" | "webp" | "avif"
      progressive?: boolean
      stripMetadata?: boolean
    } = {},
    tenantId?: string
  ): Promise<MediaFile> {
    try {
      const mediaFile = await this.mediaRepo.findMediaById(id)
      if (!mediaFile) {
        throw ApiError.notFound("Media file not found")
      }

      if (!mediaFile.mimeType.startsWith("image/")) {
        throw ApiError.badRequest("File is not an image")
      }

      const optimizedPath = mediaFile.url.replace(/(\.[^.]+)$/, "_optimized$1")

      // Optimize image
      let image = sharp(mediaFile.url)

      if (options.stripMetadata) {
        image = image.withMetadata({})
      }

      switch (options.format) {
        case "jpeg":
          image = image.jpeg({
            quality: options.quality || 85,
            progressive: options.progressive || false,
          })
          break
        case "png":
          image = image.png({
            quality: options.quality || 85,
            progressive: options.progressive || false,
          })
          break
        case "webp":
          image = image.webp({
            quality: options.quality || 85,
          })
          break
        case "avif":
          image = image.avif({
            quality: options.quality || 85,
          })
          break
      }

      await image.toFile(optimizedPath)

      // Update media record with optimized version
      const optimizedMetadata = await this.extractMetadata(optimizedPath, mediaFile.mimeType)
      const updatedMedia = await this.mediaRepo.updateMedia(id, {
        url: optimizedPath,
        metadata: {
          ...mediaFile.metadata,
          optimized: true,
          optimizationOptions: options,
          originalSize: mediaFile.size,
        },
      })

      logger.info("Media optimized", {
        id,
        originalSize: mediaFile.size,
        optimizedSize: optimizedMetadata.fileSize,
        savings: mediaFile.size - optimizedMetadata.fileSize,
      })

      return updatedMedia
    } catch (error) {
      logger.error("Failed to optimize media:", error)
      throw error
    }
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{
    status: "healthy" | "degraded" | "unhealthy"
    timestamp: string
    features: Record<string, boolean>
    storage: {
      available: boolean
      usage: number
    }
  }> {
    try {
      let healthStatus: "healthy" | "degraded" | "unhealthy" = "healthy"
      let storageAvailable = true

      // Test storage availability
      try {
        await fs.access("uploads")
      } catch {
        storageAvailable = false
        healthStatus = "degraded"
      }
      
      const status = {
        status: healthStatus,
        timestamp: new Date().toISOString(),
        features: {
          imageProcessing: this.options.enableImageProcessing!,
          thumbnails: this.options.enableThumbnails!,
          watermarks: this.options.enableWatermarks!,
          cache: this.options.enableCache!,
          audit: this.options.enableAudit!,
        },
        storage: {
          available: storageAvailable,
          usage: 0,
        },
      }

      return status
    } catch (error) {
      logger.error("Failed to get health status:", error)
      return {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        features: {},
        storage: {
          available: false,
          usage: 0,
        },
      }
    }
  }
}

// Export singleton instance
export const mediaService = new MediaService()
