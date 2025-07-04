// =============================================================================
// CONTENT TYPE REPOSITORY - POSTGRESQL
// =============================================================================
// Dynamic content type management with field definitions

import { PrismaClient, ContentType, Prisma } from '@prisma/client'
import { BaseRepository } from './base.repository'

export type ContentTypeCreateInput = Prisma.ContentTypeCreateInput
export type ContentTypeUpdateInput = Prisma.ContentTypeUpdateInput

export interface ContentTypeWithRelations extends ContentType {
  tenant?: any
  createdBy?: any
  contents?: any[]
  workflows?: any[]
}

export interface FieldDefinition {
  id?: string
  name: string
  displayName: string
  type: string
  description?: string
  validation?: {
    required?: boolean
    unique?: boolean
    min?: number
    max?: number
    minLength?: number
    maxLength?: number
    pattern?: string
    enum?: string[]
    message?: string
  }
  defaultValue?: any
  isSystem: boolean
  isLocalized?: boolean
  settings?: Record<string, any>
}

export class ContentTypeRepository extends BaseRepository<ContentType, ContentTypeCreateInput, ContentTypeUpdateInput> {
  protected modelName = 'ContentType'
  protected model = this.prisma.contentType

  constructor(prisma: PrismaClient) {
    super(prisma)
  }

  /**
   * Find content type by name
   */
  async findByName(name: string, tenantId?: string): Promise<ContentType | null> {
    const where: any = { name }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findFirst(where)
  }

  /**
   * Find content type by name or throw error
   */
  async findByNameOrThrow(name: string, tenantId?: string): Promise<ContentType> {
    const contentType = await this.findByName(name, tenantId)
    if (!contentType) {
      throw new Error(`Content type not found with name: ${name}`)
    }
    return contentType
  }

  /**
   * Check if content type exists by name
   */
  async existsByName(name: string, tenantId?: string): Promise<boolean> {
    const where: any = { name }
    if (tenantId) {
      where.tenantId = tenantId
    }

    const count = await this.count(where)
    return count > 0
  }

