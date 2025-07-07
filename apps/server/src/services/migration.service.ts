import type { PrismaClient } from "@prisma/client"
import { prisma } from "@cms-platform/database/client"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import { cacheService } from "./cache.service"
import { auditService } from "./audit.service"
import { EventEmitter } from "events"
import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import zlib from "zlib"
import { promisify } from "util"

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

export interface MigrationServiceOptions {
  enableCache?: boolean
  cacheTtl?: number
  enableAudit?: boolean
  enableValidation?: boolean
  enableRollback?: boolean
  enableCompression?: boolean
  enableEncryption?: boolean
  maxBackupRetention?: number
  batchSize?: number
  enableProgressTracking?: boolean
  encryptionKey?: string
  maxConcurrentOperations?: number
  operationTimeout?: number
}

export interface MigrationPlan {
  id: string
  name: string
  description?: string
  version: string
  dependencies: string[]
  operations: MigrationOperation[]
  rollbackOperations: MigrationOperation[]
  estimatedDuration: number
  riskLevel: "low" | "medium" | "high" | "critical"
  affectedTables: string[]
  dataValidation: ValidationRule[]
  createdAt: Date
  createdBy?: string
}

export interface MigrationOperation {
  id: string
  type: "schema" | "data" | "index" | "constraint" | "trigger" | "function"
  action: "create" | "update" | "delete" | "transform"
  target: string
  sql?: string
  script?: string
  parameters?: Record<string, any>
  conditions?: string[]
  rollbackSql?: string
  validation?: ValidationRule[]
  estimatedRows?: number
  batchable?: boolean
  timeout?: number
  retryCount?: number
}

export interface ValidationRule {
  id: string
  name: string
  description?: string
  type: "count" | "integrity" | "constraint" | "custom"
  query: string
  expectedResult?: any
  tolerance?: number
  critical?: boolean
}

export interface MigrationExecution {
  id: string
  planId: string
  status: "pending" | "running" | "completed" | "failed" | "rolled_back"
  startedAt?: Date
  completedAt?: Date
  progress: number
  currentOperation?: string
  executedOperations: string[]
  failedOperations: Array<{ operationId: string; error: string }>
  validationResults: Array<{ ruleId: string; passed: boolean; result?: any; error?: string }>
  rollbackPoint?: string
  metadata: Record<string, any>
  tenantId?: string
  executedBy?: string
}

export interface BackupInfo {
  id: string
  name: string
  description?: string
  type: "full" | "incremental" | "schema" | "data"
  size: number
  compressed: boolean
  encrypted: boolean
  checksum: string
  tables: string[]
  rowCounts: Record<string, number>
  createdAt: Date
  expiresAt?: Date
  metadata: Record<string, any>
  tenantId?: string
  createdBy?: string
}

export interface DataTransformationRule {
  id: string
  name: string
  description?: string
  sourceTable: string
  targetTable: string
  mapping: Record<string, string | TransformFunction>
  conditions?: string[]
  validation?: ValidationRule[]
  batchSize?: number
}

export interface TransformFunction {
  type: "javascript" | "sql" | "regex" | "lookup"
  expression: string
  parameters?: Record<string, any>
}

export interface TableSchemaInfo {
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
}

export interface SchemaBackupData {
  schema: TableSchemaInfo[]
}

export interface BackupDataStructure {
  [tableName: string]: any[] | SchemaBackupData
}

export interface RestoreTableData {
  data?: any[]
  schema?: TableSchemaInfo[]
}

export interface MigrationStats {
  totalMigrations: number
  successfulMigrations: number
  failedMigrations: number
  totalDataMigrated: number
  averageExecutionTime: number
  recentMigrations: Array<{
    id: string
    name: string
    status: string
    executedAt: Date
    duration: number
  }>
  riskDistribution: Record<string, number>
  tablesMigrated: string[]
  performanceMetrics: {
    throughput: number
    errorRate: number
    rollbackRate: number
  }
}

export class MigrationService extends EventEmitter {
  private prisma: PrismaClient
  private options: MigrationServiceOptions
  private migrationPlans: Map<string, MigrationPlan> = new Map()
  private activeExecutions: Map<string, MigrationExecution> = new Map()
  private backups: Map<string, BackupInfo> = new Map()
  private transformationRules: Map<string, DataTransformationRule> = new Map()
  private migrationHistory: Map<string, MigrationExecution[]> = new Map()
  private operationSemaphore: Map<string, number> = new Map()
  private encryptionKey: string

  constructor(options: MigrationServiceOptions = {}) {
    super()
    this.prisma = prisma
    this.options = {
      enableCache: true,
      cacheTtl: 3600,
      enableAudit: true,
      enableValidation: true,
      enableRollback: true,
      enableCompression: true,
      enableEncryption: false,
      maxBackupRetention: 30,
      batchSize: 1000,
      enableProgressTracking: true,
      maxConcurrentOperations: 5,
      operationTimeout: 300000, // 5 minutes
      ...options,
    }

    this.encryptionKey =
      options.encryptionKey || process.env.MIGRATION_ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex")
    this.setMaxListeners(100)
    this.initializeBuiltInTransformations()
    this.startCleanupScheduler()
    this.loadExistingData()

    logger.info("Enhanced Migration service initialized", this.options)
  }

  /**
   * Load existing migration data from database
   */
  private async loadExistingData(): Promise<void> {
    try {
      // Load migration plans from database if they exist
      // This would typically query your migration_plans table
      logger.info("Migration service data loaded")
    } catch (error) {
      logger.warn("Failed to load existing migration data:", error)
    }
  }

