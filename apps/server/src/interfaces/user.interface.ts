export interface IUser {
  id: string
  email: string
  firstName: string
  lastName: string
  username?: string
  avatarUrl?: string
  phoneNumber?: string
  isActive: boolean
  isVerified: boolean
  role: string
  tenantId?: string
  lastLoginAt?: Date
  createdAt: Date
  updatedAt: Date
  loginCount?: number
  lastIpAddress?: string
  timezone?: string
  locale?: string
  preferences?: Record<string, any>
  tenant?: {
    id: string
    name: string
    slug: string
    isActive: boolean
  }
}
