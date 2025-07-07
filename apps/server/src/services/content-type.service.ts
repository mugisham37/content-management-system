
import { PrismaClient } from "@prisma/client"
import {
  type ContentType,
  type ContentTypeWithFields,
  type CreateContentTypeInput,
  type UpdateContentTypeInput,
  type PaginatedContentTypes,
  type ContentTypeValidationResult,
  type ContentTypeStats,
  type FieldDefinition,
  type CreateFieldDefinition,
  type FieldType,
  transformPrismaContentType,
  transformPrismaContentTypeWithFields,
  serializeFieldsToJson,
  parseFieldsFromJson,
  validateContentTypeData,
  validateFieldDefinition,
  mergeFields,
  generateId,
} from "@cms-platform/shared"
import { ContentTypeRepository } from "@cms-platform/database/repositories/content-type.repository"
import { FieldTypeRepository } from "@cms-platform/database/repositories/field-type.repository"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import { cacheService } from "./cache.service"
import { auditService } from "./audit.service"

export interface ContentTypeServiceOptions {
  enableCache?: boolean
  cacheTtl?: number
  enableAudit?: boolean
  maxFieldsPerType?: number
  enableValidation?: boolean
}

export interface BulkOperationResult {
  successful: string[]
  failed: Array<{ id: string; error: string }>
  total: number
}

export interface ContentTypeExportData {
  contentType: ContentTypeWithFields
  metadata: {
    exportedAt: Date
    version: string
    checksum: string
  }
}

export interface ContentTypeImportOptions {
  overwrite?: boolean
  validateOnly?: boolean
  skipValidation?: boolean
}

export class ContentTypeService {
  private contentTypeRepo: ContentTypeRepository
  private fieldTypeRepo: FieldTypeRepository
  private options: ContentTypeServiceOptions

  constructor(prisma: PrismaClient, options: ContentTypeServiceOptions = {}) {
    this.contentTypeRepo = new ContentTypeRepository(prisma)
    this.fieldTypeRepo = new FieldTypeRepository(prisma)
    this.options = {
      enableCache: true,
      cacheTtl: 3600, // 1 hour
      enableAudit: true,
      maxFieldsPerType: 100,
      enableValidation: true,
      ...options,
    }

    logger.info("Content Type service initialized", this.options)
  }

  /**
   * Create a new content type
   */
  async createContentType(data: CreateContentTypeInput, userId?: string, tenantId?: string): Promise<ContentType> {
    try {
      // Validate content type data
      if (this.options.enableValidation) {
        const validation = validateContentTypeData(data)
        if (!validation.isValid) {
          throw ApiError.validationError("Content type validation failed", validation.errors)
        }
      }

      // Check field count limit
      if (data.fields && data.fields.length > this.options.maxFieldsPerType!) {
        throw ApiError.validationError(`Content type cannot have more than ${this.options.maxFieldsPerType} fields`)
      }

      // Check if content type with same name exists
      const existing = await this.contentTypeRepo.findByName(data.name, tenantId)
      if (existing) {
        throw ApiError.conflict(`Content type with name '${data.name}' already exists`)
      }

      // Validate field definitions
      if (data.fields && data.fields.length > 0) {
        await this.validateFieldDefinitions(data.fields)
      }

      // Prepare data for creation
      const createData: any = {
        name: data.name,
        displayName: data.displayName,
        description: data.description,
        isSystem: data.isSystem || false,
        fields: data.fields
          ? serializeFieldsToJson(
              data.fields.map((field) => ({
                ...field,
                contentTypeId: "", // Will be set after creation
              })),
            )
          : [],
        tenant: tenantId ? { connect: { id: tenantId } } : undefined,
        createdBy: userId ? { connect: { id: userId } } : undefined,
      }

      // Create content type
      const contentType = await this.contentTypeRepo.create(createData)

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

      return transformPrismaContentType(contentType)
    } catch (error) {
      logger.error("Failed to create content type:", error)
      throw error
    }
  }