  /**
   * Initialize built-in transformation rules
   */
  private initializeBuiltInTransformations(): void {
    const builtInRules: DataTransformationRule[] = [
      {
        id: "mongodb-to-postgres-content",
        name: "MongoDB to PostgreSQL Content Migration",
        description: "Transform MongoDB content documents to PostgreSQL format",
        sourceTable: "mongodb_content",
        targetTable: "contents",
        mapping: {
          _id: { type: "javascript", expression: "crypto.randomUUID()" },
          title: "title",
          content: { type: "javascript", expression: "JSON.stringify(data)" },
          status: {
            type: "lookup",
            expression: "statusMapping",
            parameters: {
              mapping: { published: "PUBLISHED", draft: "DRAFT" },
            },
          },
          createdAt: "created_at",
          updatedAt: "updated_at",
        },
        batchSize: 500,
      },
      {
        id: "user-data-normalization",
        name: "User Data Normalization",
        description: "Normalize user data and ensure consistency",
        sourceTable: "users",
        targetTable: "users",
        mapping: {
          email: { type: "javascript", expression: "value.toLowerCase().trim()" },
          firstName: { type: "javascript", expression: "value.trim()" },
          lastName: { type: "javascript", expression: "value.trim()" },
          status: {
            type: "lookup",
            expression: "statusMapping",
            parameters: {
              mapping: { active: "ACTIVE", inactive: "INACTIVE" },
            },
          },
        },
      },
      {
        id: "legacy-data-cleanup",
        name: "Legacy Data Cleanup",
        description: "Clean up and standardize legacy data formats",
        sourceTable: "legacy_data",
        targetTable: "standardized_data",
        mapping: {
          id: "id",
          data: { type: "javascript", expression: "JSON.parse(value || '{}')" },
          timestamp: { type: "javascript", expression: "new Date(value).toISOString()" },
        },
      },
    ]

    for (const rule of builtInRules) {
      this.transformationRules.set(rule.id, rule)
    }
  }

  /**
   * Start cleanup scheduler for old backups and executions
   */
  private startCleanupScheduler(): void {
    setInterval(
      async () => {
        await this.cleanupOldBackups()
        await this.cleanupOldExecutions()
      },
      24 * 60 * 60 * 1000,
    ) // Daily cleanup
  }

  /**
   * Create a comprehensive migration plan
   */
  async createMigrationPlan(data: {
    name: string
    description?: string
    version: string
    operations: Omit<MigrationOperation, "id">[]
    dependencies?: string[]
    riskLevel?: "low" | "medium" | "high" | "critical"
    dataValidation?: Omit<ValidationRule, "id">[]
    tenantId?: string
    createdBy?: string
  }): Promise<MigrationPlan> {
    try {
      const plan: MigrationPlan = {
        id: crypto.randomUUID(),
        name: data.name,
        description: data.description,
        version: data.version,
        dependencies: data.dependencies || [],
        operations: data.operations.map((op) => ({ ...op, id: crypto.randomUUID() })),
        rollbackOperations: this.generateRollbackOperations(data.operations),
        estimatedDuration: this.estimateMigrationDuration(data.operations),
        riskLevel: data.riskLevel || "medium",
        affectedTables: this.extractAffectedTables(data.operations),
        dataValidation: (data.dataValidation || []).map((rule) => ({ ...rule, id: crypto.randomUUID() })),
        createdAt: new Date(),
        createdBy: data.createdBy,
      }

      // Validate plan
      await this.validateMigrationPlan(plan)

      // Store plan
      this.migrationPlans.set(plan.id, plan)

      // Cache plan
      if (this.options.enableCache) {
        await cacheService.set(`migration:plan:${plan.id}`, plan, {
          ttl: this.options.cacheTtl,
          namespace: data.tenantId,
        })
      }

      // Emit event
      this.emit("migration:plan:created", { plan, tenantId: data.tenantId })

      // Audit log
      if (this.options.enableAudit) {
        await auditService.log({
          action: "migration.plan.create",
          entityType: "MigrationPlan",
          entityId: plan.id,
          userId: data.createdBy,
          tenantId: data.tenantId,
          details: {
            name: plan.name,
            version: plan.version,
            operationsCount: plan.operations.length,
            riskLevel: plan.riskLevel,
          },
        })
      }

      logger.info("Migration plan created", {
        id: plan.id,
        name: plan.name,
        version: plan.version,
        operationsCount: plan.operations.length,
      })

      return plan
    } catch (error) {
      logger.error("Failed to create migration plan:", error)
      throw error
    }
  }

  /**
   * Execute migration plan with comprehensive monitoring
   */
  async executeMigrationPlan(
    planId: string,
    options: {
      dryRun?: boolean
      createBackup?: boolean
      skipValidation?: boolean
      tenantId?: string
      executedBy?: string
    } = {},
  ): Promise<MigrationExecution> {
    try {
      const plan = this.migrationPlans.get(planId)
      if (!plan) {
        throw ApiError.notFound("Migration plan not found")
      }

      const execution: MigrationExecution = {
        id: crypto.randomUUID(),
        planId,
        status: "pending",
        progress: 0,
        executedOperations: [],
        failedOperations: [],
        validationResults: [],
        metadata: {
          dryRun: options.dryRun || false,
          backupCreated: false,
          startTime: Date.now(),
        },
        tenantId: options.tenantId,
        executedBy: options.executedBy,
      }

      this.activeExecutions.set(execution.id, execution)

      // Create backup if requested
      if (options.createBackup && !options.dryRun) {
        const backup = await this.createBackup({
          name: `pre-migration-${plan.name}-${Date.now()}`,
          description: `Backup before executing migration plan: ${plan.name}`,
          type: "full",
          tables: plan.affectedTables,
          tenantId: options.tenantId,
          createdBy: options.executedBy,
        })
        execution.rollbackPoint = backup.id
        execution.metadata.backupCreated = true
      }

      // Start execution
      execution.status = "running"
      execution.startedAt = new Date()
      this.emit("migration:execution:started", { execution, plan })

      try {
        // Execute operations
        for (let i = 0; i < plan.operations.length; i++) {
          const operation = plan.operations[i]
          execution.currentOperation = operation.id

          try {
            await this.executeOperation(operation, execution, options)
            execution.executedOperations.push(operation.id)
            execution.progress = Math.round(((i + 1) / plan.operations.length) * 100)
            this.emit("migration:operation:completed", { execution, operation })
          } catch (error) {
            execution.failedOperations.push({
              operationId: operation.id,
              error: (error as Error).message,
            })

            if (operation.type === "schema" || plan.riskLevel === "critical") {
              throw error // Stop execution on critical failures
            }

            logger.warn("Operation failed but continuing", {
              operationId: operation.id,
              error: (error as Error).message,
            })
          }
        }

        // Run validation if enabled
        if (this.options.enableValidation && !options.skipValidation) {
          execution.validationResults = await this.runValidation(plan.dataValidation, execution)
        }

        execution.status = "completed"
        execution.completedAt = new Date()
        execution.progress = 100
        this.emit("migration:execution:completed", { execution, plan })
      } catch (error) {
        execution.status = "failed"
        execution.completedAt = new Date()
        this.emit("migration:execution:failed", { execution, plan, error })

        // Auto-rollback on failure if enabled
        if (this.options.enableRollback && execution.rollbackPoint) {
          await this.rollbackMigration(execution.id)
        }

        throw error
      }

      // Store execution history
      if (!this.migrationHistory.has(planId)) {
        this.migrationHistory.set(planId, [])
      }
      this.migrationHistory.get(planId)!.push(execution)

      // Audit log
      if (this.options.enableAudit) {
        await auditService.log({
          action: "migration.execute",
          entityType: "MigrationExecution",
          entityId: execution.id,
          userId: options.executedBy,
          tenantId: options.tenantId,
          details: {
            planId,
            planName: plan.name,
            status: execution.status,
            operationsExecuted: execution.executedOperations.length,
            operationsFailed: execution.failedOperations.length,
            dryRun: options.dryRun,
          },
        })
      }

      return execution
    } catch (error) {
      logger.error("Failed to execute migration plan:", error)
      throw error
    }
  }

