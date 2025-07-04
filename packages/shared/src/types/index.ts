// =============================================================================
// SHARED TYPES
// =============================================================================

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
  timestamp?: string
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

// User Types
export interface UserProfile {
  id: string
  email: string
  username?: string
  firstName?: string
  lastName?: string
  avatar?: string
  bio?: string
  role: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AuthUser {
  id: string
  email: string
  username?: string
  firstName?: string
  lastName?: string
  avatar?: string
  role: string
  permissions: string[]
}

// Content Types
export interface ContentMeta {
  title?: string
  description?: string
  keywords?: string
  author?: string
  publishedAt?: string
  updatedAt?: string
}

export interface MediaFile {
  id: string
  filename: string
  originalName: string
  mimeType: string
  size: number
  url: string
  thumbnailUrl?: string
  width?: number
  height?: number
  alt?: string
  caption?: string
}

// Form Types
export interface FormField {
  name: string
  label: string
  type: 'text' | 'email' | 'password' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'file'
  placeholder?: string
  required?: boolean
  options?: { label: string; value: string }[]
  validation?: any
}

export interface FormConfig {
  fields: FormField[]
  submitLabel?: string
  resetLabel?: string
}

// Navigation Types
export interface NavItem {
  label: string
  href: string
  icon?: string
  children?: NavItem[]
  permissions?: string[]
}

export interface Breadcrumb {
  label: string
  href?: string
}

// Theme Types
export interface ThemeConfig {
  colors: {
    primary: string
    secondary: string
    accent: string
    background: string
    foreground: string
    muted: string
    border: string
  }
  fonts: {
    sans: string
    serif: string
    mono: string
  }
  spacing: {
    xs: string
    sm: string
    md: string
    lg: string
    xl: string
  }
}

// Error Types
export interface AppError {
  code: string
  message: string
  details?: any
  timestamp: string
}

// Filter Types
export interface FilterOption {
  label: string
  value: string
  count?: number
}

export interface FilterGroup {
  label: string
  key: string
  options: FilterOption[]
  type: 'checkbox' | 'radio' | 'select'
}

// Search Types
export interface SearchResult<T = any> {
  items: T[]
  total: number
  query: string
  filters?: Record<string, any>
  facets?: FilterGroup[]
}

// Notification Types
export interface Notification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
  timestamp: string
  read: boolean
  actions?: {
    label: string
    action: () => void
  }[]
}

// Analytics Types
export interface AnalyticsData {
  pageViews: number
  uniqueVisitors: number
  bounceRate: number
  avgSessionDuration: number
  topPages: { path: string; views: number }[]
  topReferrers: { source: string; visits: number }[]
}

// Settings Types
export interface SystemSetting {
  key: string
  value: any
  type: 'string' | 'number' | 'boolean' | 'json'
  group: string
  description?: string
  isPublic: boolean
}

// Utility Types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>

export type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}
