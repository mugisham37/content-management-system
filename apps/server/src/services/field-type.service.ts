import { FieldTypeRepository } from "@cms-platform/database/repositories/field-type.repository"
import { PrismaClient, FieldDataType, FieldUIType } from "@prisma/client"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import { cacheService } from "./cache.service"
import { AuditService } from "./audit.service"

export interface FieldValidation {
  required?: boolean
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  pattern?: string
  message?: string
  enum?: string[]
}

export interface FieldTypeServiceOptions {
  enableCache?: boolean
  cacheTtl?: number
  enableAudit?: boolean
}

export class FieldTypeService {
  private fieldTypeRepo: FieldTypeRepository
  private auditService: AuditService
  private options: FieldTypeServiceOptions

  constructor(prisma: PrismaClient, options: FieldTypeServiceOptions = {}) {
    this.fieldTypeRepo = new FieldTypeRepository(prisma)
    this.auditService = new AuditService()
    this.options = {
      enableCache: true,
      cacheTtl: 3600, // 1 hour
      enableAudit: true,
      ...options,
    }

    logger.info("Field Type service initialized", this.options)
  }

  /**
   * Initialize built-in field types
   */
  public async initializeBuiltInFieldTypes(): Promise<void> {
    try {
      const builtInFieldTypes = [
        {
          name: "string",
          displayName: "String",
          description: "Single line text field",
          dataType: FieldDataType.STRING,
          uiType: FieldUIType.TEXT_INPUT,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false, minLength: 0, maxLength: 255 },
          settings: {
            placeholder: "",
            defaultValue: "",
          },
        },
        {
          name: "text",
          displayName: "Text",
          description: "Multi-line text field",
          dataType: FieldDataType.TEXT,
          uiType: FieldUIType.TEXT_AREA,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false },
          settings: {
            placeholder: "",
            defaultValue: "",
            rows: 4,
          },
        },
        {
          name: "richText",
          displayName: "Rich Text",
          description: "Rich text editor with formatting options",
          dataType: FieldDataType.RICH_TEXT,
          uiType: FieldUIType.RICH_TEXT_EDITOR,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false },
          settings: {
            defaultValue: "",
            toolbar: ["bold", "italic", "underline", "link", "bulletList", "orderedList"],
          },
        },
        {
          name: "number",
          displayName: "Number",
          description: "Numeric field",
          dataType: FieldDataType.NUMBER,
          uiType: FieldUIType.NUMBER_INPUT,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false, min: null, max: null },
          settings: {
            placeholder: "",
            defaultValue: null,
            step: 1,
          },
        },
        {
          name: "boolean",
          displayName: "Boolean",
          description: "True/false field",
          dataType: FieldDataType.BOOLEAN,
          uiType: FieldUIType.TOGGLE,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false },
          settings: {
            defaultValue: false,
            labelOn: "Yes",
            labelOff: "No",
          },
        },
        {
          name: "date",
          displayName: "Date",
          description: "Date picker",
          dataType: FieldDataType.DATE,
          uiType: FieldUIType.DATE_PICKER,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false },
          settings: {
            defaultValue: null,
            format: "YYYY-MM-DD",
          },
        },
        {
          name: "datetime",
          displayName: "Date & Time",
          description: "Date and time picker",
          dataType: FieldDataType.DATETIME,
          uiType: FieldUIType.DATE_TIME_PICKER,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false },
          settings: {
            defaultValue: null,
            format: "YYYY-MM-DD HH:mm",
          },
        },
        {
          name: "email",
          displayName: "Email",
          description: "Email address field",
          dataType: FieldDataType.EMAIL,
          uiType: FieldUIType.EMAIL_INPUT,
          isSystem: true,
          isBuiltIn: true,
          validations: {
            required: false,
            pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
            message: "Please enter a valid email address",
          },
          settings: {
            placeholder: "",
            defaultValue: "",
          },
        },
        {
          name: "url",
          displayName: "URL",
          description: "URL field",
          dataType: FieldDataType.URL,
          uiType: FieldUIType.URL_INPUT,
          isSystem: true,
          isBuiltIn: true,
          validations: {
            required: false,
            pattern: "^(https?:\\/\\/)?([\\da-z.-]+)\\.([a-z.]{2,6})([\\/\\w .-]*)*\\/?$",
            message: "Please enter a valid URL",
          },
          settings: {
            placeholder: "",
            defaultValue: "",
          },
        },
        {
          name: "image",
          displayName: "Image",
          description: "Image upload field",
          dataType: FieldDataType.IMAGE,
          uiType: FieldUIType.IMAGE_UPLOADER,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false },
          settings: {
            maxSize: 5242880, // 5MB
            allowedTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
            dimensions: {
              width: null,
              height: null,
              aspectRatio: null,
            },
          },
        },
        {
          name: "file",
          displayName: "File",
          description: "File upload field",
          dataType: FieldDataType.FILE,
          uiType: FieldUIType.FILE_UPLOADER,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false },
          settings: {
            maxSize: 10485760, // 10MB
            allowedTypes: ["*/*"],
          },
        },
        {
          name: "reference",
          displayName: "Reference",
          description: "Reference to another content type",
          dataType: FieldDataType.REFERENCE,
          uiType: FieldUIType.REFERENCE_SELECTOR,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false },
          settings: {
            contentTypeId: null,
            displayField: "title",
          },
        },
        {
          name: "json",
          displayName: "JSON",
          description: "JSON data field",
          dataType: FieldDataType.JSON,
          uiType: FieldUIType.JSON_EDITOR,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false },
          settings: {
            defaultValue: {},
          },
        },
        {
          name: "array",
          displayName: "Array",
          description: "Array of values",
          dataType: FieldDataType.ARRAY,
          uiType: FieldUIType.ARRAY_EDITOR,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false, minLength: 0, maxLength: null },
          settings: {
            itemType: "string",
            defaultValue: [],
          },
        },
        {
          name: "component",
          displayName: "Component",
          description: "Reusable component",
          dataType: FieldDataType.COMPONENT,
          uiType: FieldUIType.COMPONENT_EDITOR,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false },
          settings: {
            componentId: null,
            allowMultiple: false,
          },
        },
        {
          name: "enum",
          displayName: "Enumeration",
          description: "Select from predefined options",
          dataType: FieldDataType.ENUM,
          uiType: FieldUIType.SELECT,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false, enum: [] },
          settings: {
            options: [],
            defaultValue: null,
            allowMultiple: false,
          },
        },
        {
          name: "color",
          displayName: "Color",
          description: "Color picker",
          dataType: FieldDataType.COLOR,
          uiType: FieldUIType.COLOR_PICKER,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false },
          settings: {
            defaultValue: null,
            format: "hex", // hex, rgb, rgba
          },
        },
        {
          name: "geoPoint",
          displayName: "Geographic Point",
          description: "Geographic coordinates",
          dataType: FieldDataType.GEO_POINT,
          uiType: FieldUIType.MAP,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false },
          settings: {
            defaultValue: null,
          },
        },
        {
          name: "relation",
          displayName: "Relation",
          description: "Relation to other content types",
          dataType: FieldDataType.RELATION,
          uiType: FieldUIType.RELATION_EDITOR,
          isSystem: true,
          isBuiltIn: true,
          validations: { required: false },
          settings: {
            contentTypeId: null,
            relationType: "oneToMany", // oneToOne, oneToMany, manyToMany
            inversedBy: null,
          },
        },
      ]

      // Check if built-in field types already exist
      const existingCount = await this.fieldTypeRepo.countBuiltIn()

      if (existingCount === builtInFieldTypes.length) {
        logger.info("Built-in field types already initialized")
        return
      }

      // Delete existing built-in field types
      await this.fieldTypeRepo.deleteBuiltIn()

      // Create built-in field types
      for (const fieldType of builtInFieldTypes) {
        await this.fieldTypeRepo.create(fieldType as any)
      }

      logger.info(`Initialized ${builtInFieldTypes.length} built-in field types`)
    } catch (error) {
      logger.error("Failed to initialize built-in field types:", error)
      throw ApiError.internal("Failed to initialize built-in field types")
    }
  }

  /**
   * Get all field types
   */
  public async getAllFieldTypes(tenantId?: string): Promise<any[]> {
    try {
      const cacheKey = "field-types:all"
      
      if (this.options.enableCache) {
        const cached = await cacheService.get(cacheKey, tenantId)
        if (cached) return cached
      }

      const fieldTypes = await this.fieldTypeRepo.findMany({ tenantId })

      if (this.options.enableCache) {
        await cacheService.set(cacheKey, fieldTypes, {
          ttl: this.options.cacheTtl,
          namespace: tenantId,
        })
      }

      return fieldTypes
    } catch (error) {
      logger.error("Failed to get field types:", error)
      throw ApiError.internal("Failed to get field types")
    }
  }

  /**
   * Get field type by ID
   */
  public async getFieldTypeById(id: string, tenantId?: string): Promise<any> {
    try {
      const fieldType = await this.fieldTypeRepo.findByIdWithTenant(id, tenantId)
      if (!fieldType) {
        throw ApiError.notFound("Field type not found")
      }
      return fieldType
    } catch (error) {
      if (error instanceof ApiError) throw error
      logger.error("Failed to get field type:", error)
      throw ApiError.internal("Failed to get field type")
    }
  }

  /**
   * Get field type by name
   */
  public async getFieldTypeByName(name: string, tenantId?: string): Promise<any> {
    try {
      const fieldType = await this.fieldTypeRepo.findByName(name, tenantId)
      if (!fieldType) {
        throw ApiError.notFound("Field type not found")
      }
      return fieldType
    } catch (error) {
      if (error instanceof ApiError) throw error
      logger.error("Failed to get field type:", error)
      throw ApiError.internal("Failed to get field type")
    }
  }

  /**
   * Create a new field type
   */
  public async createFieldType(
    data: {
      name: string
      displayName: string
      dataType: FieldDataType
      uiType: FieldUIType
      description?: string
      validations?: FieldValidation
      settings?: Record<string, any>
      pluginId?: string
      tenantId?: string
    },
    userId?: string
  ): Promise<any> {
    try {
      // Check if field type already exists
      const existingFieldType = await this.fieldTypeRepo.findByName(data.name, data.tenantId)
      if (existingFieldType) {
        throw ApiError.conflict(`Field type with name '${data.name}' already exists`)
      }

      // Create field type
      const fieldType = await this.fieldTypeRepo.create({
        ...data,
        validations: data.validations ? [data.validations] : undefined,
        isSystem: false,
        isBuiltIn: false,
        createdBy: userId,
        updatedBy: userId,
      })

      // Clear cache
      if (this.options.enableCache) {
        await cacheService.deletePattern("field-types*", data.tenantId)
      }

      // Audit log
      if (this.options.enableAudit && userId) {
        await this.auditService.log({
          action: "field_type.create",
          entityType: "FieldType",
          entityId: fieldType.id,
          userId,
          details: {
            name: fieldType.name,
            dataType: fieldType.dataType,
            uiType: fieldType.uiType,
          },
        })
      }

      logger.info("Field type created", {
        id: fieldType.id,
        name: fieldType.name,
        userId,
        tenantId: data.tenantId,
      })

      return fieldType
    } catch (error) {
      if (error instanceof ApiError) throw error
      logger.error("Failed to create field type:", error)
      throw ApiError.internal("Failed to create field type")
    }
  }

  /**
   * Update a field type
   */
  public async updateFieldType(
    id: string,
    updates: {
      displayName?: string
      description?: string
      uiType?: FieldUIType
      validations?: FieldValidation
      settings?: Record<string, any>
    },
    userId?: string,
    tenantId?: string
  ): Promise<any> {
    try {
      const fieldType = await this.getFieldTypeById(id, tenantId)

      // Prevent updating built-in field types
      if (fieldType.isBuiltIn) {
        throw ApiError.forbidden("Cannot update built-in field types")
      }

      // Update field type
      const updatedFieldType = await this.fieldTypeRepo.updateWithTenant(id, {
        ...updates,
        validations: updates.validations ? [updates.validations] : undefined,
        updatedBy: userId,
      }, tenantId)

      // Clear cache
      if (this.options.enableCache) {
        await cacheService.deletePattern("field-types*", tenantId)
      }

      // Audit log
      if (this.options.enableAudit && userId) {
        await this.auditService.log({
          action: "field_type.update",
          entityType: "FieldType",
          entityId: id,
          userId,
          details: {
            changes: updates,
          },
        })
      }

      logger.info("Field type updated", {
        id,
        userId,
        tenantId,
      })

      return updatedFieldType
    } catch (error) {
      if (error instanceof ApiError) throw error
      logger.error("Failed to update field type:", error)
      throw ApiError.internal("Failed to update field type")
    }
  }

  /**
   * Delete a field type
   */
  public async deleteFieldType(id: string, userId?: string, tenantId?: string): Promise<void> {
    try {
      const fieldType = await this.getFieldTypeById(id, tenantId)

      // Prevent deleting built-in field types
      if (fieldType.isBuiltIn) {
        throw ApiError.forbidden("Cannot delete built-in field types")
      }

      // Prevent deleting system field types
      if (fieldType.isSystem) {
        throw ApiError.forbidden("Cannot delete system field types")
      }

      // TODO: Check if field type is in use by any content types

      await this.fieldTypeRepo.deleteWithTenant(id, tenantId)

      // Clear cache
      if (this.options.enableCache) {
        await cacheService.deletePattern("field-types*", tenantId)
      }

      // Audit log
      if (this.options.enableAudit && userId) {
        await this.auditService.log({
          action: "field_type.delete",
          entityType: "FieldType",
          entityId: id,
          userId,
          details: {
            name: fieldType.name,
          },
        })
      }

      logger.info("Field type deleted", {
        id,
        name: fieldType.name,
        userId,
        tenantId,
      })
    } catch (error) {
      if (error instanceof ApiError) throw error
      logger.error("Failed to delete field type:", error)
      throw ApiError.internal("Failed to delete field type")
    }
  }

  /**
   * Validate field value against field type
   */
  public async validateFieldValue(
    fieldTypeId: string,
    value: any,
    tenantId?: string
  ): Promise<{ valid: boolean; errors?: string[] }> {
    try {
      const fieldType = await this.getFieldTypeById(fieldTypeId, tenantId)
      const errors: string[] = []

      // Skip validation if value is null or undefined
      if (value === null || value === undefined) {
        // Check if field is required
        if (fieldType.validations?.required) {
          errors.push("This field is required")
        }
        return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined }
      }

      // Validate based on data type
      switch (fieldType.dataType) {
        case FieldDataType.STRING:
        case FieldDataType.TEXT:
        case FieldDataType.RICH_TEXT:
        case FieldDataType.EMAIL:
        case FieldDataType.URL:
          if (typeof value !== "string") {
            errors.push(`Value must be a string`)
          } else {
            // Check min length
            if (fieldType.validations?.minLength !== undefined && value.length < fieldType.validations.minLength) {
              errors.push(`Minimum length is ${fieldType.validations.minLength} characters`)
            }

            // Check max length
            if (fieldType.validations?.maxLength !== undefined && value.length > fieldType.validations.maxLength) {
              errors.push(`Maximum length is ${fieldType.validations.maxLength} characters`)
            }

            // Check pattern
            if (fieldType.validations?.pattern) {
              const regex = new RegExp(fieldType.validations.pattern)
              if (!regex.test(value)) {
                errors.push(fieldType.validations.message || "Value does not match the required pattern")
              }
            }
          }
          break

        case FieldDataType.NUMBER:
        case FieldDataType.INTEGER:
        case FieldDataType.FLOAT:
          if (typeof value !== "number") {
            errors.push(`Value must be a number`)
          } else {
            // Check if integer
            if (fieldType.dataType === FieldDataType.INTEGER && !Number.isInteger(value)) {
              errors.push("Value must be an integer")
            }

            // Check min value
            if (fieldType.validations?.min !== undefined && value < fieldType.validations.min) {
              errors.push(`Minimum value is ${fieldType.validations.min}`)
            }

            // Check max value
            if (fieldType.validations?.max !== undefined && value > fieldType.validations.max) {
              errors.push(`Maximum value is ${fieldType.validations.max}`)
            }
          }
          break

        case FieldDataType.BOOLEAN:
          if (typeof value !== "boolean") {
            errors.push(`Value must be a boolean`)
          }
          break

        case FieldDataType.DATE:
        case FieldDataType.DATETIME:
          if (!(value instanceof Date) && !(typeof value === "string" && !isNaN(Date.parse(value)))) {
            errors.push(`Value must be a valid date`)
          }
          break

        case FieldDataType.ENUM:
          if (fieldType.validations?.enum && !fieldType.validations.enum.includes(value)) {
            errors.push(`Value must be one of: ${fieldType.validations.enum.join(", ")}`)
          }
          break

        case FieldDataType.ARRAY:
          if (!Array.isArray(value)) {
            errors.push(`Value must be an array`)
          } else {
            // Check min length
            if (fieldType.validations?.minLength !== undefined && value.length < fieldType.validations.minLength) {
              errors.push(`Minimum length is ${fieldType.validations.minLength} items`)
            }

            // Check max length
            if (fieldType.validations?.maxLength !== undefined && value.length > fieldType.validations.maxLength) {
              errors.push(`Maximum length is ${fieldType.validations.maxLength} items`)
            }
          }
          break

        // Add more validations for other data types as needed
      }

      return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined }
    } catch (error) {
      if (error instanceof ApiError) throw error
      logger.error("Failed to validate field value:", error)
      throw ApiError.internal("Failed to validate field value")
    }
  }
}

// Note: Singleton instance should be created with proper PrismaClient injection
// This will be handled by the dependency injection container
// export const fieldTypeService = new FieldTypeService(prisma)
