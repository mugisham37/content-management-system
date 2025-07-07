import { prisma } from "@cms-platform/database/client"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import type { Tenant, User } from "@cms-platform/database/types"

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

      // Create new tenant
      const tenant = await prisma.tenant.create({
        data: {
          name,
          slug,
          description,
          plan: plan || TenantPlan.FREE,
          status: TenantStatus.ACTIVE,
          users: {
            connect: { id: ownerId },
          },
          usageLimits,
        },
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
  public async getTenantById(id: string): Promise<Tenant> {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id } })

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
  public async getTenantBySlug(slug: string): Promise<Tenant> {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { slug } })

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
  public async updateTenant(id: string, data: Partial<Omit<Tenant, "id" | "createdAt" | "updatedAt">>): Promise<Tenant> {
    try {
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
   * Delete tenant
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
   * List tenants with pagination and filtering
   */
  public async listTenants(options: {
    page?: number
    limit?: number
    status?: TenantStatus
    search?: string
    plan?: TenantPlan
  }): Promise<{
    tenants: Tenant[]
    total: number
    page: number
    limit: number
    totalPages: number
  }> {
    try {
      const { page = 1, limit = 10, status, search, plan } = options

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

      const [tenants, total] = await prisma.$transaction([
        prisma.tenant.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: "desc" },
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
  ): Promise<Tenant> {
    try {
      const { userId, role } = data

      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user) {
        throw ApiError.badRequest("User does not exist")
      }

      const tenant = await this.getTenantById(tenantId)
      const usageLimits = tenant.usageLimits as any
      const currentUsage = tenant.currentUsage as any

      if (currentUsage.users >= usageLimits.maxUsers) {
        throw ApiError.badRequest("Tenant has reached the maximum number of users")
      }

      const updatedTenant = await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          users: {
            connect: { id: userId },
          },
          currentUsage: {
            ...currentUsage,
            users: currentUsage.users + 1,
          },
        },
        include: { users: true },
      })

      // We need to set the role on the user model for this tenant
      // This part of the logic needs adjustment based on how roles are managed per tenant.
      // The current schema has a single `role` on the `User` model, not a per-tenant role.
      // For now, I'll log a warning.
      logger.warn(`User role assignment in a multi-tenant context needs schema adjustment. Assigning role '${role}' globally for now.`);
      await prisma.user.update({ where: { id: userId }, data: { role: role as any } });


      logger.info(`User ${userId} added to tenant ${tenantId} with role ${role}`)

      return updatedTenant as Tenant
    } catch (error) {
      logger.error(`Error adding user to tenant ${tenantId}:`, error)
      throw error
    }
  }

  /**
   * Remove user from tenant
   */
  public async removeUserFromTenant(tenantId: string, userId: string): Promise<Tenant> {
    try {
        const tenant = await this.getTenantById(tenantId);
        const currentUsage = tenant.currentUsage as any;

        const updatedTenant = await prisma.tenant.update({
            where: { id: tenantId },
            data: {
                users: {
                    disconnect: { id: userId },
                },
                currentUsage: {
                    ...currentUsage,
                    users: Math.max(0, currentUsage.users - 1),
                },
            },
        });

        logger.info(`User ${userId} removed from tenant ${tenantId}`);
        return updatedTenant as Tenant;
    } catch (error) {
        logger.error(`Error removing user from tenant ${tenantId}:`, error);
        throw error;
    }
  }

  private getPlanLimits(plan: TenantPlan): any {
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
}