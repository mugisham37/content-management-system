// =============================================================================
// DATABASE PACKAGE EXPORTS
// =============================================================================

// Client and utilities
export { default as prisma } from './client'
export * from './client'

// Types
export * from './types'

// Re-export Prisma types
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
  SettingType,
  Prisma
} from '@prisma/client'
