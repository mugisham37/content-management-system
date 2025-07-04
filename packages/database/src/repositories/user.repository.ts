// =============================================================================
// USER REPOSITORY - POSTGRESQL
// =============================================================================
// Enhanced user management with authentication and security features

import { PrismaClient, User, Prisma, UserRole, UserStatus } from '@prisma/client'
import { BaseRepository } from './base.repository'
import bcrypt from 'bcryptjs'

export type UserCreateInput = Prisma.UserCreateInput
export type UserUpdateInput = Prisma.UserUpdateInput

export interface UserWithRelations extends User {
  tenant?: any
  accounts?: any[]
  sessions?: any[]
  createdContents?: any[]
  updatedContents?: any[]
  publishedContents?: any[]
  createdContentTypes?: any[]
  uploadedMedia?: any[]
  createdApiKeys?: any[]
}

export class UserRepository extends BaseRepository<User, UserCreateInput, UserUpdateInput> {
  protected modelName = 'User'
  protected model = this.prisma.user

  constructor(prisma: PrismaClient) {
    super(prisma)
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string, tenantId?: string): Promise<User | null> {
    const where: any = { email }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findFirst(where)
  }

  /**
   * Find user by email or throw error
   */
  async findByEmailOrThrow(email: string, tenantId?: string): Promise<User> {
    const user = await this.findByEmail(email, tenantId)
    if (!user) {
      throw new Error(`User not found with email: ${email}`)
    }
    return user
  }

  /**
   * Check if user exists by email
   */
  async existsByEmail(email: string, tenantId?: string): Promise<boolean> {
    const where: any = { email }
    if (tenantId) {
      where.tenantId = tenantId
    }

    const count = await this.count(where)
    return count > 0
  }

  /**
   * Create user with hashed password
   */
  async createWithHashedPassword(
    data: Omit<UserCreateInput, 'password'> & { password: string },
    saltRounds = 12
  ): Promise<User> {
    const hashedPassword = await bcrypt.hash(data.password, saltRounds)
    
    return this.create({
      ...data,
      password: hashedPassword,
    })
  }

