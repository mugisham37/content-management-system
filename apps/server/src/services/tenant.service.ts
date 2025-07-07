import { prisma } from "@cms-platform/database/client"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import type { Tenant, TenantPlan, UserRole, Prisma } from "@prisma/client"
import { SafeTenantUpdateInput, SafeUserUpdateInput } from "../types/prisma.types"
import { TenantUpdateData, UserUpdateData, TenantUsageLimits, TenantCurrentUsage } from "../types/tenant.types"
import { 
  validateUserRole, 
  validateTenantPlan, 
  convertJsonValueToInputJson, 
  processUsageLimitKey 
} from "../utils/validation"

export enum TenantUserRole {
  OWNER = "SUPER_ADMIN",
  ADMIN = "ADMIN",
  EDITOR = "EDITOR",
  VIEWER = "VIEWER",
}

interface TenantUser {
  id: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
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
      const usageLimits = this.getPlanLimits(plan || "FREE")
      const currentUsage = this.getInitialUsage()

      // Create new tenant with transaction
      const tenant = await prisma.$transaction(async (tx) => {
        const newTenant = await tx.tenant.create({
          data: {
            name,
            slug,
            description,
            plan: plan || "FREE",
            status: "ACTIVE",
            usageLimits: usageLimits as any,
            currentUsage: currentUsage as any,
          },
        })

        // Update user to be associated with this tenant and set as owner
        await tx.user.update({
          where: { id: ownerId },
          data: {
            tenantId: newTenant.id,
            role: "SUPER_ADMIN", // Owner role
          },
        })

        return newTenant
      })

