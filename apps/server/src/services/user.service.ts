import { prisma } from "@cms-platform/database/client"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import { hashPassword, comparePassword } from "../utils/crypto.utils"
import { EnumUtils } from "../utils/enum.utils"
import { User, UserRole, UserStatus } from "@prisma/client"

// Define a proper user return type that matches what we actually select
type UserWithoutPassword = {
  id: string
  email: string
  firstName: string
  lastName: string
  avatar: string | null
  role: UserRole
  status: UserStatus
  emailVerified: boolean
  lastLoginAt: Date | null
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date | null
  tenant?: {
    id: string
    name: string
    slug: string
  } | null
  sessions?: any[]
  _count?: {
    sessions: number
    auditLogs: number
  }
}

export class UserService {
  /**
   * Get all users with advanced filtering and pagination
   */
  public async getAllUsers(
    options: {
      search?: string
      role?: string | string[]
      status?: string | string[]
      tenantId?: string
      createdAfter?: Date
      createdBefore?: Date
      lastLoginAfter?: Date
      lastLoginBefore?: Date
      page?: number
      limit?: number
      sort?: string
      order?: "asc" | "desc"
      includeDeleted?: boolean
    } = {},
  ): Promise<{
    users: UserWithoutPassword[]
    total: number
    page: number
    limit: number
    totalPages: number
    stats: {
      byRole: Record<string, number>
      byStatus: Record<string, number>
      totalActive: number
      totalInactive: number
    }
  }> {
    try {
      const {
        search,
        role,
        status,
        tenantId,
        createdAfter,
        createdBefore,
        lastLoginAfter,
        lastLoginBefore,
        page = 1,
        limit = 20,
        sort = "createdAt",
        order = "desc",
        includeDeleted = false,
      } = options

      // Build where clause
      const where: any = {}

      if (!includeDeleted) {
        where.deletedAt = null
      }

      if (search) {
        where.OR = [
          { email: { contains: search, mode: "insensitive" } },
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          {
            AND: [
              { firstName: { contains: search.split(" ")[0], mode: "insensitive" } },
              { lastName: { contains: search.split(" ")[1] || "", mode: "insensitive" } },
            ],
          },
        ]
      }

      if (role) {
        where.role = Array.isArray(role) ? { in: role } : role
      }

      if (status) {
        where.status = Array.isArray(status) ? { in: status } : status
      }

      if (tenantId) {
        where.tenantId = tenantId
      }

      if (createdAfter || createdBefore) {
        where.createdAt = {}
        if (createdAfter) where.createdAt.gte = createdAfter
        if (createdBefore) where.createdAt.lte = createdBefore
      }

      if (lastLoginAfter || lastLoginBefore) {
        where.lastLoginAt = {}
        if (lastLoginAfter) where.lastLoginAt.gte = lastLoginAfter
        if (lastLoginBefore) where.lastLoginAt.lte = lastLoginBefore
      }

      // Get total count and users in parallel
      const [total, users, roleStats, statusStats] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          orderBy: { [sort]: order },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            status: true,
            avatar: true,
            lastLoginAt: true,
            emailVerified: true,
            createdAt: true,
            updatedAt: true,
            tenant: {
              select: { id: true, name: true, slug: true },
            },
            _count: {
              select: {
                sessions: true,
                auditLogs: true,
              },
            },
          },
        }),
        prisma.user.groupBy({
          by: ["role"],
          where: { ...where, deletedAt: null },
          _count: { role: true },
        }),
        prisma.user.groupBy({
          by: ["status"],
          where: { ...where, deletedAt: null },
          _count: { status: true },
        }),
      ])

      // Build stats
      const byRole = roleStats.reduce(
        (acc, s) => {
          acc[s.role] = s._count.role || 0
          return acc
        },
        {} as Record<string, number>,
      )

      const byStatus = statusStats.reduce(
        (acc, s) => {
          acc[s.status] = s._count.status || 0
          return acc
        },
        {} as Record<string, number>,
      )

      return {
        users: users as UserWithoutPassword[],
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        stats: {
          byRole,
          byStatus,
          totalActive: byStatus["ACTIVE"] || 0,
          totalInactive: (byStatus["INACTIVE"] || 0) + (byStatus["SUSPENDED"] || 0),
        },
      }
    } catch (error) {
      logger.error("Error getting all users:", error)
      throw error
    }
  }

  /**
   * Get user by ID
   */
  public async getUserById(id: string, includeDeleted = false): Promise<UserWithoutPassword> {
    try {
      const user = await prisma.user.findFirst({
        where: {
          id,
          ...(includeDeleted ? {} : { deletedAt: null }),
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          avatar: true,
          lastLoginAt: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          tenant: {
            select: { id: true, name: true, slug: true },
          },
          sessions: {
            where: { expires: { gt: new Date() } },
            take: 5,
          },
          _count: {
            select: {
              sessions: true,
              auditLogs: true,
            },
          },
        },
      })

      if (!user) {
        throw ApiError.notFound(`User not found with ID: ${id}`)
      }

      return user as UserWithoutPassword
    } catch (error) {
      logger.error(`Error getting user by ID ${id}:`, error)
      throw error
    }
  }

  /**
   * Get user by email
   */
  public async getUserByEmail(email: string, includePassword = false): Promise<User | UserWithoutPassword> {
    try {
      const user = await prisma.user.findFirst({
        where: {
          email: email.toLowerCase(),
          deletedAt: null,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          avatar: true,
          lastLoginAt: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          password: includePassword,
          tenant: {
            select: { id: true, name: true, slug: true },
          },
        },
      })

      if (!user) {
        throw ApiError.notFound(`User not found with email: ${email}`)
      }

      return user as User | UserWithoutPassword
    } catch (error) {
      logger.error(`Error getting user by email ${email}:`, error)
      throw error
    }
  }

  /**
   * Create user
   */
  public async createUser(data: {
    email: string
    password: string
    firstName: string
    lastName: string
    role?: string
    status?: string
    avatar?: string
    tenantId?: string
    skipEmailVerification?: boolean
  }): Promise<UserWithoutPassword> {
    try {
      const {
        email,
        password,
        firstName,
        lastName,
        role = "VIEWER",
        status = "PENDING",
        avatar,
        tenantId,
        skipEmailVerification = false,
      } = data

      // Check if user already exists
      const existingUser = await prisma.user.findFirst({
        where: {
          email: email.toLowerCase(),
          deletedAt: null,
        },
      })

      if (existingUser) {
        throw ApiError.conflict("User with this email already exists")
      }

      // Hash password
      const hashedPassword = await hashPassword(password)

      // Convert enum values safely
      const userRole = EnumUtils.toUserRoleWithDefault(role, UserRole.VIEWER)
      const userStatus = EnumUtils.toUserStatusWithDefault(
        skipEmailVerification ? "ACTIVE" : status,
        UserStatus.PENDING
      )

      // Create user
      const user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          password: hashedPassword,
          firstName,
          lastName,
          role: userRole,
          status: userStatus,
          avatar,
          emailVerified: skipEmailVerification,
          tenantId,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          avatar: true,
          lastLoginAt: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      logger.info(`Created user: ${user.email} (${user.id})`)
      return user as UserWithoutPassword
    } catch (error) {
      logger.error("Error creating user:", error)
      throw error
    }
  }

  /**
   * Update user
   */
  public async updateUser(
    id: string,
    data: {
      email?: string
      firstName?: string
      lastName?: string
      role?: string
      status?: string
      avatar?: string
    },
  ): Promise<UserWithoutPassword> {
    try {
      // Check if user exists
      const existingUser = await prisma.user.findFirst({
        where: { id, deletedAt: null },
      })

      if (!existingUser) {
        throw ApiError.notFound(`User not found with ID: ${id}`)
      }

      // Check if email is being changed and if it's already in use
      if (data.email && data.email.toLowerCase() !== existingUser.email) {
        const emailExists = await prisma.user.findFirst({
          where: {
            email: data.email.toLowerCase(),
            deletedAt: null,
            NOT: { id },
          },
        })

        if (emailExists) {
          throw ApiError.conflict("User with this email already exists")
        }
      }

      // Prepare update data with enum conversions
      const updateData: any = {
        updatedAt: new Date(),
      }

      if (data.email) updateData.email = data.email.toLowerCase()
      if (data.firstName) updateData.firstName = data.firstName
      if (data.lastName) updateData.lastName = data.lastName
      if (data.avatar) updateData.avatar = data.avatar
      if (data.role) updateData.role = EnumUtils.toUserRole(data.role)
      if (data.status) updateData.status = EnumUtils.toUserStatus(data.status)

      // Update user
      const updatedUser = await prisma.user.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          avatar: true,
          lastLoginAt: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          tenant: {
            select: { id: true, name: true, slug: true },
          },
        },
      })

      logger.info(`Updated user: ${updatedUser.email} (${updatedUser.id})`)
      return updatedUser as UserWithoutPassword
    } catch (error) {
      logger.error(`Error updating user ${id}:`, error)
      throw error
    }
  }

  /**
   * Delete user (soft delete)
   */
  public async deleteUser(id: string, hardDelete = false): Promise<void> {
    try {
      const user = await prisma.user.findFirst({
        where: { id, deletedAt: null },
      })

      if (!user) {
        throw ApiError.notFound(`User not found with ID: ${id}`)
      }

      if (hardDelete) {
        // Hard delete - remove all related data
        await prisma.$transaction(async (tx) => {
          // Delete user sessions
          await tx.session.deleteMany({ where: { userId: id } })

          // Delete user
          await tx.user.delete({ where: { id } })
        })
      } else {
        // Soft delete
        await prisma.$transaction(async (tx) => {
          // Invalidate all sessions
          await tx.session.deleteMany({ where: { userId: id } })

          // Soft delete user
          await tx.user.update({
            where: { id },
            data: {
              deletedAt: new Date(),
              status: UserStatus.INACTIVE,
            },
          })
        })
      }

      logger.info(`${hardDelete ? "Hard" : "Soft"} deleted user: ${user.email} (${user.id})`)
    } catch (error) {
      logger.error(`Error deleting user ${id}:`, error)
      throw error
    }
  }

  /**
   * Restore soft deleted user
   */
  public async restoreUser(id: string): Promise<UserWithoutPassword> {
    try {
      const user = await prisma.user.findFirst({
        where: { id, deletedAt: { not: null } },
      })

      if (!user) {
        throw ApiError.notFound(`Deleted user not found with ID: ${id}`)
      }

      const restoredUser = await prisma.user.update({
        where: { id },
        data: {
          deletedAt: null,
          status: UserStatus.ACTIVE,
          updatedAt: new Date(),
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          avatar: true,
          lastLoginAt: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      logger.info(`Restored user: ${restoredUser.email} (${restoredUser.id})`)
      return restoredUser as UserWithoutPassword
    } catch (error) {
      logger.error(`Error restoring user ${id}:`, error)
      throw error
    }
  }

  /**
   * Change password
   */
  public async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    try {
      const user = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true, password: true, email: true },
      })

      if (!user) {
        throw ApiError.notFound(`User not found with ID: ${userId}`)
      }

      // Verify current password
      const isPasswordValid = await comparePassword(currentPassword, user.password)
      if (!isPasswordValid) {
        throw ApiError.unauthorized("Current password is incorrect")
      }

      // Hash new password
      const hashedPassword = await hashPassword(newPassword)

      // Update password and invalidate all sessions
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            password: hashedPassword,
            updatedAt: new Date(),
          },
        })

        // Invalidate all user sessions
        await tx.session.deleteMany({ where: { userId } })
      })

      logger.info(`Password changed for user: ${user.email} (${user.id})`)
    } catch (error) {
      logger.error(`Error changing password for user ${userId}:`, error)
      throw error
    }
  }

  /**
   * Update user status
   */
  public async updateUserStatus(id: string, status: string): Promise<UserWithoutPassword> {
    try {
      const userStatus = EnumUtils.toUserStatus(status)

      const user = await prisma.user.update({
        where: { id },
        data: {
          status: userStatus,
          updatedAt: new Date(),
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          avatar: true,
          lastLoginAt: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      // If suspending user, invalidate all sessions
      if (userStatus === UserStatus.SUSPENDED) {
        await prisma.session.deleteMany({ where: { userId: id } })
      }

      logger.info(`Updated user status to ${status}: ${user.email} (${user.id})`)
      return user as Omit<User, "password">
    } catch (error) {
      logger.error(`Error updating user status ${id}:`, error)
      throw error
    }
  }

  /**
   * Update user role
   */
  public async updateUserRole(id: string, role: string): Promise<Omit<User, "password">> {
    try {
      const userRole = EnumUtils.toUserRole(role)

      const user = await prisma.user.update({
        where: { id },
        data: {
          role: userRole,
          updatedAt: new Date(),
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          avatar: true,
          lastLoginAt: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      logger.info(`Updated user role to ${role}: ${user.email} (${user.id})`)
      return user as Omit<User, "password">
    } catch (error) {
      logger.error(`Error updating user role ${id}:`, error)
      throw error
    }
  }

  /**
   * Verify user email
   */
  public async verifyEmail(id: string): Promise<Omit<User, "password">> {
    try {
      const user = await prisma.user.update({
        where: { id },
        data: {
          emailVerified: true,
          status: UserStatus.ACTIVE,
          updatedAt: new Date(),
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          avatar: true,
          lastLoginAt: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      logger.info(`Email verified for user: ${user.email} (${user.id})`)
      return user as Omit<User, "password">
    } catch (error) {
      logger.error(`Error verifying email for user ${id}:`, error)
      throw error
    }
  }

  /**
   * Update last login
   */
  public async updateLastLogin(id: string): Promise<void> {
    try {
      await prisma.user.update({
        where: { id },
        data: { lastLoginAt: new Date() },
      })
    } catch (error) {
      logger.error(`Error updating last login for user ${id}:`, error)
      // Don't throw error for this operation
    }
  }

  /**
   * Search users
   */
  public async searchUsers(
    query: string,
    options: {
      tenantId?: string
      role?: string[]
      status?: string[]
      limit?: number
    } = {},
  ): Promise<Omit<User, "password">[]> {
    try {
      const { tenantId, role, status, limit = 10 } = options

      const where: any = {
        deletedAt: null,
        OR: [
          { email: { contains: query, mode: "insensitive" } },
          { firstName: { contains: query, mode: "insensitive" } },
          { lastName: { contains: query, mode: "insensitive" } },
        ],
      }

      if (role && role.length > 0) {
        where.role = { in: role }
      }

      if (status && status.length > 0) {
        where.status = { in: status }
      }

      if (tenantId) {
        where.tenantId = tenantId
      }

      const users = await prisma.user.findMany({
        where,
        take: limit,
        orderBy: [
          { status: "asc" }, // Active users first
          { firstName: "asc" },
        ],
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          avatar: true,
          lastLoginAt: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      return users as Omit<User, "password">[]
    } catch (error) {
      logger.error(`Error searching users with query "${query}":`, error)
      throw error
    }
  }

  /**
   * Bulk update users
   */
  public async bulkUpdateUsers(
    userIds: string[],
    data: {
      role?: string
      status?: string
    },
  ): Promise<number> {
    try {
      const updateData: any = {
        updatedAt: new Date(),
      }

      if (data.role) {
        updateData.role = EnumUtils.toUserRole(data.role)
      }
      if (data.status) {
        updateData.status = EnumUtils.toUserStatus(data.status)
      }

      const result = await prisma.user.updateMany({
        where: {
          id: { in: userIds },
          deletedAt: null,
        },
        data: updateData,
      })

      logger.info(`Bulk updated ${result.count} users`)
      return result.count
    } catch (error) {
      logger.error("Error in bulk user update:", error)
      throw error
    }
  }

  /**
   * Get user activity summary
   */
  public async getUserActivity(
    userId: string,
    days = 30,
  ): Promise<{
    loginCount: number
    lastLogin: Date | null
    sessionCount: number
    auditLogCount: number
  }> {
    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

      const [user, sessionCount, auditLogCount] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { lastLoginAt: true },
        }),
        prisma.session.count({
          where: {
            userId,
            expires: { gte: since },
          },
        }),
        prisma.auditLog.count({
          where: {
            userId,
            createdAt: { gte: since },
          },
        }),
      ])

      if (!user) {
        throw ApiError.notFound(`User not found with ID: ${userId}`)
      }

      return {
        loginCount: sessionCount,
        lastLogin: user.lastLoginAt,
        sessionCount,
        auditLogCount,
      }
    } catch (error) {
      logger.error(`Error getting user activity for ${userId}:`, error)
      throw error
    }
  }

  /**
   * Get user sessions
   */
  public async getUserSessions(userId: string): Promise<any[]> {
    try {
      return await prisma.session.findMany({
        where: {
          userId,
          expires: { gt: new Date() },
        },
        orderBy: {
          expires: "desc",
        },
      })
    } catch (error) {
      logger.error(`Error getting user sessions for ${userId}:`, error)
      throw error
    }
  }

  /**
   * Clean up expired sessions
   */
  public async cleanupExpiredSessions(): Promise<number> {
    try {
      const result = await prisma.session.deleteMany({
        where: {
          expires: { lt: new Date() },
        },
      })

      logger.info(`Cleaned up ${result.count} expired sessions`)
      return result.count
    } catch (error) {
      logger.error("Error cleaning up expired sessions:", error)
      throw error
    }
  }
}

// Export singleton instance
export const userService = new UserService()
