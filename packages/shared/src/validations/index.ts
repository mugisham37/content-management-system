// =============================================================================
// SHARED VALIDATIONS
// =============================================================================

import { z } from 'zod'
import { VALIDATION_RULES, REGEX_PATTERNS } from '../constants'

// =============================================================================
// USER VALIDATIONS
// =============================================================================

export const userValidation = {
  email: z
    .string()
    .min(1, 'Email is required')
    .max(VALIDATION_RULES.EMAIL.MAX_LENGTH, 'Email is too long')
    .email('Invalid email format'),

  username: z
    .string()
    .min(VALIDATION_RULES.USERNAME.MIN_LENGTH, `Username must be at least ${VALIDATION_RULES.USERNAME.MIN_LENGTH} characters`)
    .max(VALIDATION_RULES.USERNAME.MAX_LENGTH, `Username must be at most ${VALIDATION_RULES.USERNAME.MAX_LENGTH} characters`)
    .regex(VALIDATION_RULES.USERNAME.PATTERN, 'Username can only contain letters, numbers, underscores, and hyphens')
    .optional(),

  password: z
    .string()
    .min(VALIDATION_RULES.PASSWORD.MIN_LENGTH, `Password must be at least ${VALIDATION_RULES.PASSWORD.MIN_LENGTH} characters`)
    .max(VALIDATION_RULES.PASSWORD.MAX_LENGTH, `Password must be at most ${VALIDATION_RULES.PASSWORD.MAX_LENGTH} characters`)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/\d/, 'Password must contain at least one number'),

  firstName: z
    .string()
    .min(1, 'First name is required')
    .max(50, 'First name is too long')
    .optional(),

  lastName: z
    .string()
    .min(1, 'Last name is required')
    .max(50, 'Last name is too long')
    .optional(),

  bio: z
    .string()
    .max(500, 'Bio is too long')
    .optional(),

  avatar: z
    .string()
    .url('Invalid avatar URL')
    .optional()
}

export const createUserSchema = z.object({
  email: userValidation.email,
  username: userValidation.username,
  firstName: userValidation.firstName,
  lastName: userValidation.lastName,
  password: userValidation.password,
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'EDITOR', 'AUTHOR', 'CONTRIBUTOR', 'USER']).optional()
})

export const updateUserSchema = z.object({
  email: userValidation.email.optional(),
  username: userValidation.username,
  firstName: userValidation.firstName,
  lastName: userValidation.lastName,
  bio: userValidation.bio,
  avatar: userValidation.avatar,
  isActive: z.boolean().optional()
})

export const loginSchema = z.object({
  email: userValidation.email,
  password: z.string().min(1, 'Password is required')
})

export const registerSchema = z.object({
  email: userValidation.email,
  username: userValidation.username,
  firstName: userValidation.firstName,
  lastName: userValidation.lastName,
  password: userValidation.password,
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"]
})

export const forgotPasswordSchema = z.object({
  email: userValidation.email
})

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: userValidation.password,
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"]
})

// =============================================================================
// POST VALIDATIONS
// =============================================================================

export const postValidation = {
  title: z
    .string()
    .min(1, 'Title is required')
    .max(VALIDATION_RULES.POST.TITLE_MAX_LENGTH, 'Title is too long'),

  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(VALIDATION_RULES.POST.SLUG_MAX_LENGTH, 'Slug is too long')
    .regex(REGEX_PATTERNS.SLUG, 'Slug must be URL-friendly (lowercase letters, numbers, and hyphens only)'),

  excerpt: z
    .string()
    .max(VALIDATION_RULES.POST.EXCERPT_MAX_LENGTH, 'Excerpt is too long')
    .optional(),

  content: z
    .string()
    .min(1, 'Content is required'),

  status: z.enum(['DRAFT', 'PUBLISHED', 'SCHEDULED', 'ARCHIVED', 'TRASH']).optional(),

  type: z.enum(['POST', 'PAGE', 'PRODUCT', 'EVENT', 'CUSTOM']).optional(),

  metaTitle: z
    .string()
    .max(60, 'Meta title should be under 60 characters for SEO')
    .optional(),

  metaDescription: z
    .string()
    .max(160, 'Meta description should be under 160 characters for SEO')
    .optional(),

  metaKeywords: z
    .string()
    .max(255, 'Meta keywords are too long')
    .optional(),

  featuredImage: z
    .string()
    .url('Invalid featured image URL')
    .optional(),

  publishedAt: z
    .string()
    .datetime('Invalid publish date')
    .optional(),

  scheduledAt: z
    .string()
    .datetime('Invalid schedule date')
    .optional()
}

