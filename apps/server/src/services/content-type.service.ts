import { ContentTypeRepository } from "@cms-platform/database/repositories/content-type.repository"
import { FieldTypeRepository } from "@cms-platform/database/repositories/field-type.repository"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import { cacheService } from "./cache.service"
import { auditService } from "./audit.service"
import type { 
  ContentType, 
  FieldType, 
  CreateContentTypeData, 
  UpdateContentTypeData,
  ContentTypeWithFields,
  FieldDefinition,
  ValidationRule
} from "@cms-platform/database/types"

export interface ContentTypeServiceOptions {
  enableCache?: boolean
  cacheTtl?: number
  enableAudit?: boolean
}

export interface ContentTypeValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

export interface ContentTypeStats {
  totalTypes: number
  activeTypes: number
  totalFields: number
  fieldsByType: Record<string, number>
  mostUsedTypes: Array<{ id: string; name: string; usageCount: number }>
}

export class ContentTypeService {
  private contentTypeRepo: ContentTypeRepository
  private fieldTypeRepo: FieldTypeRepository
  private options: ContentTypeServiceOptions

  constructor(options: ContentTypeServiceOptions = {}) {
    this.contentTypeRepo = new ContentTypeRepository()
    this.fieldTypeRepo = new FieldTypeRepository()
    this.options = {
      enableCache: true,
      cacheTtl: 3600, // 1 hour
      enableAudit: true,
      ...options,
    }

    logger.info("Content Type service initialized", this.options)
  }

  /**
   * Create a new content type
   */
  async createContentType(
    data: CreateContentTypeData,
    userId?: string,
    tenantId?: string
  ): Promise<ContentType> {
    try {
      // Validate content type data
      await this.validateContentTypeData(data)

      // Check if content type with same name exists
      const existing = await this.contentTypeRepo.findByName(data.name, tenantId)
      if (existing) {
        throw ApiError.conflict(`Content type with name '${data.name}' already exists`)
      }

      // Validate field definitions
      if (data.fields && data.fields.length > 0) {
        await this.validateFieldDefinitions(data.fields)
      }

      // Create content type
      const contentType = await this.contentTypeRepo.create({
        ...data,
        tenantId,
        createdBy: userId,
        updatedBy: userId,
      })

      // Clear cache
      if (this.options.enableCache) {
        await this.clearContentTypeCache(tenantId)
      }

      // Audit log
      if (this.options.enableAudit && userId) {
        await auditService.log({
          action: "content_type.create",
          entityType: "ContentType",
          entityId: contentType.id,
          userId,
          details: {
            name: contentType.name,
            fieldsCount: data.fields?.length || 0,
          },
        })
      }

      logger.info("Content type created", {
        id: contentType.id,
        name: contentType.name,
        userId,
        tenantId,
      })

      return contentType
    } catch (error) {
      logger.error("Failed to create content type:", error)
      throw error
    }
  }

