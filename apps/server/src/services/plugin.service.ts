// =============================================================================
// ENTERPRISE PLUGIN SERVICE - POSTGRESQL INTEGRATION
// =============================================================================
// High-performance, multi-tenant plugin management system with advanced features

import { EventEmitter } from 'events'
import { PrismaClient, Plugin, PluginStatus, Prisma } from '@prisma/client'
import { PluginRepository } from '@cms-platform/database/repositories/plugin.repository'
import { CacheService } from './cache.service'
import { AuditService } from './audit.service'
import { NotificationService } from './notification.service'
import { WebhookService } from './webhook.service'
import { ApiError } from '../utils/errors'
import { logger } from '../utils/logger'
import fs from 'fs/promises'
import path from 'path'
import { createHash } from 'crypto'
import crypto from 'crypto'
import { Worker } from 'worker_threads'
import semver from 'semver'
import vm from 'vm'
import { performance } from 'perf_hooks'

// =============================================================================
// INTERFACES AND TYPES
// =============================================================================

export interface PluginHook {
  name: string
  pluginName: string
  handler: Function
  priority: number
  async: boolean
  timeout?: number
}

export interface PluginManifest {
  name: string
  version: string
  description: string
  author: string
  license?: string
  homepage?: string
  repository?: string
  main: string
  hooks?: string[]
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  engines?: {
    node?: string
    cms?: string
  }
  permissions?: string[]
  config?: {
    schema: Record<string, any>
    defaults: Record<string, any>
  }
  ui?: {
    admin?: string
    settings?: string
  }
  api?: {
    routes?: Array<{
      method: string
      path: string
      handler: string
    }>
  }
}

export interface PluginContext {
  pluginId: string
  pluginName: string
  version: string
  config: Record<string, any>
  tenantId?: string
  userId?: string
  logger: any
  cache: CacheService
  database: PrismaClient
  hooks: PluginHookManager
}

export interface PluginInstallOptions {
  source: 'file' | 'url' | 'registry' | 'git'
  path?: string
  url?: string
  registry?: string
  version?: string
  force?: boolean
  skipDependencies?: boolean
  tenantId?: string
  userId?: string
}

export interface PluginValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  securityIssues: string[]
  performanceIssues: string[]
}

export interface PluginMetrics {
  pluginId: string
  pluginName: string
  version: string
  status: PluginStatus
  installDate: Date
  lastEnabled?: Date
  lastDisabled?: Date
  errorCount: number
  lastError?: string
  performance: {
    averageExecutionTime: number
    totalExecutions: number
    memoryUsage: number
    cpuUsage: number
  }
  hooks: Array<{
    name: string
    executionCount: number
    averageTime: number
    errorCount: number
  }>
}

export interface PluginServiceOptions {
  pluginsDirectory?: string
  maxPlugins?: number
  enableSandbox?: boolean
  enableMetrics?: boolean
  enableAutoUpdate?: boolean
  registryUrl?: string
  cache?: CacheService
  audit?: AuditService
  notifications?: NotificationService
  webhooks?: WebhookService
}

// =============================================================================
// PLUGIN HOOK MANAGER
// =============================================================================

class PluginHookManager extends EventEmitter {
  private hooks: Map<string, PluginHook[]> = new Map()
  private metrics: Map<string, any> = new Map()

  /**
   * Register a hook
   */
  registerHook(hook: PluginHook): void {
    if (!this.hooks.has(hook.name)) {
      this.hooks.set(hook.name, [])
    }

    const hooks = this.hooks.get(hook.name)!
    
    // Remove existing hook from same plugin
    const existingIndex = hooks.findIndex(h => h.pluginName === hook.pluginName)
    if (existingIndex !== -1) {
      hooks.splice(existingIndex, 1)
    }

    // Insert hook in priority order
    const insertIndex = hooks.findIndex(h => h.priority > hook.priority)
    if (insertIndex === -1) {
      hooks.push(hook)
    } else {
      hooks.splice(insertIndex, 0, hook)
    }

    this.emit('hookRegistered', hook)
  }

  /**
   * Unregister hooks for a plugin
   */
  unregisterPluginHooks(pluginName: string): void {
    for (const [hookName, hooks] of this.hooks.entries()) {
      const filtered = hooks.filter(h => h.pluginName !== pluginName)
      this.hooks.set(hookName, filtered)
    }
    this.emit('hooksUnregistered', pluginName)
  }

  /**
   * Execute hooks
   */
  async executeHooks(hookName: string, context: any, ...args: any[]): Promise<any[]> {
    const hooks = this.hooks.get(hookName) || []
    const results: any[] = []

    for (const hook of hooks) {
      const startTime = performance.now()
      
      try {
        let result: any

        if (hook.async) {
          if (hook.timeout) {
            result = await Promise.race([
              hook.handler(context, ...args),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Hook timeout')), hook.timeout)
              )
            ])
          } else {
            result = await hook.handler(context, ...args)
          }
        } else {
          result = hook.handler(context, ...args)
        }

        results.push(result)
        
        // Update metrics
        this.updateHookMetrics(hook, performance.now() - startTime, true)
        
      } catch (error) {
        logger.error(`Error executing hook ${hookName} from plugin ${hook.pluginName}:`, error)
        this.updateHookMetrics(hook, performance.now() - startTime, false)
        
        // Continue with other hooks unless it's a critical hook
        if (hook.name.startsWith('critical.')) {
          throw error
        }
      }
    }

