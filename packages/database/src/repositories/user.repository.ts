// =============================================================================
// USER REPOSITORY - POSTGRESQL
// =============================================================================
// User management with authentication and multi-tenant support

import { PrismaClient, User, UserRole, UserStatus, Prisma } from '@prisma/client'
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
   * Find user by email or throw
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
  async createWithHashedPassword(data: UserCreateInput & { password: string }): Promise<User> {
    const hashedPassword = await bcrypt.hash(data.password, 12)
    
    return this.create({
      ...data,
      password: hashedPassword,
    })
  }

  /**
   * Update user password
   */
  async updatePassword(userId: string, newPassword: string): Promise<User> {
    const hashedPassword = await bcrypt.hash(newPassword, 12)
    
    return this.update(userId, {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpires: null,
    })
  }

  /**
   * Verify user password
   */
  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.findByIdOrThrow(userId)
    return bcrypt.compare(password, user.password)
  }

  /**
   * Update last login
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
  async incrementLoginAttempts(userId: string): Promise<User> {
    const user = await this.findByIdOrThrow(userId)
    const loginAttempts = user.loginAttempts + 1
    
    // Lock account after 5 failed attempts for 2 hours
    const updates: any = { loginAttempts }
    if (loginAttempts >= 5) {
      const lockUntil = new Date()
      lockUntil.setHours(lockUntil.getHours() + 2)
      updates.lockUntil = lockUntil
    }

    return this.update(userId, updates)
  }

  /**
   * Reset login attempts
   */
  async resetLoginAttempts(userId: string): Promise<User> {
    return this.update(userId, {
      loginAttempts: 0,
      lockUntil: null,
    })
  }

  /**
   * Check if user is locked
   */
  async isLocked(userId: string): Promise<boolean> {
    const user = await this.findByIdOrThrow(userId)
    return user.lockUntil ? user.lockUntil > new Date() : false
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
   * Verify email
   */
  async verifyEmail(token: string): Promise<User | null> {
    const user = await this.findFirst({
      emailVerificationToken: token,
    })

    if (!user) {
      return null
    }

    return this.update(user.id, {
      emailVerified: true,
      emailVerificationToken: null,
      status: UserStatus.ACTIVE,
    })
  }

  /**
   * Set password reset token
   */
  async setPasswordResetToken(userId: string, token: string, expiresAt: Date): Promise<User> {
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

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Find users by status
   */
  async findByStatus(status: UserStatus, tenantId?: string): Promise<User[]> {
    const where: any = { status }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Find active users
   */
  async findActive(tenantId?: string): Promise<User[]> {
    const where: any = { 
      isActive: true,
      status: UserStatus.ACTIVE,
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { lastLoginAt: 'desc' })
  }

  /**
   * Search users
   */
  async search(
    query: string, 
    tenantId?: string,
    options: {
      role?: UserRole
      status?: UserStatus
      limit?: number
      offset?: number
    } = {}
  ): Promise<User[]> {
    const { role, status, limit = 50, offset = 0 } = options

    const where: any = {
      OR: [
        { email: { contains: query, mode: 'insensitive' } },
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
      ],
    }

    if (role) {
      where.role = role
    }

    if (status) {
      where.status = status
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      })
    } catch (error) {
      this.handleError(error, 'search')
    }
  }

  /**
   * Update user role
   */
  async updateRole(userId: string, role: UserRole): Promise<User> {
    return this.update(userId, { role })
  }

  /**
   * Update user status
   */
  async updateStatus(userId: string, status: UserStatus): Promise<User> {
    return this.update(userId, { status })
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
   * Suspend user
   */
  async suspend(userId: string): Promise<User> {
    return this.update(userId, {
      status: UserStatus.SUSPENDED,
    })
  }

  /**
   * Update user preferences
   */
  async updatePreferences(userId: string, preferences: Record<string, any>): Promise<User> {
    const user = await this.findByIdOrThrow(userId)
    const currentPreferences = (user.preferences as Record<string, any>) || {}
    
    return this.update(userId, {
      preferences: {
        ...currentPreferences,
        ...preferences,
      },
    })
  }

  /**
   * Find users with relations
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
   * Get user statistics
   */
  async getStatistics(tenantId?: string): Promise<{
    total: number
    active: number
    inactive: number
    suspended: number
    pending: number
    byRole: Record<string, number>
    recentLogins: number
  }> {
    const where: any = {}
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      const [
        total,
        active,
        inactive,
        suspended,
        pending,
        roleStats,
        recentLogins,
      ] = await Promise.all([
        this.count(where),
        this.count({ ...where, status: UserStatus.ACTIVE }),
        this.count({ ...where, status: UserStatus.INACTIVE }),
        this.count({ ...where, status: UserStatus.SUSPENDED }),
        this.count({ ...where, status: UserStatus.PENDING }),
        this.prisma.user.groupBy({
          by: ['role'],
          where,
          _count: { _all: true },
        }),
        this.count({
          ...where,
          lastLoginAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        }),
      ])

      // Group by role
      const byRole: Record<string, number> = {}
      roleStats.forEach(stat => {
        byRole[stat.role] = stat._count._all
      })

      return {
        total,
        active,
        inactive,
        suspended,
        pending,
        byRole,
        recentLogins,
      }
    } catch (error) {
      this.handleError(error, 'getStatistics')
    }
  }

  /**
   * Find users by creation date range
   */
  async findByCreationDate(
    startDate: Date, 
    endDate: Date, 
    tenantId?: string
  ): Promise<User[]> {
    const where: any = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Find users by last login date range
   */
  async findByLastLoginDate(
    startDate: Date, 
    endDate: Date, 
    tenantId?: string
  ): Promise<User[]> {
    const where: any = {
      lastLoginAt: {
        gte: startDate,
        lte: endDate,
      },
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { lastLoginAt: 'desc' })
  }

  /**
   * Bulk update user status
   */
  async bulkUpdateStatus(userIds: string[], status: UserStatus): Promise<number> {
    const result = await this.prisma.user.updateMany({
      where: {
        id: { in: userIds },
      },
      data: { status },
    })

    return result.count
  }

  /**
   * Bulk update user role
   */
  async bulkUpdateRole(userIds: string[], role: UserRole): Promise<number> {
    const result = await this.prisma.user.updateMany({
      where: {
        id: { in: userIds },
      },
      data: { role },
    })

    return result.count
  }
}
