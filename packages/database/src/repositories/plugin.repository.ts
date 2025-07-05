// =============================================================================
// PLUGIN REPOSITORY - POSTGRESQL
// =============================================================================
// High-level abstraction for plugin operations with comprehensive functionality

import { PrismaClient, Plugin, PluginStatus, Prisma } from '@prisma/client'
import { BaseRepository } from './base.repository'

export interface CreatePluginInput {
  name: string
  slug?: string
  description?: string
  version: string
  author?: string
  repository?: string
  homepage?: string
  license?: string
  main: string
  status?: PluginStatus
  isSystem?: boolean
  config?: Record<string, any>
  hooks?: string[]
  dependencies?: Record<string, string>
  installedAt?: Date
}

export interface UpdatePluginInput {
  name?: string
  slug?: string
  description?: string
  version?: string
  author?: string
  repository?: string
  homepage?: string
  license?: string
  main?: string
  status?: PluginStatus
  config?: Record<string, any>
  hooks?: string[]
  dependencies?: Record<string, string>
  lastEnabledAt?: Date
  lastDisabledAt?: Date
  lastErrorAt?: Date
  errorMessage?: string
}

export interface PluginFilters {
  name?: string
  slug?: string
  status?: PluginStatus
  isSystem?: boolean
  author?: string
  search?: string
  hasErrors?: boolean
}

export class PluginRepository extends BaseRepository<Plugin, CreatePluginInput, UpdatePluginInput> {
  protected modelName = 'Plugin'
  protected model = this.prisma.plugin

  constructor(prisma: PrismaClient) {
    super(prisma)
  }

  /**
   * Find plugin by slug
   */
  async findBySlug(slug: string): Promise<Plugin | null> {
    try {
      return await this.model.findUnique({
        where: { slug },
        include: {
          fieldTypes: {
            select: {
              id: true,
              name: true,
              displayName: true,
              dataType: true,
              uiType: true,
            },
          },
        },
      })
    } catch (error) {
      this.handleError(error, 'findBySlug')
    }
  }

  /**
   * Find plugin by slug or throw error
   */
  async findBySlugOrThrow(slug: string): Promise<Plugin> {
    const plugin = await this.findBySlug(slug)
    if (!plugin) {
      throw new this.constructor.prototype.NotFoundError('Plugin', slug)
    }
    return plugin
  }

  /**
   * Find plugin by name
   */
  async findByName(name: string): Promise<Plugin | null> {
    try {
      return await this.model.findFirst({
        where: { name },
        include: {
          fieldTypes: {
            select: {
              id: true,
              name: true,
              displayName: true,
              dataType: true,
              uiType: true,
            },
          },
        },
      })
    } catch (error) {
      this.handleError(error, 'findByName')
    }
  }

