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
  async findByName(name: string, tenantId?: string, includeFields = false): Promise<ContentType | null> {
    const where: any = { name }
    if (tenantId) {
      where.tenantId = tenantId
    }

    const include = includeFields ? { fields: true } : undefined
    return this.findFirst(where, include)
  }

  /**
   * Find content type by ID with tenant and field options
   */
  async findByIdWithOptions(id: string, tenantId?: string, includeFields = false): Promise<ContentType | null> {
    const where: any = { id }
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findFirst({
        where,
        include: includeFields ? { 
          tenant: true,
          createdBy: true 
        } : undefined,
      })
    } catch (error) {
      this.handleError(error, 'findByIdWithOptions')
    }
  }

  /**
   * Find many content types with pagination and filtering
   */
  async findManyWithPagination(options: {
    page?: number
    limit?: number
    search?: string
    isActive?: boolean
    sortBy?: string
    sortOrder?: "asc" | "desc"
    tenantId?: string
    includeFields?: boolean
  }): Promise<{
    contentTypes: ContentType[]
    total: number
    page: number
    limit: number
    totalPages: number
  }> {
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

    const where: any = {}
    if (tenantId) {
      where.tenantId = tenantId
    }
    if (isActive !== undefined) {
      where.isActive = isActive
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    const orderBy = { [sortBy]: sortOrder }

    const [contentTypes, total] = await Promise.all([
      this.model.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.model.count({ where }),
    ])

    return {
      contentTypes,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
   * Get usage count for content type
   */
  async getUsageCount(id: string, tenantId?: string): Promise<number> {
    // This would typically count related content items
    // For now, return 0 as a placeholder
    return 0
  }

  /**
   * Get content type statistics
   */
  async getStats(tenantId?: string): Promise<{
    totalTypes: number
    activeTypes: number
    totalFields: number
    fieldsByType: Record<string, number>
    mostUsedTypes: Array<{ id: string; name: string; usageCount: number }>
  }> {
    const where: any = {}
    if (tenantId) {
      where.tenantId = tenantId
    }

    const [totalTypes, activeTypes, allContentTypes] = await Promise.all([
      this.model.count({ where }),
      this.model.count({ where: { ...where, isActive: true } }),
      this.model.findMany({
        where,
        select: {
          id: true,
          name: true,
          fields: true,
        },
      }),
    ])

    let totalFields = 0
    const fieldsByType: Record<string, number> = {}

    allContentTypes.forEach(ct => {
      const fieldsCount = Array.isArray(ct.fields) ? ct.fields.length : 0
      totalFields += fieldsCount
      fieldsByType[ct.name] = fieldsCount
    })

    // Placeholder for most used types - would need content usage data
    const mostUsedTypes = allContentTypes.slice(0, 5).map(ct => ({
      id: ct.id,
      name: ct.name,
      usageCount: 0,
    }))

    return {
      totalTypes,
      activeTypes,
      totalFields,
      fieldsByType,
      mostUsedTypes,
    }
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
  async search(query: string, options: {
    tenantId?: string;
    limit?: number;
    includeFields?: boolean;
    searchInFields?: boolean;
  } = {}): Promise<ContentType[]> {
    const { tenantId, limit = 50, includeFields = false, searchInFields = false } = options;
    
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

    // If searchInFields is enabled, we could add field-based search here
    // For now, we'll keep the basic implementation

    return this.model.findMany({
      where,
      take: limit,
      include: includeFields ? { 
        tenant: true,
        createdBy: true 
      } : undefined,
      orderBy: { updatedAt: 'desc' }
    })
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
