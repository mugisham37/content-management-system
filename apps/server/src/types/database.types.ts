/**
 * Database row types for better type safety
 */

export interface UserRow {
  id: string
  email: string
  first_name: string
  last_name: string
  username?: string
  avatar_url?: string
  phone_number?: string
  is_active: boolean
  is_verified: boolean
  role: string
  tenant_id?: string
  last_login_at?: Date
  created_at: Date
  updated_at: Date
  login_count?: number
  last_ip_address?: string
  timezone?: string
  locale?: string
  preferences?: any
  // Joined fields from tenant table
  tenant_name?: string
  tenant_slug?: string
  tenant_is_active?: boolean
}

export interface TenantRow {
  id: string
  name: string
  slug: string
  is_active: boolean
  created_at: Date
  updated_at: Date
}

export interface DatabaseQueryResult<T = any> {
  rows: T[]
  rowCount: number
}

export interface PaginationParams {
  page?: number
  limit?: number
  orderBy?: string
  orderDirection?: 'asc' | 'desc'
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}