      logger.info(`Tenant created: ${tenant.name} (${tenant.id})`)
      return tenant
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
              users: true,
            }
          : undefined,
      })

      if (!tenant) {
        throw ApiError.notFound("Tenant not found")
      }

      return tenant
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
              users: true,
            }
          : undefined,
      })

      if (!tenant) {
        throw ApiError.notFound("Tenant not found")
      }

      return tenant
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
    data: TenantUpdateData,
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

      // Validate and convert plan if provided
      if (data.plan && typeof data.plan === 'string') {
        data.plan = validateTenantPlan(data.plan);
      }

      // Prepare update data with proper JSON conversion
      const updateData: SafeTenantUpdateInput = {
        ...data,
        usageLimits: data.usageLimits ? convertJsonValueToInputJson(data.usageLimits) : undefined,
        currentUsage: data.currentUsage ? convertJsonValueToInputJson(data.currentUsage) : undefined,
        settings: data.settings ? convertJsonValueToInputJson(data.settings) : undefined,
        securitySettings: data.securitySettings ? convertJsonValueToInputJson(data.securitySettings) : undefined,
        customBranding: data.customBranding ? convertJsonValueToInputJson(data.customBranding) : undefined,
        billingInfo: data.billingInfo ? convertJsonValueToInputJson(data.billingInfo) : undefined,
      };

      const tenant = await prisma.tenant.update({
        where: { id },
        data: updateData as Prisma.TenantUpdateInput,
      })

      if (!tenant) {
        throw ApiError.notFound("Tenant not found")
      }

      logger.info(`Tenant updated: ${tenant.name} (${tenant.id})`)
      return tenant
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
        data: { status: "ARCHIVED" },
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
        // Update all users to remove tenant association
        await tx.user.updateMany({
          where: { tenantId: id },
          data: { tenantId: null },
        })

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
    status?: string
    search?: string
    plan?: string
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
        where.users = {
          some: {
            id: ownerId,
            role: "SUPER_ADMIN",
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
            users: {
              where: { role: "SUPER_ADMIN" },
            },
          },
        }),
        prisma.tenant.count({ where }),
      ])

      return {
        tenants,
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
      role: string
    },
  ): Promise<void> {
    try {
      const { userId, role } = data

      // Validate user exists
      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user) {
        throw ApiError.badRequest("User does not exist")
      }

      // Check if user is already in a tenant
      if (user.tenantId) {
        throw ApiError.conflict("User is already a member of another tenant")
      }

      // Check usage limits
      await this.validateUsageLimit(tenantId, "users")

      // Validate and convert role
      const validatedRole = validateUserRole(role);

      // Add user to tenant
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            tenantId,
            role: validatedRole,
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
      // Check if user exists and is in the tenant
      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user || user.tenantId !== tenantId) {
        throw ApiError.notFound("User is not a member of this tenant")
      }

      if (user.role === "SUPER_ADMIN") {
        // Check if there are other owners
        const ownerCount = await prisma.user.count({
          where: {
            tenantId,
            role: "SUPER_ADMIN",
          },
        })

        if (ownerCount <= 1) {
          throw ApiError.badRequest("Cannot remove the last owner from tenant")
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            tenantId: null,
            role: "VIEWER", // Reset to default role
          },
        })

        // Decrement usage count
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
  public async updateUserRole(tenantId: string, userId: string, newRole: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user || user.tenantId !== tenantId) {
        throw ApiError.notFound("User is not a member of this tenant")
      }

      // If demoting the last owner, prevent it
      if (user.role === "SUPER_ADMIN" && newRole !== "SUPER_ADMIN") {
        const ownerCount = await prisma.user.count({
          where: {
            tenantId,
            role: "SUPER_ADMIN",
          },
        })

        if (ownerCount <= 1) {
          throw ApiError.badRequest("Cannot demote the last owner of the tenant")
        }
      }

      // Validate and convert role
      const validatedRole = validateUserRole(newRole);

      await prisma.user.update({
        where: { id: userId },
        data: { role: validatedRole },
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
      page?: number
      limit?: number
      role?: string
      search?: string
    } = {},
  ): Promise<{
    users: TenantUser[]
    total: number
    page: number
    limit: number
    totalPages: number
  }> {
    try {
      const { page = 1, limit = 10, role, search } = options
      const where: any = { tenantId }

      if (role) where.role = role
      if (search) {
        where.OR = [
          { email: { contains: search, mode: "insensitive" } },
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
        ]
      }

      const [users, total] = await prisma.$transaction([
        prisma.user.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            createdAt: true,
          },
        }),
        prisma.user.count({ where }),
      ])

      const tenantUsers: TenantUser[] = users.map((user) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        joinedAt: user.createdAt,
      }))

      return {
        users: tenantUsers,
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
   * Update tenant plan
   */
  public async updateTenantPlan(tenantId: string, newPlan: string): Promise<Tenant> {
    try {
      const tenant = await this.getTenantById(tenantId)
      
      // Validate and convert plan
      const validatedPlan = validateTenantPlan(newPlan);
      const newLimits = this.getPlanLimits(newPlan)

      const updatedTenant = await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          plan: validatedPlan,
          usageLimits: newLimits as any,
        },
      })

      logger.info(`Tenant ${tenantId} plan updated to ${newPlan}`)
      return updatedTenant
    } catch (error) {
      logger.error(`Error updating tenant plan for ${tenantId}:`, error)
      throw error
    }
  }

  /**
   * Get tenant usage statistics
   */
  public async getTenantUsage(tenantId: string): Promise<{
    limits: TenantUsageLimits
    current: TenantCurrentUsage
    percentages: Record<string, number>
  }> {
    try {
      const tenant = await this.getTenantById(tenantId)
      const limits = tenant.usageLimits as TenantUsageLimits
      const current = tenant.currentUsage as TenantCurrentUsage

      // Calculate usage percentages
      const percentages: Record<string, number> = {}
      Object.keys(limits).forEach((key) => {
        if (key.startsWith("max")) {
          const usageKey = key.replace("max", "").toLowerCase()
          const currentValue = current[usageKey] || 0
          const limitValue = limits[key] || 1
          percentages[usageKey] = Math.round((currentValue / limitValue) * 100)
        }
      })

      return {
        limits,
        current,
        percentages,
      }
    } catch (error) {
      logger.error(`Error getting tenant usage for ${tenantId}:`, error)
      throw error
    }
  }

  /**
   * Check if tenant can perform action based on usage limits
   */
  public async canPerformAction(tenantId: string, action: keyof TenantUsageLimits, amount = 1): Promise<boolean> {
    try {
      const tenant = await this.getTenantById(tenantId)
      const limits = tenant.usageLimits as TenantUsageLimits
      const current = tenant.currentUsage as TenantCurrentUsage

      const usageKey = processUsageLimitKey(action).replace("max", "").toLowerCase()
      const currentValue = current[usageKey] || 0
      const limitValue = limits[action] || 0

      return currentValue + amount <= limitValue
    } catch (error) {
      logger.error(`Error checking if tenant can perform action ${String(action)}:`, error)
      return false
    }
  }

  /**
   * Validate usage limit before performing action
   */
  private async validateUsageLimit(tenantId: string, usageType: string, amount = 1): Promise<void> {
    const maxKey = `max${usageType.charAt(0).toUpperCase() + usageType.slice(1)}` as keyof TenantUsageLimits
    const canPerform = await this.canPerformAction(tenantId, maxKey, amount)

    if (!canPerform) {
      throw ApiError.forbidden(`Usage limit exceeded for ${usageType}`)
    }
  }

  /**
   * Increment usage counter
   */
  private async incrementUsage(tenantId: string, usageType: string, amount = 1, tx?: any): Promise<void> {
    const client = tx || prisma

    const tenant = await client.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) return

    const currentUsage = tenant.currentUsage as TenantCurrentUsage
    currentUsage[usageType] = (currentUsage[usageType] || 0) + amount

    await client.tenant.update({
      where: { id: tenantId },
      data: { currentUsage: currentUsage as any },
    })
  }

  /**
   * Decrement usage counter
   */
  private async decrementUsage(tenantId: string, usageType: string, amount = 1, tx?: any): Promise<void> {
    const client = tx || prisma

    const tenant = await client.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) return

    const currentUsage = tenant.currentUsage as TenantCurrentUsage
    currentUsage[usageType] = Math.max(0, (currentUsage[usageType] || 0) - amount)

    await client.tenant.update({
      where: { id: tenantId },
      data: { currentUsage: currentUsage as any },
    })
  }

  /**
   * Get plan limits based on plan type
   */
  private getPlanLimits(plan: string): TenantUsageLimits {
    const planLimits: Record<string, TenantUsageLimits> = {
      FREE: {
        maxUsers: 3,
        maxStorage: 1024 * 1024 * 100, // 100MB
        maxContentTypes: 5,
        maxContents: 100,
        maxApiRequests: 1000,
        maxWebhooks: 2,
        maxWorkflows: 1,
      },
      BASIC: {
        maxUsers: 10,
        maxStorage: 1024 * 1024 * 1024, // 1GB
        maxContentTypes: 20,
        maxContents: 1000,
        maxApiRequests: 10000,
        maxWebhooks: 10,
        maxWorkflows: 5,
      },
      PRO: {
        maxUsers: 50,
        maxStorage: 1024 * 1024 * 1024 * 10, // 10GB
        maxContentTypes: 100,
        maxContents: 10000,
        maxApiRequests: 100000,
        maxWebhooks: 50,
        maxWorkflows: 25,
      },
      ENTERPRISE: {
        maxUsers: 1000,
        maxStorage: 1024 * 1024 * 1024 * 100, // 100GB
        maxContentTypes: 1000,
        maxContents: 100000,
        maxApiRequests: 1000000,
        maxWebhooks: 200,
        maxWorkflows: 100,
      },
    }

    return planLimits[plan] || planLimits["FREE"]
  }

  /**
   * Get initial usage values
   */
  private getInitialUsage(): TenantCurrentUsage {
    return {
      users: 1, // Owner is already added
      storage: 0,
      contentTypes: 0,
      contents: 0,
      apiRequests: 0,
      webhooks: 0,
      workflows: 0,
    }
  }

  /**
   * Reset tenant usage (useful for monthly resets)
   */
  public async resetTenantUsage(
    tenantId: string,
    usageTypes: (keyof TenantCurrentUsage)[] = ["apiRequests"],
  ): Promise<void> {
    try {
      const tenant = await this.getTenantById(tenantId)
      const currentUsage = tenant.currentUsage as TenantCurrentUsage

      usageTypes.forEach((type) => {
        currentUsage[type] = 0
      })

      await prisma.tenant.update({
        where: { id: tenantId },
        data: { currentUsage: currentUsage as any },
      })

      logger.info(`Usage reset for tenant ${tenantId}: ${usageTypes.join(", ")}`)
    } catch (error) {
      logger.error(`Error resetting tenant usage for ${tenantId}:`, error)
      throw error
    }
  }

  /**
   * Transfer tenant ownership
   */
  public async transferOwnership(tenantId: string, currentOwnerId: string, newOwnerId: string): Promise<void> {
    try {
      // Validate both users exist and are in the tenant
      const [currentOwner, newOwner] = await Promise.all([
        prisma.user.findUnique({ where: { id: currentOwnerId } }),
        prisma.user.findUnique({ where: { id: newOwnerId } }),
      ])

      if (!currentOwner || currentOwner.tenantId !== tenantId || currentOwner.role !== "SUPER_ADMIN") {
        throw ApiError.badRequest("Current owner is not valid")
      }

      if (!newOwner || newOwner.tenantId !== tenantId) {
        throw ApiError.badRequest("New owner must be a member of the tenant")
      }

      await prisma.$transaction(async (tx) => {
        // Update current owner to admin
        await tx.user.update({
          where: { id: currentOwnerId },
          data: { role: "ADMIN" },
        })

        // Update new owner to super admin
        await tx.user.update({
          where: { id: newOwnerId },
          data: { role: "SUPER_ADMIN" },
        })
      })

      logger.info(`Ownership transferred from ${currentOwnerId} to ${newOwnerId} for tenant ${tenantId}`)
    } catch (error) {
      logger.error(`Error transferring ownership for tenant ${tenantId}:`, error)
      throw error
    }
  }
}
