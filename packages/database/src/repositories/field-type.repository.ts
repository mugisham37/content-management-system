// =============================================================================
// FIELD TYPE REPOSITORY - POSTGRESQL
// =============================================================================
// High-level abstraction for field type operations with comprehensive functionality

import { PrismaClient, FieldType, FieldDataType, FieldUIType, Prisma } from '@prisma/client'
import { BaseRepository } from './base.repository'

export interface CreateFieldTypeInput {
  name: string
  displayName: string
  description?: string
  dataType: FieldDataType
  uiType: FieldUIType
  isSystem?: boolean
  isBuiltIn?: boolean
  validations?: any[]
  settings?: Record<string, any>
  pluginId?: string
}

export interface UpdateFieldTypeInput {
  name?: string
  displayName?: string
  description?: string
  dataType?: FieldDataType
  uiType?: FieldUIType
  validations?: any[]
  settings?: Record<string, any>
  pluginId?: string
}

export interface FieldTypeFilters {
  name?: string
  dataType?: FieldDataType
  uiType?: FieldUIType
  isSystem?: boolean
  isBuiltIn?: boolean
  pluginId?: string
  search?: string
}

export class FieldTypeRepository extends BaseRepository<FieldType, CreateFieldTypeInput, UpdateFieldTypeInput> {
  protected modelName = 'FieldType'
  protected model = this.prisma.fieldType

  constructor(prisma: PrismaClient) {
    super(prisma)
  }

  /**
   * Find field type by name
   */
  async findByName(name: string): Promise<FieldType | null> {
    try {
      return await this.model.findUnique({
        where: { name },
        include: {
          plugin: {
            select: {
              id: true,
              name: true,
              slug: true,
              version: true,
            },
          },
        },
      })
    } catch (error) {
      this.handleError(error, 'findByName')
    }
  }

  /**
   * Find field type by name or throw error
   */
  async findByNameOrThrow(name: string): Promise<FieldType> {
    const fieldType = await this.findByName(name)
    if (!fieldType) {
      throw new this.constructor.prototype.NotFoundError('FieldType', name)
    }
    return fieldType
  }