    return results
  }

  /**
   * Update hook execution metrics
   */
  private updateHookMetrics(hook: PluginHook, executionTime: number, success: boolean): void {
    const key = `${hook.pluginName}:${hook.name}`
    const metrics = this.metrics.get(key) || {
      executionCount: 0,
      totalTime: 0,
      errorCount: 0,
      averageTime: 0
    }

    metrics.executionCount++
    metrics.totalTime += executionTime
    metrics.averageTime = metrics.totalTime / metrics.executionCount

    if (!success) {
      metrics.errorCount++
    }

    this.metrics.set(key, metrics)
  }

  /**
   * Get hook metrics
   */
  getHookMetrics(pluginName?: string): Map<string, any> {
    if (pluginName) {
      const filtered = new Map()
      for (const [key, value] of this.metrics.entries()) {
        if (key.startsWith(`${pluginName}:`)) {
          filtered.set(key, value)
        }
      }
      return filtered
    }
    return new Map(this.metrics)
  }

  /**
   * Get registered hooks
   */
  getHooks(hookName?: string): Map<string, PluginHook[]> {
    if (hookName) {
      const hooks = this.hooks.get(hookName)
      return hooks ? new Map([[hookName, hooks]]) : new Map()
    }
    return new Map(this.hooks)
  }
}

// =============================================================================
// PLUGIN SANDBOX
// =============================================================================

class PluginSandbox {
  private context: vm.Context
  private allowedModules: Set<string>

  constructor() {
    this.allowedModules = new Set([
      'crypto', 'util', 'events', 'stream', 'buffer',
      'querystring', 'url', 'path'
    ])

    this.context = vm.createContext({
      console: {
        log: (...args: any[]) => logger.info('[Plugin]', ...args),
        error: (...args: any[]) => logger.error('[Plugin]', ...args),
        warn: (...args: any[]) => logger.warn('[Plugin]', ...args),
        info: (...args: any[]) => logger.info('[Plugin]', ...args)
      },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Buffer,
      process: {
        env: {},
        version: process.version,
        platform: process.platform
      },
      require: (moduleName: string) => {
        if (this.allowedModules.has(moduleName)) {
          return require(moduleName)
        }
        throw new Error(`Module '${moduleName}' is not allowed in plugin sandbox`)
      }
    })
  }

  /**
   * Execute code in sandbox
   */
  execute(code: string, timeout = 5000): any {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Plugin execution timeout'))
      }, timeout)

      try {
        const result = vm.runInContext(code, this.context, {
          timeout,
          displayErrors: true
        })
        clearTimeout(timer)
        resolve(result)
      } catch (error) {
        clearTimeout(timer)
        reject(error)
      }
    })
  }
}

// =============================================================================
// MAIN PLUGIN SERVICE
// =============================================================================

export class PluginService extends EventEmitter {
  private repository: PluginRepository
  private hookManager: PluginHookManager
  private sandbox: PluginSandbox
  private cache: CacheService
  private audit: AuditService
  private notifications: NotificationService
  private webhooks: WebhookService
  private pluginsDirectory: string
  private options: PluginServiceOptions
  private metrics: Map<string, PluginMetrics> = new Map()
  private workers: Map<string, Worker> = new Map()

  constructor(
    prisma: PrismaClient,
    options: PluginServiceOptions = {}
  ) {
    super()

    this.repository = new PluginRepository(prisma)
    this.hookManager = new PluginHookManager()
    this.sandbox = new PluginSandbox()
    this.options = options
    this.pluginsDirectory = options.pluginsDirectory || path.resolve(process.cwd(), 'plugins')

    // Initialize services
    this.cache = options.cache || new CacheService()
    this.audit = options.audit || new AuditService()
    this.notifications = options.notifications || new NotificationService({})
    this.webhooks = options.webhooks || new WebhookService({})

    this.initialize()
  }

  // =============================================================================
  // INITIALIZATION
  // =============================================================================

  /**
   * Initialize the plugin service
   */
  private async initialize(): Promise<void> {
    try {
      await this.ensurePluginsDirectory()
      await this.loadActivePlugins()
      this.startMetricsCollection()
      this.setupEventHandlers()
      
      logger.info('Plugin service initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize plugin service:', error)
      throw error
    }
  }