export const createPostSchema = z.object({
  title: postValidation.title,
  slug: postValidation.slug,
  excerpt: postValidation.excerpt,
  content: postValidation.content,
  status: postValidation.status,
  type: postValidation.type,
  metaTitle: postValidation.metaTitle,
  metaDescription: postValidation.metaDescription,
  metaKeywords: postValidation.metaKeywords,
  featuredImage: postValidation.featuredImage,
  publishedAt: postValidation.publishedAt,
  scheduledAt: postValidation.scheduledAt,
  isFeatured: z.boolean().optional(),
  isSticky: z.boolean().optional(),
  categoryIds: z.array(z.string().cuid()).optional(),
  tagIds: z.array(z.string().cuid()).optional()
})

export const updatePostSchema = createPostSchema.partial()

// =============================================================================
// CATEGORY VALIDATIONS
// =============================================================================

export const categoryValidation = {
  name: z
    .string()
    .min(1, 'Category name is required')
    .max(VALIDATION_RULES.CATEGORY.NAME_MAX_LENGTH, 'Category name is too long'),

  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(100, 'Slug is too long')
    .regex(REGEX_PATTERNS.SLUG, 'Slug must be URL-friendly'),

  description: z
    .string()
    .max(VALIDATION_RULES.CATEGORY.DESCRIPTION_MAX_LENGTH, 'Description is too long')
    .optional(),

  color: z
    .string()
    .regex(REGEX_PATTERNS.HEX_COLOR, 'Invalid color format (use hex color)')
    .optional(),

  icon: z
    .string()
    .max(50, 'Icon is too long')
    .optional(),

  metaTitle: z
    .string()
    .max(60, 'Meta title should be under 60 characters')
    .optional(),

  metaDescription: z
    .string()
    .max(160, 'Meta description should be under 160 characters')
    .optional()
}

export const createCategorySchema = z.object({
  name: categoryValidation.name,
  slug: categoryValidation.slug,
  description: categoryValidation.description,
  color: categoryValidation.color,
  icon: categoryValidation.icon,
  parentId: z.string().cuid().optional(),
  metaTitle: categoryValidation.metaTitle,
  metaDescription: categoryValidation.metaDescription,
  isVisible: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional()
})

export const updateCategorySchema = createCategorySchema.partial()

// =============================================================================
// TAG VALIDATIONS
// =============================================================================

export const tagValidation = {
  name: z
    .string()
    .min(1, 'Tag name is required')
    .max(VALIDATION_RULES.TAG.NAME_MAX_LENGTH, 'Tag name is too long'),

  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(50, 'Slug is too long')
    .regex(REGEX_PATTERNS.SLUG, 'Slug must be URL-friendly'),

  description: z
    .string()
    .max(VALIDATION_RULES.TAG.DESCRIPTION_MAX_LENGTH, 'Description is too long')
    .optional(),

  color: z
    .string()
    .regex(REGEX_PATTERNS.HEX_COLOR, 'Invalid color format')
    .optional()
}

export const createTagSchema = z.object({
  name: tagValidation.name,
  slug: tagValidation.slug,
  description: tagValidation.description,
  color: tagValidation.color
})

export const updateTagSchema = createTagSchema.partial()

// =============================================================================
// COMMENT VALIDATIONS
// =============================================================================

export const commentValidation = {
  content: z
    .string()
    .min(1, 'Comment content is required')
    .max(1000, 'Comment is too long'),

  postId: z
    .string()
    .cuid('Invalid post ID'),

  parentId: z
    .string()
    .cuid('Invalid parent comment ID')
    .optional()
}

export const createCommentSchema = z.object({
  content: commentValidation.content,
  postId: commentValidation.postId,
  parentId: commentValidation.parentId
})

export const updateCommentSchema = z.object({
  content: commentValidation.content
})

// =============================================================================
// MEDIA VALIDATIONS
// =============================================================================

