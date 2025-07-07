import { prisma } from "@cms-platform/database/client"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import type { Tenant } from "@cms-platform/database/types"

export enum TenantPlan {
  FREE = "FREE",
  BASIC = "BASIC",
  PROFESSIONAL = "PROFESSIONAL",
  ENTERPRISE = "ENTERPRISE",
}

export enum TenantStatus {
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  PENDING = "PENDING",
  ARCHIVED = "ARCHIVED",
}

export enum TenantUserRole {
  OWNER = "OWNER",
  ADMIN = "ADMIN",
  EDITOR = "EDITOR",
  VIEWER = "VIEWER",
}

interface TenantUsageLimits {
  maxUsers: number
  maxStorage: number
  maxContentTypes: number
  maxContents: number
  maxApiRequests: number
  maxWebhooks: number
  maxWorkflows: number
}

interface TenantCurrentUsage {
  users: number
  storage: number
  contentTypes: number
  contents: number
  apiRequests: number
  webhooks: number
  workflows: number
}

interface TenantUser {
  id: string
  email: string
  name: string | null
  role: TenantUserRole
  joinedAt: Date
}

export class TenantService {
  /**
   * Create a new tenant
   */
  public async createTenant(
    data: {
      name: string
      slug: string
      description?: string
      plan?: TenantPlan
      ownerId: string
    },
    options: {
      skipOwnerCheck?: boolean
    } = {},
  ): Promise<Tenant> {
    try {
      const { name, slug, description, plan, ownerId } = data
      const { skipOwnerCheck = false } = options

      // Validate owner exists
      if (!skipOwnerCheck) {
        const owner = await prisma.user.findUnique({ where: { id: ownerId } })
        if (!owner) {
          throw ApiError.badRequest("Owner user does not exist")
        }
      }

      // Check if slug is already taken
      const existingTenant = await prisma.tenant.findUnique({ where: { slug } })
      if (existingTenant) {
        throw ApiError.conflict("Tenant slug is already taken")
      }

      // Set default plan limits based on plan
      const usageLimits = this.getPlanLimits(plan || TenantPlan.FREE)
      const currentUsage = this.getInitialUsage()

      // Create new tenant with transaction
      const tenant = await prisma.$transaction(async (tx) => {
        const newTenant = await tx.tenant.create({
          data: {
            name,
            slug,
            description,
            plan: plan || TenantPlan.FREE,
            status: TenantStatus.ACTIVE,
            usageLimits,
            currentUsage,
          },
        })

        // Create tenant-user relationship with owner role
        await tx.tenantUser.create({
          data: {
            tenantId: newTenant.id,
            userId: ownerId,
            role: TenantUserRole.OWNER,
          },
        })

        return newTenant
      })

      logger.info(`Tenant created: ${tenant.name} (${tenant.id})`)
      return tenant as Tenant
    } catch (error) {
      logger.error("Error creating tenant:", error)
      throw error
    }
  }