  /**
   * Ensure plugins directory exists
   */
  private async ensurePluginsDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.pluginsDirectory, { recursive: true })
      await fs.mkdir(path.join(this.pluginsDirectory, 'temp'), { recursive: true })
      await fs.mkdir(path.join(this.pluginsDirectory, 'backups'), { recursive: true })
    } catch (error) {
      logger.error('Failed to create plugins directory:', error)
      throw new ApiError(500, 'Failed to create plugins directory')
    }
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.hookManager.on('hookRegistered', (hook: PluginHook) => {
      this.emit('hookRegistered', hook)
    })

    this.hookManager.on('hooksUnregistered', (pluginName: string) => {
      this.emit('hooksUnregistered', pluginName)
    })
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    if (!this.options.enableMetrics) return

    setInterval(async () => {
      try {
        await this.collectMetrics()
      } catch (error) {
        logger.error('Error collecting plugin metrics:', error)
      }
    }, 60000) // Collect every minute
  }

  // =============================================================================
  // PLUGIN LIFECYCLE MANAGEMENT
  // =============================================================================

  /**
   * Install a plugin
   */
  async installPlugin(options: PluginInstallOptions): Promise<Plugin> {
    const startTime = performance.now()
    
    try {
      // Validate installation options
      this.validateInstallOptions(options)

      // Download/extract plugin if needed
      const pluginPath = await this.preparePluginFiles(options)
      
      // Load and validate manifest
      const manifest = await this.loadPluginManifest(pluginPath)
      const validation = await this.validatePlugin(manifest, pluginPath)
      
      if (!validation.isValid) {
        throw new ApiError(400, `Plugin validation failed: ${validation.errors.join(', ')}`)
      }

      // Check dependencies
      if (!options.skipDependencies) {
        await this.resolveDependencies(manifest)
      }

      // Create plugin record
      const plugin = await this.repository.install({
        name: manifest.name,
        slug: await this.repository.generateUniqueSlug(manifest.name),
        description: manifest.description,
        version: manifest.version,
        author: manifest.author,
        repository: manifest.repository,
        homepage: manifest.homepage,
        license: manifest.license,
        main: manifest.main,
        status: PluginStatus.INACTIVE,
        config: manifest.config?.defaults || {},
        hooks: manifest.hooks || [],
        dependencies: manifest.dependencies || {},
      })

      // Copy plugin files to final location
      const finalPath = path.join(this.pluginsDirectory, plugin.slug)
      await this.copyPluginFiles(pluginPath, finalPath)

      // Audit log
      await this.audit.log({
        action: 'plugin.install',
        entityType: 'plugin',
        entityId: plugin.id,
        userId: options.userId,
        tenantId: options.tenantId,
        details: {
          pluginName: plugin.name,
          version: plugin.version,
          source: options.source,
          installTime: performance.now() - startTime
        }
      })

      // Send notification
      if (options.userId) {
        await this.notifications.sendNotification({
          type: 'PLUGIN_INSTALLED',
          title: 'Plugin Installed',
          message: `Plugin "${plugin.name}" has been installed successfully`,
          userId: options.userId,
          tenantId: options.tenantId,
          data: { pluginId: plugin.id, pluginName: plugin.name }
        })
      }

      // Trigger webhook
      await this.webhooks.triggerWebhook({
        id: crypto.randomUUID(),
        type: 'PLUGIN_INSTALLED',
        timestamp: new Date(),
        data: {
          plugin: plugin,
          installTime: performance.now() - startTime
        },
        tenantId: options.tenantId
      })

      this.emit('pluginInstalled', plugin)
      return plugin

    } catch (error) {
      logger.error('Failed to install plugin:', error)
      
      // Audit error
      await this.audit.log({
        action: 'plugin.install.failed',
        entityType: 'plugin',
        entityId: 'unknown',
        userId: options.userId,
        tenantId: options.tenantId,
        details: {
          error: error instanceof Error ? error.message : String(error),
          options
        }
      })

      throw error
    }
  }

  /**
   * Uninstall a plugin
   */
  async uninstallPlugin(
    id: string, 
    options: { force?: boolean; tenantId?: string; userId?: string } = {}
  ): Promise<void> {
    try {
      const plugin = await this.repository.findByIdOrThrow(id)

      // Check if plugin is active
      if (plugin.status === PluginStatus.ACTIVE) {
        await this.deactivatePlugin(id, options)
      }

      // Check dependencies unless forced
      if (!options.force) {
        const dependents = await this.repository.getDependents(plugin.name)
        if (dependents.length > 0) {
          const dependentNames = dependents.map(p => p.name).join(', ')
          throw new ApiError(400, `Cannot uninstall plugin "${plugin.name}" because it is required by: ${dependentNames}`)
        }
      }

      // Remove plugin files
      const pluginPath = path.join(this.pluginsDirectory, plugin.slug)
      await fs.rm(pluginPath, { recursive: true, force: true })

      // Remove from database
      await this.repository.uninstall(id, options.force)

      // Clear cache
      await this.cache.deletePattern(`plugin:${plugin.slug}:*`)

      // Audit log
      await this.audit.log({
        action: 'plugin.uninstall',
        entityType: 'plugin',
        entityId: plugin.id,
        userId: options.userId,
        tenantId: options.tenantId,
        details: {
          pluginName: plugin.name,
          version: plugin.version,
          forced: options.force
        }
      })

      // Send notification
      if (options.userId) {
        await this.notifications.sendNotification({
          type: 'PLUGIN_UNINSTALLED',
          title: 'Plugin Uninstalled',
          message: `Plugin "${plugin.name}" has been uninstalled`,
          userId: options.userId,
          tenantId: options.tenantId,
          data: { pluginName: plugin.name }
        })
      }

      this.emit('pluginUninstalled', plugin)

    } catch (error) {
      logger.error('Failed to uninstall plugin:', error)
      throw error
    }
  }

  /**
   * Activate a plugin
   */
  async activatePlugin(
    id: string, 
    options: { tenantId?: string; userId?: string } = {}
  ): Promise<Plugin> {
    try {
      const plugin = await this.repository.findByIdOrThrow(id)

      if (plugin.status === PluginStatus.ACTIVE) {
        throw new ApiError(400, 'Plugin is already active')
      }

      // Check dependencies
      const depCheck = await this.repository.checkDependencies(id)
      if (!depCheck.satisfied) {
        throw new ApiError(400, `Plugin dependencies not satisfied: ${depCheck.missing.join(', ')}`)
      }

      // Load plugin
      await this.loadPlugin(plugin)

      // Update status
      const updatedPlugin = await this.repository.activate(id)

      // Clear cache
      await this.cache.delete(`plugin:${plugin.slug}:status`)

      // Audit log
      await this.audit.log({
        action: 'plugin.activate',
        entityType: 'plugin',
        entityId: plugin.id,
        userId: options.userId,
        tenantId: options.tenantId,
        details: {
          pluginName: plugin.name,
          version: plugin.version
        }
      })

      this.emit('pluginActivated', updatedPlugin)
      return updatedPlugin

    } catch (error) {
      logger.error('Failed to activate plugin:', error)
      
      // Mark as error if activation failed
      await this.repository.markAsError(id, error instanceof Error ? error.message : String(error))
      
      throw error
    }
  }

  /**
   * Deactivate a plugin
   */
  async deactivatePlugin(
    id: string, 
    options: { tenantId?: string; userId?: string } = {}
  ): Promise<Plugin> {
    try {
      const plugin = await this.repository.findByIdOrThrow(id)

      if (plugin.status === PluginStatus.INACTIVE) {
        throw new ApiError(400, 'Plugin is already inactive')
      }

      // Unload plugin
      await this.unloadPlugin(plugin)

      // Update status
      const updatedPlugin = await this.repository.deactivate(id)

      // Clear cache
      await this.cache.delete(`plugin:${plugin.slug}:status`)

      // Audit log
      await this.audit.log({
        action: 'plugin.deactivate',
        entityType: 'plugin',
        entityId: plugin.id,
        userId: options.userId,
        tenantId: options.tenantId,
        details: {
          pluginName: plugin.name,
          version: plugin.version
        }
      })

      this.emit('pluginDeactivated', updatedPlugin)
      return updatedPlugin

    } catch (error) {
      logger.error('Failed to deactivate plugin:', error)
      throw error
    }
  }

  // =============================================================================
  // PLUGIN LOADING AND EXECUTION
  // =============================================================================

  /**
   * Load all active plugins
   */
  async loadActivePlugins(): Promise<void> {
    try {
      const activePlugins = await this.repository.findActive()
      
      for (const plugin of activePlugins) {
        try {
          await this.loadPlugin(plugin)
        } catch (error) {
          logger.error(`Failed to load plugin ${plugin.name}:`, error)
          await this.repository.markAsError(plugin.id, error instanceof Error ? error.message : String(error))
        }
      }

      logger.info(`Loaded ${activePlugins.length} active plugins`)
    } catch (error) {
      logger.error('Failed to load active plugins:', error)
      throw error
    }
  }

  /**
   * Load a specific plugin
   */
  private async loadPlugin(plugin: Plugin): Promise<void> {
    try {
      const pluginPath = path.join(this.pluginsDirectory, plugin.slug)
      const manifestPath = path.join(pluginPath, 'package.json')
      const mainPath = path.join(pluginPath, plugin.main)

      // Verify files exist
      await fs.access(manifestPath)
      await fs.access(mainPath)

      // Load manifest
      const manifest: PluginManifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))

      // Create plugin context
      const context: PluginContext = {
        pluginId: plugin.id,
        pluginName: plugin.name,
        version: plugin.version,
        config: typeof plugin.config === 'object' && plugin.config !== null ? plugin.config as Record<string, any> : {},
        logger: logger.child({ plugin: plugin.name }),
        cache: this.cache,
        database: this.repository['prisma'],
        hooks: this.hookManager
      }

      // Load plugin code
      const pluginCode = await fs.readFile(mainPath, 'utf-8')
      
      // Execute in sandbox if enabled
      if (this.options.enableSandbox) {
        await this.sandbox.execute(pluginCode)
      } else {
        // Load as module
        const pluginModule = require(mainPath)
        if (typeof pluginModule.initialize === 'function') {
          await pluginModule.initialize(context)
        }
      }

      // Register hooks
      if (manifest.hooks) {
        for (const hookName of manifest.hooks) {
          this.hookManager.registerHook({
            name: hookName,
            pluginName: plugin.name,
            handler: async (...args: any[]) => {
              // Plugin hook execution logic
              return await this.executePluginHook(plugin, hookName, ...args)
            },
            priority: 100,
            async: true,
            timeout: 5000
          })
        }
      }

      logger.info(`Plugin ${plugin.name} loaded successfully`)

    } catch (error) {
      logger.error(`Failed to load plugin ${plugin.name}:`, error)
      throw error
    }
  }

  /**
   * Unload a plugin
   */
  private async unloadPlugin(plugin: Plugin): Promise<void> {
    try {
      // Unregister hooks
      this.hookManager.unregisterPluginHooks(plugin.name)

      // Stop any workers
      const worker = this.workers.get(plugin.id)
      if (worker) {
        await worker.terminate()
        this.workers.delete(plugin.id)
      }

      // Clear plugin cache
      await this.cache.deletePattern(`plugin:${plugin.slug}:*`)

      logger.info(`Plugin ${plugin.name} unloaded successfully`)

    } catch (error) {
      logger.error(`Failed to unload plugin ${plugin.name}:`, error)
      throw error
    }
  }

  /**
   * Execute a plugin hook
   */
  private async executePluginHook(plugin: Plugin, hookName: string, ...args: any[]): Promise<any> {
    const startTime = performance.now()
    
    try {
      // Implementation would depend on how hooks are defined in the plugin
      // This is a placeholder for the actual hook execution logic
      
      const executionTime = performance.now() - startTime
      
      // Update metrics
      this.updatePluginMetrics(plugin.id, {
        executionTime,
        success: true,
        hookName
      })

      return null // Placeholder return

    } catch (error) {
      const executionTime = performance.now() - startTime
      
      // Update metrics
      this.updatePluginMetrics(plugin.id, {
        executionTime,
        success: false,
        hookName,
        error: error instanceof Error ? error.message : String(error)
      })

      throw error
    }
  }

  // =============================================================================
  // PLUGIN VALIDATION AND SECURITY
  // =============================================================================

  /**
   * Validate a plugin
   */
  private async validatePlugin(manifest: PluginManifest, pluginPath: string): Promise<PluginValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const securityIssues: string[] = []
    const performanceIssues: string[] = []

    try {
      // Validate manifest structure
      if (!manifest.name) errors.push('Plugin name is required')
      if (!manifest.version) errors.push('Plugin version is required')
      if (!manifest.main) errors.push('Main entry point is required')

      // Validate version format
      if (manifest.version && !semver.valid(manifest.version)) {
        errors.push('Invalid semantic version format')
      }

      // Validate main file exists
      const mainPath = path.join(pluginPath, manifest.main)
      try {
        await fs.access(mainPath)
      } catch {
        errors.push(`Main file not found: ${manifest.main}`)
      }

      // Security validation
      await this.performSecurityValidation(pluginPath, securityIssues)

      // Performance validation
      await this.performPerformanceValidation(pluginPath, performanceIssues)

      // Dependency validation
      if (manifest.dependencies) {
        for (const [depName, version] of Object.entries(manifest.dependencies)) {
          if (!semver.validRange(version)) {
            warnings.push(`Invalid version range for dependency ${depName}: ${version}`)
          }
        }
      }

    } catch (error) {
      errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`)
    }

    return {
      isValid: errors.length === 0 && securityIssues.length === 0,
      errors,
      warnings,
      securityIssues,
      performanceIssues
    }
  }

  /**
   * Perform security validation
   */
  private async performSecurityValidation(pluginPath: string, issues: string[]): Promise<void> {
    try {
      // Check for suspicious patterns in code
      const files = await this.getAllJSFiles(pluginPath)
      
      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8')
        
        // Check for dangerous patterns
        const dangerousPatterns = [
          /eval\s*\(/g,
          /Function\s*\(/g,
          /process\.exit/g,
          /require\s*\(\s*['"]child_process['"]\s*\)/g,
          /require\s*\(\s*['"]fs['"]\s*\)/g,
          /\.\.\/\.\.\//g // Path traversal
        ]

        for (const pattern of dangerousPatterns) {
          if (pattern.test(content)) {
            issues.push(`Potentially dangerous code pattern found in ${path.relative(pluginPath, file)}`)
          }
        }
      }

    } catch (error) {
      issues.push(`Security validation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Perform performance validation
   */
  private async performPerformanceValidation(pluginPath: string, issues: string[]): Promise<void> {
    try {
      // Check file sizes
      const stats = await this.getDirectoryStats(pluginPath)
      
      if (stats.totalSize > 50 * 1024 * 1024) { // 50MB
        issues.push('Plugin size exceeds recommended limit (50MB)')
      }

      if (stats.fileCount > 1000) {
        issues.push('Plugin contains too many files (>1000)')
      }

    } catch (error) {
      issues.push(`Performance validation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // =============================================================================
  // DEPENDENCY MANAGEMENT
  // =============================================================================

  /**
   * Resolve plugin dependencies
   */
  private async resolveDependencies(manifest: PluginManifest): Promise<void> {
    if (!manifest.dependencies) return

    for (const [depName, versionRange] of Object.entries(manifest.dependencies)) {
      const dependency = await this.repository.findByName(depName)
      
      if (!dependency) {
        throw new ApiError(400, `Required dependency not found: ${depName}`)
      }

      if (!semver.satisfies(dependency.version, versionRange)) {
        throw new ApiError(400, 
          `Dependency version mismatch: ${depName} requires ${versionRange}, found ${dependency.version}`
        )
      }

      if (dependency.status !== PluginStatus.ACTIVE) {
        throw new ApiError(400, `Required dependency is not active: ${depName}`)
      }
    }
  }

  // =============================================================================
  // METRICS AND MONITORING
  // =============================================================================

  /**
   * Collect plugin metrics
   */
  private async collectMetrics(): Promise<void> {
    try {
      const plugins = await this.repository.findAll()
      
      for (const plugin of plugins) {
        const hookMetrics = this.hookManager.getHookMetrics(plugin.name)
        const hooks = Array.from(hookMetrics.entries()).map(([key, metrics]) => ({
          name: key.split(':')[1],
          executionCount: metrics.executionCount,
          averageTime: metrics.averageTime,
          errorCount: metrics.errorCount
        }))

        const metrics: PluginMetrics = {
          pluginId: plugin.id,
          pluginName: plugin.name,
          version: plugin.version,
          status: plugin.status,
          installDate: plugin.installedAt,
          lastEnabled: plugin.lastEnabledAt || undefined,
          lastDisabled: plugin.lastDisabledAt || undefined,
          errorCount: 0,
          lastError: plugin.errorMessage || undefined,
          performance: {
            averageExecutionTime: 0,
            totalExecutions: 0,
            memoryUsage: 0,
            cpuUsage: 0
          },
          hooks
        }

        this.metrics.set(plugin.id, metrics)
      }

    } catch (error) {
      logger.error('Error collecting plugin metrics:', error)
    }
  }

  /**
   * Update plugin metrics
   */
  private updatePluginMetrics(pluginId: string, data: {
    executionTime: number
    success: boolean
    hookName: string
    error?: string
  }): void {
    const metrics = this.metrics.get(pluginId)
    if (metrics) {
      metrics.performance.totalExecutions++
      metrics.performance.averageExecutionTime = 
        (metrics.performance.averageExecutionTime * (metrics.performance.totalExecutions - 1) + data.executionTime) / 
        metrics.performance.totalExecutions

      if (!data.success) {
        metrics.errorCount++
        if (data.error) {
          metrics.lastError = data.error
        }
      }

      this.metrics.set(pluginId, metrics)
    }
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  /**
   * Validate installation options
   */
  private validateInstallOptions(options: PluginInstallOptions): void {
    if (!options.source) {
      throw new ApiError(400, 'Installation source is required')
    }

    switch (options.source) {
      case 'file':
        if (!options.path) {
          throw new ApiError(400, 'File path is required for file installation')
        }
        break
      case 'url':
        if (!options.url) {
          throw new ApiError(400, 'URL is required for URL installation')
        }
        break
      case 'registry':
        if (!options.registry) {
          throw new ApiError(400, 'Registry URL is required for registry installation')
        }
        break
      case 'git':
        if (!options.url) {
          throw new ApiError(400, 'Git URL is required for git installation')
        }
        break
    }
  }

  /**
   * Prepare plugin files for installation
   */
  private async preparePluginFiles(options: PluginInstallOptions): Promise<string> {
    const tempDir = path.join(this.pluginsDirectory, 'temp', `plugin-${Date.now()}`)
    await fs.mkdir(tempDir, { recursive: true })

    try {
      switch (options.source) {
        case 'file':
          // Copy from local file system
          await this.copyDirectory(options.path!, tempDir)
          break
        case 'url':
          // Download and extract from URL
          await this.downloadAndExtract(options.url!, tempDir)
          break
        case 'registry':
          // Download from plugin registry
          await this.downloadFromRegistry(options.registry!, options.version!, tempDir)
          break
        case 'git':
          // Clone from git repository
          await this.cloneFromGit(options.url!, tempDir)
          break
      }

      return tempDir
    } catch (error) {
      // Cleanup on error
      await fs.rm(tempDir, { recursive: true, force: true })
      throw error
    }
  }

  /**
   * Load plugin manifest
   */
  private async loadPluginManifest(pluginPath: string): Promise<PluginManifest> {
    const manifestPath = path.join(pluginPath, 'package.json')
    
    try {
      const manifestContent = await fs.readFile(manifestPath, 'utf-8')
      const manifest = JSON.parse(manifestContent)
      
      // Validate required fields
      if (!manifest.name || !manifest.version || !manifest.main) {
        throw new Error('Invalid plugin manifest: missing required fields')
      }

      return manifest
    } catch (error) {
      throw new ApiError(400, `Failed to load plugin manifest: ${(error as Error).message}`)
    }
  }

  /**
   * Copy plugin files to final location
   */
  private async copyPluginFiles(sourcePath: string, targetPath: string): Promise<void> {
    try {
      await fs.mkdir(targetPath, { recursive: true })
      await this.copyDirectory(sourcePath, targetPath)
    } catch (error) {
      throw new ApiError(500, `Failed to copy plugin files: ${(error as Error).message}`)
    }
  }

  /**
   * Copy directory recursively
   */
  private async copyDirectory(source: string, target: string): Promise<void> {
    const entries = await fs.readdir(source, { withFileTypes: true })
    
    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name)
      const targetPath = path.join(target, entry.name)
      
      if (entry.isDirectory()) {
        await fs.mkdir(targetPath, { recursive: true })
        await this.copyDirectory(sourcePath, targetPath)
      } else {
        await fs.copyFile(sourcePath, targetPath)
      }
    }
  }

  /**
   * Download and extract from URL
   */
  private async downloadAndExtract(url: string, targetPath: string): Promise<void> {
    // Implementation would use libraries like node-fetch and tar/unzip
    // This is a placeholder for the actual implementation
    throw new ApiError(501, 'URL download not implemented yet')
  }

  /**
   * Download from plugin registry
   */
  private async downloadFromRegistry(registry: string, version: string, targetPath: string): Promise<void> {
    // Implementation would interact with plugin registry API
    // This is a placeholder for the actual implementation
    throw new ApiError(501, 'Registry download not implemented yet')
  }

  /**
   * Clone from git repository
   */
  private async cloneFromGit(gitUrl: string, targetPath: string): Promise<void> {
    // Implementation would use git commands or libraries
    // This is a placeholder for the actual implementation
    throw new ApiError(501, 'Git clone not implemented yet')
  }

  /**
   * Get all JavaScript files in directory
   */
  private async getAllJSFiles(dirPath: string): Promise<string[]> {
    const files: string[] = []
    
    const scanDirectory = async (currentPath: string): Promise<void> => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name)
        
        if (entry.isDirectory()) {
          await scanDirectory(fullPath)
        } else if (entry.name.endsWith('.js') || entry.name.endsWith('.ts')) {
          files.push(fullPath)
        }
      }
    }

    await scanDirectory(dirPath)
    return files
  }

  /**
   * Get directory statistics
   */
  private async getDirectoryStats(dirPath: string): Promise<{ totalSize: number; fileCount: number }> {
    let totalSize = 0
    let fileCount = 0

    const scanDirectory = async (currentPath: string): Promise<void> => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name)
        
        if (entry.isDirectory()) {
          await scanDirectory(fullPath)
        } else {
          const stats = await fs.stat(fullPath)
          totalSize += stats.size
          fileCount++
        }
      }
    }

    await scanDirectory(dirPath)
    return { totalSize, fileCount }
  }

  // =============================================================================
  // PUBLIC API METHODS
  // =============================================================================

  /**
   * Get all plugins
   */
  async getAllPlugins(tenantId?: string): Promise<Plugin[]> {
    try {
      const cacheKey = `plugins:all:${tenantId || 'global'}`
      const cached = await this.cache.get<Plugin[]>(cacheKey)
      
      if (cached) {
        return cached
      }

      const plugins = await this.repository.findAll()
      await this.cache.set(cacheKey, plugins, { ttl: 300 }) // Cache for 5 minutes
      
      return plugins
    } catch (error) {
      logger.error('Failed to get all plugins:', error)
      throw new ApiError(500, 'Failed to get plugins')
    }
  }

  /**
   * Get plugin by ID
   */
  async getPluginById(id: string): Promise<Plugin> {
    try {
      const cacheKey = `plugin:${id}`
      const cached = await this.cache.get<Plugin>(cacheKey)
      
      if (cached) {
        return cached
      }

      const plugin = await this.repository.findByIdOrThrow(id)
      await this.cache.set(cacheKey, plugin, { ttl: 300 })
      
      return plugin
    } catch (error) {
      logger.error('Failed to get plugin by ID:', error)
      throw error
    }
  }

  /**
   * Search plugins
   */
  async searchPlugins(filters: any = {}): Promise<Plugin[]> {
    try {
      return await this.repository.search(filters)
    } catch (error) {
      logger.error('Failed to search plugins:', error)
      throw new ApiError(500, 'Failed to search plugins')
    }
  }

  /**
   * Update plugin configuration
   */
  async updatePluginConfig(
    id: string, 
    config: Record<string, any>,
    options: { tenantId?: string; userId?: string } = {}
  ): Promise<Plugin> {
    try {
      const plugin = await this.repository.updateConfig(id, config)
      
      // Clear cache
      await this.cache.delete(`plugin:${id}`)
      
      // Audit log
      await this.audit.log({
        action: 'plugin.config.update',
        entityType: 'plugin',
        entityId: plugin.id,
        userId: options.userId,
        tenantId: options.tenantId,
        details: { config }
      })

      this.emit('pluginConfigUpdated', plugin)
      return plugin
    } catch (error) {
      logger.error('Failed to update plugin config:', error)
      throw error
    }
  }

  /**
   * Get plugin metrics
   */
  getPluginMetrics(pluginId?: string): PluginMetrics | Map<string, PluginMetrics> {
    if (pluginId) {
      const metrics = this.metrics.get(pluginId)
      if (!metrics) {
        throw new ApiError(404, 'Plugin metrics not found')
      }
      return metrics
    }
    return new Map(this.metrics)
  }

  /**
   * Get plugin statistics
   */
  async getPluginStats(): Promise<any> {
    try {
      const stats = await this.repository.getStats()
      const hookStats = this.hookManager.getHookMetrics()
      
      return {
        ...stats,
        hooks: {
          total: hookStats.size,
          byPlugin: Array.from(hookStats.entries()).reduce((acc, [key, metrics]) => {
            const pluginName = key.split(':')[0]
            if (!acc[pluginName]) {
              acc[pluginName] = 0
            }
            acc[pluginName]++
            return acc
          }, {} as Record<string, number>)
        },
        performance: {
          totalExecutions: Array.from(this.metrics.values()).reduce(
            (sum, m) => sum + m.performance.totalExecutions, 0
          ),
          averageExecutionTime: Array.from(this.metrics.values()).reduce(
            (sum, m) => sum + m.performance.averageExecutionTime, 0
          ) / this.metrics.size || 0
        }
      }
    } catch (error) {
      logger.error('Failed to get plugin stats:', error)
      throw new ApiError(500, 'Failed to get plugin statistics')
    }
  }

  /**
   * Execute hook
   */
  async executeHook(hookName: string, context: any, ...args: any[]): Promise<any[]> {
    return await this.hookManager.executeHooks(hookName, context, ...args)
  }

  /**
   * Get registered hooks
   */
  getRegisteredHooks(hookName?: string): Map<string, PluginHook[]> {
    return this.hookManager.getHooks(hookName)
  }

  /**
   * Health check
   */
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy'
    plugins: {
      total: number
      active: number
      inactive: number
      error: number
    }
    hooks: {
      total: number
      errors: number
    }
    performance: {
      averageExecutionTime: number
      totalExecutions: number
    }
  }> {
    try {
      const stats = await this.repository.getStats()
      const hookMetrics = this.hookManager.getHookMetrics()
      
      const totalHookErrors = Array.from(hookMetrics.values()).reduce(
        (sum, metrics) => sum + metrics.errorCount, 0
      )
      
      const avgExecutionTime = Array.from(this.metrics.values()).reduce(
        (sum, m) => sum + m.performance.averageExecutionTime, 0
      ) / this.metrics.size || 0

      const totalExecutions = Array.from(this.metrics.values()).reduce(
        (sum, m) => sum + m.performance.totalExecutions, 0
      )

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'
      
      if (stats.withErrors > 0 || totalHookErrors > 0) {
        status = 'degraded'
      }
      
      if (stats.withErrors > stats.total * 0.5) {
        status = 'unhealthy'
      }

      return {
        status,
        plugins: {
          total: stats.total,
          active: stats.byStatus['ACTIVE'] || 0,
          inactive: stats.byStatus['INACTIVE'] || 0,
          error: stats.byStatus['ERROR'] || 0
        },
        hooks: {
          total: hookMetrics.size,
          errors: totalHookErrors
        },
        performance: {
          averageExecutionTime: avgExecutionTime,
          totalExecutions
        }
      }
    } catch (error) {
      logger.error('Failed to get health status:', error)
      return {
        status: 'unhealthy',
        plugins: { total: 0, active: 0, inactive: 0, error: 0 },
        hooks: { total: 0, errors: 0 },
        performance: { averageExecutionTime: 0, totalExecutions: 0 }
      }
    }
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown(): Promise<void> {
    try {
      // Stop all workers
      for (const [pluginId, worker] of this.workers.entries()) {
        await worker.terminate()
      }
      this.workers.clear()

      // Clear all hooks
      this.hookManager.removeAllListeners()

      // Clear metrics
      this.metrics.clear()

      logger.info('Plugin service shutdown completed')
    } catch (error) {
      logger.error('Error during plugin service shutdown:', error)
      throw error
    }
  }
}