export const mediaValidation = {
  alt: z
    .string()
    .max(255, 'Alt text is too long')
    .optional(),

  caption: z
    .string()
    .max(500, 'Caption is too long')
    .optional(),

  description: z
    .string()
    .max(1000, 'Description is too long')
    .optional(),

  folder: z
    .string()
    .max(255, 'Folder path is too long')
    .optional(),

  tags: z
    .array(z.string().max(50))
    .max(10, 'Too many tags')
    .optional()
}

export const updateMediaSchema = z.object({
  alt: mediaValidation.alt,
  caption: mediaValidation.caption,
  description: mediaValidation.description,
  folder: mediaValidation.folder,
  tags: mediaValidation.tags
})

// =============================================================================
// SETTINGS VALIDATIONS
// =============================================================================

export const settingValidation = {
  key: z
    .string()
    .min(1, 'Setting key is required')
    .max(100, 'Setting key is too long')
    .regex(/^[a-z0-9_]+$/, 'Setting key must be lowercase with underscores only'),

  value: z
    .string()
    .min(1, 'Setting value is required'),

  type: z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'JSON', 'TEXT']).optional(),

  group: z
    .string()
    .max(50, 'Group name is too long')
    .optional(),

  description: z
    .string()
    .max(255, 'Description is too long')
    .optional()
}

export const createSettingSchema = z.object({
  key: settingValidation.key,
  value: settingValidation.value,
  type: settingValidation.type,
  group: settingValidation.group,
  description: settingValidation.description,
  isPublic: z.boolean().optional()
})

export const updateSettingSchema = z.object({
  value: settingValidation.value,
  description: settingValidation.description,
  isPublic: z.boolean().optional()
})

// =============================================================================
// PAGINATION VALIDATIONS
// =============================================================================

export const paginationSchema = z.object({
  page: z
    .number()
    .int()
    .min(1, 'Page must be at least 1')
    .optional()
    .default(1),

  limit: z
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .optional()
    .default(10),

  orderBy: z
    .string()
    .max(50, 'Order by field is too long')
    .optional(),

  orderDirection: z
    .enum(['asc', 'desc'])
    .optional()
    .default('desc')
})

// =============================================================================
// SEARCH VALIDATIONS
// =============================================================================

export const searchSchema = z.object({
  query: z
    .string()
    .min(1, 'Search query is required')
    .max(255, 'Search query is too long'),

  filters: z
    .record(z.any())
    .optional(),

  ...paginationSchema.shape
})

// =============================================================================
// FILE UPLOAD VALIDATIONS
// =============================================================================

export const fileUploadSchema = z.object({
  file: z.any().refine((file) => {
    if (!file) return false
    return file instanceof File || (file && file.name && file.size)
  }, 'File is required'),

  folder: z
    .string()
    .max(255, 'Folder path is too long')
    .optional(),

  alt: z
    .string()
    .max(255, 'Alt text is too long')
    .optional(),

  caption: z
    .string()
    .max(500, 'Caption is too long')
    .optional()
})

// =============================================================================
// BULK OPERATIONS VALIDATIONS
// =============================================================================

export const bulkDeleteSchema = z.object({
  ids: z
    .array(z.string().cuid())
    .min(1, 'At least one ID is required')
    .max(100, 'Cannot delete more than 100 items at once')
})

export const bulkUpdateSchema = z.object({
  ids: z
    .array(z.string().cuid())
    .min(1, 'At least one ID is required')
    .max(100, 'Cannot update more than 100 items at once'),

  data: z.record(z.any())
})

// =============================================================================
// EXPORT TYPES
// =============================================================================

export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

export type CreatePostInput = z.infer<typeof createPostSchema>
export type UpdatePostInput = z.infer<typeof updatePostSchema>

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>

export type CreateTagInput = z.infer<typeof createTagSchema>
export type UpdateTagInput = z.infer<typeof updateTagSchema>

export type CreateCommentInput = z.infer<typeof createCommentSchema>
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>

export type UpdateMediaInput = z.infer<typeof updateMediaSchema>

export type CreateSettingInput = z.infer<typeof createSettingSchema>
export type UpdateSettingInput = z.infer<typeof updateSettingSchema>

export type PaginationInput = z.infer<typeof paginationSchema>
export type SearchInput = z.infer<typeof searchSchema>
export type FileUploadInput = z.infer<typeof fileUploadSchema>
export type BulkDeleteInput = z.infer<typeof bulkDeleteSchema>
export type BulkUpdateInput = z.infer<typeof bulkUpdateSchema>