  /**
   * Get content type by ID
   */
  async getContentTypeById(id: string, tenantId?: string, includeFields = true): Promise<ContentTypeWithFields | null> {
    try {
      const cacheKey = `content-type:${id}:${includeFields}`

      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get<ContentTypeWithFields>(cacheKey, tenantId)
        if (cached) {
          return cached
        }
      }

      const contentType = await this.contentTypeRepo.findByIdWithOptions(id, tenantId, includeFields)

      if (!contentType) {
        return null
      }

      const result = transformPrismaContentTypeWithFields(contentType)

      // Cache result
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, result, {
          ttl: this.options.cacheTtl,
          namespace: tenantId,
        })
      }

      return result
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
    includeFields = true,
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

      if (!contentType) {
        return null
      }

      const result = transformPrismaContentTypeWithFields(contentType)

      // Cache result
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, result, {
          ttl: this.options.cacheTtl,
          namespace: tenantId,
        })
      }

      return result
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
  }): Promise<PaginatedContentTypes> {
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
        const cached = await cacheService.get<PaginatedContentTypes>(cacheKey, tenantId)
        if (cached) {
          return cached
        }
      }

      const result = await this.contentTypeRepo.findManyWithPagination({
        page,
        limit,
        search,
        isActive,
        sortBy,
        sortOrder,
        tenantId,
        includeFields,
      })

      const transformedResult: PaginatedContentTypes = {
        contentTypes: result.contentTypes.map((ct) => transformPrismaContentTypeWithFields(ct)),
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      }

      // Cache result
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, transformedResult, {
          ttl: this.options.cacheTtl / 2, // Shorter TTL for lists
          namespace: tenantId,
        })
      }

      return transformedResult
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
    data: UpdateContentTypeInput,
    userId?: string,
    tenantId?: string,
  ): Promise<ContentType> {
    try {
      // Get existing content type
      const existing = await this.contentTypeRepo.findById(id)
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

        // Check field count limit
        if (data.fields.length > this.options.maxFieldsPerType!) {
          throw ApiError.validationError(`Content type cannot have more than ${this.options.maxFieldsPerType} fields`)
        }
      }

      // Prepare update data
      const updateData: any = {}
      if (data.name !== undefined) updateData.name = data.name
      if (data.displayName !== undefined) updateData.displayName = data.displayName
      if (data.description !== undefined) updateData.description = data.description
      if (data.fields !== undefined) {
        const existingFields = parseFieldsFromJson(existing.fields)
        const updatedFields = mergeFields(existingFields, data.fields)
        updateData.fields = serializeFieldsToJson(updatedFields)
      }

      // Update content type
      const contentType = await this.contentTypeRepo.update(id, updateData)

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

      return transformPrismaContentType(contentType)
    } catch (error) {
      logger.error("Failed to update content type:", error)
      throw error
    }
  }

  /**
   * Delete content type
   */
  async deleteContentType(id: string, userId?: string, tenantId?: string, force = false): Promise<void> {
    try {
      // Get existing content type
      const existing = await this.contentTypeRepo.findById(id)
      if (!existing) {
        throw ApiError.notFound("Content type not found")
      }

      // Check if content type is in use (unless force delete)
      if (!force) {
        const usageCount = await this.contentTypeRepo.getUsageCount(id, tenantId)
        if (usageCount > 0) {
          throw ApiError.conflict(
            `Cannot delete content type '${existing.name}' as it is used by ${usageCount} content items. Use force=true to delete anyway.`,
          )
        }
      }

      // Delete content type
      await this.contentTypeRepo.delete(id)

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
    fieldDefinition: CreateFieldDefinition,
    userId?: string,
    tenantId?: string,
  ): Promise<ContentType> {
    try {
      // Get existing content type
      const contentType = await this.contentTypeRepo.findById(contentTypeId)
      if (!contentType) {
        throw ApiError.notFound("Content type not found")
      }

      // Validate field definition
      if (this.options.enableValidation) {
        const validation = validateFieldDefinition(fieldDefinition)
        if (!validation.isValid) {
          throw ApiError.validationError("Field validation failed", validation.errors)
        }
      }

      // Check if field name already exists
      const fields = parseFieldsFromJson(contentType.fields)
      const existingField = fields.find((f) => f.name === fieldDefinition.name)
      if (existingField) {
        throw ApiError.conflict(`Field with name '${fieldDefinition.name}' already exists`)
      }

      // Check field count limit
      if (fields.length >= this.options.maxFieldsPerType!) {
        throw ApiError.validationError(`Content type cannot have more than ${this.options.maxFieldsPerType} fields`)
      }

      // Add field to content type
      const newField: FieldDefinition = {
        ...fieldDefinition,
        id: generateId(),
        required: fieldDefinition.required || false,
        contentTypeId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const updatedFields = [...fields, newField]
      const updatedContentType = await this.contentTypeRepo.update(contentTypeId, {
        fields: serializeFieldsToJson(updatedFields),
      })

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

      return transformPrismaContentType(updatedContentType)
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
    fieldDefinition: Partial<CreateFieldDefinition>,
    userId?: string,
    tenantId?: string,
  ): Promise<ContentType> {
    try {
      // Get existing content type
      const contentType = await this.contentTypeRepo.findById(contentTypeId)
      if (!contentType) {
        throw ApiError.notFound("Content type not found")
      }

      // Find existing field
      const fields = parseFieldsFromJson(contentType.fields)
      const fieldIndex = fields.findIndex((f) => f.id === fieldId)
      if (fieldIndex === -1) {
        throw ApiError.notFound("Field not found")
      }

      const existingField = fields[fieldIndex]

      // Validate field definition
      if (this.options.enableValidation) {
        const fullFieldDef = { ...existingField, ...fieldDefinition }
        const validation = validateFieldDefinition(fullFieldDef)
        if (!validation.isValid) {
          throw ApiError.validationError("Field validation failed", validation.errors)
        }
      }

      // Check if new field name conflicts
      if (fieldDefinition.name && fieldDefinition.name !== existingField.name) {
        const nameConflict = fields.find((f) => f.name === fieldDefinition.name && f.id !== fieldId)
        if (nameConflict) {
          throw ApiError.conflict(`Field with name '${fieldDefinition.name}' already exists`)
        }
      }

      // Update field
      fields[fieldIndex] = {
        ...existingField,
        ...fieldDefinition,
        updatedAt: new Date(),
      }

      const updatedContentType = await this.contentTypeRepo.update(contentTypeId, {
        fields: serializeFieldsToJson(fields),
      })

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

      return transformPrismaContentType(updatedContentType)
    } catch (error) {
      logger.error("Failed to update field in content type:", error)
      throw error
    }
  }

  /**
   * Remove field from content type
   */
  async removeField(contentTypeId: string, fieldId: string, userId?: string, tenantId?: string): Promise<ContentType> {
    try {
      // Get existing content type
      const contentType = await this.contentTypeRepo.findById(contentTypeId)
      if (!contentType) {
        throw ApiError.notFound("Content type not found")
      }

      // Find existing field
      const fields = parseFieldsFromJson(contentType.fields)
      const existingField = fields.find((f) => f.id === fieldId)
      if (!existingField) {
        throw ApiError.notFound("Field not found")
      }

      // Remove field
      const updatedFields = fields.filter((f) => f.id !== fieldId)
      const updatedContentType = await this.contentTypeRepo.update(contentTypeId, {
        fields: serializeFieldsToJson(updatedFields),
      })

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

      return transformPrismaContentType(updatedContentType)
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
   * Bulk create content types
   */
  async bulkCreateContentTypes(
    contentTypes: CreateContentTypeInput[],
    userId?: string,
    tenantId?: string,
  ): Promise<BulkOperationResult> {
    const result: BulkOperationResult = {
      successful: [],
      failed: [],
      total: contentTypes.length,
    }

    for (const contentTypeData of contentTypes) {
      try {
        const contentType = await this.createContentType(contentTypeData, userId, tenantId)
        result.successful.push(contentType.id)
      } catch (error) {
        result.failed.push({
          id: contentTypeData.name,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      }
    }

    logger.info("Bulk content type creation completed", {
      total: result.total,
      successful: result.successful.length,
      failed: result.failed.length,
      userId,
      tenantId,
    })

    return result
  }

  /**
   * Bulk delete content types
   */
  async bulkDeleteContentTypes(
    ids: string[],
    userId?: string,
    tenantId?: string,
    force = false,
  ): Promise<BulkOperationResult> {
    const result: BulkOperationResult = {
      successful: [],
      failed: [],
      total: ids.length,
    }

    for (const id of ids) {
      try {
        await this.deleteContentType(id, userId, tenantId, force)
        result.successful.push(id)
      } catch (error) {
        result.failed.push({
          id,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      }
    }

    logger.info("Bulk content type deletion completed", {
      total: result.total,
      successful: result.successful.length,
      failed: result.failed.length,
      userId,
      tenantId,
      force,
    })

    return result
  }

  /**
   * Clone content type
   */
  async cloneContentType(id: string, newName: string, userId?: string, tenantId?: string): Promise<ContentType> {
    try {
      const original = await this.getContentTypeById(id, tenantId, true)
      if (!original) {
        throw ApiError.notFound("Content type not found")
      }

      const cloneData: CreateContentTypeInput = {
        name: newName,
        displayName: `${original.displayName} (Copy)`,
        description: original.description,
        fields: original.fields?.map((field) => ({
          name: field.name,
          type: field.type,
          displayName: field.displayName,
          description: field.description,
          required: field.required,
          defaultValue: field.defaultValue,
          validationRules: field.validationRules,
          options: field.options,
        })),
        isSystem: false, // Cloned types are never system types
      }

      const cloned = await this.createContentType(cloneData, userId, tenantId)

      logger.info("Content type cloned", {
        originalId: id,
        clonedId: cloned.id,
        newName,
        userId,
        tenantId,
      })

      return cloned
    } catch (error) {
      logger.error("Failed to clone content type:", error)
      throw error
    }
  }

  /**
   * Export content type
   */
  async exportContentType(id: string, tenantId?: string): Promise<ContentTypeExportData> {
    try {
      const contentType = await this.getContentTypeById(id, tenantId, true)
      if (!contentType) {
        throw ApiError.notFound("Content type not found")
      }

      const exportData: ContentTypeExportData = {
        contentType,
        metadata: {
          exportedAt: new Date(),
          version: "1.0",
          checksum: this.generateChecksum(contentType),
        },
      }

      logger.info("Content type exported", {
        id,
        name: contentType.name,
        tenantId,
      })

      return exportData
    } catch (error) {
      logger.error("Failed to export content type:", error)
      throw error
    }
  }

  /**
   * Import content type
   */
  async importContentType(
    exportData: ContentTypeExportData,
    options: ContentTypeImportOptions = {},
    userId?: string,
    tenantId?: string,
  ): Promise<ContentType> {
    try {
      const { overwrite = false, validateOnly = false, skipValidation = false } = options
      const { contentType } = exportData

      // Validate checksum if not skipping validation
      if (!skipValidation) {
        const expectedChecksum = this.generateChecksum(contentType)
        if (exportData.metadata.checksum !== expectedChecksum) {
          throw ApiError.validationError("Import data checksum validation failed")
        }
      }

      // Check if content type already exists
      const existing = await this.getContentTypeByName(contentType.name, tenantId)
      if (existing && !overwrite) {
        throw ApiError.conflict(
          `Content type with name '${contentType.name}' already exists. Use overwrite=true to replace it.`,
        )
      }

      // If validate only, return early
      if (validateOnly) {
        logger.info("Content type import validation successful", {
          name: contentType.name,
          tenantId,
        })
        return contentType as ContentType
      }

      const importData: CreateContentTypeInput = {
        name: contentType.name,
        displayName: contentType.displayName,
        description: contentType.description,
        fields: contentType.fields?.map((field) => ({
          name: field.name,
          type: field.type,
          displayName: field.displayName,
          description: field.description,
          required: field.required,
          defaultValue: field.defaultValue,
          validationRules: field.validationRules,
          options: field.options,
        })),
        isSystem: false, // Imported types are never system types
      }

      let result: ContentType

      if (existing && overwrite) {
        // Update existing content type
        result = await this.updateContentType(existing.id, importData, userId, tenantId)
      } else {
        // Create new content type
        result = await this.createContentType(importData, userId, tenantId)
      }

      logger.info("Content type imported", {
        id: result.id,
        name: result.name,
        overwrite,
        userId,
        tenantId,
      })

      return result
    } catch (error) {
      logger.error("Failed to import content type:", error)
      throw error
    }
  }

  /**
   * Validate content type structure
   */
  async validateContentType(id: string, tenantId?: string): Promise<ContentTypeValidationResult> {
    try {
      const contentType = await this.getContentTypeById(id, tenantId, true)
      if (!contentType) {
        throw ApiError.notFound("Content type not found")
      }

      const validation = validateContentTypeData({
        name: contentType.name,
        displayName: contentType.displayName,
        description: contentType.description,
        fields:
          contentType.fields?.map((field) => ({
            name: field.name,
            type: field.type,
            displayName: field.displayName,
            description: field.description,
            required: field.required,
            defaultValue: field.defaultValue,
            validationRules: field.validationRules,
            options: field.options,
          })) || [],
      })

      logger.info("Content type validation completed", {
        id,
        name: contentType.name,
        isValid: validation.isValid,
        errorsCount: validation.errors?.length || 0,
        tenantId,
      })

      return validation
    } catch (error) {
      logger.error("Failed to validate content type:", error)
      throw error
    }
  }

  /**
   * Get available field types
   */
  async getAvailableFieldTypes(): Promise<FieldType[]> {
    try {
      const cacheKey = "field-types:available"

      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get<FieldType[]>(cacheKey)
        if (cached) {
          return cached
        }
      }

      const fieldTypes = await this.fieldTypeRepo.findAll()

      // Cache result
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, fieldTypes, {
          ttl: this.options.cacheTtl * 2, // Longer TTL for field types
        })
      }

      return fieldTypes
    } catch (error) {
      logger.error("Failed to get available field types:", error)
      throw error
    }
  }

  /**
   * Search content types
   */
  async searchContentTypes(
    query: string,
    options: {
      tenantId?: string
      limit?: number
      includeFields?: boolean
      searchInFields?: boolean
    } = {},
  ): Promise<ContentTypeWithFields[]> {
    try {
      const { tenantId, limit = 50, includeFields = false, searchInFields = false } = options

      const cacheKey = `content-types:search:${query}:${JSON.stringify(options)}`

      // Try cache first
      if (this.options.enableCache) {
        const cached = await cacheService.get<ContentTypeWithFields[]>(cacheKey, tenantId)
        if (cached) {
          return cached
        }
      }

      const results = await this.contentTypeRepo.search(query, {
        tenantId,
        limit,
        includeFields,
        searchInFields,
      })

      const transformedResults = results.map((ct) => transformPrismaContentTypeWithFields(ct))

      // Cache result
      if (this.options.enableCache) {
        await cacheService.set(cacheKey, transformedResults, {
          ttl: this.options.cacheTtl / 4, // Shorter TTL for search results
          namespace: tenantId,
        })
      }

      return transformedResults
    } catch (error) {
      logger.error("Failed to search content types:", error)
      throw error
    }
  }

  /**
   * Reorder fields in content type
   */
  async reorderFields(
    contentTypeId: string,
    fieldOrder: string[],
    userId?: string,
    tenantId?: string,
  ): Promise<ContentType> {
    try {
      const contentType = await this.contentTypeRepo.findById(contentTypeId)
      if (!contentType) {
        throw ApiError.notFound("Content type not found")
      }

      const fields = parseFieldsFromJson(contentType.fields)

      // Validate that all field IDs are present
      const fieldIds = fields.map((f) => f.id)
      const missingIds = fieldOrder.filter((id) => !fieldIds.includes(id))
      const extraIds = fieldIds.filter((id) => !fieldOrder.includes(id))

      if (missingIds.length > 0 || extraIds.length > 0) {
        throw ApiError.validationError("Field order does not match existing fields")
      }

      // Reorder fields
      const reorderedFields = fieldOrder.map((id) => {
        const field = fields.find((f) => f.id === id)!
        return { ...field, updatedAt: new Date() }
      })

      const updatedContentType = await this.contentTypeRepo.update(contentTypeId, {
        fields: serializeFieldsToJson(reorderedFields),
      })

      // Clear cache
      if (this.options.enableCache) {
        await this.clearContentTypeCache(tenantId)
      }

      // Audit log
      if (this.options.enableAudit && userId) {
        await auditService.log({
          action: "content_type.reorder_fields",
          entityType: "ContentType",
          entityId: contentTypeId,
          userId,
          details: {
            fieldOrder,
          },
        })
      }

      logger.info("Fields reordered in content type", {
        contentTypeId,
        fieldsCount: fieldOrder.length,
        userId,
        tenantId,
      })

      return transformPrismaContentType(updatedContentType)
    } catch (error) {
      logger.error("Failed to reorder fields:", error)
      throw error
    }
  }

  // Private helper methods

  private async validateFieldDefinitions(fields: CreateFieldDefinition[]): Promise<void> {
    if (!this.options.enableValidation) return

    const fieldNames = new Set<string>()

    for (const field of fields) {
      // Check for duplicate field names
      if (fieldNames.has(field.name)) {
        throw ApiError.validationError(`Duplicate field name: ${field.name}`)
      }
      fieldNames.add(field.name)

      // Validate individual field
      const validation = validateFieldDefinition(field)
      if (!validation.isValid) {
        throw ApiError.validationError(`Field '${field.name}' validation failed`, validation.errors)
      }
    }
  }

  private async clearContentTypeCache(tenantId?: string): Promise<void> {
    try {
      const patterns = ["content-type:*", "content-types:*", "field-types:*"]

      for (const pattern of patterns) {
        await cacheService.deletePattern(pattern, tenantId)
      }
    } catch (error) {
      logger.warn("Failed to clear content type cache:", error)
    }
  }

  private generateChecksum(contentType: ContentTypeWithFields): string {
    const data = JSON.stringify({
      name: contentType.name,
      displayName: contentType.displayName,
      description: contentType.description,
      fields: contentType.fields?.map((f) => ({
        name: f.name,
        type: f.type,
        required: f.required,
        validationRules: f.validationRules,
      })),
    })

    // Simple checksum implementation (in production, use a proper hash function)
    let hash = 0
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16)
  }
}

// Export singleton instance
export const contentTypeService = new ContentTypeService(new PrismaClient())
