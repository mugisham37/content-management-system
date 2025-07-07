// =============================================================================
// ENUM UTILITIES
// =============================================================================

import { UserRole, UserStatus } from '@prisma/client'

export class EnumUtils {
  /**
   * Safely convert string to UserRole enum
   */
  static toUserRole(value: string): UserRole {
    const upperValue = value.toUpperCase() as keyof typeof UserRole
    if (upperValue in UserRole) {
      return UserRole[upperValue]
    }
    throw new Error(`Invalid UserRole: ${value}. Valid values are: ${Object.values(UserRole).join(', ')}`)
  }

  /**
   * Safely convert string to UserStatus enum
   */
  static toUserStatus(value: string): UserStatus {
    const upperValue = value.toUpperCase() as keyof typeof UserStatus
    if (upperValue in UserStatus) {
      return UserStatus[upperValue]
    }
    throw new Error(`Invalid UserStatus: ${value}. Valid values are: ${Object.values(UserStatus).join(', ')}`)
  }

  /**
   * Check if string is valid UserRole
   */
  static isValidUserRole(value: string): boolean {
    const upperValue = value.toUpperCase()
    return Object.values(UserRole).includes(upperValue as UserRole)
  }

  /**
   * Check if string is valid UserStatus
   */
  static isValidUserStatus(value: string): boolean {
    const upperValue = value.toUpperCase()
    return Object.values(UserStatus).includes(upperValue as UserStatus)
  }

  /**
   * Get all UserRole values
   */
  static getAllUserRoles(): UserRole[] {
    return Object.values(UserRole)
  }

  /**
   * Get all UserStatus values
   */
  static getAllUserStatuses(): UserStatus[] {
    return Object.values(UserStatus)
  }

  /**
   * Safely convert string to UserRole with default fallback
   */
  static toUserRoleWithDefault(value: string | undefined, defaultRole: UserRole = UserRole.VIEWER): UserRole {
    if (!value) return defaultRole
    try {
      return this.toUserRole(value)
    } catch {
      return defaultRole
    }
  }

  /**
   * Safely convert string to UserStatus with default fallback
   */
  static toUserStatusWithDefault(value: string | undefined, defaultStatus: UserStatus = UserStatus.PENDING): UserStatus {
    if (!value) return defaultStatus
    try {
      return this.toUserStatus(value)
    } catch {
      return defaultStatus
    }
  }
}
