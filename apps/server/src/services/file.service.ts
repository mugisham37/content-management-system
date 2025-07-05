import multer from "multer"
import path from "path"
import fs from "fs/promises"
import { v4 as uuidv4 } from "uuid"
import sharp from "sharp"
import ffmpeg from "fluent-ffmpeg"
import { createHash } from "crypto"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import { cacheService } from "./cache.service"
import { auditService } from "./audit.service"
import type { Express } from "express"

export interface FileUploadResult {
  id: string
  filename: string
  originalName: string
  path: string
  url: string
  size: number
  mimeType: string
  hash: string
  metadata?: FileMetadata
  thumbnails?: FileThumbnail[]
  variants?: FileVariant[]
  uploadedAt: Date
  uploadedBy?: string
  tenantId?: string
  folder?: string
  tags?: string[]
  alt?: string
  title?: string
  description?: string
}

export interface FileMetadata {
  width?: number
  height?: number
  duration?: number
  format?: string
  bitrate?: number
  fps?: number
  channels?: number
  sampleRate?: number
  colorSpace?: string
  orientation?: number
  hasAlpha?: boolean
  density?: number
  pages?: number
  compression?: string
  quality?: number
  exif?: Record<string, any>
  iptc?: Record<string, any>
  xmp?: Record<string, any>
}

export interface FileThumbnail {
  size: string
  width: number
  height: number
  path: string
  url: string
  format: string
}

export interface FileVariant {
  name: string
  path: string
  url: string
  size: number
  format: string
  quality?: number
  width?: number
  height?: number
  bitrate?: number
}

export interface FileServiceOptions {
  uploadDir: string
  publicUrl: string
  maxFileSize: number
  allowedMimeTypes: string[]
  enableThumbnails: boolean
  enableVariants: boolean
  enableMetadataExtraction: boolean
  enableVirusScan: boolean
  enableCompression: boolean
  enableWatermark: boolean
  enableCdn: boolean
  cdnUrl?: string
  thumbnailSizes: Array<{ name: string; width: number; height: number }>
  imageVariants: Array<{ name: string; width?: number; height?: number; quality?: number; format?: string }>
  videoVariants: Array<{ name: string; width?: number; height?: number; bitrate?: string; format?: string }>
  watermarkConfig?: {
    imagePath: string
    position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center"
    opacity: number
    margin: number
  }
}

export interface FileStats {
  totalFiles: number
  totalSize: number
  filesByType: Record<string, number>
  sizeByType: Record<string, number>
  recentUploads: Array<{
    id: string
    filename: string
    size: number
    uploadedAt: Date
    uploadedBy?: string
  }>
  largestFiles: Array<{
    id: string
    filename: string
    size: number
    type: string
  }>
  storageUsage: {
    used: number
    available: number
    percentage: number
  }
}

export interface FileSearchOptions {
  query?: string
  mimeType?: string
  minSize?: number
  maxSize?: number
  uploadedBy?: string
  dateFrom?: Date
  dateTo?: Date
  tags?: string[]
  folder?: string
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: "asc" | "desc"
}

export interface FileProcessingJob {
  id: string
  fileId: string
  type: "thumbnail" | "variant" | "compression" | "watermark" | "virus-scan"
  status: "pending" | "processing" | "completed" | "failed"
  progress: number
  error?: string
  result?: any
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
}

export class FileService {
  private options: FileServiceOptions
  private processingQueue: Map<string, FileProcessingJob> = new Map()
  private isProcessingQueue = false
  private fileDatabase: Map<string, FileUploadResult> = new Map() // In-memory storage for demo
  private hashIndex: Map<string, string> = new Map() // hash -> fileId mapping

  constructor(options: Partial<FileServiceOptions> = {}) {
    this.options = {
      uploadDir: "./uploads",
      publicUrl: "/uploads",
      maxFileSize: 100 * 1024 * 1024, // 100MB
      allowedMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/svg+xml",
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "audio/mp3",
        "audio/wav",
        "audio/ogg",
        "application/pdf",
        "text/plain",
        "application/json",
        "application/zip",
        "application/x-zip-compressed",
      ],
      enableThumbnails: true,
      enableVariants: true,
      enableMetadataExtraction: true,
      enableVirusScan: false,
      enableCompression: true,
      enableWatermark: false,
      enableCdn: false,
      thumbnailSizes: [
        { name: "small", width: 150, height: 150 },
        { name: "medium", width: 300, height: 300 },
        { name: "large", width: 600, height: 600 },
      ],
      imageVariants: [
        { name: "webp", format: "webp", quality: 80 },
        { name: "compressed", quality: 70 },
        { name: "mobile", width: 800, quality: 75 },
      ],
      videoVariants: [
        { name: "720p", width: 1280, height: 720, bitrate: "2000k", format: "mp4" },
        { name: "480p", width: 854, height: 480, bitrate: "1000k", format: "mp4" },
        { name: "360p", width: 640, height: 360, bitrate: "500k", format: "mp4" },
      ],
      ...options,
    }

    this.ensureUploadDir()
    this.startProcessingQueue()
    this.startCleanupScheduler()