  /**
   * Get tenant by ID
   */
  public async getTenantById(id: string, includeUsers = false): Promise<Tenant> {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id },
        include: includeUsers
          ? {
              tenantUsers: {
                include: {
                  user: true,
                },
              },
            }
          : undefined,
      })

      if (!tenant) {
        throw ApiError.notFound("Tenant not found")
      }

      return tenant as Tenant
    } catch (error) {
      logger.error(`Error getting tenant by ID ${id}:`, error)
      throw error
    }
  }

  /**
   * Get tenant by slug
   */
  public async getTenantBySlug(slug: string, includeUsers = false): Promise<Tenant> {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { slug },
        include: includeUsers
          ? {
              tenantUsers: {
                include: {
                  user: true,
                },
              },
            }
          : undefined,
      })

      if (!tenant) {
        throw ApiError.notFound("Tenant not found")
      }

      return tenant as Tenant
    } catch (error) {
      logger.error(`Error getting tenant by slug ${slug}:`, error)
      throw error
    }
  }

  /**
   * Update tenant
   */
  public async updateTenant(
    id: string,
    data: Partial<Omit<Tenant, "id" | "createdAt" | "updatedAt">>,
  ): Promise<Tenant> {
    try {
      // If updating slug, check for conflicts
      if (data.slug) {
        const existingTenant = await prisma.tenant.findFirst({
          where: {
            slug: data.slug,
            NOT: { id },
          },
        })
        if (existingTenant) {
          throw ApiError.conflict("Tenant slug is already taken")
        }
      }

      const tenant = await prisma.tenant.update({
        where: { id },
        data,
      })

      if (!tenant) {
        throw ApiError.notFound("Tenant not found")
      }

      logger.info(`Tenant updated: ${tenant.name} (${tenant.id})`)
      return tenant as Tenant
    } catch (error) {
      logger.error(`Error updating tenant ${id}:`, error)
      throw error
    }
  }

  /**
   * Delete tenant (archive)
   */
  public async deleteTenant(id: string): Promise<void> {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id } })
      if (!tenant) {
        throw ApiError.notFound("Tenant not found")
      }

      // Archive tenant instead of deleting
      await prisma.tenant.update({
        where: { id },
        data: { status: TenantStatus.ARCHIVED },
      })

      logger.info(`Tenant archived: ${tenant.name} (${tenant.id})`)
    } catch (error) {
      logger.error(`Error deleting tenant ${id}:`, error)
      throw error
    }
  }

  /**
   * Permanently delete tenant (use with caution)
   */
  public async permanentlyDeleteTenant(id: string): Promise<void> {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id } })
      if (!tenant) {
        throw ApiError.notFound("Tenant not found")
      }

      await prisma.$transaction(async (tx) => {
        // Delete all tenant-user relationships
        await tx.tenantUser.deleteMany({ where: { tenantId: id } })

        // Delete tenant
        await tx.tenant.delete({ where: { id } })
      })

      logger.info(`Tenant permanently deleted: ${tenant.name} (${tenant.id})`)
    } catch (error) {
      logger.error(`Error permanently deleting tenant ${id}:`, error)
      throw error
    }
  }

  /**
   * List tenants with pagination and filtering
   */
  public async listTenants(options: {
    page?: number
    limit?: number
    status?: TenantStatus
    search?: string
    plan?: TenantPlan
    ownerId?: string
  }): Promise<{
    tenants: Tenant[]
    total: number
    page: number
    limit: number
    totalPages: number
  }> {
    try {
      const { page = 1, limit = 10, status, search, plan, ownerId } = options
      const where: any = {}

      if (status) where.status = status
      if (plan) where.plan = plan

      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { slug: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ]
      }

      if (ownerId) {
        where.tenantUsers = {
          some: {
            userId: ownerId,
            role: TenantUserRole.OWNER,
          },
        }
      }

      const [tenants, total] = await prisma.$transaction([
        prisma.tenant.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            tenantUsers: {
              where: { role: TenantUserRole.OWNER },
              include: { user: true },
            },
          },
        }),
        prisma.tenant.count({ where }),
      ])

      return {
        tenants: tenants as Tenant[],
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
    } catch (error) {
      logger.error("Error listing tenants:", error)
      throw error
    }
  }

  /**
   * Add user to tenant
   */
  public async addUserToTenant(
    tenantId: string,
    data: {
      userId: string
      role: TenantUserRole
    },
  ): Promise<void> {
    try {
      const { userId, role } = data

      // Validate user exists
      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user) {
        throw ApiError.badRequest("User does not exist")
      }

      // Check if user is already in tenant
      const existingTenantUser = await prisma.tenantUser.findUnique({
        where: {
          tenantId_userId: {
            tenantId,
            userId,
          },
        },
      })

      if (existingTenantUser) {
        throw ApiError.conflict("User is already a member of this tenant")
      }

      // Check usage limits
      await this.validateUsageLimit(tenantId, "users")

      // Add user to tenant
      await prisma.$transaction(async (tx) => {
        await tx.tenantUser.create({
          data: {
            tenantId,
            userId,
            role,
          },
        })

        // Update usage count
        await this.incrementUsage(tenantId, "users", 1, tx)
      })

      logger.info(`User ${userId} added to tenant ${tenantId} with role ${role}`)
    } catch (error) {
      logger.error(`Error adding user to tenant ${tenantId}:`, error)
      throw error
    }
  }

  /**
   * Remove user from tenant
   */
  public async removeUserFromTenant(tenantId: string, userId: string): Promise<void> {
    try {
      // Check if user is the owner
      const tenantUser = await prisma.tenantUser.findUnique({
        where: {
          tenantId_userId: {
            tenantId,
            userId,
          },
        },
      })

      if (!tenantUser) {
        throw ApiError.notFound("User is not a member of this tenant")
      }

      if (tenantUser.role === TenantUserRole.OWNER) {
        // Check if there are other owners
        const ownerCount = await prisma.tenantUser.count({
          where: {
            tenantId,
            role: TenantUserRole.OWNER,
          },
        })

        if (ownerCount <= 1) {
          throw ApiError.badRequest("Cannot remove the last owner from tenant")
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.tenantUser.delete({
          where: {
            tenantId_userId: {
              tenantId,
              userId,
            },
          },
        })

        // Update usage count
        await this.decrementUsage(tenantId, "users", 1, tx)
      })

      logger.info(`User ${userId} removed from tenant ${tenantId}`)
    } catch (error) {
      logger.error(`Error removing user from tenant ${tenantId}:`, error)
      throw error
    }
  }

  /**
   * Update user role in tenant
   */
  public async updateUserRole(tenantId: string, userId: string, newRole: TenantUserRole): Promise<void> {
    try {
      const tenantUser = await prisma.tenantUser.findUnique({
        where: {
          tenantId_userId: {
            tenantId,
            userId,
          },
        },
      })

      if (!tenantUser) {
        throw ApiError.notFound("User is not a member of this tenant")
      }

      // If changing from owner role, ensure there's another owner
      if (tenantUser.role === TenantUserRole.OWNER && newRole !== TenantUserRole.OWNER) {
        const ownerCount = await prisma.tenantUser.count({
          where: {
            tenantId,
            role: TenantUserRole.OWNER,
          },
        })

        if (ownerCount <= 1) {
          throw ApiError.badRequest("Cannot change role of the last owner")
        }
      }

      await prisma.tenantUser.update({
        where: {
          tenantId_userId: {
            tenantId,
            userId,
          },
        },
        data: { role: newRole },
      })

      logger.info(`User ${userId} role updated to ${newRole} in tenant ${tenantId}`)
    } catch (error) {
      logger.error(`Error updating user role in tenant ${tenantId}:`, error)
      throw error
    }
  }

  /**
   * Get tenant users
   */
  public async getTenantUsers(
    tenantId: string,
    options: {
      role?: TenantUserRole
      page?: number
      limit?: number
    } = {},
  ): Promise<{
    users: TenantUser[]
    total: number
    page: number
    limit: number
    totalPages: number
  }> {
    try {
      const { role, page = 1, limit = 10 } = options
      const where: any = { tenantId }

      if (role) {
        where.role = role
      }

      const [tenantUsers, total] = await prisma.$transaction([
        prisma.tenantUser.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          include: {
            user: true,
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.tenantUser.count({ where }),
      ])

      const users: TenantUser[] = tenantUsers.map((tu) => ({
        id: tu.user.id,
        email: tu.user.email,
        name: tu.user.name,
        role: tu.role as TenantUserRole,
        joinedAt: tu.createdAt,
      }))

      return {
        users,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
    } catch (error) {
      logger.error(`Error getting tenant users for ${tenantId}:`, error)
      throw error
    }
  }

  /**
   * Get user's tenants
   */
  public async getUserTenants(userId: string): Promise<Array<Tenant & { role: TenantUserRole }>> {
    try {
      const tenantUsers = await prisma.tenantUser.findMany({
        where: { userId },
        include: {
          tenant: true,
        },
      })

      return tenantUsers.map((tu) => ({
        ...tu.tenant,
        role: tu.role as TenantUserRole,
      })) as Array<Tenant & { role: TenantUserRole }>
    } catch (error) {
      logger.error(`Error getting user tenants for ${userId}:`, error)
      throw error
    }
  }

  /**
   * Suspend tenant
   */
  public async suspendTenant(id: string, reason?: string): Promise<void> {
    try {
      await prisma.tenant.update({
        where: { id },
        data: {
          status: TenantStatus.SUSPENDED,
          suspensionReason: reason,
        },
      })

      logger.info(`Tenant ${id} suspended. Reason: ${reason || "No reason provided"}`)
    } catch (error) {
      logger.error(`Error suspending tenant ${id}:`, error)
      throw error
    }
  }

  /**
   * Activate tenant
   */
  public async activateTenant(id: string): Promise<void> {
    try {
      await prisma.tenant.update({
        where: { id },
        data: {
          status: TenantStatus.ACTIVE,
          suspensionReason: null,
        },
      })

      logger.info(`Tenant ${id} activated`)
    } catch (error) {
      logger.error(`Error activating tenant ${id}:`, error)
      throw error
    }
  }

  /**
   * Upgrade/downgrade tenant plan
   */
  public async changeTenantPlan(id: string, newPlan: TenantPlan): Promise<void> {
    try {
      const tenant = await this.getTenantById(id)
      const newLimits = this.getPlanLimits(newPlan)
      const currentUsage = tenant.currentUsage as TenantCurrentUsage

      // Check if current usage exceeds new plan limits
      const violations = this.checkUsageViolations(currentUsage, newLimits)
      if (violations.length > 0) {
        throw ApiError.badRequest(`Cannot downgrade plan. Current usage exceeds new limits: ${violations.join(", ")}`)
      }

      await prisma.tenant.update({
        where: { id },
        data: {
          plan: newPlan,
          usageLimits: newLimits,
        },
      })

      logger.info(`Tenant ${id} plan changed to ${newPlan}`)
    } catch (error) {
      logger.error(`Error changing tenant plan ${id}:`, error)
      throw error
    }
  }

  /**
   * Get tenant usage statistics
   */
  public async getTenantUsage(id: string): Promise<{
    current: TenantCurrentUsage
    limits: TenantUsageLimits
    percentages: Record<string, number>
  }> {
    try {
      const tenant = await this.getTenantById(id)
      const current = tenant.currentUsage as TenantCurrentUsage
      const limits = tenant.usageLimits as TenantUsageLimits

      const percentages = {
        users: (current.users / limits.maxUsers) * 100,
        storage: (current.storage / limits.maxStorage) * 100,
        contentTypes: (current.contentTypes / limits.maxContentTypes) * 100,
        contents: (current.contents / limits.maxContents) * 100,
        apiRequests: (current.apiRequests / limits.maxApiRequests) * 100,
        webhooks: (current.webhooks / limits.maxWebhooks) * 100,
        workflows: (current.workflows / limits.maxWorkflows) * 100,
      }

      return { current, limits, percentages }
    } catch (error) {
      logger.error(`Error getting tenant usage ${id}:`, error)
      throw error
    }
  }

  /**
   * Reset monthly usage counters
   */
  public async resetMonthlyUsage(id: string): Promise<void> {
    try {
      const tenant = await this.getTenantById(id)
      const currentUsage = tenant.currentUsage as TenantCurrentUsage

      await prisma.tenant.update({
        where: { id },
        data: {
          currentUsage: {
            ...currentUsage,
            apiRequests: 0, // Reset monthly counter
          },
        },
      })

      logger.info(`Monthly usage reset for tenant ${id}`)
    } catch (error) {
      logger.error(`Error resetting monthly usage for tenant ${id}:`, error)
      throw error
    }
  }

  /**
   * Bulk operations
   */
  public async bulkUpdateTenantStatus(tenantIds: string[], status: TenantStatus): Promise<number> {
    try {
      const result = await prisma.tenant.updateMany({
        where: {
          id: { in: tenantIds },
        },
        data: { status },
      })

      logger.info(`Bulk updated ${result.count} tenants to status ${status}`)
      return result.count
    } catch (error) {
      logger.error("Error in bulk tenant status update:", error)
      throw error
    }
  }

  /**
   * Check if user has permission in tenant
   */
  public async checkUserPermission(tenantId: string, userId: string, requiredRole: TenantUserRole): Promise<boolean> {
    try {
      const tenantUser = await prisma.tenantUser.findUnique({
        where: {
          tenantId_userId: {
            tenantId,
            userId,
          },
        },
      })

      if (!tenantUser) return false

      const roleHierarchy = {
        [TenantUserRole.VIEWER]: 1,
        [TenantUserRole.EDITOR]: 2,
        [TenantUserRole.ADMIN]: 3,
        [TenantUserRole.OWNER]: 4,
      }

      return roleHierarchy[tenantUser.role as TenantUserRole] >= roleHierarchy[requiredRole]
    } catch (error) {
      logger.error(`Error checking user permission:`, error)
      return false
    }
  }

  // Private helper methods

  private async validateUsageLimit(
    tenantId: string,
    usageType: keyof TenantCurrentUsage,
    increment = 1,
  ): Promise<void> {
    const tenant = await this.getTenantById(tenantId)
    const current = tenant.currentUsage as TenantCurrentUsage
    const limits = tenant.usageLimits as TenantUsageLimits

    const limitKey = `max${usageType.charAt(0).toUpperCase() + usageType.slice(1)}` as keyof TenantUsageLimits
    const currentValue = current[usageType]
    const maxValue = limits[limitKey]

    if (currentValue + increment > maxValue) {
      throw ApiError.badRequest(`Tenant has reached the maximum limit for ${usageType}`)
    }
  }

  private async incrementUsage(
    tenantId: string,
    usageType: keyof TenantCurrentUsage,
    amount = 1,
    tx?: any,
  ): Promise<void> {
    const prismaClient = tx || prisma
    const tenant = await prismaClient.tenant.findUnique({ where: { id: tenantId } })
    const currentUsage = tenant.currentUsage as TenantCurrentUsage

    await prismaClient.tenant.update({
      where: { id: tenantId },
      data: {
        currentUsage: {
          ...currentUsage,
          [usageType]: currentUsage[usageType] + amount,
        },
      },
    })
  }

  private async decrementUsage(
    tenantId: string,
    usageType: keyof TenantCurrentUsage,
    amount = 1,
    tx?: any,
  ): Promise<void> {
    const prismaClient = tx || prisma
    const tenant = await prismaClient.tenant.findUnique({ where: { id: tenantId } })
    const currentUsage = tenant.currentUsage as TenantCurrentUsage

    await prismaClient.tenant.update({
      where: { id: tenantId },
      data: {
        currentUsage: {
          ...currentUsage,
          [usageType]: Math.max(0, currentUsage[usageType] - amount),
        },
      },
    })
  }

  private checkUsageViolations(current: TenantCurrentUsage, limits: TenantUsageLimits): string[] {
    const violations: string[] = []

    if (current.users > limits.maxUsers) violations.push("users")
    if (current.storage > limits.maxStorage) violations.push("storage")
    if (current.contentTypes > limits.maxContentTypes) violations.push("content types")
    if (current.contents > limits.maxContents) violations.push("contents")
    if (current.webhooks > limits.maxWebhooks) violations.push("webhooks")
    if (current.workflows > limits.maxWorkflows) violations.push("workflows")

    return violations
  }

  private getPlanLimits(plan: TenantPlan): TenantUsageLimits {
    switch (plan) {
      case TenantPlan.FREE:
        return {
          maxUsers: 3,
          maxStorage: 100, // 100 MB
          maxContentTypes: 5,
          maxContents: 100,
          maxApiRequests: 1000,
          maxWebhooks: 2,
          maxWorkflows: 1,
        }
      case TenantPlan.BASIC:
        return {
          maxUsers: 10,
          maxStorage: 1024, // 1 GB
          maxContentTypes: 20,
          maxContents: 1000,
          maxApiRequests: 10000,
          maxWebhooks: 10,
          maxWorkflows: 5,
        }
      case TenantPlan.PROFESSIONAL:
        return {
          maxUsers: 25,
          maxStorage: 10240, // 10 GB
          maxContentTypes: 50,
          maxContents: 10000,
          maxApiRequests: 100000,
          maxWebhooks: 25,
          maxWorkflows: 15,
        }
      case TenantPlan.ENTERPRISE:
        return {
          maxUsers: 100,
          maxStorage: 102400, // 100 GB
          maxContentTypes: 200,
          maxContents: 100000,
          maxApiRequests: 1000000,
          maxWebhooks: 100,
          maxWorkflows: 50,
        }
      default:
        return {
          maxUsers: 3,
          maxStorage: 100,
          maxContentTypes: 5,
          maxContents: 100,
          maxApiRequests: 1000,
          maxWebhooks: 2,
          maxWorkflows: 1,
        }
    }
  }

  private getInitialUsage(): TenantCurrentUsage {
    return {
      users: 1, // Owner is the first user
      storage: 0,
      contentTypes: 0,
      contents: 0,
      apiRequests: 0,
      webhooks: 0,
      workflows: 0,
    }
  }
}
