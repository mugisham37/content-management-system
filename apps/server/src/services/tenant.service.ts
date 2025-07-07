import { prisma } from "@cms-platform/database/client"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import type { Tenant, User, TenantPlan, TenantStatus, UserRole } from "@prisma/client"

export { TenantPlan, TenantStatus } from "@prisma/client"

export enum TenantUserRole {
  OWNER = "SUPER_ADMIN",
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
  [key: string]: number
}

interface TenantCurrentUsage {
  users: number
  storage: number
  contentTypes: number
  contents: number
  apiRequests: number
  webhooks: number
  workflows: number
  [key: string]: number
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
            usageLimits: usageLimits as any,
            currentUsage: currentUsage as any,
          },
        })

        // Update user to be associated with this tenant and set as owner
        await tx.user.update({
          where: { id: ownerId },
          data: {
            tenantId: newTenant.id,
            role: UserRole.SUPER_ADMIN, // Owner role
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
        where.users = {
          some: {
            id: ownerId,
            role: UserRole.SUPER_ADMIN,
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
              where: { role: UserRole.SUPER_ADMIN },
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
      role: UserRole
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

      // Add user to tenant
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            tenantId,
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
      // Check if user exists and is in the tenant
      const user = await prisma.user.findUnique({ where: { id: userId } })

      if (!user || user.tenantId !== tenantId) {
        throw ApiError.notFound("User is not a member of this tenant")
      }

      if (user.role === UserRole.SUPER_ADMIN) {
        // Check if there are other owners
        const ownerCount = await prisma.user.count({
          where: {
            tenantId,
            role: UserRole.SUPER_ADMIN,
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
            role: UserRole.VIEWER, // Reset