  /**
   * Get content type by ID
   */
  async getContentTypeById(
    id: string,
    tenantId?: string,
    includeFields = true
  ): Promise<ContentTypeWithFields | null> {
    try {
      const cacheKey = `content-type:${id}:${includeFields}`
      
      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get<ContentTypeWithFields>(cacheKey, tenantId)
        if (cached) {
          return cached
        }
      }

      const contentType = await this.contentTypeRepo.findById(id, tenantId, includeFields)
      
      // Cache result
      if (this.options.enableCache && contentType) {
        await cacheService.set(cacheKey, contentType, {
          ttl: this.options.cacheTtl,
          namespace: tenantId,
        })
      }

      return contentType
    } catch (error) {
      logger.error("Failed to get content type by ID:", error)
      throw error
    }
  }

  /**
   * Get content type by name
   */
  async getContentTypeByName(
    name: string,
    tenantId?: string,
    includeFields = true
  ): Promise<ContentTypeWithFields | null> {
    try {
      const cacheKey = `content-type:name:${name}:${includeFields}`
      
      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get<ContentTypeWithFields>(cacheKey, tenantId)
        if (cached) {
          return cached
        }
      }

      const contentType = await this.contentTypeRepo.findByName(name, tenantId, includeFields)
      
      // Cache result
      if (this.options.enableCache && contentType) {
        await cacheService.set(cacheKey, contentType, {
          ttl: this.options.cacheTtl,
          namespace: tenantId,
        })
      }

      return contentType
    } catch (error) {
      logger.error("Failed to get content type by name:", error)
      throw error
    }
  }

  /**
   * List content types with pagination and filtering
   */
  async listContentTypes(options: {
    page?: number
    limit?: number
    search?: string
    isActive?: boolean
    sortBy?: string
    sortOrder?: "asc" | "desc"
    tenantId?: string
    includeFields?: boolean
  }): Promise<{
    contentTypes: ContentTypeWithFields[]
    total: number
    page: number
    limit: number
    totalPages: number
  }> {
    try {
      const {
        page = 1,
        limit = 20,
        search,
        isActive,
        sortBy = "createdAt",
        sortOrder = "desc",
        tenantId,
        includeFields = false,
      } = options

      const cacheKey = `content-types:list:${JSON.stringify(options)}`
      
      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get(cacheKey, tenantId)
        if (cached) {
          return cached
        }
      }

      const result = await this.contentTypeRepo.findMany({
        page,
        limit,
        search,
        isActive,
        sortBy,
        sortOrder,
        tenantId,
        includeFields,
      })

      // Cache result
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, result, {
          ttl: this.options.cacheTtl / 2, // Shorter TTL for lists
          namespace: tenantId,
        })
      }

      return result
    } catch (error) {
      logger.error("Failed to list content types:", error)
      throw error
    }
  }

  /**
   * Update content type
   */
  async updateContentType(
    id: string,
    data: UpdateContentTypeData,
    userId?: string,
    tenantId?: string
  ): Promise<ContentType> {
    try {
      // Get existing content type
      const existing = await this.contentTypeRepo.findById(id, tenantId)
      if (!existing) {
        throw ApiError.notFound("Content type not found")
      }

      // Validate update data
      if (data.name && data.name !== existing.name) {
        const nameExists = await this.contentTypeRepo.findByName(data.name, tenantId)
        if (nameExists && nameExists.id !== id) {
          throw ApiError.conflict(`Content type with name '${data.name}' already exists`)
        }
      }

      // Validate field definitions if provided
      if (data.fields) {
        await this.validateFieldDefinitions(data.fields)
      }

      // Update content type
      const contentType = await this.contentTypeRepo.update(id, {
        ...data,
        updatedBy: userId,
      }, tenantId)

      // Clear cache
      if (this.options.enableCache) {
        await this.clearContentTypeCache(tenantId)
      }

      // Audit log
      if (this.options.enableAudit && userId) {
        await auditService.log({
          action: "content_type.update",
          entityType: "ContentType",
          entityId: id,
          userId,
          details: {
            changes: data,
            previousName: existing.name,
          },
        })
      }

      logger.info("Content type updated", {
        id,
        userId,
        tenantId,
      })

      return contentType
    } catch (error) {
      logger.error("Failed to update content type:", error)
      throw error
    }
  }

  /**
   * Delete content type
   */
  async deleteContentType(
    id: string,
    userId?: string,
    tenantId?: string,
    force = false
  ): Promise<void> {
    try {
      // Get existing content type
      const existing = await this.contentTypeRepo.findById(id, tenantId)
      if (!existing) {
        throw ApiError.notFound("Content type not found")
      }

      // Check if content type is in use (unless force delete)
      if (!force) {
        const usageCount = await this.contentTypeRepo.getUsageCount(id, tenantId)
        if (usageCount > 0) {
          throw ApiError.conflict(
            `Cannot delete content type '${existing.name}' as it is used by ${usageCount} content items. Use force=true to delete anyway.`
          )
        }
      }

      // Delete content type
      await this.contentTypeRepo.delete(id, tenantId)

      // Clear cache
      if (this.options.enableCache) {
        await this.clearContentTypeCache(tenantId)
      }

      // Audit log
      if (this.options.enableAudit && userId) {
        await auditService.log({
          action: "content_type.delete",
          entityType: "ContentType",
          entityId: id,
          userId,
          details: {
            name: existing.name,
            force,
          },
        })
      }

      logger.info("Content type deleted", {
        id,
        name: existing.name,
        userId,
        tenantId,
        force,
      })
    } catch (error) {
      logger.error("Failed to delete content type:", error)
      throw error
    }
  }

  /**
   * Add field to content type
   */
  async addField(
    contentTypeId: string,
    fieldDefinition: FieldDefinition,
    userId?: string,
    tenantId?: string
  ): Promise<ContentType> {
    try {
      // Get existing content type
      const contentType = await this.contentTypeRepo.findById(contentTypeId, tenantId, true)
      if (!contentType) {
        throw ApiError.notFound("Content type not found")
      }

      // Validate field definition
      await this.validateFieldDefinitions([fieldDefinition])

      // Check if field name already exists
      const existingField = contentType.fields?.find((f: any) => f.name === fieldDefinition.name)
      if (existingField) {
        throw ApiError.conflict(`Field with name '${fieldDefinition.name}' already exists`)
      }

      // Add field to content type
      const updatedContentType = await this.contentTypeRepo.addField(contentTypeId, fieldDefinition, tenantId)

      // Clear cache
      if (this.options.enableCache) {
        await this.clearContentTypeCache(tenantId)
      }

      // Audit log
      if (this.options.enableAudit && userId) {
        await auditService.log({
          action: "content_type.add_field",
          entityType: "ContentType",
          entityId: contentTypeId,
          userId,
          details: {
            fieldName: fieldDefinition.name,
            fieldType: fieldDefinition.type,
          },
        })
      }

      logger.info("Field added to content type", {
        contentTypeId,
        fieldName: fieldDefinition.name,
        userId,
        tenantId,
      })

      return updatedContentType
    } catch (error) {
      logger.error("Failed to add field to content type:", error)
      throw error
    }
  }

  /**
   * Update field in content type
   */
  async updateField(
    contentTypeId: string,
    fieldId: string,
    fieldDefinition: Partial<FieldDefinition>,
    userId?: string,
    tenantId?: string
  ): Promise<ContentType> {
    try {
      // Get existing content type
      const contentType = await this.contentTypeRepo.findById(contentTypeId, tenantId, true)
      if (!contentType) {
        throw ApiError.notFound("Content type not found")
      }

      // Find existing field
      const existingField = contentType.fields?.find((f: any) => f.id === fieldId)
      if (!existingField) {
        throw ApiError.notFound("Field not found")
      }

      // Validate field definition
      if (fieldDefinition.name || fieldDefinition.type || fieldDefinition.validation) {
        const fullFieldDef = { ...existingField, ...fieldDefinition }
        await this.validateFieldDefinitions([fullFieldDef as FieldDefinition])
      }

      // Check if new field name conflicts
      if (fieldDefinition.name && fieldDefinition.name !== existingField.name) {
        const nameConflict = contentType.fields?.find((f: any) => f.name === fieldDefinition.name && f.id !== fieldId)
        if (nameConflict) {
          throw ApiError.conflict(`Field with name '${fieldDefinition.name}' already exists`)
        }
      }

      // Update field
      const updatedContentType = await this.contentTypeRepo.updateField(contentTypeId, fieldId, fieldDefinition, tenantId)

      // Clear cache
      if (this.options.enableCache) {
        await this.clearContentTypeCache(tenantId)
      }

      // Audit log
      if (this.options.enableAudit && userId) {
        await auditService.log({
          action: "content_type.update_field",
          entityType: "ContentType",
          entityId: contentTypeId,
          userId,
          details: {
            fieldId,
            fieldName: fieldDefinition.name || existingField.name,
            changes: fieldDefinition,
          },
        })
      }

      logger.info("Field updated in content type", {
        contentTypeId,
        fieldId,
        userId,
        tenantId,
      })

      return updatedContentType
    } catch (error) {
      logger.error("Failed to update field in content type:", error)
      throw error
    }
  }

  /**
   * Remove field from content type
   */
  async removeField(
    contentTypeId: string,
    fieldId: string,
    userId?: string,
    tenantId?: string
  ): Promise<ContentType> {
    try {
      // Get existing content type
      const contentType = await this.contentTypeRepo.findById(contentTypeId, tenantId, true)
      if (!contentType) {
        throw ApiError.notFound("Content type not found")
      }

      // Find existing field
      const existingField = contentType.fields?.find((f: any) => f.id === fieldId)
      if (!existingField) {
        throw ApiError.notFound("Field not found")
      }

      // Remove field
      const updatedContentType = await this.contentTypeRepo.removeField(contentTypeId, fieldId, tenantId)

      // Clear cache
      if (this.options.enableCache) {
        await this.clearContentTypeCache(tenantId)
      }

      // Audit log
      if (this.options.enableAudit && userId) {
        await auditService.log({
          action: "content_type.remove_field",
          entityType: "ContentType",
          entityId: contentTypeId,
          userId,
          details: {
            fieldId,
            fieldName: existingField.name,
          },
        })
      }

      logger.info("Field removed from content type", {
        contentTypeId,
        fieldId,
        fieldName: existingField.name,
        userId,
        tenantId,
      })

      return updatedContentType
    } catch (error) {
      logger.error("Failed to remove field from content type:", error)
      throw error
    }
  }

  /**
   * Get content type statistics
   */
  async getStats(tenantId?: string): Promise<ContentTypeStats> {
    try {
      const cacheKey = "content-type:stats"
      
      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get<ContentTypeStats>(cacheKey, tenantId)
        if (cached) {
          return cached
        }
      }

      const stats = await this.contentTypeRepo.getStats(tenantId)

      // Cache result
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, stats, {
          ttl: this.options.cacheTtl / 4, // Shorter TTL for stats
          namespace: tenantId,
        })
      }

      return stats
    } catch (error) {
      logger.error("Failed to get content type stats:", error)
      throw error
    }
  }

  /**
   * Validate content type data
   */
  private async validateContentTypeData(data: CreateContentTypeData): Promise<void> {
    const errors: string[] = []

    // Validate name
    if (!data.name || data.name.trim().length === 0) {
      errors.push("Content type name is required")
    } else if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(data.name)) {
      errors.push("Content type name must start with a letter and contain only letters, numbers, and underscores")
    }

    // Validate display name
    if (!data.displayName || data.displayName.trim().length === 0) {
      errors.push("Content type display name is required")
    }

    if (errors.length > 0) {
      throw ApiError.validationError("Content type validation failed", errors)
    }
  }

  /**
   * Validate field definitions
   */
  private async validateFieldDefinitions(fields: FieldDefinition[]): Promise<void> {
    const errors: string[] = []
    const fieldNames = new Set<string>()

    for (const field of fields) {
      // Validate field name
      if (!field.name || field.name.trim().length === 0) {
        errors.push("Field name is required")
        continue
      }

      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.name)) {
        errors.push(`Field '${field.name}' must start with a letter and contain only letters, numbers, and underscores`)
      }

      // Check for duplicate field names
      if (fieldNames.has(field.name)) {
        errors.push(`Duplicate field name: ${field.name}`)
      }
      fieldNames.add(field.name)

      // Validate field type
      if (!field.type) {
        errors.push(`Field '${field.name}' must have a type`)
        continue
      }

      // Validate field type exists
      const fieldType = await this.fieldTypeRepo.findByName(field.type)
      if (!fieldType) {
        errors.push(`Invalid field type '${field.type}' for field '${field.name}'`)
      }

      // Validate display name
      if (!field.displayName || field.displayName.trim().length === 0) {
        errors.push(`Field '${field.name}' must have a display name`)
      }

      // Validate field-specific rules
      await this.validateFieldSpecificRules(field, errors)
    }

    if (errors.length > 0) {
      throw ApiError.validationError("Field validation failed", errors)
    }
  }

  /**
   * Validate field-specific rules
   */
  private async validateFieldSpecificRules(field: FieldDefinition, errors: string[]): Promise<void> {
    // Validate based on field type
    switch (field.type) {
      case "reference":
        if (!field.settings?.referenceType) {
          errors.push(`Reference field '${field.name}' must specify a reference type`)
        }
        break

      case "enum":
        if (!field.validation?.enum || field.validation.enum.length === 0) {
          errors.push(`Enum field '${field.name}' must specify enum values`)
        }
        break

      case "relation":
        if (!field.settings?.relationTo) {
          errors.push(`Relation field '${field.name}' must specify relation target`)
        }
        break

      case "number":
        if (field.validation?.min !== undefined && field.validation?.max !== undefined) {
          if (field.validation.min > field.validation.max) {
            errors.push(`Number field '${field.name}' min value cannot be greater than max value`)
          }
        }
        break

      case "string":
      case "text":
        if (field.validation?.minLength !== undefined && field.validation?.maxLength !== undefined) {
          if (field.validation.minLength > field.validation.maxLength) {
            errors.push(`Text field '${field.name}' min length cannot be greater than max length`)
          }
        }
        break
    }
  }

  /**
   * Clear content type cache
   */
  private async clearContentTypeCache(tenantId?: string): Promise<void> {
    try {
      await cacheService.deletePattern("content-type*", tenantId)
      await cacheService.deletePattern("content-types*", tenantId)
    } catch (error) {
      logger.error("Failed to clear content type cache:", error)
    }
  }

  /**
   * Validate content against content type
   */
  async validateContent(
    contentTypeId: string,
    content: Record<string, any>,
    tenantId?: string
  ): Promise<ContentTypeValidationResult> {
    try {
      const contentType = await this.getContentTypeById(contentTypeId, tenantId, true)
      if (!contentType) {
        return {
          isValid: false,
          errors: ["Content type not found"],
          warnings: [],
        }
      }

      const errors: string[] = []
      const warnings: string[] = []

      // Validate each field
      for (const field of contentType.fields || []) {
        const value = content[field.name]
        const fieldErrors = await this.validateFieldValue(field, value)
        errors.push(...fieldErrors)
      }

      // Check for unknown fields
      const knownFields = new Set((contentType.fields || []).map((f: any) => f.name))
      for (const key of Object.keys(content)) {
        if (!knownFields.has(key)) {
          warnings.push(`Unknown field: ${key}`)
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
      }
    } catch (error) {
      logger.error("Failed to validate content:", error)
      return {
        isValid: false,
        errors: ["Validation failed due to internal error"],
        warnings: [],
      }
    }
  }

  /**
   * Validate field value
   */
  private async validateFieldValue(field: any, value: any): Promise<string[]> {
    const errors: string[] = []
    const validation = field.validation || {}

    // Check required
    if (validation.required && (value === undefined || value === null || value === "")) {
      errors.push(`Field '${field.displayName}' is required`)
      return errors
    }

    // Skip further validation if value is empty and not required
    if (value === undefined || value === null || value === "") {
      return errors
    }

    // Type-specific validation
    switch (field.type) {
      case "string":
      case "text":
        if (typeof value !== "string") {
          errors.push(`Field '${field.displayName}' must be a string`)
        } else {
          if (validation.minLength && value.length < validation.minLength) {
            errors.push(`Field '${field.displayName}' must be at least ${validation.minLength} characters`)
          }
          if (validation.maxLength && value.length > validation.maxLength) {
            errors.push(`Field '${field.displayName}' must be at most ${validation.maxLength} characters`)
          }
          if (validation.pattern && !new RegExp(validation.pattern).test(value)) {
            errors.push(`Field '${field.displayName}' format is invalid`)
          }
        }
        break

      case "number":
        if (typeof value !== "number") {
          errors.push(`Field '${field.displayName}' must be a number`)
        } else {
          if (validation.min !== undefined && value < validation.min) {
            errors.push(`Field '${field.displayName}' must be at least ${validation.min}`)
          }
          if (validation.max !== undefined && value > validation.max) {
            errors.push(`Field '${field.displayName}' must be at most ${validation.max}`)
          }
        }
        break

      case "boolean":
        if (typeof value !== "boolean") {
          errors.push(`Field '${field.displayName}' must be a boolean`)
        }
        break

      case "date":
      case "datetime":
        if (!this.isValidDate(value)) {
          errors.push(`Field '${field.displayName}' must be a valid date`)
        }
        break

      case "email":
        if (typeof value === "string" && !this.isValidEmail(value)) {
          errors.push(`Field '${field.displayName}' must be a valid email`)
        }
        break

      case "url":
        if (typeof value === "string" && !this.isValidUrl(value)) {
          errors.push(`Field '${field.displayName}' must be a valid URL`)
        }
        break

      case "enum":
        if (validation.enum && !validation.enum.includes(value)) {
          errors.push(`Field '${field.displayName}' must be one of: ${validation.enum.join(", ")}`)
        }
        break

      case "array":
        if (!Array.isArray(value)) {
          errors.push(`Field '${field.displayName}' must be an array`)
        }
        break
    }

    return errors
  }

  /**
   * Check if value is a valid date
   */
  private isValidDate(value: any): boolean {
    const date = new Date(value)
    return date instanceof Date && !isNaN(date.getTime())
  }

  /**
   * Check if value is a valid email
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  /**
   * Check if value is a valid URL
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  }
}

// Export singleton instance
export const contentTypeService = new ContentTypeService()
