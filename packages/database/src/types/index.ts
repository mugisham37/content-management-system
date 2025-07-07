// =============================================================================
// DATABASE TYPES
// =============================================================================

// Export Prisma-generated types
export type {
  User,
  Content,
  Media,
  Tenant,
  ContentType,
  UserRole,
  UserStatus,
  ContentStatus,
  MediaType,
  Prisma,
} from '@prisma/client'

// Export media types
export * from './media.types'

// Import Prisma types for extending
import type { ContentType as PrismaContentType } from '@prisma/client'

export interface FieldType {
  id: string
  name: string
  displayName: string
  description?: string
  dataType: string
  uiType: string
  isSystem: boolean
  isBuiltIn: boolean
  validations?: any[]
  settings?: Record<string, any>
  pluginId?: string
  createdAt: Date
  updatedAt: Date
}

export interface CreateContentTypeData {
  name: string
  displayName: string
  description?: string
  isSystem?: boolean
  fields?: Omit<FieldDefinition, 'id' | 'contentTypeId' | 'createdAt' | 'updatedAt'>[]
  tenantId?: string
  createdBy?: string
  updatedBy?: string
}

export interface UpdateContentTypeData {
  name?: string
  displayName?: string
  description?: string
  isSystem?: boolean
  fields?: Partial<FieldDefinition>[]
  updatedBy?: string
}

export interface ContentTypeWithFields extends Omit<PrismaContentType, 'fields'> {
  fields: FieldDefinition[]
}

export interface FieldDefinition {
  id: string
  contentTypeId: string
  name: string
  displayName: string
  type: string
  description?: string
  validation?: {
    required?: boolean
    unique?: boolean
    min?: number
    max?: number
    minLength?: number
    maxLength?: number
    pattern?: string
    enum?: string[]
    message?: string
  }
  defaultValue?: any
  isSystem: boolean
  isLocalized?: boolean
  settings?: Record<string, any>
  order?: number
  createdAt: Date
  updatedAt: Date
}

export interface ValidationRule {
  id: string
  fieldId: string
  ruleType: 'minLength' | 'maxLength' | 'pattern' | 'min' | 'max' | 'custom' | 'required' | 'unique' | 'enum'
  value: string | number | string[]
  errorMessage?: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

// Extended types for better type safety
export interface CreateUserInput {
  email: string
  username?: string
  firstName?: string
  lastName?: string
  password?: string
  role?: 'SUPER_ADMIN' | 'ADMIN' | 'EDITOR' | 'AUTHOR' | 'CONTRIBUTOR' | 'USER'
}

export interface UpdateUserInput {
  email?: string
  username?: string
  firstName?: string
  lastName?: string
  avatar?: string
  bio?: string
  isActive?: boolean
}

export interface CreatePostInput {
  title: string
  slug: string
  excerpt?: string
  content: string
  status?: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED' | 'ARCHIVED' | 'TRASH'
  type?: 'POST' | 'PAGE' | 'PRODUCT' | 'EVENT' | 'CUSTOM'
  metaTitle?: string
  metaDescription?: string
  metaKeywords?: string
  publishedAt?: Date
  scheduledAt?: Date
  featuredImage?: string
  isFeatured?: boolean
  isSticky?: boolean
  authorId: string
  categoryIds?: string[]
  tagIds?: string[]
}

export interface UpdatePostInput {
  title?: string
  slug?: string
  excerpt?: string
  content?: string
  status?: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED' | 'ARCHIVED' | 'TRASH'
  type?: 'POST' | 'PAGE' | 'PRODUCT' | 'EVENT' | 'CUSTOM'
  metaTitle?: string
  metaDescription?: string
  metaKeywords?: string
  publishedAt?: Date
  scheduledAt?: Date
  featuredImage?: string
  isFeatured?: boolean
  isSticky?: boolean
  categoryIds?: string[]
  tagIds?: string[]
}

export interface CreateCategoryInput {
  name: string
  slug: string
  description?: string
  color?: string
  icon?: string
  parentId?: string
  metaTitle?: string
  metaDescription?: string
  isVisible?: boolean
  sortOrder?: number
}

export interface CreateTagInput {
  name: string
  slug: string
  description?: string
  color?: string
}

export interface CreateCommentInput {
  content: string
  postId: string
  authorId: string
  parentId?: string
}

export interface CreateMediaInput {
  filename: string
  originalName: string
  mimeType: string
  size: number
  url: string
  thumbnailUrl?: string
  width?: number
  height?: number
  duration?: number
  alt?: string
  caption?: string
  description?: string
  folder?: string
  tags?: string[]
  uploadedById: string
  storageProvider?: string
  storageKey?: string
}

// Search and filter types
export interface PostFilters {
  status?: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED' | 'ARCHIVED' | 'TRASH'
  type?: 'POST' | 'PAGE' | 'PRODUCT' | 'EVENT' | 'CUSTOM'
  authorId?: string
  categoryId?: string
  tagId?: string
  isFeatured?: boolean
  isSticky?: boolean
  search?: string
  dateFrom?: Date
  dateTo?: Date
}

export interface UserFilters {
  role?: 'SUPER_ADMIN' | 'ADMIN' | 'EDITOR' | 'AUTHOR' | 'CONTRIBUTOR' | 'USER'
  isActive?: boolean
  search?: string
  dateFrom?: Date
  dateTo?: Date
}

export interface MediaFilters {
  mimeType?: string
  folder?: string
  uploadedById?: string
  search?: string
  dateFrom?: Date
  dateTo?: Date
}

// Analytics types
export interface PostAnalytics {
  viewCount: number
  likeCount: number
  shareCount: number
  commentCount: number
}

export interface UserAnalytics {
  postCount: number
  commentCount: number
  mediaCount: number
  lastLoginAt?: Date
}

export interface SearchAnalytics {
  total_searches: number
  popular_queries: Array<{
    query: string
    count: number
    last_searched: Date
  }>
  avg_results: number
  zero_result_queries: Array<{
    query: string
    count: number
    last_searched: Date
  }>
}

// Audit types
export interface AuditLogInput {
  action: string
  resource: string
  resourceId?: string
  userId?: string
  userEmail?: string
  ipAddress?: string
  userAgent?: string
  metadata?: Record<string, any>
}

// Settings types
export interface SettingInput {
  key: string
  value: string
  type?: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON' | 'TEXT'
  group?: string
  description?: string
  isPublic?: boolean
}

// Response types
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T = any> extends ApiResponse<T[]> {
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

// Database operation types
export type DatabaseOperation = 'CREATE' | 'READ' | 'UPDATE' | 'DELETE'
export type ResourceType = 'USER' | 'POST' | 'CATEGORY' | 'TAG' | 'COMMENT' | 'MEDIA' | 'SETTING'

// Permission types
export interface PermissionCheck {
  userId: string
  resource: ResourceType
  action: DatabaseOperation
}

export interface RolePermission {
  resource: string
  actions: DatabaseOperation[]
}
