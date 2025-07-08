import type { IUser } from "../interfaces/user.interface"
import { ApiError } from "../utils/errors"
import logger from "../utils/logger"
import { prisma } from "@cms-platform/database/client"
import { extractErrorInfo } from "../utils/error-guards"

export class AuthService {
  constructor() {
    // Using Prisma client directly from the database package
  }

  /**
   * Sanitizes a user object by removing sensitive information.
   * @param user The user object to sanitize.
   * @returns A partial user object with sensitive information removed.
   */
  private sanitizeUser(user: any): Partial<IUser> {
    if (!user) return {}

    const {
      password,
      password_reset_token,
      password_reset_expires,
      email_verification_token,
      created_at,
      updated_at,
      ...sanitizedUser
    } = user

    // Convert snake_case to camelCase for consistency
    return {
      ...sanitizedUser,
      createdAt: created_at,
      updatedAt: updated_at,
    }
  }

  /**
   * Validates user ID format and existence
   * @param userId The user ID to validate
   */
  private validateUserId(userId: string): void {
    if (!userId || typeof userId !== "string") {
      throw ApiError.badRequest("Invalid user ID format")
    }

    // UUID validation for PostgreSQL
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(userId)) {
      throw ApiError.badRequest("Invalid user ID format")
    }
  }

  /**
   * Gets user profile with tenant information
   * @param userId The ID of the user to retrieve
   * @param includeMetadata Whether to include additional metadata
   * @returns Promise resolving to sanitized user profile
   */
  async getUserProfile(userId: string, includeMetadata = false): Promise<Partial<IUser>> {
    const startTime = Date.now()

    try {
      this.validateUserId(userId)

      const query = `
        SELECT 
          u.id,
          u.email,
          u.first_name,
          u.last_name,
          u.username,
          u.avatar_url,
          u.phone_number,
          u.is_active,
          u.is_verified,
          u.role,
          u.tenant_id,
          u.last_login_at,
          u.created_at,
          u.updated_at,
          ${
            includeMetadata
              ? `
          u.login_count,
          u.last_ip_address,
          u.timezone,
          u.locale,
          u.preferences,
          `
              : ""
          }
          t.id as tenant_id,
          t.name as tenant_name,
          t.slug as tenant_slug,
          t.is_active as tenant_is_active
        FROM users u
        LEFT JOIN tenants t ON u.tenant_id = t.id
        WHERE u.id = $1 AND u.deleted_at IS NULL
      `

      const result = await prisma.$queryRawUnsafe(query, userId)

      if (!Array.isArray(result) || result.length === 0) {
        throw ApiError.notFound("User not found")
      }

      const userRow = result[0] as any

      // Structure the response with nested tenant object
      const userProfile = {
        ...userRow,
        tenant: userRow.tenant_id
          ? {
              id: userRow.tenant_id,
              name: userRow.tenant_name,
              slug: userRow.tenant_slug,
              isActive: userRow.tenant_is_active,
            }
          : null,
      }

      // Remove tenant fields from root level
      delete userProfile.tenant_name
      delete userProfile.tenant_slug
      delete userProfile.tenant_is_active

      const sanitizedUser = this.sanitizeUser(userProfile)

      // Log successful retrieval
      logger.info("User profile retrieved successfully", {
        userId,
        executionTime: Date.now() - startTime,
        includeMetadata,
      })

      return sanitizedUser
    } catch (error) {
      const executionTime = Date.now() - startTime

      if (error instanceof ApiError) {
        logger.warn("Get user profile failed - API Error", {
          userId,
          error: error.message,
          statusCode: error.statusCode,
          executionTime,
        })
        throw error
      }

      const errorInfo = extractErrorInfo(error)
      logger.error("Get user profile failed - Database Error", {
        userId,
        error: errorInfo.message,
        stack: errorInfo.stack,
        executionTime,
      })

      throw ApiError.internal("Failed to retrieve user profile")
    }
  }

  /**
   * Gets multiple user profiles by IDs (batch operation)
   * @param userIds Array of user IDs to retrieve
   * @param includeMetadata Whether to include additional metadata
   * @returns Promise resolving to array of sanitized user profiles
   */
  async getUserProfiles(userIds: string[], includeMetadata = false): Promise<Partial<IUser>[]> {
    const startTime = Date.now()

    try {
      if (!Array.isArray(userIds) || userIds.length === 0) {
        throw ApiError.badRequest("Invalid user IDs array")
      }

      if (userIds.length > 100) {
        throw ApiError.badRequest("Too many user IDs requested (max 100)")
      }

      // Validate all user IDs
      userIds.forEach((id) => this.validateUserId(id))

      const placeholders = userIds.map((_, index) => `$${index + 1}`).join(",")

      const query = `
        SELECT 
          u.id,
          u.email,
          u.first_name,
          u.last_name,
          u.username,
          u.avatar_url,
          u.phone_number,
          u.is_active,
          u.is_verified,
          u.role,
          u.tenant_id,
          u.last_login_at,
          u.created_at,
          u.updated_at,
          ${
            includeMetadata
              ? `
          u.login_count,
          u.last_ip_address,
          u.timezone,
          u.locale,
          u.preferences,
          `
              : ""
          }
          t.id as tenant_id,
          t.name as tenant_name,
          t.slug as tenant_slug,
          t.is_active as tenant_is_active
        FROM users u
        LEFT JOIN tenants t ON u.tenant_id = t.id
        WHERE u.id IN (${placeholders}) AND u.deleted_at IS NULL
        ORDER BY u.created_at DESC
      `

      const result = await prisma.$queryRawUnsafe(query, ...userIds)

      const userProfiles = (result as any[]).map((userRow: any) => {
        const userProfile = {
          ...userRow,
          tenant: userRow.tenant_id
            ? {
                id: userRow.tenant_id,
                name: userRow.tenant_name,
                slug: userRow.tenant_slug,
                isActive: userRow.tenant_is_active,
              }
            : null,
        }

        // Remove tenant fields from root level
        delete userProfile.tenant_name
        delete userProfile.tenant_slug
        delete userProfile.tenant_is_active

        return this.sanitizeUser(userProfile)
      })

      logger.info("Multiple user profiles retrieved successfully", {
        requestedCount: userIds.length,
        retrievedCount: userProfiles.length,
        executionTime: Date.now() - startTime,
        includeMetadata,
      })

      return userProfiles
    } catch (error) {
      const executionTime = Date.now() - startTime

      if (error instanceof ApiError) {
        logger.warn("Get user profiles failed - API Error", {
          userIds: userIds.slice(0, 5), // Log first 5 IDs only
          error: error.message,
          statusCode: error.statusCode,
          executionTime,
        })
        throw error
      }

      const errorInfo = extractErrorInfo(error)
      logger.error("Get user profiles failed - Database Error", {
        userIds: userIds.slice(0, 5),
        error: errorInfo.message,
        stack: errorInfo.stack,
        executionTime,
      })

      throw ApiError.internal("Failed to retrieve user profiles")
    }
  }

  /**
   * Checks if user exists and is active
   * @param userId The user ID to check
   * @returns Promise resolving to boolean indicating user existence and active status
   */
  async isUserActiveById(userId: string): Promise<boolean> {
    try {
      this.validateUserId(userId)

      const query = `
        SELECT EXISTS(
          SELECT 1 FROM users 
          WHERE id = $1 AND is_active = true AND deleted_at IS NULL
        ) as exists
      `

      const result = await prisma.$queryRawUnsafe(query, userId)
      return (result as any[])[0]?.exists || false
    } catch (error) {
      const errorInfo = extractErrorInfo(error)
      logger.error("Check user active status failed", {
        userId,
        error: errorInfo.message,
      })
      return false
    }
  }

  /**
   * Gets user's basic info for caching purposes
   * @param userId The user ID to retrieve basic info for
   * @returns Promise resolving to basic user information
   */
  async getUserBasicInfo(
    userId: string,
  ): Promise<{ id: string; email: string; role: string; tenantId?: string } | null> {
    try {
      this.validateUserId(userId)

      const query = `
        SELECT id, email, role, tenant_id
        FROM users 
        WHERE id = $1 AND is_active = true AND deleted_at IS NULL
      `

      const result = await prisma.$queryRawUnsafe(query, userId)

      if (!Array.isArray(result) || result.length === 0) {
        return null
      }

      const user = result[0] as any
      return {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenant_id,
      }
    } catch (error) {
      const errorInfo = extractErrorInfo(error)
      logger.error("Get user basic info failed", {
        userId,
        error: errorInfo.message,
      })
      return null
    }
  }

  /**
   * Updates user's last login timestamp
   * @param userId The user ID to update
   * @param ipAddress The IP address of the login
   * @returns Promise resolving to boolean indicating success
   */
  async updateLastLogin(userId: string, ipAddress?: string): Promise<boolean> {
    try {
      this.validateUserId(userId)

      const query = `
        UPDATE users 
        SET 
          last_login_at = NOW(),
          login_count = COALESCE(login_count, 0) + 1,
          ${ipAddress ? "last_ip_address = $2," : ""}
          updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id
      `

      const result = ipAddress 
        ? await prisma.$queryRawUnsafe(query, userId, ipAddress)
        : await prisma.$queryRawUnsafe(query, userId)

      const success = Array.isArray(result) && result.length > 0

      if (success) {
        logger.info("User last login updated", { userId, ipAddress })
      }

      return success
    } catch (error) {
      const errorInfo = extractErrorInfo(error)
      logger.error("Update last login failed", {
        userId,
        ipAddress,
        error: errorInfo.message,
      })
      return false
    }
  }
}