  /**
   * Find active plugins
   */
  async findActive(): Promise<Plugin[]> {
    try {
      return await this.model.findMany({
        where: { status: PluginStatus.ACTIVE },
        include: {
          fieldTypes: {
            select: {
              id: true,
              name: true,
              displayName: true,
              dataType: true,
              uiType: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'findActive')
    }
  }

  /**
   * Find inactive plugins
   */
  async findInactive(): Promise<Plugin[]> {
    try {
      return await this.model.findMany({
        where: { status: PluginStatus.INACTIVE },
        include: {
          fieldTypes: {
            select: {
              id: true,
              name: true,
              displayName: true,
              dataType: true,
              uiType: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'findInactive')
    }
  }

  /**
   * Find plugins with errors
   */
  async findWithErrors(): Promise<Plugin[]> {
    try {
      return await this.model.findMany({
        where: { status: PluginStatus.ERROR },
        include: {
          fieldTypes: {
            select: {
              id: true,
              name: true,
              displayName: true,
              dataType: true,
              uiType: true,
            },
          },
        },
        orderBy: { lastErrorAt: 'desc' },
      })
    } catch (error) {
      this.handleError(error, 'findWithErrors')
    }
  }

  /**
   * Find system plugins
   */
  async findSystem(): Promise<Plugin[]> {
    try {
      return await this.model.findMany({
        where: { isSystem: true },
        include: {
          fieldTypes: {
            select: {
              id: true,
              name: true,
              displayName: true,
              dataType: true,
              uiType: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'findSystem')
    }
  }

  /**
   * Find custom plugins (non-system)
   */
  async findCustom(): Promise<Plugin[]> {
    try {
      return await this.model.findMany({
        where: { isSystem: false },
        include: {
          fieldTypes: {
            select: {
              id: true,
              name: true,
              displayName: true,
              dataType: true,
              uiType: true,
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
   * Find plugins by status
   */
  async findByStatus(status: PluginStatus): Promise<Plugin[]> {
    try {
      return await this.model.findMany({
        where: { status },
        include: {
          fieldTypes: {
            select: {
              id: true,
              name: true,
              displayName: true,
              dataType: true,
              uiType: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'findByStatus')
    }
  }

  /**
   * Find plugins by author
   */
  async findByAuthor(author: string): Promise<Plugin[]> {
    try {
      return await this.model.findMany({
        where: { author: { contains: author, mode: 'insensitive' } },
        include: {
          fieldTypes: {
            select: {
              id: true,
              name: true,
              displayName: true,
              dataType: true,
              uiType: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'findByAuthor')
    }
  }

  /**
   * Search plugins with advanced filtering
   */
  async search(filters: PluginFilters = {}): Promise<Plugin[]> {
    const {
      name,
      slug,
      status,
      isSystem,
      author,
      search,
      hasErrors,
    } = filters

    const where: any = {}

    if (name) {
      where.name = { contains: name, mode: 'insensitive' }
    }

    if (slug) {
      where.slug = { contains: slug, mode: 'insensitive' }
    }

    if (status) {
      where.status = status
    }

    if (isSystem !== undefined) {
      where.isSystem = isSystem
    }

    if (author) {
      where.author = { contains: author, mode: 'insensitive' }
    }

    if (hasErrors) {
      where.status = PluginStatus.ERROR
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { author: { contains: search, mode: 'insensitive' } },
      ]
    }

    try {
      return await this.model.findMany({
        where,
        include: {
          fieldTypes: {
            select: {
              id: true,
              name: true,
              displayName: true,
              dataType: true,
              uiType: true,
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
   * Activate plugin
   */
  async activate(id: string): Promise<Plugin> {
    try {
      return await this.model.update({
        where: { id },
        data: {
          status: PluginStatus.ACTIVE,
          lastEnabledAt: new Date(),
          errorMessage: null,
          lastErrorAt: null,
        },
      })
    } catch (error) {
      this.handleError(error, 'activate')
    }
  }

  /**
   * Deactivate plugin
   */
  async deactivate(id: string): Promise<Plugin> {
    try {
      return await this.model.update({
        where: { id },
        data: {
          status: PluginStatus.INACTIVE,
          lastDisabledAt: new Date(),
        },
      })
    } catch (error) {
      this.handleError(error, 'deactivate')
    }
  }

  /**
   * Mark plugin as error
   */
  async markAsError(id: string, errorMessage: string): Promise<Plugin> {
    try {
      return await this.model.update({
        where: { id },
        data: {
          status: PluginStatus.ERROR,
          errorMessage,
          lastErrorAt: new Date(),
        },
      })
    } catch (error) {
      this.handleError(error, 'markAsError')
    }
  }

  /**
   * Clear plugin error
   */
  async clearError(id: string): Promise<Plugin> {
    try {
      return await this.model.update({
        where: { id },
        data: {
          status: PluginStatus.INACTIVE,
          errorMessage: null,
          lastErrorAt: null,
        },
      })
    } catch (error) {
      this.handleError(error, 'clearError')
    }
  }

  /**
   * Update plugin configuration
   */
  async updateConfig(id: string, config: Record<string, any>): Promise<Plugin> {
    try {
      return await this.model.update({
        where: { id },
        data: { config },
      })
    } catch (error) {
      this.handleError(error, 'updateConfig')
    }
  }

  /**
   * Update plugin hooks
   */
  async updateHooks(id: string, hooks: string[]): Promise<Plugin> {
    try {
      return await this.model.update({
        where: { id },
        data: { hooks },
      })
    } catch (error) {
      this.handleError(error, 'updateHooks')
    }
  }

  /**
   * Update plugin dependencies
   */
  async updateDependencies(id: string, dependencies: Record<string, string>): Promise<Plugin> {
    try {
      return await this.model.update({
        where: { id },
        data: { dependencies },
      })
    } catch (error) {
      this.handleError(error, 'updateDependencies')
    }
  }

  /**
   * Get plugin statistics
   */
  async getStats(): Promise<{
    total: number
    byStatus: Record<string, number>
    system: number
    custom: number
    withErrors: number
    withFieldTypes: number
  }> {
    try {
      const [total, system, withErrors, withFieldTypes, allPlugins] = await Promise.all([
        this.model.count(),
        this.model.count({ where: { isSystem: true } }),
        this.model.count({ where: { status: PluginStatus.ERROR } }),
        this.model.count({
          where: {
            fieldTypes: {
              some: {},
            },
          },
        }),
        this.model.findMany({
          select: { status: true },
        }),
      ])

      const custom = total - system

      // Count by status
      const byStatus: Record<string, number> = {}
      allPlugins.forEach(plugin => {
        byStatus[plugin.status] = (byStatus[plugin.status] || 0) + 1
      })

      return {
        total,
        byStatus,
        system,
        custom,
        withErrors,
        withFieldTypes,
      }
    } catch (error) {
      this.handleError(error, 'getStats')
    }
  }

  /**
   * Check plugin dependencies
   */
  async checkDependencies(id: string): Promise<{
    satisfied: boolean
    missing: string[]
    conflicts: string[]
  }> {
    try {
      const plugin = await this.findByIdOrThrow(id)
      const dependencies = plugin.dependencies || {}
      
      const missing: string[] = []
      const conflicts: string[] = []

      // Check each dependency
      for (const [depName, requiredVersion] of Object.entries(dependencies)) {
        const dependency = await this.findByName(depName)
        
        if (!dependency) {
          missing.push(`${depName}@${requiredVersion}`)
        } else if (dependency.status !== PluginStatus.ACTIVE) {
          missing.push(`${depName}@${requiredVersion} (inactive)`)
        } else {
          // Simple version check (in production, use semver)
          if (dependency.version !== requiredVersion) {
            conflicts.push(`${depName}: required ${requiredVersion}, found ${dependency.version}`)
          }
        }
      }

      return {
        satisfied: missing.length === 0 && conflicts.length === 0,
        missing,
        conflicts,
      }
    } catch (error) {
      this.handleError(error, 'checkDependencies')
    }
  }

  /**
   * Get plugins that depend on a specific plugin
   */
  async getDependents(pluginName: string): Promise<Plugin[]> {
    try {
      // Note: This is a simplified implementation
      // In production, you might want to use a more sophisticated JSON query
      const allPlugins = await this.model.findMany()
      
      return allPlugins.filter(plugin => {
        const dependencies = plugin.dependencies || {}
        return Object.keys(dependencies).includes(pluginName)
      })
    } catch (error) {
      this.handleError(error, 'getDependents')
    }
  }

  /**
   * Validate plugin before installation
   */
  async validatePlugin(pluginData: CreatePluginInput): Promise<{
    isValid: boolean
    errors: string[]
    warnings: string[]
  }> {
    const errors: string[] = []
    const warnings: string[] = []

    // Check if plugin with same name exists
    if (pluginData.name) {
      const existing = await this.findByName(pluginData.name)
      if (existing) {
        errors.push(`Plugin with name '${pluginData.name}' already exists`)
      }
    }

    // Check if plugin with same slug exists
    if (pluginData.slug) {
      const existing = await this.findBySlug(pluginData.slug)
      if (existing) {
        errors.push(`Plugin with slug '${pluginData.slug}' already exists`)
      }
    }

    // Validate main file path
    if (!pluginData.main) {
      errors.push('Main file path is required')
    }

    // Validate version format (basic check)
    if (!pluginData.version || !/^\d+\.\d+\.\d+/.test(pluginData.version)) {
      errors.push('Valid semantic version is required (e.g., 1.0.0)')
    }

    // Check dependencies
    if (pluginData.dependencies) {
      for (const [depName, version] of Object.entries(pluginData.dependencies)) {
        const dependency = await this.findByName(depName)
        if (!dependency) {
          warnings.push(`Dependency '${depName}' not found`)
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Generate unique slug from name
   */
  async generateUniqueSlug(name: string): Promise<string> {
    let baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')

    let slug = baseSlug
    let counter = 1

    while (await this.findBySlug(slug)) {
      slug = `${baseSlug}-${counter}`
      counter++
    }

    return slug
  }

  /**
   * Install plugin with validation
   */
  async install(pluginData: CreatePluginInput): Promise<Plugin> {
    // Validate plugin
    const validation = await this.validatePlugin(pluginData)
    if (!validation.isValid) {
      throw new Error(`Plugin validation failed: ${validation.errors.join(', ')}`)
    }

    // Generate slug if not provided
    if (!pluginData.slug) {
      pluginData.slug = await this.generateUniqueSlug(pluginData.name)
    }

    // Set installation date
    pluginData.installedAt = new Date()

    try {
      return await this.create(pluginData)
    } catch (error) {
      this.handleError(error, 'install')
    }
  }

  /**
   * Uninstall plugin (with dependency check)
   */
  async uninstall(id: string, force = false): Promise<void> {
    try {
      const plugin = await this.findByIdOrThrow(id)
      
      if (!force) {
        // Check if other plugins depend on this one
        const dependents = await this.getDependents(plugin.name)
        if (dependents.length > 0) {
          const dependentNames = dependents.map(p => p.name).join(', ')
          throw new Error(`Cannot uninstall plugin '${plugin.name}' because it is required by: ${dependentNames}`)
        }
      }

      // First deactivate if active
      if (plugin.status === PluginStatus.ACTIVE) {
        await this.deactivate(id)
      }

      // Delete the plugin
      await this.delete(id)
    } catch (error) {
      this.handleError(error, 'uninstall')
    }
  }
}