  /**
   * Find system content types
   */
  async findSystemContentTypes(tenantId?: string): Promise<ContentType[]> {
    const where: any = { isSystem: true }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where)
  }

  /**
   * Find non-system content types
   */
  async findNonSystemContentTypes(tenantId?: string): Promise<ContentType[]> {
    const where: any = { isSystem: false }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where)
  }

  /**
   * Create content type with system fields
   */
  async createWithSystemFields(
    data: Omit<ContentTypeCreateInput, 'fields'> & { 
      fields?: FieldDefinition[] 
    }
  ): Promise<ContentType> {
    const systemFields: FieldDefinition[] = [
      {
        name: 'id',
        displayName: 'ID',
        type: 'STRING',
        isSystem: true,
        validation: { required: true, unique: true },
      },
      {
        name: 'createdAt',
        displayName: 'Created At',
        type: 'DATETIME',
        isSystem: true,
        validation: { required: true },
      },
      {
        name: 'updatedAt',
        displayName: 'Updated At',
        type: 'DATETIME',
        isSystem: true,
        validation: { required: true },
      },
    ]

    const allFields = [...systemFields, ...(data.fields || [])]

    return this.create({
      ...data,
      fields: allFields as any,
    })
  }

  /**
   * Add field to content type
   */
  async addField(contentTypeId: string, field: FieldDefinition): Promise<ContentType> {
    const contentType = await this.findByIdOrThrow(contentTypeId)
    const currentFields = (contentType.fields as unknown as FieldDefinition[]) || []

    // Check if field name already exists
    const fieldExists = currentFields.some(f => f.name === field.name)
    if (fieldExists) {
      throw new Error(`Field with name '${field.name}' already exists in this content type`)
    }

    // Add unique ID to field if not provided
    const fieldWithId = {
      ...field,
      id: field.id || `field_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    }

    const updatedFields = [...currentFields, fieldWithId]

    return this.update(contentTypeId, {
      fields: updatedFields as any,
    })
  }

  /**
   * Update field in content type
   */
  async updateField(contentTypeId: string, fieldId: string, fieldData: Partial<FieldDefinition>): Promise<ContentType> {
    const contentType = await this.findByIdOrThrow(contentTypeId)
    const currentFields = (contentType.fields as unknown as FieldDefinition[]) || []

    // Find field index
    const fieldIndex = currentFields.findIndex(f => f.id === fieldId)
    if (fieldIndex === -1) {
      throw new Error(`Field not found with ID: ${fieldId}`)
    }

    // Check if field is system field
    if (currentFields[fieldIndex].isSystem) {
      throw new Error('Cannot modify system fields')
    }

    // Update field
    const updatedFields = [...currentFields]
    updatedFields[fieldIndex] = { ...updatedFields[fieldIndex], ...fieldData }

    return this.update(contentTypeId, {
      fields: updatedFields as any,
    })
  }

  /**
   * Remove field from content type
   */
  async removeField(contentTypeId: string, fieldId: string): Promise<ContentType> {
    const contentType = await this.findByIdOrThrow(contentTypeId)
    const currentFields = (contentType.fields as unknown as FieldDefinition[]) || []

    // Find field
    const field = currentFields.find(f => f.id === fieldId)
    if (!field) {
      throw new Error(`Field not found with ID: ${fieldId}`)
    }

    // Check if field is system field
    if (field.isSystem) {
      throw new Error('Cannot remove system fields')
    }

    // Remove field
    const updatedFields = currentFields.filter(f => f.id !== fieldId)

    return this.update(contentTypeId, {
      fields: updatedFields as any,
    })
  }

  /**
   * Reorder fields in content type
   */
  async reorderFields(contentTypeId: string, fieldOrder: string[]): Promise<ContentType> {
    const contentType = await this.findByIdOrThrow(contentTypeId)
    const currentFields = (contentType.fields as unknown as FieldDefinition[]) || []

    // Create a map for quick lookup
    const fieldMap = new Map(currentFields.map(f => [f.id!, f]))

    // Reorder fields based on provided order
    const reorderedFields = fieldOrder
      .map(fieldId => fieldMap.get(fieldId))
      .filter(Boolean) as FieldDefinition[]

    // Add any fields not in the order list at the end
    const orderedFieldIds = new Set(fieldOrder)
    const remainingFields = currentFields.filter(f => !orderedFieldIds.has(f.id!))
    const finalFields = [...reorderedFields, ...remainingFields]

    return this.update(contentTypeId, {
      fields: finalFields as any,
    })
  }

  /**
   * Get field by name
   */
  async getField(contentTypeId: string, fieldName: string): Promise<FieldDefinition | null> {
    const contentType = await this.findByIdOrThrow(contentTypeId)
    const fields = (contentType.fields as unknown as FieldDefinition[]) || []
    
    return fields.find(f => f.name === fieldName) || null
  }

  /**
   * Search content types
   */
  async search(query: string, tenantId?: string): Promise<ContentType[]> {
    const where: any = {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { displayName: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where)
  }

  /**
   * Find content types with their relations
   */
  async findWithRelations(
    where?: Record<string, any>,
    includeRelations: {
      tenant?: boolean
      createdBy?: boolean
      contents?: boolean
      workflows?: boolean
    } = {}
  ): Promise<ContentTypeWithRelations[]> {
    return this.findMany(where, includeRelations) as Promise<ContentTypeWithRelations[]>
  }

  /**
   * Get content type statistics
   */
  async getStatistics(tenantId?: string): Promise<{
    total: number
    system: number
    custom: number
    withContents: number
    withWorkflows: number
  }> {
    const where: any = {}
    if (tenantId) {
      where.tenantId = tenantId
    }

    const [
      total,
      system,
      custom,
      withContents,
      withWorkflows,
    ] = await Promise.all([
      this.count(where),
      this.count({ ...where, isSystem: true }),
      this.count({ ...where, isSystem: false }),
      this.prisma.contentType.count({
        where: {
          ...where,
          contents: {
            some: {},
          },
        },
      }),
      this.prisma.contentType.count({
        where: {
          ...where,
          workflows: {
            some: {},
          },
        },
      }),
    ])

    return {
      total,
      system,
      custom,
      withContents,
      withWorkflows,
    }
  }

  /**
   * Validate field definition
   */
  validateField(field: FieldDefinition): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // Check required properties
    if (!field.name) {
      errors.push('Field name is required')
    }

    if (!field.displayName) {
      errors.push('Field display name is required')
    }

    if (!field.type) {
      errors.push('Field type is required')
    }

    // Validate field name format
    if (field.name && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.name)) {
      errors.push('Field name must start with a letter and contain only letters, numbers, and underscores')
    }

    // Validate validation rules
    if (field.validation) {
      const { min, max, minLength, maxLength } = field.validation

      if (min !== undefined && max !== undefined && min > max) {
        errors.push('Minimum value cannot be greater than maximum value')
      }

      if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
        errors.push('Minimum length cannot be greater than maximum length')
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * Clone content type
   */
  async clone(
    contentTypeId: string, 
    newName: string, 
    newDisplayName: string,
    tenantId?: string
  ): Promise<ContentType> {
    const originalContentType = await this.findByIdOrThrow(contentTypeId)

    // Check if new name already exists
    const exists = await this.existsByName(newName, tenantId)
    if (exists) {
      throw new Error(`Content type with name '${newName}' already exists`)
    }

    // Clone the content type
    const clonedData: ContentTypeCreateInput = {
      name: newName,
      displayName: newDisplayName,
      description: originalContentType.description ? `${originalContentType.description} (Copy)` : undefined,
      isSystem: false, // Cloned content types are never system types
      fields: originalContentType.fields as any,
      tenant: tenantId ? { connect: { id: tenantId } } : undefined,
    }

    return this.create(clonedData)
  }
}