  /**
   * Find all field types
   */
  async findAll(): Promise<FieldType[]> {
    try {
      return await this.model.findMany({
        include: {
          plugin: {
            select: {
              id: true,
              name: true,
              slug: true,
              version: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'findAll')
    }
  }

  /**
   * Find system field types
   */
  async findSystem(): Promise<FieldType[]> {
    try {
      return await this.model.findMany({
        where: { isSystem: true },
        orderBy: { name: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'findSystem')
    }
  }

  /**
   * Find built-in field types
   */
  async findBuiltIn(): Promise<FieldType[]> {
    try {
      return await this.model.findMany({
        where: { isBuiltIn: true },
        orderBy: { name: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'findBuiltIn')
    }
  }

  /**
   * Find custom field types (non-system, non-built-in)
   */
  async findCustom(): Promise<FieldType[]> {
    try {
      return await this.model.findMany({
        where: {
          isSystem: false,
          isBuiltIn: false,
        },
        include: {
          plugin: {
            select: {
              id: true,
              name: true,
              slug: true,
              version: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'findCustom')
    }
  }

  /**
   * Find field types by data type
   */
  async findByDataType(dataType: FieldDataType): Promise<FieldType[]> {
    try {
      return await this.model.findMany({
        where: { dataType },
        include: {
          plugin: {
            select: {
              id: true,
              name: true,
              slug: true,
              version: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'findByDataType')
    }
  }

  /**
   * Find field types by UI type
   */
  async findByUIType(uiType: FieldUIType): Promise<FieldType[]> {
    try {
      return await this.model.findMany({
        where: { uiType },
        include: {
          plugin: {
            select: {
              id: true,
              name: true,
              slug: true,
              version: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'findByUIType')
    }
  }

  /**
   * Find field types by plugin
   */
  async findByPlugin(pluginId: string): Promise<FieldType[]> {
    try {
      return await this.model.findMany({
        where: { pluginId },
        orderBy: { name: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'findByPlugin')
    }
  }

  /**
   * Search field types with advanced filtering
   */
  async search(filters: FieldTypeFilters = {}): Promise<FieldType[]> {
    const {
      name,
      dataType,
      uiType,
      isSystem,
      isBuiltIn,
      pluginId,
      search,
    } = filters

    const where: any = {}

    if (name) {
      where.name = { contains: name, mode: 'insensitive' }
    }

    if (dataType) {
      where.dataType = dataType
    }

    if (uiType) {
      where.uiType = uiType
    }

    if (isSystem !== undefined) {
      where.isSystem = isSystem
    }

    if (isBuiltIn !== undefined) {
      where.isBuiltIn = isBuiltIn
    }

    if (pluginId) {
      where.pluginId = pluginId
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    try {
      return await this.model.findMany({
        where,
        include: {
          plugin: {
            select: {
              id: true,
              name: true,
              slug: true,
              version: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'search')
    }
  }

  /**
   * Get field types grouped by data type
   */
  async getGroupedByDataType(): Promise<Record<string, FieldType[]>> {
    try {
      const fieldTypes = await this.model.findMany({
        include: {
          plugin: {
            select: {
              id: true,
              name: true,
              slug: true,
              version: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      })

      const grouped: Record<string, FieldType[]> = {}
      fieldTypes.forEach(fieldType => {
        if (!grouped[fieldType.dataType]) {
          grouped[fieldType.dataType] = []
        }
        grouped[fieldType.dataType].push(fieldType)
      })

      return grouped
    } catch (error) {
      this.handleError(error, 'getGroupedByDataType')
    }
  }

  /**
   * Get field types grouped by UI type
   */
  async getGroupedByUIType(): Promise<Record<string, FieldType[]>> {
    try {
      const fieldTypes = await this.model.findMany({
        include: {
          plugin: {
            select: {
              id: true,
              name: true,
              slug: true,
              version: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      })

      const grouped: Record<string, FieldType[]> = {}
      fieldTypes.forEach(fieldType => {
        if (!grouped[fieldType.uiType]) {
          grouped[fieldType.uiType] = []
        }
        grouped[fieldType.uiType].push(fieldType)
      })

      return grouped
    } catch (error) {
      this.handleError(error, 'getGroupedByUIType')
    }
  }

  /**
   * Update field type validations
   */
  async updateValidations(id: string, validations: any[]): Promise<FieldType> {
    try {
      return await this.model.update({
        where: { id },
        data: { validations },
      })
    } catch (error) {
      this.handleError(error, 'updateValidations')
    }
  }

  /**
   * Update field type settings
   */
  async updateSettings(id: string, settings: Record<string, any>): Promise<FieldType> {
    try {
      return await this.model.update({
        where: { id },
        data: { settings },
      })
    } catch (error) {
      this.handleError(error, 'updateSettings')
    }
  }

  /**
   * Get field type statistics
   */
  async getStats(): Promise<{
    total: number
    byDataType: Record<string, number>
    byUIType: Record<string, number>
    system: number
    builtIn: number
    custom: number
    withPlugin: number
  }> {
    try {
      const [total, system, builtIn, withPlugin, allFieldTypes] = await Promise.all([
        this.model.count(),
        this.model.count({ where: { isSystem: true } }),
        this.model.count({ where: { isBuiltIn: true } }),
        this.model.count({ where: { pluginId: { not: null } } }),
        this.model.findMany({
          select: { dataType: true, uiType: true },
        }),
      ])

      const custom = total - system - builtIn

      // Count by data type
      const byDataType: Record<string, number> = {}
      allFieldTypes.forEach(fieldType => {
        byDataType[fieldType.dataType] = (byDataType[fieldType.dataType] || 0) + 1
      })

      // Count by UI type
      const byUIType: Record<string, number> = {}
      allFieldTypes.forEach(fieldType => {
        byUIType[fieldType.uiType] = (byUIType[fieldType.uiType] || 0) + 1
      })

      return {
        total,
        byDataType,
        byUIType,
        system,
        builtIn,
        custom,
        withPlugin,
      }
    } catch (error) {
      this.handleError(error, 'getStats')
    }
  }

  /**
   * Validate field type configuration
   */
  async validateConfiguration(fieldType: Partial<FieldType>): Promise<{
    isValid: boolean
    errors: string[]
  }> {
    const errors: string[] = []

    // Check if name is unique
    if (fieldType.name) {
      const existing = await this.findByName(fieldType.name)
      if (existing && existing.id !== fieldType.id) {
        errors.push(`Field type with name '${fieldType.name}' already exists`)
      }
    }

    // Validate data type and UI type compatibility
    if (fieldType.dataType && fieldType.uiType) {
      const isCompatible = this.isDataTypeUITypeCompatible(fieldType.dataType, fieldType.uiType)
      if (!isCompatible) {
        errors.push(`UI type '${fieldType.uiType}' is not compatible with data type '${fieldType.dataType}'`)
      }
    }

    // Validate system field type restrictions
    if (fieldType.isSystem && fieldType.pluginId) {
      errors.push('System field types cannot be associated with plugins')
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  /**
   * Check if data type and UI type are compatible
   */
  private isDataTypeUITypeCompatible(dataType: FieldDataType, uiType: FieldUIType): boolean {
    const compatibilityMap: Record<FieldDataType, FieldUIType[]> = {
      [FieldDataType.STRING]: [FieldUIType.TEXT_INPUT, FieldUIType.SELECT, FieldUIType.RADIO_GROUP],
      [FieldDataType.TEXT]: [FieldUIType.TEXT_AREA],
      [FieldDataType.RICH_TEXT]: [FieldUIType.RICH_TEXT_EDITOR],
      [FieldDataType.NUMBER]: [FieldUIType.NUMBER_INPUT],
      [FieldDataType.INTEGER]: [FieldUIType.NUMBER_INPUT],
      [FieldDataType.FLOAT]: [FieldUIType.NUMBER_INPUT],
      [FieldDataType.BOOLEAN]: [FieldUIType.CHECKBOX, FieldUIType.TOGGLE],
      [FieldDataType.DATE]: [FieldUIType.DATE_PICKER],
      [FieldDataType.DATETIME]: [FieldUIType.DATE_TIME_PICKER],
      [FieldDataType.EMAIL]: [FieldUIType.EMAIL_INPUT],
      [FieldDataType.URL]: [FieldUIType.URL_INPUT],
      [FieldDataType.IMAGE]: [FieldUIType.IMAGE_UPLOADER],
      [FieldDataType.FILE]: [FieldUIType.FILE_UPLOADER],
      [FieldDataType.REFERENCE]: [FieldUIType.REFERENCE_SELECTOR],
      [FieldDataType.JSON]: [FieldUIType.JSON_EDITOR],
      [FieldDataType.ARRAY]: [FieldUIType.ARRAY_EDITOR, FieldUIType.MULTI_SELECT],
      [FieldDataType.COMPONENT]: [FieldUIType.COMPONENT_EDITOR],
      [FieldDataType.ENUM]: [FieldUIType.SELECT, FieldUIType.RADIO_GROUP, FieldUIType.MULTI_SELECT],
      [FieldDataType.COLOR]: [FieldUIType.COLOR_PICKER],
      [FieldDataType.GEO_POINT]: [FieldUIType.MAP],
      [FieldDataType.RELATION]: [FieldUIType.RELATION_EDITOR],
      [FieldDataType.CUSTOM]: [FieldUIType.CUSTOM_UI],
    }

    const compatibleUITypes = compatibilityMap[dataType] || []
    return compatibleUITypes.includes(uiType)
  }

  /**
   * Get available UI types for a data type
   */
  getAvailableUITypes(dataType: FieldDataType): FieldUIType[] {
    const compatibilityMap: Record<FieldDataType, FieldUIType[]> = {
      [FieldDataType.STRING]: [FieldUIType.TEXT_INPUT, FieldUIType.SELECT, FieldUIType.RADIO_GROUP],
      [FieldDataType.TEXT]: [FieldUIType.TEXT_AREA],
      [FieldDataType.RICH_TEXT]: [FieldUIType.RICH_TEXT_EDITOR],
      [FieldDataType.NUMBER]: [FieldUIType.NUMBER_INPUT],
      [FieldDataType.INTEGER]: [FieldUIType.NUMBER_INPUT],
      [FieldDataType.FLOAT]: [FieldUIType.NUMBER_INPUT],
      [FieldDataType.BOOLEAN]: [FieldUIType.CHECKBOX, FieldUIType.TOGGLE],
      [FieldDataType.DATE]: [FieldUIType.DATE_PICKER],
      [FieldDataType.DATETIME]: [FieldUIType.DATE_TIME_PICKER],
      [FieldDataType.EMAIL]: [FieldUIType.EMAIL_INPUT],
      [FieldDataType.URL]: [FieldUIType.URL_INPUT],
      [FieldDataType.IMAGE]: [FieldUIType.IMAGE_UPLOADER],
      [FieldDataType.FILE]: [FieldUIType.FILE_UPLOADER],
      [FieldDataType.REFERENCE]: [FieldUIType.REFERENCE_SELECTOR],
      [FieldDataType.JSON]: [FieldUIType.JSON_EDITOR],
      [FieldDataType.ARRAY]: [FieldUIType.ARRAY_EDITOR, FieldUIType.MULTI_SELECT],
      [FieldDataType.COMPONENT]: [FieldUIType.COMPONENT_EDITOR],
      [FieldDataType.ENUM]: [FieldUIType.SELECT, FieldUIType.RADIO_GROUP, FieldUIType.MULTI_SELECT],
      [FieldDataType.COLOR]: [FieldUIType.COLOR_PICKER],
      [FieldDataType.GEO_POINT]: [FieldUIType.MAP],
      [FieldDataType.RELATION]: [FieldUIType.RELATION_EDITOR],
      [FieldDataType.CUSTOM]: [FieldUIType.CUSTOM_UI],
    }

    return compatibilityMap[dataType] || []
  }
}