    logger.info("File service initialized", {
      uploadDir: this.options.uploadDir,
      maxFileSize: this.options.maxFileSize,
      enableThumbnails: this.options.enableThumbnails,
      enableVariants: this.options.enableVariants,
    })
  }

  /**
   * Ensure upload directory exists
   */
  private async ensureUploadDir(): Promise<void> {
    try {
      await fs.access(this.options.uploadDir)
    } catch {
      await fs.mkdir(this.options.uploadDir, { recursive: true })
    }

    // Create subdirectories
    const subdirs = ["images", "videos", "audio", "documents", "thumbnails", "variants", "temp"]
    for (const subdir of subdirs) {
      const dirPath = path.join(this.options.uploadDir, subdir)
      try {
        await fs.access(dirPath)
      } catch {
        await fs.mkdir(dirPath, { recursive: true })
      }
    }
  }

  /**
   * Get multer configuration
   */
  getMulterConfig(): multer.Multer {
    const storage = multer.diskStorage({
      destination: async (req, file, cb) => {
        const uploadPath = path.join(this.options.uploadDir, this.getUploadSubdir(file.mimetype))
        try {
          await fs.mkdir(uploadPath, { recursive: true })
          cb(null, uploadPath)
        } catch (error) {
          cb(error as Error, "")
        }
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname)
        const filename = `${uuidv4()}${ext}`
        cb(null, filename)
      },
    })

    return multer({
      storage,
      limits: {
        fileSize: this.options.maxFileSize,
        files: 10,
      },
      fileFilter: (req, file, cb) => {
        if (this.options.allowedMimeTypes.includes(file.mimetype)) {
          cb(null, true)
        } else {
          cb(new ApiError(400, `File type ${file.mimetype} not allowed`))
        }
      },
    })
  }

  /**
   * Process uploaded file
   */
  async processUpload(
    file: Express.Multer.File,
    options: {
      userId?: string
      tenantId?: string
      folder?: string
      tags?: string[]
      alt?: string
      title?: string
      description?: string
      generateThumbnails?: boolean
      generateVariants?: boolean
      enableCompression?: boolean
      enableWatermark?: boolean
    } = {}
  ): Promise<FileUploadResult> {
    try {
      const {
        userId,
        tenantId,
        folder,
        tags = [],
        alt,
        title,
        description,
        generateThumbnails = this.options.enableThumbnails,
        generateVariants = this.options.enableVariants,
        enableCompression = this.options.enableCompression,
        enableWatermark = this.options.enableWatermark,
      } = options

      // Calculate file hash
      const hash = await this.calculateFileHash(file.path)

      // Check for duplicate files
      const existingFile = await this.findFileByHash(hash, tenantId)
      if (existingFile) {
        // Delete uploaded file since we have a duplicate
        await fs.unlink(file.path)
        logger.info("Duplicate file detected, returning existing file", {
          hash,
          existingFileId: existingFile.id,
        })
        return existingFile
      }

      // Extract metadata
      let metadata: FileMetadata | undefined
      if (this.options.enableMetadataExtraction) {
        metadata = await this.extractMetadata(file.path, file.mimetype)
      }

      // Create file result
      const result: FileUploadResult = {
        id: uuidv4(),
        filename: file.filename,
        originalName: file.originalname,
        path: file.path,
        url: this.getFileUrl(file.path),
        size: file.size,
        mimeType: file.mimetype,
        hash,
        metadata,
        thumbnails: [],
        variants: [],
        uploadedAt: new Date(),
        uploadedBy: userId,
        tenantId,
        folder,
        tags,
        alt,
        title,
        description,
      }

      // Store in database
      this.fileDatabase.set(result.id, result)
      this.hashIndex.set(hash, result.id)

      // Queue processing jobs
      if (generateThumbnails && this.isImageFile(file.mimetype)) {
        await this.queueThumbnailGeneration(result)
      }

      if (generateVariants) {
        if (this.isImageFile(file.mimetype)) {
          await this.queueImageVariantGeneration(result)
        } else if (this.isVideoFile(file.mimetype)) {
          await this.queueVideoVariantGeneration(result)
        }
      }

      if (enableCompression) {
        await this.queueCompressionJob(result)
      }

      if (enableWatermark && this.isImageFile(file.mimetype)) {
        await this.queueWatermarkJob(result)
      }

      if (this.options.enableVirusScan) {
        await this.queueVirusScanJob(result)
      }

      // Cache the result
      await cacheService.set(`file:${result.id}`, result, 3600)

      // Audit log
      await auditService.log({
        action: "file.upload",
        entityType: "File",
        entityId: result.id,
        userId,
        details: {
          filename: result.originalName,
          size: result.size,
          mimeType: result.mimeType,
          folder,
          tags,
        },
      })

      logger.info("File uploaded successfully", {
        id: result.id,
        filename: result.originalName,
        size: result.size,
        mimeType: result.mimeType,
        userId,
        tenantId,
      })

      return result
    } catch (error) {
      logger.error("File processing failed", { error: (error as Error).message })
      throw ApiError.internal("File processing failed")
    }
  }

  /**
   * Calculate file hash
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    try {
      const fileBuffer = await fs.readFile(filePath)
      return createHash("sha256").update(fileBuffer).digest("hex")
    } catch (error) {
      logger.error("Failed to calculate file hash:", error)
      throw error
    }
  }

  /**
   * Find file by hash
   */
  private async findFileByHash(hash: string, tenantId?: string): Promise<FileUploadResult | null> {
    const fileId = this.hashIndex.get(hash)
    if (!fileId) return null

    const file = this.fileDatabase.get(fileId)
    if (!file) return null

    // Check tenant isolation
    if (tenantId && file.tenantId !== tenantId) return null

    return file
  }

  /**
   * Extract file metadata
   */
  private async extractMetadata(filePath: string, mimeType: string): Promise<FileMetadata> {
    try {
      const metadata: FileMetadata = {}

      if (this.isImageFile(mimeType)) {
        const imageMetadata = await sharp(filePath).metadata()
        metadata.width = imageMetadata.width
        metadata.height = imageMetadata.height
        metadata.format = imageMetadata.format
        metadata.colorSpace = imageMetadata.space
        metadata.orientation = imageMetadata.orientation
        metadata.hasAlpha = imageMetadata.hasAlpha
        metadata.density = imageMetadata.density
        metadata.pages = imageMetadata.pages
        metadata.compression = imageMetadata.compression
        metadata.exif = imageMetadata.exif
        metadata.iptc = imageMetadata.iptc
        metadata.xmp = imageMetadata.xmp
      } else if (this.isVideoFile(mimeType)) {
        // Use ffprobe to extract video metadata
        metadata.duration = await this.getVideoDuration(filePath)
        const videoInfo = await this.getVideoInfo(filePath)
        metadata.width = videoInfo.width
        metadata.height = videoInfo.height
        metadata.bitrate = videoInfo.bitrate
        metadata.fps = videoInfo.fps
        metadata.format = videoInfo.format
      } else if (this.isAudioFile(mimeType)) {
        // Extract audio metadata
        const audioInfo = await this.getAudioInfo(filePath)
        metadata.duration = audioInfo.duration
        metadata.bitrate = audioInfo.bitrate
        metadata.sampleRate = audioInfo.sampleRate
        metadata.channels = audioInfo.channels
        metadata.format = audioInfo.format
      }

      return metadata
    } catch (error) {
      logger.error("Failed to extract metadata:", error)
      return {}
    }
  }

  /**
   * Get video duration using ffprobe
   */
  private async getVideoDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err)
        } else {
          resolve(metadata.format.duration || 0)
        }
      })
    })
  }

  /**
   * Get video information
   */
  private async getVideoInfo(filePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err)
        } else {
          const videoStream = metadata.streams.find(s => s.codec_type === "video")
          resolve({
            width: videoStream?.width || 0,
            height: videoStream?.height || 0,
            bitrate: parseInt(videoStream?.bit_rate || "0"),
            fps: this.parseFrameRate(videoStream?.r_frame_rate || "0"),
            format: metadata.format.format_name,
          })
        }
      })
    })
  }

  /**
   * Parse frame rate string
   */
  private parseFrameRate(frameRate: string): number {
    try {
      if (frameRate.includes('/')) {
        const [num, den] = frameRate.split('/').map(Number)
        return den > 0 ? num / den : 0
      }
      return parseFloat(frameRate) || 0
    } catch {
      return 0
    }
  }

  /**
   * Get audio information
   */
  private async getAudioInfo(filePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err)
        } else {
          const audioStream = metadata.streams.find(s => s.codec_type === "audio")
          resolve({
            duration: metadata.format.duration || 0,
            bitrate: parseInt(audioStream?.bit_rate || "0"),
            sampleRate: parseInt(audioStream?.sample_rate || "0"),
            channels: audioStream?.channels || 0,
            format: metadata.format.format_name,
          })
        }
      })
    })
  }

  /**
   * Queue thumbnail generation
   */
  private async queueThumbnailGeneration(file: FileUploadResult): Promise<void> {
    const job: FileProcessingJob = {
      id: uuidv4(),
      fileId: file.id,
      type: "thumbnail",
      status: "pending",
      progress: 0,
      createdAt: new Date(),
    }
    this.processingQueue.set(job.id, job)
    logger.debug("Queued thumbnail generation", { fileId: file.id, jobId: job.id })
  }

  /**
   * Queue image variant generation
   */
  private async queueImageVariantGeneration(file: FileUploadResult): Promise<void> {
    const job: FileProcessingJob = {
      id: uuidv4(),
      fileId: file.id,
      type: "variant",
      status: "pending",
      progress: 0,
      createdAt: new Date(),
    }
    this.processingQueue.set(job.id, job)
    logger.debug("Queued image variant generation", { fileId: file.id, jobId: job.id })
  }

  /**
   * Queue video variant generation
   */
  private async queueVideoVariantGeneration(file: FileUploadResult): Promise<void> {
    const job: FileProcessingJob = {
      id: uuidv4(),
      fileId: file.id,
      type: "variant",
      status: "pending",
      progress: 0,
      createdAt: new Date(),
    }
    this.processingQueue.set(job.id, job)
    logger.debug("Queued video variant generation", { fileId: file.id, jobId: job.id })
  }

  /**
   * Queue compression job
   */
  private async queueCompressionJob(file: FileUploadResult): Promise<void> {
    const job: FileProcessingJob = {
      id: uuidv4(),
      fileId: file.id,
      type: "compression",
      status: "pending",
      progress: 0,
      createdAt: new Date(),
    }
    this.processingQueue.set(job.id, job)
    logger.debug("Queued compression job", { fileId: file.id, jobId: job.id })
  }

  /**
   * Queue watermark job
   */
  private async queueWatermarkJob(file: FileUploadResult): Promise<void> {
    const job: FileProcessingJob = {
      id: uuidv4(),
      fileId: file.id,
      type: "watermark",
      status: "pending",
      progress: 0,
      createdAt: new Date(),
    }
    this.processingQueue.set(job.id, job)
    logger.debug("Queued watermark job", { fileId: file.id, jobId: job.id })
  }

  /**
   * Queue virus scan job
   */
  private async queueVirusScanJob(file: FileUploadResult): Promise<void> {
    const job: FileProcessingJob = {
      id: uuidv4(),
      fileId: file.id,
      type: "virus-scan",
      status: "pending",
      progress: 0,
      createdAt: new Date(),
    }
    this.processingQueue.set(job.id, job)
    logger.debug("Queued virus scan job", { fileId: file.id, jobId: job.id })
  }

  /**
   * Start processing queue
   */
  private startProcessingQueue(): void {
    if (this.isProcessingQueue) return

    this.isProcessingQueue = true

    const processQueue = async () => {
      const pendingJobs = Array.from(this.processingQueue.values()).filter(
        job => job.status === "pending"
      )

      for (const job of pendingJobs.slice(0, 3)) { // Process max 3 jobs concurrently
        this.processJob(job).catch(error => {
          logger.error("Job processing error:", error)
        })
      }

      // Check queue again after 5 seconds
      setTimeout(processQueue, 5000)
    }

    processQueue()
  }

  /**
   * Process individual job
   */
  private async processJob(job: FileProcessingJob): Promise<void> {
    try {
      job.status = "processing"
      job.startedAt = new Date()
      job.progress = 0

      const file = this.fileDatabase.get(job.fileId)
      if (!file) {
        throw new Error("File not found")
      }

      switch (job.type) {
        case "thumbnail":
          await this.generateThumbnails(job, file)
          break
        case "variant":
          await this.generateVariants(job, file)
          break
        case "compression":
          await this.compressFile(job, file)
          break
        case "watermark":
          await this.addWatermark(job, file)
          break
        case "virus-scan":
          await this.scanForVirus(job, file)
          break
      }

      job.status = "completed"
      job.progress = 100
      job.completedAt = new Date()

      logger.debug("Job completed successfully", {
        jobId: job.id,
        type: job.type,
        fileId: job.fileId,
      })
    } catch (error) {
      job.status = "failed"
      job.error = (error as Error).message
      job.completedAt = new Date()

      logger.error("Job failed", {
        jobId: job.id,
        type: job.type,
        fileId: job.fileId,
        error: (error as Error).message,
      })
    }
  }

  /**
   * Generate thumbnails
   */
  private async generateThumbnails(job: FileProcessingJob, file: FileUploadResult): Promise<void> {
    const thumbnailDir = path.join(this.options.uploadDir, "thumbnails")
    const filename = path.basename(file.path, path.extname(file.path))
    const thumbnails: FileThumbnail[] = []

    for (let i = 0; i < this.options.thumbnailSizes.length; i++) {
      const size = this.options.thumbnailSizes[i]
      const thumbnailPath = path.join(thumbnailDir, `${filename}_${size.name}.jpg`)
      
      await sharp(file.path)
        .resize(size.width, size.height, {
          fit: "cover",
          position: "center"
        })
        .jpeg({ quality: 85 })
        .toFile(thumbnailPath)

      thumbnails.push({
        size: size.name,
        width: size.width,
        height: size.height,
        path: thumbnailPath,
        url: this.getFileUrl(thumbnailPath),
        format: "jpeg"
      })

      job.progress = Math.round(((i + 1) / this.options.thumbnailSizes.length) * 100)
    }

    // Update file with thumbnails
    file.thumbnails = thumbnails
    this.fileDatabase.set(file.id, file)
    await cacheService.set(`file:${file.id}`, file, 3600)
  }

  /**
   * Generate variants
   */
  private async generateVariants(job: FileProcessingJob, file: FileUploadResult): Promise<void> {
    const variantDir = path.join(this.options.uploadDir, "variants")
    const filename = path.basename(file.path, path.extname(file.path))
    const variants: FileVariant[] = []

    if (this.isImageFile(file.mimeType)) {
      for (let i = 0; i < this.options.imageVariants.length; i++) {
        const variant = this.options.imageVariants[i]
        const ext = variant.format || path.extname(file.path).slice(1)
        const variantPath = path.join(variantDir, `${filename}_${variant.name}.${ext}`)
        
        let pipeline = sharp(file.path)
        
        if (variant.width || variant.height) {
          pipeline = pipeline.resize(variant.width, variant.height, {
            fit: "inside",
            withoutEnlargement: true
          })
        }

        switch (variant.format) {
          case "webp":
            pipeline = pipeline.webp({ quality: variant.quality || 80 })
            break
          case "jpeg":
            pipeline = pipeline.jpeg({ quality: variant.quality || 80 })
            break
          case "png":
            pipeline = pipeline.png({ quality: variant.quality || 80 })
            break
          default:
            if (variant.quality) {
              pipeline = pipeline.jpeg({ quality: variant.quality })
            }
        }

        await pipeline.toFile(variantPath)
        
        const stats = await fs.stat(variantPath)
        const metadata = await sharp(variantPath).metadata()

        variants.push({
          name: variant.name,
          path: variantPath,
          url: this.getFileUrl(variantPath),
          size: stats.size,
          format: variant.format || ext,
          quality: variant.quality,
          width: metadata.width,
          height: metadata.height
        })

        job.progress = Math.round(((i + 1) / this.options.imageVariants.length) * 100)
      }
    } else if (this.isVideoFile(file.mimeType)) {
      for (let i = 0; i < this.options.videoVariants.length; i++) {
        const variant = this.options.videoVariants[i]
        const variantPath = path.join(variantDir, `${filename}_${variant.name}.${variant.format || "mp4"}`)
        
        await this.generateVideoVariant(file.path, variantPath, variant)
        
        const stats = await fs.stat(variantPath)

        variants.push({
          name: variant.name,
          path: variantPath,
          url: this.getFileUrl(variantPath),
          size: stats.size,
          format: variant.format || "mp4",
          width: variant.width,
          height: variant.height,
          bitrate: parseInt(variant.bitrate?.replace('k', '') || '0')
        })

        job.progress = Math.round(((i + 1) / this.options.videoVariants.length) * 100)
      }
    }

    // Update file with variants
    file.variants = variants
    this.fileDatabase.set(file.id, file)
    await cacheService.set(`file:${file.id}`, file, 3600)
  }

  /**
   * Generate video variant
   */
  private async generateVideoVariant(
    inputPath: string,
    outputPath: string,
    variant: { width?: number; height?: number; bitrate?: string; format?: string }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath)
        .output(outputPath)
        .videoCodec('libx264')
        .audioCodec('aac')

      if (variant.width && variant.height) {
        command = command.size(`${variant.width}x${variant.height}`)
      }

      if (variant.bitrate) {
        command = command.videoBitrate(variant.bitrate)
      }

      command
        .on('end', resolve)
        .on('error', reject)
        .run()
    })
  }

  /**
   * Compress file
   */
  private async compressFile(job: FileProcessingJob, file: FileUploadResult): Promise<void> {
    job.progress = 25

    if (this.isImageFile(file.mimeType)) {
      const compressedPath = path.join(
        path.dirname(file.path),
        `compressed_${path.basename(file.path)}`
      )

      await sharp(file.path)
        .jpeg({ quality: 70, progressive: true })
        .toFile(compressedPath)

      // Replace original with compressed version
      await fs.unlink(file.path)
      await fs.rename(compressedPath, file.path)

      job.progress = 100
    } else {
      // For other file types, compression would be implemented here
      job.progress = 100
    }
  }

  /**
   * Add watermark
   */
  private async addWatermark(job: FileProcessingJob, file: FileUploadResult): Promise<void> {
    if (!this.options.watermarkConfig) {
      throw new Error("Watermark configuration not provided")
    }

    const { imagePath, position, opacity, margin } = this.options.watermarkConfig
    
    job.progress = 25

    const watermarkBuffer = await fs.readFile(imagePath)
    const image = sharp(file.path)
    const metadata = await image.metadata()

    if (!metadata.width || !metadata.height) {
      throw new Error("Could not determine image dimensions")
    }

    // Calculate watermark position
    let left = 0
    let top = 0

    switch (position) {
      case "top-left":
        left = margin
        top = margin
        break
      case "top-right":
        left = metadata.width - 100 - margin // Assuming watermark width of 100
        top = margin
        break
      case "bottom-left":
        left = margin
        top = metadata.height - 50 - margin // Assuming watermark height of 50
        break
      case "bottom-right":
        left = metadata.width - 100 - margin
        top = metadata.height - 50 - margin
        break
      case "center":
        left = Math.floor((metadata.width - 100) / 2)
        top = Math.floor((metadata.height - 50) / 2)
        break
    }

    job.progress = 75

    const watermarkedPath = path.join(
      path.dirname(file.path),
      `watermarked_${path.basename(file.path)}`
    )

    await image
      .composite([{
        input: watermarkBuffer,
        left,
        top,
        blend: 'over'
      }])
      .toFile(watermarkedPath)

    // Replace original with watermarked version
    await fs.unlink(file.path)
    await fs.rename(watermarkedPath, file.path)

    job.progress = 100
  }

  /**
   * Scan for virus
   */
  private async scanForVirus(job: FileProcessingJob, file: FileUploadResult): Promise<void> {
    job.progress = 50
    
    // Simulate virus scanning - in real implementation, you would use ClamAV or similar
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    // For demo purposes, assume all files are clean
    job.result = { clean: true, threats: [] }
    job.progress = 100
  }

  /**
   * Get upload subdirectory based on mime type
   */
  private getUploadSubdir(mimeType: string): string {
    if (this.isImageFile(mimeType)) return "images"
    if (this.isVideoFile(mimeType)) return "videos"
    if (this.isAudioFile(mimeType)) return "audio"
    if (mimeType === "application/pdf") return "documents"
    return "files"
  }

  /**
   * Get file URL
   */
  private getFileUrl(filePath: string): string {
    const relativePath = path.relative(this.options.uploadDir, filePath)
    const url = `${this.options.publicUrl}/${relativePath.replace(/\\/g, "/")}`
    
    if (this.options.enableCdn && this.options.cdnUrl) {
      return `${this.options.cdnUrl}/${relativePath.replace(/\\/g, "/")}`
    }
    
    return url
  }

  /**
   * Check if file is an image
   */
  private isImageFile(mimeType: string): boolean {
    return mimeType.startsWith("image/")
  }

  /**
   * Check if file is a video
   */
  private isVideoFile(mimeType: string): boolean {
    return mimeType.startsWith("video/")
  }

  /**
   * Check if file is audio
   */
  private isAudioFile(mimeType: string): boolean {
    return mimeType.startsWith("audio/")
  }

  /**
   * Get file by ID
   */
  async getFile(fileId: string, tenantId?: string): Promise<FileUploadResult | null> {
    try {
      // Try cache first
      const cached = await cacheService.get(`file:${fileId}`)
      if (cached) {
        const file = cached as FileUploadResult
        if (!tenantId || file.tenantId === tenantId) {
          return file
        }
      }

      // Get from database
      const file = this.fileDatabase.get(fileId)
      if (!file) return null

      // Check tenant isolation
      if (tenantId && file.tenantId !== tenantId) return null

      // Cache the result
      await cacheService.set(`file:${fileId}`, file, 3600)

      return file
    } catch (error) {
      logger.error("Failed to get file:", error)
      throw ApiError.internal("Failed to retrieve file")
    }
  }

  /**
   * Update file metadata
   */
  async updateFile(
    fileId: string,
    updates: Partial<Pick<FileUploadResult, 'alt' | 'title' | 'description' | 'tags' | 'folder'>>,
    userId?: string,
    tenantId?: string
  ): Promise<FileUploadResult> {
    try {
      const file = await this.getFile(fileId, tenantId)
      if (!file) {
        throw ApiError.notFound("File not found")
      }

      // Update file
      const updatedFile = { ...file, ...updates }
      this.fileDatabase.set(fileId, updatedFile)

      // Update cache
      await cacheService.set(`file:${fileId}`, updatedFile, 3600)

      // Audit log
      await auditService.log({
        action: "file.update",
        entityType: "File",
        entityId: fileId,
        userId,
        details: updates,
      })

      logger.info("File updated successfully", { fileId, updates, userId })

      return updatedFile
    } catch (error) {
      logger.error("File update failed:", error)
      throw error instanceof ApiError ? error : ApiError.internal("File update failed")
    }
  }

  /**
   * Delete file and all its variants
   */
  async deleteFile(fileId: string, userId?: string, tenantId?: string): Promise<void> {
    try {
      const file = await this.getFile(fileId, tenantId)
      if (!file) {
        throw ApiError.notFound("File not found")
      }

      // Delete main file
      try {
        await fs.unlink(file.path)
      } catch (error) {
        logger.warn("Main file already deleted or not found:", file.path)
      }

      // Delete thumbnails
      if (file.thumbnails) {
        for (const thumbnail of file.thumbnails) {
          try {
            await fs.unlink(thumbnail.path)
          } catch (error) {
            logger.warn("Thumbnail file not found:", thumbnail.path)
          }
        }
      }

      // Delete variants
      if (file.variants) {
        for (const variant of file.variants) {
          try {
            await fs.unlink(variant.path)
          } catch (error) {
            logger.warn("Variant file not found:", variant.path)
          }
        }
      }

      // Remove from database
      this.fileDatabase.delete(fileId)
      this.hashIndex.delete(file.hash)

      // Remove from cache
      await cacheService.delete(`file:${fileId}`)

      // Cancel any pending jobs for this file
      const fileJobs = this.getFileJobs(fileId)
      for (const job of fileJobs) {
        if (job.status === "pending") {
          this.cancelJob(job.id)
        }
      }

      // Audit log
      await auditService.log({
        action: "file.delete",
        entityType: "File",
        entityId: fileId,
        userId,
        details: {
          filename: file.originalName,
          path: file.path,
        },
      })

      logger.info("File deleted successfully", { fileId, userId })
    } catch (error) {
      logger.error("File deletion failed:", error)
      throw error instanceof ApiError ? error : ApiError.internal("File deletion failed")
    }
  }

  /**
   * Get file information
   */
  async getFileInfo(filePath: string): Promise<any> {
    try {
      const stats = await fs.stat(filePath)
      return {
        size: stats.size,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
      }
    } catch (error) {
      throw ApiError.notFound("File not found")
    }
  }

  /**
   * Search files
   */
  async searchFiles(options: FileSearchOptions): Promise<{
    files: FileUploadResult[]
    total: number
    page: number
    limit: number
  }> {
    try {
      const {
        query,
        mimeType,
        minSize,
        maxSize,
        uploadedBy,
        dateFrom,
        dateTo,
        tags,
        folder,
        page = 1,
        limit = 20,
        sortBy = "uploadedAt",
        sortOrder = "desc"
      } = options

      let files = Array.from(this.fileDatabase.values())

      // Apply filters
      if (query) {
        const searchTerm = query.toLowerCase()
        files = files.filter(file => 
          file.originalName.toLowerCase().includes(searchTerm) ||
          file.title?.toLowerCase().includes(searchTerm) ||
          file.description?.toLowerCase().includes(searchTerm)
        )
      }

      if (mimeType) {
        files = files.filter(file => file.mimeType === mimeType)
      }

      if (minSize !== undefined) {
        files = files.filter(file => file.size >= minSize)
      }

      if (maxSize !== undefined) {
        files = files.filter(file => file.size <= maxSize)
      }

      if (uploadedBy) {
        files = files.filter(file => file.uploadedBy === uploadedBy)
      }

      if (dateFrom) {
        files = files.filter(file => file.uploadedAt >= dateFrom)
      }

      if (dateTo) {
        files = files.filter(file => file.uploadedAt <= dateTo)
      }

      if (tags && tags.length > 0) {
        files = files.filter(file => 
          file.tags && tags.some(tag => file.tags!.includes(tag))
        )
      }

      if (folder) {
        files = files.filter(file => file.folder === folder)
      }

      // Sort files
      files.sort((a, b) => {
        let aValue: any = a[sortBy as keyof FileUploadResult]
        let bValue: any = b[sortBy as keyof FileUploadResult]

        if (aValue instanceof Date) aValue = aValue.getTime()
        if (bValue instanceof Date) bValue = bValue.getTime()

        if (sortOrder === "asc") {
          return aValue > bValue ? 1 : -1
        } else {
          return aValue < bValue ? 1 : -1
        }
      })

      // Pagination
      const total = files.length
      const startIndex = (page - 1) * limit
      const endIndex = startIndex + limit
      const paginatedFiles = files.slice(startIndex, endIndex)

      return {
        files: paginatedFiles,
        total,
        page,
        limit,
      }
    } catch (error) {
      logger.error("File search failed:", error)
      throw ApiError.internal("File search failed")
    }
  }

  /**
   * Get file statistics
   */
  async getStats(tenantId?: string): Promise<FileStats> {
    try {
      let files = Array.from(this.fileDatabase.values())
      
      if (tenantId) {
        files = files.filter(file => file.tenantId === tenantId)
      }

      const totalFiles = files.length
      const totalSize = files.reduce((sum, file) => sum + file.size, 0)

      const filesByType: Record<string, number> = {}
      const sizeByType: Record<string, number> = {}

      files.forEach(file => {
        const type = file.mimeType.split('/')[0]
        filesByType[type] = (filesByType[type] || 0) + 1
        sizeByType[type] = (sizeByType[type] || 0) + file.size
      })

      const recentUploads = files
        .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
        .slice(0, 10)
        .map(file => ({
          id: file.id,
          filename: file.originalName,
          size: file.size,
          uploadedAt: file.uploadedAt,
          uploadedBy: file.uploadedBy,
        }))

      const largestFiles = files
        .sort((a, b) => b.size - a.size)
        .slice(0, 10)
        .map(file => ({
          id: file.id,
          filename: file.originalName,
          size: file.size,
          type: file.mimeType,
        }))

      const maxStorage = 10 * 1024 * 1024 * 1024 // 10GB
      const storageUsage = {
        used: totalSize,
        available: maxStorage - totalSize,
        percentage: Math.round((totalSize / maxStorage) * 100),
      }

      return {
        totalFiles,
        totalSize,
        filesByType,
        sizeByType,
        recentUploads,
        largestFiles,
        storageUsage,
      }
    } catch (error) {
      logger.error("Failed to get file stats:", error)
      throw ApiError.internal("Failed to get file statistics")
    }
  }

  /**
   * Get processing job status
   */
  getJobStatus(jobId: string): FileProcessingJob | null {
    return this.processingQueue.get(jobId) || null
  }

  /**
   * Get all processing jobs for a file
   */
  getFileJobs(fileId: string): FileProcessingJob[] {
    return Array.from(this.processingQueue.values()).filter(job => job.fileId === fileId)
  }

  /**
   * Cancel processing job
   */
  cancelJob(jobId: string): boolean {
    const job = this.processingQueue.get(jobId)
    if (job && job.status === "pending") {
      job.status = "failed"
      job.error = "Cancelled by user"
      job.completedAt = new Date()
      return true
    }
    return false
  }

  /**
   * Clean up completed jobs
   */
  cleanupJobs(): void {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago
    
    for (const [jobId, job] of this.processingQueue.entries()) {
      if (job.completedAt && job.completedAt < cutoffTime) {
        this.processingQueue.delete(jobId)
      }
    }
    
    logger.debug("Cleaned up old processing jobs")
  }

  /**
   * Start cleanup scheduler
   */
  private startCleanupScheduler(): void {
    // Clean up jobs every hour
    setInterval(() => {
      this.cleanupJobs()
    }, 60 * 60 * 1000)
  }

  /**
   * Optimize image
   */
  async optimizeImage(
    inputPath: string,
    outputPath: string,
    options: {
      width?: number
      height?: number
      quality?: number
      format?: "jpeg" | "png" | "webp"
      progressive?: boolean
      stripMetadata?: boolean
    } = {}
  ): Promise<void> {
    try {
      let pipeline = sharp(inputPath)

      if (options.width || options.height) {
        pipeline = pipeline.resize(options.width, options.height, {
          fit: "inside",
          withoutEnlargement: true,
        })
      }

      if (options.stripMetadata) {
        pipeline = pipeline.removeMetadata()
      }

      switch (options.format) {
        case "jpeg":
          pipeline = pipeline.jpeg({
            quality: options.quality || 80,
            progressive: options.progressive || false,
          })
          break
        case "png":
          pipeline = pipeline.png({
            quality: options.quality || 80,
            progressive: options.progressive || false,
          })
          break
        case "webp":
          pipeline = pipeline.webp({
            quality: options.quality || 80,
          })
          break
      }

      await pipeline.toFile(outputPath)
    } catch (error) {
      logger.error("Image optimization failed:", error)
      throw error
    }
  }

  /**
   * Bulk delete files
   */
  async bulkDeleteFiles(fileIds: string[], userId?: string, tenantId?: string): Promise<{
    deleted: string[]
    failed: Array<{ id: string; error: string }>
  }> {
    const deleted: string[] = []
    const failed: Array<{ id: string; error: string }> = []

    for (const fileId of fileIds) {
      try {
        await this.deleteFile(fileId, userId, tenantId)
        deleted.push(fileId)
      } catch (error) {
        failed.push({
          id: fileId,
          error: (error as Error).message
        })
      }
    }

    logger.info("Bulk delete completed", {
      deleted: deleted.length,
      failed: failed.length,
      userId
    })

    return { deleted, failed }
  }

  /**
   * Move file to different folder
   */
  async moveFile(
    fileId: string,
    newFolder: string,
    userId?: string,
    tenantId?: string
  ): Promise<FileUploadResult> {
    try {
      const file = await this.getFile(fileId, tenantId)
      if (!file) {
        throw ApiError.notFound("File not found")
      }

      const updatedFile = { ...file, folder: newFolder }
      this.fileDatabase.set(fileId, updatedFile)

      // Update cache
      await cacheService.set(`file:${fileId}`, updatedFile, 3600)

      // Audit log
      await auditService.log({
        action: "file.move",
        entityType: "File",
        entityId: fileId,
        userId,
        details: {
          oldFolder: file.folder,
          newFolder,
        },
      })

      logger.info("File moved successfully", {
        fileId,
        oldFolder: file.folder,
        newFolder,
        userId
      })

      return updatedFile
    } catch (error) {
      logger.error("File move failed:", error)
      throw error instanceof ApiError ? error : ApiError.internal("File move failed")
    }
  }

  /**
   * Copy file
   */
  async copyFile(
    fileId: string,
    options: {
      newName?: string
      folder?: string
      userId?: string
      tenantId?: string
    } = {}
  ): Promise<FileUploadResult> {
    try {
      const originalFile = await this.getFile(fileId, options.tenantId)
      if (!originalFile) {
        throw ApiError.notFound("File not found")
      }

      // Create new file path
      const ext = path.extname(originalFile.path)
      const newFilename = `${uuidv4()}${ext}`
      const newPath = path.join(path.dirname(originalFile.path), newFilename)

      // Copy the physical file
      await fs.copyFile(originalFile.path, newPath)

      // Create new file record
      const newFile: FileUploadResult = {
        ...originalFile,
        id: uuidv4(),
        filename: newFilename,
        originalName: options.newName || `Copy of ${originalFile.originalName}`,
        path: newPath,
        url: this.getFileUrl(newPath),
        hash: await this.calculateFileHash(newPath),
        uploadedAt: new Date(),
        uploadedBy: options.userId,
        folder: options.folder || originalFile.folder,
        thumbnails: [],
        variants: []
      }

      // Store in database
      this.fileDatabase.set(newFile.id, newFile)
      this.hashIndex.set(newFile.hash, newFile.id)

      // Copy thumbnails and variants if they exist
      if (originalFile.thumbnails) {
        await this.queueThumbnailGeneration(newFile)
      }

      if (originalFile.variants) {
        if (this.isImageFile(newFile.mimeType)) {
          await this.queueImageVariantGeneration(newFile)
        } else if (this.isVideoFile(newFile.mimeType)) {
          await this.queueVideoVariantGeneration(newFile)
        }
      }

      // Cache the result
      await cacheService.set(`file:${newFile.id}`, newFile, 3600)

      // Audit log
      await auditService.log({
        action: "file.copy",
        entityType: "File",
        entityId: newFile.id,
        userId: options.userId,
        details: {
          originalFileId: fileId,
          originalName: originalFile.originalName,
          newName: newFile.originalName,
        },
      })

      logger.info("File copied successfully", {
        originalId: fileId,
        newId: newFile.id,
        userId: options.userId
      })

      return newFile
    } catch (error) {
      logger.error("File copy failed:", error)
      throw error instanceof ApiError ? error : ApiError.internal("File copy failed")
    }
  }

  /**
   * Get file download URL with expiration
   */
  async getDownloadUrl(
    fileId: string,
    expiresIn: number = 3600,
    tenantId?: string
  ): Promise<string> {
    try {
      const file = await this.getFile(fileId, tenantId)
      if (!file) {
        throw ApiError.notFound("File not found")
      }

      // In a real implementation, you would generate a signed URL
      // For now, return the regular URL with a token
      const token = Buffer.from(`${fileId}:${Date.now() + expiresIn * 1000}`).toString('base64')
      return `${file.url}?token=${token}`
    } catch (error) {
      logger.error("Failed to generate download URL:", error)
      throw error instanceof ApiError ? error : ApiError.internal("Failed to generate download URL")
    }
  }

  /**
   * Validate download token
   */
  validateDownloadToken(token: string, fileId: string): boolean {
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8')
      const [tokenFileId, expirationTime] = decoded.split(':')
      
      if (tokenFileId !== fileId) {
        return false
      }

      const expiration = parseInt(expirationTime)
      return Date.now() < expiration
    } catch {
      return false
    }
  }

  /**
   * Get storage usage by tenant
   */
  async getStorageUsage(tenantId?: string): Promise<{
    totalFiles: number
    totalSize: number
    quota: number
    percentage: number
  }> {
    try {
      let files = Array.from(this.fileDatabase.values())
      
      if (tenantId) {
        files = files.filter(file => file.tenantId === tenantId)
      }

      const totalFiles = files.length
      const totalSize = files.reduce((sum, file) => sum + file.size, 0)
      const quota = 10 * 1024 * 1024 * 1024 // 10GB default quota
      const percentage = Math.round((totalSize / quota) * 100)

      return {
        totalFiles,
        totalSize,
        quota,
        percentage
      }
    } catch (error) {
      logger.error("Failed to get storage usage:", error)
      throw ApiError.internal("Failed to get storage usage")
    }
  }

  /**
   * Cleanup orphaned files
   */
  async cleanupOrphanedFiles(): Promise<{
    cleaned: number
    errors: string[]
  }> {
    let cleaned = 0
    const errors: string[] = []

    try {
      // Get all files in upload directory
      const uploadDirs = ["images", "videos", "audio", "documents", "files"]
      
      for (const dir of uploadDirs) {
        const dirPath = path.join(this.options.uploadDir, dir)
        
        try {
          const files = await fs.readdir(dirPath)
          
          for (const filename of files) {
            const filePath = path.join(dirPath, filename)
            
            // Check if file exists in database
            const fileExists = Array.from(this.fileDatabase.values()).some(
              file => file.path === filePath
            )
            
            if (!fileExists) {
              try {
                await fs.unlink(filePath)
                cleaned++
                logger.debug("Cleaned orphaned file:", filePath)
              } catch (error) {
                errors.push(`Failed to delete ${filePath}: ${(error as Error).message}`)
              }
            }
          }
        } catch (error) {
          errors.push(`Failed to read directory ${dirPath}: ${(error as Error).message}`)
        }
      }

      logger.info("Orphaned file cleanup completed", { cleaned, errors: errors.length })
      
      return { cleaned, errors }
    } catch (error) {
      logger.error("Orphaned file cleanup failed:", error)
      throw ApiError.internal("Orphaned file cleanup failed")
    }
  }
}

// Export singleton instance
export const fileService = new FileService()
