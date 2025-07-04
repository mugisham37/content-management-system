// =============================================================================
// DATABASE PACKAGE EXPORTS
// =============================================================================

// Client and utilities
export { default as prisma } from './client'
export * from './client'

// Types
export * from './types'

// Re-export Prisma types and namespace
export type {
  User,
  Role,
  Permission,
  Account,
  Session,
  VerificationToken,
  Post,
  Category,
  Tag,
  Comment,
  Media,
  Setting,
  AuditLog,
  UserRole,
  PostStatus,
  PostType,
  CommentStatus,
  SettingType
} from '@prisma/client'

// Export Prisma namespace for error handling
export { Prisma } from '@prisma/client'