  /**
   * Create comprehensive database backup
   */
  async createBackup(data: {
    name: string
    description?: string
    type: "full" | "incremental" | "schema" | "data"
    tables?: string[]
    compressed?: boolean
    encrypted?: boolean
    tenantId?: string
    createdBy?: string
  }): Promise<BackupInfo> {
    try {
      const backupId = crypto.randomUUID()
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      const backupPath = path.join(process.cwd(), "backups", `${data.name}-${timestamp}`)

      await fs.mkdir(path.dirname(backupPath), { recursive: true })

      // Get table information
      const tables = data.tables || (await this.getAllTables(data.tenantId))
      const rowCounts: Record<string, number> = {}

      // Create backup based on type
      let backupData: any = {}

      switch (data.type) {
        case "full":
          backupData = await this.createFullBackup(tables, data.tenantId)
          break
        case "schema":
          backupData = await this.createSchemaBackup(tables)
          break
        case "data":
          backupData = await this.createDataBackup(tables, data.tenantId)
          break
        case "incremental":
          backupData = await this.createIncrementalBackup(tables, data.tenantId)
          break
      }

      // Calculate row counts
      for (const table of tables) {
        rowCounts[table] = await this.getTableRowCount(table, data.tenantId)
      }

      // Serialize backup data
      let backupContent = JSON.stringify(backupData, null, 2)

      // Compress if requested
      if (data.compressed !== false) {
        backupContent = await this.compressData(backupContent)
      }

      // Encrypt if requested
      if (data.encrypted) {
        backupContent = await this.encryptData(backupContent)
      }

      // Write backup file
      await fs.writeFile(`${backupPath}.json`, backupContent)

      // Calculate checksum
      const checksum = crypto.createHash("sha256").update(backupContent).digest("hex")

      // Get file size
      const stats = await fs.stat(`${backupPath}.json`)

      const backup: BackupInfo = {
        id: backupId,
        name: data.name,
        description: data.description,
        type: data.type,
        size: stats.size,
        compressed: data.compressed !== false,
        encrypted: data.encrypted || false,
        checksum,
        tables,
        rowCounts,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.options.maxBackupRetention! * 24 * 60 * 60 * 1000),
        metadata: {
          path: `${backupPath}.json`,
          version: "1.0",
          format: "json",
        },
        tenantId: data.tenantId,
        createdBy: data.createdBy,
      }

      this.backups.set(backupId, backup)

      // Emit event
      this.emit("backup:created", { backup })

      logger.info("Backup created", {
        id: backupId,
        name: data.name,
        type: data.type,
        size: stats.size,
        tables: tables.length,
      })

      return backup
    } catch (error) {
      logger.error("Failed to create backup:", error)
      throw error
    }
  }

  /**
   * Restore from backup with validation
   */
  async restoreFromBackup(
    backupId: string,
    options: {
      tables?: string[]
      validateBeforeRestore?: boolean
      createBackupBeforeRestore?: boolean
      tenantId?: string
      restoredBy?: string
    } = {},
  ): Promise<{ success: boolean; restoredTables: string[]; errors: string[] }> {
    try {
      const backup = this.backups.get(backupId)
      if (!backup) {
        throw ApiError.notFound("Backup not found")
      }

      const result = {
        success: false,
        restoredTables: [] as string[],
        errors: [] as string[],
      }

      // Create backup before restore if requested
      if (options.createBackupBeforeRestore) {
        await this.createBackup({
          name: `pre-restore-${Date.now()}`,
          description: `Backup before restoring from ${backup.name}`,
          type: "full",
          tables: options.tables || backup.tables,
          tenantId: options.tenantId,
          createdBy: options.restoredBy,
        })
      }

      // Read and decrypt/decompress backup
      const backupPath = backup.metadata.path as string
      let backupContent = await fs.readFile(backupPath, "utf-8")

      if (backup.encrypted) {
        backupContent = await this.decryptData(backupContent)
      }

      if (backup.compressed) {
        backupContent = await this.decompressData(backupContent)
      }

      const backupData = JSON.parse(backupContent)

      // Validate backup integrity
      if (options.validateBeforeRestore) {
        const isValid = await this.validateBackupIntegrity(backup, backupData)
        if (!isValid) {
          throw new Error("Backup integrity validation failed")
        }
      }

      // Restore tables
      const tablesToRestore = options.tables || backup.tables
      for (const table of tablesToRestore) {
        try {
          await this.restoreTable(table, backupData[table], backup.type, options.tenantId)
          result.restoredTables.push(table)
        } catch (error) {
          result.errors.push(`Failed to restore table ${table}: ${(error as Error).message}`)
        }
      }

      result.success = result.errors.length === 0

      // Emit event
      this.emit("backup:restored", { backup, result })

      // Audit log
      if (this.options.enableAudit) {
        await auditService.log({
          action: "migration.restore",
          entityType: "Backup",
          entityId: backupId,
          userId: options.restoredBy,
          tenantId: options.tenantId,
          details: {
            backupName: backup.name,
            restoredTables: result.restoredTables,
            errors: result.errors,
          },
        })
      }

      logger.info("Backup restore completed", {
        backupId,
        success: result.success,
        restoredTables: result.restoredTables.length,
        errors: result.errors.length,
      })

      return result
    } catch (error) {
      logger.error("Failed to restore from backup:", error)
      throw error
    }
  }

  /**
   * Advanced data transformation with custom rules
   */
  async transformData(
    ruleId: string,
    options: {
      sourceFilter?: string
      batchSize?: number
      dryRun?: boolean
      validateResults?: boolean
      tenantId?: string
      transformedBy?: string
    } = {},
  ): Promise<{
    success: boolean
    processedRows: number
    transformedRows: number
    errors: string[]
    validationResults?: any[]
  }> {
    try {
      const rule = this.transformationRules.get(ruleId)
      if (!rule) {
        throw ApiError.notFound("Transformation rule not found")
      }

      const result = {
        success: false,
        processedRows: 0,
        transformedRows: 0,
        errors: [] as string[],
        validationResults: [] as any[],
      }

      const batchSize = options.batchSize || rule.batchSize || this.options.batchSize!

      // Get source data in batches
      let offset = 0
      let hasMoreData = true

      while (hasMoreData) {
        try {
          const sourceData = await this.getSourceData(
            rule.sourceTable,
            offset,
            batchSize,
            options.sourceFilter,
            options.tenantId,
          )

          if (sourceData.length === 0) {
            hasMoreData = false
            break
          }

          // Transform batch
          const transformedData = await this.transformBatch(sourceData, rule)

          // Insert transformed data if not dry run
          if (!options.dryRun) {
            await this.insertTransformedData(rule.targetTable, transformedData, options.tenantId)
          }

          result.processedRows += sourceData.length
          result.transformedRows += transformedData.length
          offset += batchSize

          // Emit progress
          this.emit("transformation:progress", {
            ruleId,
            processedRows: result.processedRows,
            transformedRows: result.transformedRows,
          })
        } catch (error) {
          result.errors.push(`Batch error at offset ${offset}: ${(error as Error).message}`)
          offset += batchSize // Continue with next batch
        }
      }

      // Run validation if requested
      if (options.validateResults && rule.validation) {
        result.validationResults = await this.runValidation(rule.validation, {
          id: crypto.randomUUID(),
          planId: ruleId,
          status: "completed",
          progress: 100,
          executedOperations: [],
          failedOperations: [],
          validationResults: [],
          metadata: {},
        })
      }

      result.success = result.errors.length === 0

      logger.info("Data transformation completed", {
        ruleId,
        success: result.success,
        processedRows: result.processedRows,
        transformedRows: result.transformedRows,
        errors: result.errors.length,
      })

      return result
    } catch (error) {
      logger.error("Failed to transform data:", error)
      throw error
    }
  }

  /**
   * Get comprehensive migration statistics
   */
  async getMigrationStats(tenantId?: string): Promise<MigrationStats> {
    try {
      const cacheKey = "migration:stats"
      if (this.options.enableCache) {
        const cached = await cacheService.get<MigrationStats>(cacheKey, tenantId)
        if (cached) return cached
      }

      const allExecutions = Array.from(this.migrationHistory.values()).flat()
      const tenantExecutions = tenantId ? allExecutions.filter((e) => e.tenantId === tenantId) : allExecutions

      const totalMigrations = tenantExecutions.length
      const successfulMigrations = tenantExecutions.filter((e) => e.status === "completed").length
      const failedMigrations = tenantExecutions.filter((e) => e.status === "failed").length

      const totalDataMigrated = tenantExecutions.reduce((sum, e) => {
        return sum + (e.metadata.rowsProcessed || 0)
      }, 0)

      const executionTimes = tenantExecutions
        .filter((e) => e.startedAt && e.completedAt)
        .map((e) => e.completedAt!.getTime() - e.startedAt!.getTime())

      const averageExecutionTime =
        executionTimes.length > 0 ? executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length : 0

      const recentMigrations = tenantExecutions
        .sort((a, b) => (b.startedAt?.getTime() || 0) - (a.startedAt?.getTime() || 0))
        .slice(0, 10)
        .map((e) => {
          const plan = this.migrationPlans.get(e.planId)
          return {
            id: e.id,
            name: plan?.name || "Unknown",
            status: e.status,
            executedAt: e.startedAt || new Date(),
            duration: e.startedAt && e.completedAt ? e.completedAt.getTime() - e.startedAt.getTime() : 0,
          }
        })

      const riskDistribution = Array.from(this.migrationPlans.values()).reduce(
        (acc, plan) => {
          acc[plan.riskLevel] = (acc[plan.riskLevel] || 0) + 1
          return acc
        },
        {} as Record<string, number>,
      )

      const tablesMigrated = Array.from(
        new Set(Array.from(this.migrationPlans.values()).flatMap((plan) => plan.affectedTables)),
      )

      const stats: MigrationStats = {
        totalMigrations,
        successfulMigrations,
        failedMigrations,
        totalDataMigrated,
        averageExecutionTime,
        recentMigrations,
        riskDistribution,
        tablesMigrated,
        performanceMetrics: {
          throughput: totalDataMigrated / (averageExecutionTime || 1),
          errorRate: totalMigrations > 0 ? (failedMigrations / totalMigrations) * 100 : 0,
          rollbackRate: (tenantExecutions.filter((e) => e.status === "rolled_back").length / totalMigrations) * 100,
        },
      }

      if (this.options.enableCache) {
        await cacheService.set(cacheKey, stats, {
          ttl: this.options.cacheTtl! / 4,
          namespace: tenantId,
        })
      }

      return stats
    } catch (error) {
      logger.error("Failed to get migration stats:", error)
      throw error
    }
  }

  /**
   * Rollback migration execution
   */
  async rollbackMigration(executionId: string): Promise<void> {
    try {
      const execution = this.activeExecutions.get(executionId)
      if (!execution) {
        throw ApiError.notFound("Migration execution not found")
      }

      const plan = this.migrationPlans.get(execution.planId)
      if (!plan) {
        throw ApiError.notFound("Migration plan not found")
      }

      logger.info("Starting migration rollback", { executionId, planId: execution.planId })

      // Execute rollback operations in reverse order
      for (const operation of plan.rollbackOperations) {
        try {
          await this.executeOperation(operation, execution, { dryRun: false })
        } catch (error) {
          logger.error("Rollback operation failed", {
            operationId: operation.id,
            error: (error as Error).message,
          })
        }
      }

      // Restore from backup if available
      if (execution.rollbackPoint) {
        await this.restoreFromBackup(execution.rollbackPoint)
      }

      execution.status = "rolled_back"
      execution.completedAt = new Date()

      this.emit("migration:rolled_back", { execution, plan })
      logger.info("Migration rollback completed", { executionId })
    } catch (error) {
      logger.error("Failed to rollback migration:", error)
      throw error
    }
  }

  // Private helper methods

  private generateRollbackOperations(operations: Omit<MigrationOperation, "id">[]): MigrationOperation[] {
    return operations.reverse().map((op) => ({
      id: crypto.randomUUID(),
      type: op.type,
      action: this.getRollbackAction(op.action),
      target: op.target,
      sql: op.rollbackSql,
      parameters: op.parameters,
    }))
  }

  private getRollbackAction(action: string): "create" | "update" | "delete" | "transform" {
    switch (action) {
      case "create":
        return "delete"
      case "delete":
        return "create"
      case "update":
        return "update"
      case "transform":
        return "transform"
      default:
        return "update"
    }
  }

  private estimateMigrationDuration(operations: Omit<MigrationOperation, "id">[]): number {
    return operations.reduce((total, op) => {
      const baseTime = op.estimatedRows ? op.estimatedRows * 0.001 : 1000 // 1ms per row
      const complexityMultiplier = op.type === "schema" ? 2 : 1
      return total + baseTime * complexityMultiplier
    }, 0)
  }

  private extractAffectedTables(operations: Omit<MigrationOperation, "id">[]): string[] {
    const tables = new Set<string>()
    operations.forEach((op) => {
      if (op.target) {
        tables.add(op.target)
      }
    })
    return Array.from(tables)
  }

  private async validateMigrationPlan(plan: MigrationPlan): Promise<void> {
    // Validate dependencies
    for (const depId of plan.dependencies) {
      if (!this.migrationPlans.has(depId)) {
        throw new Error(`Dependency migration plan not found: ${depId}`)
      }
    }

    // Validate operations
    for (const operation of plan.operations) {
      if (!operation.sql && !operation.script) {
        throw new Error(`Operation ${operation.id} must have either SQL or script`)
      }
    }

    // Check for circular dependencies
    await this.checkCircularDependencies(plan)
  }

  private async checkCircularDependencies(plan: MigrationPlan): Promise<void> {
    const visited = new Set<string>()
    const recursionStack = new Set<string>()

    const hasCycle = (planId: string): boolean => {
      if (recursionStack.has(planId)) return true
      if (visited.has(planId)) return false

      visited.add(planId)
      recursionStack.add(planId)

      const currentPlan = this.migrationPlans.get(planId)
      if (currentPlan) {
        for (const depId of currentPlan.dependencies) {
          if (hasCycle(depId)) return true
        }
      }

      recursionStack.delete(planId)
      return false
    }

    if (hasCycle(plan.id)) {
      throw new Error("Circular dependency detected in migration plan")
    }
  }

  private async executeOperation(
    operation: MigrationOperation,
    execution: MigrationExecution,
    options: any,
  ): Promise<void> {
    if (options.dryRun) {
      logger.info("DRY RUN: Would execute operation", { operationId: operation.id })
      return
    }

    const timeout = operation.timeout || this.options.operationTimeout!
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Operation timeout")), timeout)
    })

    try {
      await Promise.race([this.executeOperationByType(operation, execution, options), timeoutPromise])
    } catch (error) {
      // Retry logic
      const retryCount = operation.retryCount || 0
      if (retryCount > 0) {
        for (let i = 0; i < retryCount; i++) {
          try {
            await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1))) // Exponential backoff
            await this.executeOperationByType(operation, execution, options)
            return
          } catch (retryError) {
            if (i === retryCount - 1) throw retryError
          }
        }
      }
      throw error
    }
  }

  private async executeOperationByType(
    operation: MigrationOperation,
    execution: MigrationExecution,
    options: any,
  ): Promise<void> {
    switch (operation.type) {
      case "schema":
        await this.executeSchemaOperation(operation, execution, options)
        break
      case "data":
        await this.executeDataOperation(operation, execution, options)
        break
      case "index":
        await this.executeIndexOperation(operation, execution, options)
        break
      case "constraint":
        await this.executeConstraintOperation(operation, execution, options)
        break
      case "trigger":
        await this.executeTriggerOperation(operation, execution, options)
        break
      case "function":
        await this.executeFunctionOperation(operation, execution, options)
        break
      default:
        throw new Error(`Unknown operation type: ${operation.type}`)
    }
  }

  private async executeSchemaOperation(
    operation: MigrationOperation,
    execution: MigrationExecution,
    options: any,
  ): Promise<void> {
    try {
      if (operation.sql) {
        await this.prisma.$executeRawUnsafe(
          operation.sql,
          ...(operation.parameters ? Object.values(operation.parameters) : []),
        )
      } else if (operation.script) {
        await this.executeScript(operation.script, operation.parameters)
      }

      logger.info("Schema operation executed", { operationId: operation.id, target: operation.target })
    } catch (error) {
      logger.error("Schema operation failed", { operationId: operation.id, error })
      throw error
    }
  }

  private async executeDataOperation(
    operation: MigrationOperation,
    execution: MigrationExecution,
    options: any,
  ): Promise<void> {
    try {
      if (operation.batchable && operation.estimatedRows && operation.estimatedRows > this.options.batchSize!) {
        await this.executeBatchedDataOperation(operation, execution, options)
      } else {
        if (operation.sql) {
          await this.prisma.$executeRawUnsafe(
            operation.sql,
            ...(operation.parameters ? Object.values(operation.parameters) : []),
          )
        } else if (operation.script) {
          await this.executeScript(operation.script, operation.parameters)
        }
      }

      logger.info("Data operation executed", { operationId: operation.id, target: operation.target })
    } catch (error) {
      logger.error("Data operation failed", { operationId: operation.id, error })
      throw error
    }
  }

  private async executeBatchedDataOperation(
    operation: MigrationOperation,
    execution: MigrationExecution,
    options: any,
  ): Promise<void> {
    const batchSize = this.options.batchSize!
    const totalRows = operation.estimatedRows || 0
    let processedRows = 0

    while (processedRows < totalRows) {
      const batchSql = operation.sql?.replace(/LIMIT \d+/i, `LIMIT ${batchSize} OFFSET ${processedRows}`)

      if (batchSql) {
        await this.prisma.$executeRawUnsafe(
          batchSql,
          ...(operation.parameters ? Object.values(operation.parameters) : []),
        )
      }

      processedRows += batchSize

      // Update progress
      const batchProgress = Math.min(processedRows / totalRows, 1)
      this.emit("operation:batch:progress", {
        operationId: operation.id,
        progress: batchProgress,
        processedRows,
        totalRows,
      })
    }
  }

  private async executeIndexOperation(
    operation: MigrationOperation,
    execution: MigrationExecution,
    options: any,
  ): Promise<void> {
    try {
      if (operation.sql) {
        await this.prisma.$executeRawUnsafe(operation.sql)
      }
      logger.info("Index operation executed", { operationId: operation.id, target: operation.target })
    } catch (error) {
      logger.error("Index operation failed", { operationId: operation.id, error })
      throw error
    }
  }

  private async executeConstraintOperation(
    operation: MigrationOperation,
    execution: MigrationExecution,
    options: any,
  ): Promise<void> {
    try {
      if (operation.sql) {
        await this.prisma.$executeRawUnsafe(operation.sql)
      }
      logger.info("Constraint operation executed", { operationId: operation.id, target: operation.target })
    } catch (error) {
      logger.error("Constraint operation failed", { operationId: operation.id, error })
      throw error
    }
  }

  private async executeTriggerOperation(
    operation: MigrationOperation,
    execution: MigrationExecution,
    options: any,
  ): Promise<void> {
    try {
      if (operation.sql) {
        await this.prisma.$executeRawUnsafe(operation.sql)
      }
      logger.info("Trigger operation executed", { operationId: operation.id, target: operation.target })
    } catch (error) {
      logger.error("Trigger operation failed", { operationId: operation.id, error })
      throw error
    }
  }

  private async executeFunctionOperation(
    operation: MigrationOperation,
    execution: MigrationExecution,
    options: any,
  ): Promise<void> {
    try {
      if (operation.sql) {
        await this.prisma.$executeRawUnsafe(operation.sql)
      }
      logger.info("Function operation executed", { operationId: operation.id, target: operation.target })
    } catch (error) {
      logger.error("Function operation failed", { operationId: operation.id, error })
      throw error
    }
  }

  private async executeScript(script: string, parameters?: Record<string, any>): Promise<void> {
    // Execute custom script with parameters
    // This would typically involve running Node.js scripts or shell commands
    logger.info("Executing custom script", { script: script.substring(0, 100) })
  }

  private async runValidation(
    validationRules: ValidationRule[],
    execution: MigrationExecution,
  ): Promise<Array<{ ruleId: string; passed: boolean; result?: any; error?: string }>> {
    const results = []

    for (const rule of validationRules) {
      try {
        const result = await this.prisma.$queryRawUnsafe(rule.query)
        const passed = this.validateResult(result, rule)

        results.push({
          ruleId: rule.id,
          passed,
          result,
        })

        if (!passed && rule.critical) {
          throw new Error(`Critical validation failed: ${rule.name}`)
        }
      } catch (error) {
        results.push({
          ruleId: rule.id,
          passed: false,
          error: (error as Error).message,
        })

        if (rule.critical) {
          throw error
        }
      }
    }

    return results
  }

  private validateResult(result: any, rule: ValidationRule): boolean {
    switch (rule.type) {
      case "count":
        const count = Array.isArray(result) ? result.length : result
        return rule.expectedResult ? Math.abs(count - rule.expectedResult) <= (rule.tolerance || 0) : count > 0
      case "integrity":
        return Array.isArray(result) && result.length === 0 // No integrity violations
      case "constraint":
        return Array.isArray(result) && result.length === 0 // No constraint violations
      case "custom":
        return rule.expectedResult ? JSON.stringify(result) === JSON.stringify(rule.expectedResult) : !!result
      default:
        return !!result
    }
  }

  private async getAllTables(tenantId?: string): Promise<string[]> {
    try {
      const result = await this.prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      `
      return result.map((row) => row.table_name)
    } catch (error) {
      logger.error("Failed to get all tables:", error)
      return []
    }
  }

  private async getTableRowCount(table: string, tenantId?: string): Promise<number> {
    try {
      const result = await this.prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM "${table}"`)
      return Array.isArray(result) && result.length > 0 ? (result[0] as any).count : 0
    } catch (error) {
      logger.error(`Failed to get row count for table ${table}:`, error)
      return 0
    }
  }

  private async createFullBackup(tables: string[], tenantId?: string): Promise<Record<string, any>> {
    const backup: Record<string, any> = {}

    for (const table of tables) {
      try {
        const data = await this.prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`)
        backup[table] = data
      } catch (error) {
        logger.error(`Failed to backup table ${table}:`, error)
        backup[table] = []
      }
    }

    return backup
  }

  private async createSchemaBackup(tables: string[]): Promise<Record<string, any>> {
    const backup: Record<string, any> = {}

    for (const table of tables) {
      try {
        const schema = await this.prisma.$queryRawUnsafe(
          `
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_name = $1
          ORDER BY ordinal_position
        `,
          table,
        )
        backup[table] = { schema }
      } catch (error) {
        logger.error(`Failed to backup schema for table ${table}:`, error)
        backup[table] = { schema: [] }
      }
    }

    return backup
  }

  private async createDataBackup(tables: string[], tenantId?: string): Promise<Record<string, any>> {
    return this.createFullBackup(tables, tenantId)
  }

  private async createIncrementalBackup(tables: string[], tenantId?: string): Promise<Record<string, any>> {
    const backup: Record<string, any> = {}
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours

    for (const table of tables) {
      try {
        // Assuming tables have updated_at or created_at columns
        const data = await this.prisma.$queryRawUnsafe(
          `
          SELECT * FROM "${table}" 
          WHERE updated_at > $1 OR created_at > $1
        `,
          since,
        )
        backup[table] = data
      } catch (error) {
        // Fallback to full backup for this table
        const data = await this.prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`)
        backup[table] = data
      }
    }

    return backup
  }

  private async compressData(data: string): Promise<string> {
    try {
      const compressed = await gzip(Buffer.from(data, "utf8"))
      return compressed.toString("base64")
    } catch (error) {
      logger.error("Failed to compress data:", error)
      return data
    }
  }

  private async decompressData(data: string): Promise<string> {
    try {
      const buffer = Buffer.from(data, "base64")
      const decompressed = await gunzip(buffer)
      return decompressed.toString("utf8")
    } catch (error) {
      logger.error("Failed to decompress data:", error)
      return data
    }
  }

  private async encryptData(data: string): Promise<string> {
    try {
      const cipher = crypto.createCipher("aes-256-cbc", this.encryptionKey)
      let encrypted = cipher.update(data, "utf8", "hex")
      encrypted += cipher.final("hex")
      return encrypted
    } catch (error) {
      logger.error("Failed to encrypt data:", error)
      return data
    }
  }

  private async decryptData(data: string): Promise<string> {
    try {
      const decipher = crypto.createDecipher("aes-256-cbc", this.encryptionKey)
      let decrypted = decipher.update(data, "hex", "utf8")
      decrypted += decipher.final("utf8")
      return decrypted
    } catch (error) {
      logger.error("Failed to decrypt data:", error)
      return data
    }
  }

  private async validateBackupIntegrity(backup: BackupInfo, backupData: any): Promise<boolean> {
    try {
      // Validate checksum
      const dataString = JSON.stringify(backupData)
      const calculatedChecksum = crypto.createHash("sha256").update(dataString).digest("hex")

      if (calculatedChecksum !== backup.checksum) {
        logger.error("Backup checksum validation failed")
        return false
      }

      // Validate table structure
      for (const table of backup.tables) {
        if (!backupData[table]) {
          logger.error(`Missing table data in backup: ${table}`)
          return false
        }
      }

      return true
    } catch (error) {
      logger.error("Backup integrity validation failed:", error)
      return false
    }
  }

  private async restoreTable(
    table: string, 
    data: any[] | SchemaBackupData, 
    backupType: string, 
    tenantId?: string
  ): Promise<void> {
    try {
      // Validate and normalize data structure
      const restoreData = this.validateAndNormalizeRestoreData(data, backupType, table)
      
      if (backupType === "schema") {
        // Restore schema only
        if (restoreData.schema) {
          await this.restoreTableSchema(table, restoreData.schema)
        } else {
          throw new Error(`Schema data not found for table ${table}`)
        }
      } else {
        // Clear existing data
        await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`)

        // Insert backup data in batches
        if (restoreData.data && restoreData.data.length > 0) {
          const batchSize = this.options.batchSize!
          for (let i = 0; i < restoreData.data.length; i += batchSize) {
            const batch = restoreData.data.slice(i, i + batchSize)
            await this.insertBatch(table, batch)
          }
        } else {
          logger.warn(`No data to restore for table ${table}`)
        }
      }
    } catch (error) {
      logger.error(`Failed to restore table ${table}:`, error)
      throw error
    }
  }

  private validateAndNormalizeRestoreData(
    data: any[] | SchemaBackupData, 
    backupType: string, 
    table: string
  ): RestoreTableData {
    try {
      // Type guard to check if data is SchemaBackupData
      const isSchemaBackupData = (obj: any): obj is SchemaBackupData => {
        return obj && typeof obj === 'object' && Array.isArray(obj.schema)
      }

      // Type guard to check if data is array
      const isDataArray = (obj: any): obj is any[] => {
        return Array.isArray(obj)
      }

      if (backupType === "schema") {
        if (isSchemaBackupData(data)) {
          return { schema: data.schema }
        } else if (isDataArray(data)) {
          // Handle legacy format where schema might be stored directly as array
          logger.warn(`Legacy schema format detected for table ${table}, attempting to normalize`)
          return { schema: data as TableSchemaInfo[] }
        } else {
          throw new Error(`Invalid schema backup data format for table ${table}`)
        }
      } else {
        // For data backups (full, incremental, data)
        if (isDataArray(data)) {
          return { data }
        } else if (isSchemaBackupData(data)) {
          throw new Error(`Schema backup data provided for data restore operation on table ${table}`)
        } else {
          throw new Error(`Invalid data backup format for table ${table}`)
        }
      }
    } catch (error) {
      logger.error(`Failed to validate and normalize restore data for table ${table}:`, error)
      throw error
    }
  }

  private async restoreTableSchema(table: string, schema: TableSchemaInfo[]): Promise<void> {
    try {
      // Validate schema structure
      if (!Array.isArray(schema) || schema.length === 0) {
        throw new Error(`Invalid or empty schema data for table ${table}`)
      }

      // Validate each schema column
      for (const column of schema) {
        if (!column.column_name || !column.data_type) {
          throw new Error(`Invalid schema column data for table ${table}: missing column_name or data_type`)
        }
      }

      // This would involve recreating table structure
      // Implementation depends on your specific schema format
      // For now, we'll log the schema restoration attempt
      logger.info(`Restoring schema for table: ${table}`, {
        columns: schema.length,
        columnNames: schema.map(col => col.column_name)
      })

      // TODO: Implement actual schema restoration logic
      // This might involve:
      // 1. Dropping existing table (with backup)
      // 2. Recreating table with new schema
      // 3. Handling constraints, indexes, etc.
      
    } catch (error) {
      logger.error(`Failed to restore schema for table ${table}:`, error)
      throw error
    }
  }

  private async insertBatch(table: string, batch: any[]): Promise<void> {
    if (batch.length === 0) return

    try {
      // Generate INSERT statement
      const columns = Object.keys(batch[0])
      const placeholders = batch
        .map((_, index) => `(${columns.map((_, colIndex) => `$${index * columns.length + colIndex + 1}`).join(", ")})`)
        .join(", ")

      const values = batch.flatMap((row) => columns.map((col) => row[col]))

      const sql = `INSERT INTO "${table}" (${columns.map((col) => `"${col}"`).join(", ")}) VALUES ${placeholders}`

      await this.prisma.$executeRawUnsafe(sql, ...values)
    } catch (error) {
      logger.error(`Failed to insert batch into ${table}:`, error)
      throw error
    }
  }

  private async getSourceData(
    table: string,
    offset: number,
    limit: number,
    filter?: string,
    tenantId?: string,
  ): Promise<any[]> {
    try {
      let sql = `SELECT * FROM "${table}"`
      const params: any[] = []

      if (filter) {
        sql += ` WHERE ${filter}`
      }

      if (tenantId) {
        sql += filter ? ` AND tenant_id = $${params.length + 1}` : ` WHERE tenant_id = $${params.length + 1}`
        params.push(tenantId)
      }

      sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
      params.push(limit, offset)

      const result = await this.prisma.$queryRawUnsafe(sql, ...params)
      return Array.isArray(result) ? result : []
    } catch (error) {
      logger.error(`Failed to get source data from ${table}:`, error)
      return []
    }
  }

  private async transformBatch(data: any[], rule: DataTransformationRule): Promise<any[]> {
    const transformed = []

    for (const row of data) {
      try {
        const transformedRow: any = {}

        for (const [targetField, mapping] of Object.entries(rule.mapping)) {
          if (typeof mapping === "string") {
            transformedRow[targetField] = row[mapping]
          } else {
            transformedRow[targetField] = await this.applyTransformFunction(row, mapping)
          }
        }

        transformed.push(transformedRow)
      } catch (error) {
        logger.error("Failed to transform row:", error)
      }
    }

    return transformed
  }

  private async applyTransformFunction(row: any, func: TransformFunction): Promise<any> {
    switch (func.type) {
      case "javascript":
        return this.executeJavaScriptTransform(row, func.expression, func.parameters)
      case "sql":
        return this.executeSqlTransform(row, func.expression, func.parameters)
      case "regex":
        return this.executeRegexTransform(row, func.expression, func.parameters)
      case "lookup":
        return this.executeLookupTransform(row, func.expression, func.parameters)
      default:
        return row
    }
  }

  private executeJavaScriptTransform(row: any, expression: string, parameters?: Record<string, any>): any {
    try {
      // Create a safe execution context
      const context = { row, parameters, crypto, Date }
      const func = new Function("context", `with(context) { return ${expression} }`)
      return func(context)
    } catch (error) {
      logger.error("JavaScript transform failed:", error)
      return null
    }
  }

  private async executeSqlTransform(row: any, expression: string, parameters?: Record<string, any>): Promise<any> {
    try {
      const result = await this.prisma.$queryRawUnsafe(expression, ...Object.values(parameters || {}))
      return Array.isArray(result) && result.length > 0 ? result[0] : null
    } catch (error) {
      logger.error("SQL transform failed:", error)
      return null
    }
  }

  private executeRegexTransform(row: any, expression: string, parameters?: Record<string, any>): any {
    try {
      const regex = new RegExp(expression, parameters?.flags || "g")
      const value = parameters?.field ? row[parameters.field] : row
      return typeof value === "string" ? value.replace(regex, parameters?.replacement || "") : value
    } catch (error) {
      logger.error("Regex transform failed:", error)
      return null
    }
  }

  private executeLookupTransform(row: any, expression: string, parameters?: Record<string, any>): any {
    try {
      const mapping = parameters?.mapping || {}
      const value = parameters?.field ? row[parameters.field] : row
      return mapping[value] || parameters?.default || value
    } catch (error) {
      logger.error("Lookup transform failed:", error)
      return null
    }
  }

  private async insertTransformedData(table: string, data: any[], tenantId?: string): Promise<void> {
    if (data.length === 0) return

    const batchSize = this.options.batchSize!
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize)
      await this.insertBatch(table, batch)
    }
  }

  private async cleanupOldBackups(): Promise<void> {
    try {
      const now = new Date()
      const expiredBackups = Array.from(this.backups.values()).filter(
        (backup) => backup.expiresAt && backup.expiresAt < now,
      )

      for (const backup of expiredBackups) {
        try {
          // Delete backup file
          await fs.unlink(backup.metadata.path as string)

          // Remove from memory
          this.backups.delete(backup.id)

          logger.info("Expired backup cleaned up", { backupId: backup.id })
        } catch (error) {
          logger.error("Failed to cleanup backup:", error)
        }
      }
    } catch (error) {
      logger.error("Failed to cleanup old backups:", error)
    }
  }

  private async cleanupOldExecutions(): Promise<void> {
    try {
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days ago

      for (const [planId, executions] of this.migrationHistory.entries()) {
        const recentExecutions = executions.filter((exec) => !exec.completedAt || exec.completedAt > cutoffDate)

        if (recentExecutions.length !== executions.length) {
          this.migrationHistory.set(planId, recentExecutions)
          logger.info("Old executions cleaned up", {
            planId,
            removed: executions.length - recentExecutions.length,
          })
        }
      }
    } catch (error) {
      logger.error("Failed to cleanup old executions:", error)
    }
  }

  /**
   * Get migration plan by ID
   */
  async getMigrationPlan(planId: string): Promise<MigrationPlan | null> {
    return this.migrationPlans.get(planId) || null
  }

  /**
   * List all migration plans
   */
  async listMigrationPlans(tenantId?: string): Promise<MigrationPlan[]> {
    const plans = Array.from(this.migrationPlans.values())
    return tenantId ? plans.filter((plan) => !plan.createdBy || plan.createdBy === tenantId) : plans
  }

  /**
   * Get migration execution by ID
   */
  async getMigrationExecution(executionId: string): Promise<MigrationExecution | null> {
    return this.activeExecutions.get(executionId) || null
  }

  /**
   * List transformation rules
   */
  async listTransformationRules(): Promise<DataTransformationRule[]> {
    return Array.from(this.transformationRules.values())
  }

  /**
   * Add custom transformation rule
   */
  async addTransformationRule(rule: Omit<DataTransformationRule, "id">): Promise<DataTransformationRule> {
    const newRule: DataTransformationRule = {
      ...rule,
      id: crypto.randomUUID(),
    }

    this.transformationRules.set(newRule.id, newRule)
    return newRule
  }

  /**
   * List backups
   */
  async listBackups(tenantId?: string): Promise<BackupInfo[]> {
    const backups = Array.from(this.backups.values())
    return tenantId ? backups.filter((backup) => backup.tenantId === tenantId) : backups
  }

  /**
   * Delete backup
   */
  async deleteBackup(backupId: string): Promise<void> {
    const backup = this.backups.get(backupId)
    if (!backup) {
      throw ApiError.notFound("Backup not found")
    }

    try {
      await fs.unlink(backup.metadata.path as string)
      this.backups.delete(backupId)
      logger.info("Backup deleted", { backupId })
    } catch (error) {
      logger.error("Failed to delete backup:", error)
      throw error
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    try {
      await this.cleanupOldBackups()
      await this.cleanupOldExecutions()
      await this.prisma.$disconnect()
      logger.info("Migration service cleanup completed")
    } catch (error) {
      logger.error("Failed to cleanup migration service:", error)
    }
  }
}

export default MigrationService
