// =============================================================================
// CONTENT VERSION TYPE DEFINITIONS
// =============================================================================
// Comprehensive type definitions for content version operations

import { ContentVersion, ContentVersionStatus } from "@prisma/client"

// Enhanced interfaces for version operations
export interface ContentVersionWithRelations extends ContentVersion {
  createdBy?: {
    id: string
    firstName: string
    lastName: string
    email: string
  } | null
  publishedBy?: {
    id: string
    firstName: string
    lastName: string
    email: string
  } | null
  content?: {
    id: string
    slug: string | null
    contentType: {
      id: string
      name: string
      displayName: string
    }
  }
}

// Version comparison types
export interface DifferenceItem {
  key: string
  value: any
}

export interface ModifiedDifferenceItem {
  key: string
  oldValue: any
  newValue: any
}

export interface VersionDifferences {
  added: DifferenceItem[]
  removed: DifferenceItem[]
  modified: ModifiedDifferenceItem[]
}

// Version creation input
export interface CreateVersionInput {
  contentId: string
  data: any
  status?: ContentVersionStatus
  notes?: string
  createdById?: string
}

// Version statistics
export interface VersionStats {
  totalVersions: number
  draftVersions: number
  publishedVersions: number
  archivedVersions: number
  latestVersion: number
}

// Version comparison result
export interface VersionComparisonResult {
  version1: ContentVersionWithRelations
  version2: ContentVersionWithRelations
  differences: VersionDifferences
}

// Database query result types
export interface DatabaseQueryResult {
  rows: any[]
  rowCount: number
}

// JSON data type for content version data
export type ContentVersionData = Record<string, any>

// Type guards for runtime validation
export type SafeString = string
export type SafeStringOrUndefined = string | undefined
export type SafeNumber = number
export type SafeBoolean = boolean
export type SafeDate = Date
export type SafeAny = any
