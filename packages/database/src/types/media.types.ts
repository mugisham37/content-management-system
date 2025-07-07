// =============================================================================
// MEDIA TYPES - POSTGRESQL
// =============================================================================
// Type definitions for media management system

import { MediaType } from '@prisma/client'

export interface MediaFile {
  id: string
  filename: string
  originalName: string
  path: string
  url: string
  type: MediaType
  mimeType: string
  size: number
  width?: number
  height?: number
  duration?: number
  alt?: string
  caption?: string
  tags: string[]
  metadata: Record<string, any>
  tenantId?: string
  uploadedById: string
  createdAt: Date
  updatedAt: Date
}

export interface MediaCreateInput {
  filename: string
  originalName: string
  path: string
  url: string
  type: MediaType
  mimeType: string
  size: number
  width?: number
  height?: number
  duration?: number
  alt?: string
  caption?: string
  tags?: string[]
  metadata?: Record<string, any>
  tenantId?: string
  uploadedById: string
}

export interface MediaUpdateInput {
  filename?: string
  originalName?: string
  path?: string
  url?: string
  type?: MediaType
  mimeType?: string
  size?: number
  width?: number
  height?: number
  duration?: number
  alt?: string
  caption?: string
  tags?: string[]
  metadata?: Record<string, any>
}

export interface MediaSearchOptions {
  search?: string
  type?: MediaType
  mimeType?: string
  tags?: string[]
  tenantId?: string
  uploadedById?: string
  page?: number
  limit?: number
  sortBy?: 'createdAt' | 'filename' | 'size' | 'originalName'
  sortOrder?: 'asc' | 'desc'
}

export interface MediaSearchResult {
  media: MediaFile[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface MediaStats {
  totalFiles: number
  totalSize: number
  filesByType: Record<string, number>
  sizeByType: Record<string, number>
  averageSize: number
}

export interface MediaVariant {
  id: string
  name: string
  url: string
  width?: number
  height?: number
  size: number
  format: string
  quality?: number
  metadata?: Record<string, any>
}

export interface MediaUploadOptions {
  folder?: string
  alt?: string
  title?: string
  description?: string
  tags?: string[]
  generateThumbnails?: boolean
  generateVariants?: boolean
  applyWatermark?: boolean
  quality?: number
  tenantId?: string
  uploadedBy?: string
}

export interface ImageProcessingOptions {
  width?: number
  height?: number
  quality?: number
  format?: "jpeg" | "png" | "webp" | "avif"
  fit?: "cover" | "contain" | "fill" | "inside" | "outside"
  position?: string
  background?: string
  blur?: number
  sharpen?: boolean
  grayscale?: boolean
  normalize?: boolean
  rotate?: number
  flip?: boolean
  flop?: boolean
}

export interface MediaFolder {
  id: string
  name: string
  path: string
  parentId?: string
  description?: string
  isPublic: boolean
  permissions?: Record<string, string[]>
  metadata?: Record<string, any>
  tenantId?: string
  createdAt: Date
  updatedAt: Date
  createdBy?: string
}

// Re-export MediaType from Prisma
export { MediaType } from '@prisma/client'