  /**
   * Verify user password
   */
  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.findByIdOrThrow(userId)
    if (!user.password) {
      return false
    }
    return bcrypt.compare(password, user.password)
  }

  /**
   * Update user password
   */
  async updatePassword(userId: string, newPassword: string, saltRounds = 12): Promise<User> {
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds)
    
    return this.update(userId, {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpires: null,
    })
  }

  /**
   * Update last login timestamp
   */
  async updateLastLogin(userId: string): Promise<User> {
    return this.update(userId, {
      lastLoginAt: new Date(),
      loginAttempts: 0,
      lockUntil: null,
    })
  }

  /**
   * Increment login attempts
   */
  async incrementLoginAttempts(userId: string, maxAttempts = 5, lockDuration = 2 * 60 * 60 * 1000): Promise<User> {
    const user = await this.findByIdOrThrow(userId)
    const newAttempts = user.loginAttempts + 1

    const updateData: any = {
      loginAttempts: newAttempts,
    }

    // Lock account if max attempts reached
    if (newAttempts >= maxAttempts) {
      updateData.lockUntil = new Date(Date.now() + lockDuration)
    }

    return this.update(userId, updateData)
  }

  /**
   * Check if user account is locked
   */
  async isAccountLocked(userId: string): Promise<boolean> {
    const user = await this.findByIdOrThrow(userId)
    return user.lockUntil ? user.lockUntil > new Date() : false
  }

  /**
   * Unlock user account
   */
  async unlockAccount(userId: string): Promise<User> {
    return this.update(userId, {
      loginAttempts: 0,
      lockUntil: null,
    })
  }

  /**
   * Set email verification token
   */
  async setEmailVerificationToken(userId: string, token: string): Promise<User> {
    return this.update(userId, {
      emailVerificationToken: token,
    })
  }

  /**
   * Verify email with token
   */
  async verifyEmailWithToken(token: string): Promise<User | null> {
    const user = await this.findFirst({
      emailVerificationToken: token,
    })

    if (!user) {
      return null
    }

    return this.update(user.id, {
      emailVerified: new Date(),
      emailVerificationToken: null,
    })
  }

  /**
   * Set password reset token
   */
  async setPasswordResetToken(userId: string, token: string, expiresIn = 60 * 60 * 1000): Promise<User> {
    const expiresAt = new Date(Date.now() + expiresIn)
    
    return this.update(userId, {
      passwordResetToken: token,
      passwordResetExpires: expiresAt,
    })
  }

  /**
   * Find user by password reset token
   */
  async findByPasswordResetToken(token: string): Promise<User | null> {
    return this.findFirst({
      passwordResetToken: token,
      passwordResetExpires: {
        gt: new Date(),
      },
    })
  }

  /**
   * Find users by role
   */
  async findByRole(role: UserRole, tenantId?: string): Promise<User[]> {
    const where: any = { role }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where)
  }

  /**
   * Find users by status
   */
  async findByStatus(status: UserStatus, tenantId?: string): Promise<User[]> {
    const where: any = { status }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where)
  }

  /**
   * Find active users
   */
  async findActive(tenantId?: string): Promise<User[]> {
    const where: any = { isActive: true }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where)
  }

  /**
   * Activate user
   */
  async activate(userId: string): Promise<User> {
    return this.update(userId, {
      isActive: true,
      status: UserStatus.ACTIVE,
    })
  }

  /**
   * Deactivate user
   */
  async deactivate(userId: string): Promise<User> {
    return this.update(userId, {
      isActive: false,
      status: UserStatus.INACTIVE,
    })
  }

  /**
   * Change user role
   */
  async changeRole(userId: string, role: UserRole): Promise<User> {
    return this.update(userId, { role })
  }

  /**
   * Search users by name or email
   */
  async search(query: string, tenantId?: string): Promise<User[]> {
    const where: any = {
      OR: [
        { email: { contains: query, mode: 'insensitive' } },
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
      ],
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where)
  }

  /**
   * Get user statistics
   */
  async getStatistics(tenantId?: string): Promise<{
    total: number
    active: number
    inactive: number
    byRole: Record<UserRole, number>
    byStatus: Record<UserStatus, number>
  }> {
    const where: any = {}
    if (tenantId) {
      where.tenantId = tenantId
    }

    const [
      total,
      active,
      inactive,
      roleStats,
      statusStats,
    ] = await Promise.all([
      this.count(where),
      this.count({ ...where, isActive: true }),
      this.count({ ...where, isActive: false }),
      this.prisma.user.groupBy({
        by: ['role'],
        where,
        _count: true,
      }),
      this.prisma.user.groupBy({
        by: ['status'],
        where,
        _count: true,
      }),
    ])

    const byRole = Object.values(UserRole).reduce((acc, role) => {
      acc[role] = roleStats.find(stat => stat.role === role)?._count || 0
      return acc
    }, {} as Record<UserRole, number>)

    const byStatus = Object.values(UserStatus).reduce((acc, status) => {
      acc[status] = statusStats.find(stat => stat.status === status)?._count || 0
      return acc
    }, {} as Record<UserStatus, number>)

    return {
      total,
      active,
      inactive,
      byRole,
      byStatus,
    }
  }

  /**
   * Find users with their relations
   */
  async findWithRelations(
    where?: Record<string, any>,
    includeRelations: {
      tenant?: boolean
      accounts?: boolean
      sessions?: boolean
      createdContents?: boolean
      updatedContents?: boolean
      publishedContents?: boolean
    } = {}
  ): Promise<UserWithRelations[]> {
    return this.findMany(where, includeRelations) as Promise<UserWithRelations[]>
  }

  /**
   * Clean up expired tokens and sessions
   */
  async cleanupExpiredTokens(): Promise<{ count: number }> {
    return this.updateMany(
      {
        OR: [
          {
            passwordResetExpires: {
              lt: new Date(),
            },
          },
          {
            lockUntil: {
              lt: new Date(),
            },
          },
        ],
      },
      {
        passwordResetToken: null,
        passwordResetExpires: null,
        lockUntil: null,
        loginAttempts: 0,
      }
    )
  }
}
