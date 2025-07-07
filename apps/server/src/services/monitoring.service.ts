import os from "os"
import { exec } from "child_process"
import { promisify } from "util"
import { prisma } from "@cms-platform/database/client"
import { logger } from "../utils/logger"
import { cacheService } from "./cache.service"

const execAsync = promisify(exec)

interface SystemMetrics {
  cpu: {
    user: number
    system: number
    loadAverage: number[]
    usage: number
  }
  memory: {
    rss: number
    heapTotal: number
    heapUsed: number
    external: number
    arrayBuffers: number
    systemTotal: number
    systemFree: number
    systemUsed: number
    systemUsagePercent: number
  }
  process: {
    pid: number
    uptime: number
    uptimeFormatted: string
    version: string
    platform: string
    arch: string
  }
}

interface DatabaseMetrics {
  status: string
  version: string
  uptime: number
  connections: {
    active: number
    idle: number
    waiting: number
    max: number
  }
  performance: {
    avgQueryTime: number
    slowQueries: number
    totalQueries: number
    cacheHitRatio: number
  }
  storage: {
    totalSize: number
    indexSize: number
    tableCount: number
  }
  tables: Array<{
    name: string
    rowCount: number
    size: number
    indexSize: number
    lastAnalyzed: Date | null
  }>
}

interface ApiMetrics {
  requestsPerMinute: number
  requestsPerHour: number
  averageResponseTime: number
  errorRate: number
  slowestEndpoints: Array<{
    path: string
    method: string
    avgResponseTime: number
    requestCount: number
  }>
  statusCodes: Record<string, number>
  endpoints: Record<
    string,
    {
      count: number
      avgResponseTime: number
      errorCount: number
    }
  >
}

/**
 * Enhanced service for monitoring system health and performance
 */
export class MonitoringService {
  private metricsCache: Map<string, { data: any; timestamp: number }> = new Map()
  private readonly CACHE_TTL = 30000 // 30 seconds
  private apiMetricsBuffer: Array<{
    path: string
    method: string
    statusCode: number
    responseTime: number
    userId?: string
    tenantId?: string
    timestamp: Date
  }> = []

  /**
   * Get comprehensive system health status
   */
  public async getHealthStatus(): Promise<{
    status: "healthy" | "degraded" | "unhealthy"
    timestamp: string
    version: string
    environment: string
    system: any
    services: {
      database: any
      redis?: any
      elasticsearch?: any
    }
    disk: any
    alerts: string[]
  }> {
    try {
      const [systemInfo, databaseStatus, redisStatus, elasticsearchStatus, diskSpace] = await Promise.all([
        this.getSystemInfo(),
        this.getDatabaseStatus(),
        this.getRedisStatus(),
        this.getElasticsearchStatus(),
        this.getDiskSpace(),
      ])

      // Determine overall health status
      const alerts: string[] = []
      let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy"

      // Check system resources
      if (systemInfo.memory.usedPercentage > 90) {
        alerts.push("High memory usage detected")
        overallStatus = "degraded"
      }

      if (systemInfo.loadAverage[0] > systemInfo.cpus * 2) {
        alerts.push("High CPU load detected")
        overallStatus = "degraded"
      }

      // Check database
      if (databaseStatus.status !== "connected") {
        alerts.push("Database connection issues")
        overallStatus = "unhealthy"
      }

      // Check disk space
      if (diskSpace.usedPercentage && Number.parseInt(diskSpace.usedPercentage) > 85) {
        alerts.push("Low disk space")
        overallStatus = "degraded"
      }

      return {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || "unknown",
        environment: process.env.NODE_ENV || "unknown",
        system: systemInfo,
        services: {
          database: databaseStatus,
          ...(redisStatus && { redis: redisStatus }),
          ...(elasticsearchStatus && { elasticsearch: elasticsearchStatus }),
        },
        disk: diskSpace,
        alerts,
      }
    } catch (error) {
      logger.error("Error getting health status:", error)
      return {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        version: "unknown",
        environment: "unknown",
        system: null,
        services: { database: null },
        disk: null,
        alerts: [`Health check failed: ${(error as Error).message}`],
      }
    }
  }

  /**
   * Get comprehensive system metrics
   */
  public async getMetrics(): Promise<{
    timestamp: string
    system: SystemMetrics
    database: DatabaseMetrics
    redis?: any
    elasticsearch?: any
    application: any
  }> {
    try {
      const cacheKey = "system_metrics"
      const cached = this.getFromCache(cacheKey)
      if (cached) {
        return cached
      }

      const [systemMetrics, databaseMetrics, redisMetrics, elasticsearchMetrics, applicationMetrics] =
        await Promise.all([
          this.getSystemMetrics(),
          this.getDatabaseMetrics(),
          this.getRedisMetrics(),
          this.getElasticsearchMetrics(),
          this.getApplicationMetrics(),
        ])

      const result = {
        timestamp: new Date().toISOString(),
        system: systemMetrics,
        database: databaseMetrics,
        ...(redisMetrics && { redis: redisMetrics }),
        ...(elasticsearchMetrics && { elasticsearch: elasticsearchMetrics }),
        application: applicationMetrics,
      }

      this.setCache(cacheKey, result)
      return result
    } catch (error) {
      logger.error("Error getting metrics:", error)
      throw error
    }
  }

  /**
   * Get enhanced system information
   */
  private async getSystemInfo(): Promise<any> {
    const uptime = os.uptime()
    const uptimeFormatted = this.formatUptime(uptime)
    const cpuUsage = await this.getCpuUsage()

    return {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || "unknown",
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
        usedPercentage: Number.parseFloat((((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(2)),
      },
      uptime: uptimeFormatted,
      uptimeSeconds: uptime,
      loadAverage: os.loadavg(),
      cpuUsage,
      hostname: os.hostname(),
      networkInterfaces: this.getNetworkInterfaces(),
    }
  }

  /**
   * Get enhanced database status with PostgreSQL-specific metrics
   */
  private async getDatabaseStatus(): Promise<any> {
    try {
      // Test database connection
      await prisma.$queryRaw`SELECT 1`

      // Get PostgreSQL version and basic info
      const [versionResult, uptimeResult, connectionStats, databaseSize] = await Promise.all([
        prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`,
        prisma.$queryRaw<
          Array<{ uptime: string }>
        >`SELECT EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time())) as uptime`,
        this.getConnectionStats(),
        this.getDatabaseSize(),
      ])

      const version = versionResult[0]?.version || "unknown"
      const uptime = Number.parseFloat(uptimeResult[0]?.uptime || "0")

      return {
        status: "connected",
        type: "postgresql",
        version: version.split(" ")[1] || "unknown",
        fullVersion: version,
        uptime: this.formatUptime(uptime),
        uptimeSeconds: uptime,
        connections: connectionStats,
        size: databaseSize,
        performance: await this.getDatabasePerformanceMetrics(),
      }
    } catch (error) {
      logger.error("Error getting database status:", error)
      return {
        status: "error",
        error: (error as Error).message,
      }
    }
  }

  /**
   * Get PostgreSQL connection statistics
   */
  private async getConnectionStats(): Promise<any> {
    try {
      const stats = await prisma.$queryRaw<
        Array<{
          total_connections: number
          active_connections: number
          idle_connections: number
          waiting_connections: number
          max_connections: number
        }>
      >`
        SELECT 
          (SELECT count(*) FROM pg_stat_activity) as total_connections,
          (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
          (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle') as idle_connections,
          (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type IS NOT NULL) as waiting_connections,
          (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_connections
      `

      const result = stats[0]
      return {
        total: result.total_connections,
        active: result.active_connections,
        idle: result.idle_connections,
        waiting: result.waiting_connections,
        max: result.max_connections,
        utilization: Number.parseFloat(((result.total_connections / result.max_connections) * 100).toFixed(2)),
      }
    } catch (error) {
      logger.error("Error getting connection stats:", error)
      return {
        error: (error as Error).message,
      }
    }
  }

  /**
   * Get database size information
   */
  private async getDatabaseSize(): Promise<any> {
    try {
      const sizeStats = await prisma.$queryRaw<
        Array<{
          database_size: number
          table_count: number
          index_size: number
        }>
      >`
        SELECT 
          pg_database_size(current_database()) as database_size,
          (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') as table_count,
          (SELECT COALESCE(sum(pg_total_relation_size(indexrelid)), 0) FROM pg_index) as index_size
      `

      const result = sizeStats[0]
      return {
        total: result.database_size,
        tables: result.table_count,
        indexes: result.index_size,
        data: result.database_size - result.index_size,
        formatted: {
          total: this.formatBytes(result.database_size),
          indexes: this.formatBytes(result.index_size),
          data: this.formatBytes(result.database_size - result.index_size),
        },
      }
    } catch (error) {
      logger.error("Error getting database size:", error)
      return {
        error: (error as Error).message,
      }
    }
  }

  /**
   * Get database performance metrics
   */
  private async getDatabasePerformanceMetrics(): Promise<any> {
    try {
      const [queryStats, cacheStats, lockStats] = await Promise.all([
        this.getQueryStats(),
        this.getCacheStats(),
        this.getLockStats(),
      ])

      return {
        queries: queryStats,
        cache: cacheStats,
        locks: lockStats,
      }
    } catch (error) {
      logger.error("Error getting database performance metrics:", error)
      return {
        error: (error as Error).message,
      }
    }
  }

  /**
   * Get query statistics
   */
  private async getQueryStats(): Promise<any> {
    try {
      const stats = await prisma.$queryRaw<
        Array<{
          total_queries: number
          avg_query_time: number
          slow_queries: number
        }>
      >`
        SELECT 
          sum(calls) as total_queries,
          avg(mean_exec_time) as avg_query_time,
          sum(CASE WHEN mean_exec_time > 1000 THEN calls ELSE 0 END) as slow_queries
        FROM pg_stat_statements
        WHERE pg_stat_statements IS NOT NULL
      `

      const result = stats[0] || { total_queries: 0, avg_query_time: 0, slow_queries: 0 }
      return {
        total: result.total_queries || 0,
        avgTime: Number.parseFloat((result.avg_query_time || 0).toFixed(2)),
        slowQueries: result.slow_queries || 0,
      }
    } catch (error) {
      // pg_stat_statements might not be enabled
      return {
        total: 0,
        avgTime: 0,
        slowQueries: 0,
        note: "pg_stat_statements extension not available",
      }
    }
  }

  /**
   * Get cache statistics
   */
  private async getCacheStats(): Promise<any> {
    try {
      const stats = await prisma.$queryRaw<
        Array<{
          cache_hit_ratio: number
          shared_buffers: string
          effective_cache_size: string
        }>
      >`
        SELECT 
          round(
            sum(blks_hit) * 100.0 / nullif(sum(blks_hit) + sum(blks_read), 0), 2
          ) as cache_hit_ratio,
          (SELECT setting FROM pg_settings WHERE name = 'shared_buffers') as shared_buffers,
          (SELECT setting FROM pg_settings WHERE name = 'effective_cache_size') as effective_cache_size
        FROM pg_stat_database
      `

      const result = stats[0]
      return {
        hitRatio: result.cache_hit_ratio || 0,
        sharedBuffers: result.shared_buffers,
        effectiveCacheSize: result.effective_cache_size,
      }
    } catch (error) {
      logger.error("Error getting cache stats:", error)
      return {
        error: (error as Error).message,
      }
    }
  }

  /**
   * Get lock statistics
   */
  private async getLockStats(): Promise<any> {
    try {
      const stats = await prisma.$queryRaw<
        Array<{
          total_locks: number
          waiting_locks: number
          deadlocks: number
        }>
      >`
        SELECT 
          count(*) as total_locks,
          count(*) FILTER (WHERE NOT granted) as waiting_locks,
          (SELECT sum(deadlocks) FROM pg_stat_database) as deadlocks
        FROM pg_locks
      `

      const result = stats[0]
      return {
        total: result.total_locks || 0,
        waiting: result.waiting_locks || 0,
        deadlocks: result.deadlocks || 0,
      }
    } catch (error) {
      logger.error("Error getting lock stats:", error)
      return {
        error: (error as Error).message,
      }
    }
  }

  /**
   * Get Redis metrics using existing cache service
   */
  private async getRedisMetrics(): Promise<any> {
    try {
      // Use the existing cache service to get Redis-like metrics
      const cacheStats = cacheService.getStats()
      const cacheInfo = await cacheService.getInfo()
      
      return {
        connected: true,
        type: 'in-memory-cache',
        stats: cacheStats,
        info: cacheInfo,
        performance: {
          hitRate: cacheStats.hitRate,
          memoryUsage: cacheStats.memoryUsage,
          totalOperations: cacheStats.hits + cacheStats.misses + cacheStats.sets + cacheStats.deletes
        }
      }
    } catch (error) {
      logger.error('Error getting Redis metrics:', error)
      return {
        connected: false,
        error: (error as Error).message
      }
    }
  }

  /**
   * Get Elasticsearch metrics using existing service
   */
  private async getElasticsearchMetrics(): Promise<any> {
    try {
      // Import the elasticsearch service
      const { healthCheck, getIndexStats } = await import('./elasticsearch.service')
      
      const health = await healthCheck()
      
      if (health.status === 'unhealthy') {
        return {
          connected: false,
          error: health.error
        }
      }
      
      // Get stats for main indices
      const indices = ['content', 'users', 'media']
      const indexStats: Record<string, any> = {}
      
      for (const index of indices) {
        try {
          indexStats[index] = await getIndexStats(index)
        } catch (error) {
          indexStats[index] = { error: (error as Error).message }
        }
      }
      
      return {
        connected: true,
        cluster: health.cluster,
        version: health.version,
        indices: indexStats
      }
    } catch (error) {
      logger.error('Error getting Elasticsearch metrics:', error)
      return {
        connected: false,
        error: (error as Error).message
      }
    }
  }

  /**
   * Get Redis status (if available)
   */
  private async getRedisStatus(): Promise<any> {
    try {
      // Use the cache service for Redis-like status
      const cacheStats = cacheService.getStats()
      return {
        status: "connected",
        type: "in-memory-cache",
        hitRate: cacheStats.hitRate,
        memoryUsage: cacheStats.memoryUsage,
        size: cacheStats.size
      }
    } catch (error) {
      logger.error("Error getting Redis status:", error)
      return {
        status: "error",
        error: (error as Error).message,
      }
    }
  }

  /**
   * Get Elasticsearch status (if available)
   */
  private async getElasticsearchStatus(): Promise<any> {
    try {
      // Import and use the elasticsearch service
      const { healthCheck } = await import('./elasticsearch.service')
      return await healthCheck()
    } catch (error) {
      logger.error("Error getting Elasticsearch status:", error)
      return {
        status: "error",
        error: (error as Error).message,
      }
    }
  }

  /**
   * Get disk space information
   */
  private async getDiskSpace(): Promise<any> {
    try {
      let command = "df -h / | tail -1"

      // Use different command for Windows
      if (os.platform() === "win32") {
        command = "wmic logicaldisk get size,freespace,caption"
      }

      const { stdout } = await execAsync(command)

      if (os.platform() === "win32") {
        // Parse Windows output
        const lines = stdout.trim().split("\n")
        if (lines.length > 1) {
          const data = lines[1].trim().split(/\s+/)
          const free = Number.parseInt(data[1])
          const total = Number.parseInt(data[2])
          const used = total - free

          return {
            filesystem: data[0],
            size: this.formatBytes(total),
            used: this.formatBytes(used),
            available: this.formatBytes(free),
            usedPercentage: `${Math.round((used / total) * 100)}%`,
            mountPoint: data[0],
          }
        }
      } else {
        // Parse Unix/Linux output
        const parts = stdout.trim().split(/\s+/)
        return {
          filesystem: parts[0],
          size: parts[1],
          used: parts[2],
          available: parts[3],
          usedPercentage: parts[4],
          mountPoint: parts[5],
        }
      }

      return {
        error: "Could not parse disk space information",
      }
    } catch (error) {
      logger.warn("Could not get disk space info:", error)
      return {
        error: "Could not retrieve disk space information",
      }
    }
  }

  /**
   * Get enhanced system metrics
   */
  private async getSystemMetrics(): Promise<SystemMetrics> {
    const cpuUsage = process.cpuUsage()
    const memoryUsage = process.memoryUsage()
    const systemCpuUsage = await this.getCpuUsage()

    return {
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
        loadAverage: os.loadavg(),
        usage: systemCpuUsage,
      },
      memory: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external,
        arrayBuffers: memoryUsage.arrayBuffers,
        systemTotal: os.totalmem(),
        systemFree: os.freemem(),
        systemUsed: os.totalmem() - os.freemem(),
        systemUsagePercent: Number.parseFloat((((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(2)),
      },
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        uptimeFormatted: this.formatUptime(process.uptime()),
        version: process.version,
        platform: os.platform(),
        arch: os.arch(),
      },
    }
  }

  /**
   * Get database metrics with table statistics
   */
  private async getDatabaseMetrics(): Promise<DatabaseMetrics> {
    try {
      const [basicStats, tableStats, performanceStats] = await Promise.all([
        this.getDatabaseStatus(),
        this.getTableStatistics(),
        this.getDatabasePerformanceMetrics(),
      ])

      return {
        status: basicStats.status,
        version: basicStats.version,
        uptime: basicStats.uptimeSeconds,
        connections: basicStats.connections,
        performance: {
          avgQueryTime: performanceStats.queries?.avgTime || 0,
          slowQueries: performanceStats.queries?.slowQueries || 0,
          totalQueries: performanceStats.queries?.total || 0,
          cacheHitRatio: performanceStats.cache?.hitRatio || 0,
        },
        storage: {
          totalSize: basicStats.size?.total || 0,
          indexSize: basicStats.size?.indexes || 0,
          tableCount: basicStats.size?.tables || 0,
        },
        tables: tableStats,
      }
    } catch (error) {
      logger.error("Error getting database metrics:", error)
      throw error
    }
  }

  /**
   * Get table statistics
   */
  private async getTableStatistics(): Promise<
    Array<{
      name: string
      rowCount: number
      size: number
      indexSize: number
      lastAnalyzed: Date | null
    }>
  > {
    try {
      const stats = await prisma.$queryRaw<
        Array<{
          table_name: string
          row_count: number
          table_size: number
          index_size: number
          last_analyzed: Date | null
        }>
      >`
        SELECT 
          schemaname||'.'||tablename as table_name,
          n_tup_ins + n_tup_upd + n_tup_del as row_count,
          pg_total_relation_size(schemaname||'.'||tablename) as table_size,
          pg_indexes_size(schemaname||'.'||tablename) as index_size,
          last_analyze as last_analyzed
        FROM pg_stat_user_tables
        ORDER BY table_size DESC
        LIMIT 20
      `

      return stats.map((stat) => ({
        name: stat.table_name,
        rowCount: stat.row_count || 0,
        size: stat.table_size || 0,
        indexSize: stat.index_size || 0,
        lastAnalyzed: stat.last_analyzed,
      }))
    } catch (error) {
      logger.error("Error getting table statistics:", error)
      return []
    }
  }

  /**
   * Get application metrics
   */
  public async getApplicationMetrics(): Promise<{
    models: Record<string, number>
    api: ApiMetrics
    tenants: {
      total: number
      active: number
      byPlan: Record<string, number>
    }
    users: {
      total: number
      active: number
      byRole: Record<string, number>
    }
    jobs: {
      total: number
      byStatus: Record<string, number>
      avgExecutionTime: number
    }
    workflows: {
      total: number
      activeInstances: number
      byStatus: Record<string, number>
    }
  }> {
    try {
      const [modelCounts, apiMetrics, tenantStats, userStats, jobStats, workflowStats] = await Promise.all([
        this.getModelCounts(),
        this.getApiMetrics(),
        this.getTenantStatistics(),
        this.getUserStatistics(),
        this.getJobStatistics(),
        this.getWorkflowStatistics(),
      ])

      return {
        models: modelCounts,
        api: apiMetrics,
        tenants: tenantStats,
        users: userStats,
        jobs: jobStats,
        workflows: workflowStats,
      }
    } catch (error) {
      logger.error("Error getting application metrics:", error)
      throw error
    }
  }

  /**
   * Get model counts from database
   */
  private async getModelCounts(): Promise<Record<string, number>> {
    try {
      const [tenantCount, userCount, jobCount, workflowCount, workflowInstanceCount, auditLogCount, sessionCount] =
        await Promise.all([
          prisma.tenant.count(),
          prisma.user.count(),
          prisma.job.count(),
          prisma.workflow.count(),
          prisma.workflowInstance.count(),
          prisma.auditLog.count(),
          prisma.session.count(),
        ])

      return {
        tenants: tenantCount,
        users: userCount,
        jobs: jobCount,
        workflows: workflowCount,
        workflowInstances: workflowInstanceCount,
        auditLogs: auditLogCount,
        sessions: sessionCount,
      }
    } catch (error) {
      logger.error("Error getting model counts:", error)
      return {}
    }
  }

  /**
   * Get API metrics from buffer
   */
  private async getApiMetrics(): Promise<ApiMetrics> {
    try {
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000)

      // Filter metrics from buffer
      const hourlyMetrics = this.apiMetricsBuffer.filter((m) => m.timestamp >= oneHourAgo)
      const minutelyMetrics = this.apiMetricsBuffer.filter((m) => m.timestamp >= oneMinuteAgo)

      // Calculate metrics
      const totalRequests = hourlyMetrics.length
      const totalErrors = hourlyMetrics.filter((m) => m.statusCode >= 400).length
      const totalResponseTime = hourlyMetrics.reduce((sum, m) => sum + m.responseTime, 0)

      // Group by endpoint
      const endpointStats: Record<string, { count: number; totalTime: number; errorCount: number }> = {}
      const statusCodes: Record<string, number> = {}

      hourlyMetrics.forEach((metric) => {
        const key = `${metric.method} ${metric.path}`

        if (!endpointStats[key]) {
          endpointStats[key] = { count: 0, totalTime: 0, errorCount: 0 }
        }

        endpointStats[key].count++
        endpointStats[key].totalTime += metric.responseTime

        if (metric.statusCode >= 400) {
          endpointStats[key].errorCount++
        }

        const statusKey = metric.statusCode.toString()
        statusCodes[statusKey] = (statusCodes[statusKey] || 0) + 1
      })

      // Get slowest endpoints
      const slowestEndpoints = Object.entries(endpointStats)
        .map(([endpoint, stats]) => {
          const [method, path] = endpoint.split(" ", 2)
          return {
            path,
            method,
            avgResponseTime: stats.totalTime / stats.count,
            requestCount: stats.count,
          }
        })
        .sort((a, b) => b.avgResponseTime - a.avgResponseTime)
        .slice(0, 10)

      // Convert endpoint stats
      const endpoints: Record<string, { count: number; avgResponseTime: number; errorCount: number }> = {}
      Object.entries(endpointStats).forEach(([endpoint, stats]) => {
        endpoints[endpoint] = {
          count: stats.count,
          avgResponseTime: stats.totalTime / stats.count,
          errorCount: stats.errorCount,
        }
      })

      return {
        requestsPerMinute: minutelyMetrics.length,
        requestsPerHour: totalRequests,
        averageResponseTime: totalRequests > 0 ? totalResponseTime / totalRequests : 0,
        errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
        slowestEndpoints,
        statusCodes,
        endpoints,
      }
    } catch (error) {
      logger.error("Error getting API metrics:", error)
      return {
        requestsPerMinute: 0,
        requestsPerHour: 0,
        averageResponseTime: 0,
        errorRate: 0,
        slowestEndpoints: [],
        statusCodes: {},
        endpoints: {},
      }
    }
  }

  /**
   * Get tenant statistics
   */
  private async getTenantStatistics(): Promise<{
    total: number
    active: number
    byPlan: Record<string, number>
  }> {
    try {
      const [total, active, planStats] = await Promise.all([
        prisma.tenant.count(),
        prisma.tenant.count({ where: { status: "ACTIVE" } }),
        prisma.tenant.groupBy({
          by: ["plan"],
          _count: { plan: true },
        }),
      ])

      const byPlan = planStats.reduce(
        (acc, stat) => {
          acc[stat.plan] = stat._count.plan
          return acc
        },
        {} as Record<string, number>,
      )

      return { total, active, byPlan }
    } catch (error) {
      logger.error("Error getting tenant statistics:", error)
      return { total: 0, active: 0, byPlan: {} }
    }
  }

  /**
   * Get user statistics
   */
  private async getUserStatistics(): Promise<{
    total: number
    active: number
    byRole: Record<string, number>
  }> {
    try {
      const [total, active, roleStats] = await Promise.all([
        prisma.user.count({ where: { deletedAt: null } }),
        prisma.user.count({ where: { status: "ACTIVE", deletedAt: null } }),
        prisma.user.groupBy({
          by: ["role"],
          where: { deletedAt: null },
          _count: { role: true },
        }),
      ])

      const byRole = roleStats.reduce(
        (acc, stat) => {
          acc[stat.role] = stat._count.role
          return acc
        },
        {} as Record<string, number>,
      )

      return { total, active, byRole }
    } catch (error) {
      logger.error("Error getting user statistics:", error)
      return { total: 0, active: 0, byRole: {} }
    }
  }

  /**
   * Get job statistics
   */
  private async getJobStatistics(): Promise<{
    total: number
    byStatus: Record<string, number>
    avgExecutionTime: number
  }> {
    try {
      const [total, statusStats, avgTime] = await Promise.all([
        prisma.job.count(),
        prisma.job.groupBy({
          by: ["status"],
          _count: { status: true },
        }),
        prisma.job.aggregate({
          _avg: { executionTime: true },
          where: { executionTime: { not: null } },
        }),
      ])

      const byStatus = statusStats.reduce(
        (acc, stat) => {
          acc[stat.status] = stat._count.status
          return acc
        },
        {} as Record<string, number>,
      )

      return {
        total,
        byStatus,
        avgExecutionTime: avgTime._avg.executionTime || 0,
      }
    } catch (error) {
      logger.error("Error getting job statistics:", error)
      return { total: 0, byStatus: {}, avgExecutionTime: 0 }
    }
  }

  /**
   * Get workflow statistics
   */
  private async getWorkflowStatistics(): Promise<{
    total: number
    activeInstances: number
    byStatus: Record<string, number>
  }> {
    try {
      const [total, activeInstances, statusStats] = await Promise.all([
        prisma.workflow.count(),
        prisma.workflowInstance.count({
          where: { status: { in: ["PENDING", "RUNNING"] } },
        }),
        prisma.workflowInstance.groupBy({
          by: ["status"],
          _count: { status: true },
        }),
      ])

      const byStatus = statusStats.reduce(
        (acc, stat) => {
          acc[stat.status] = stat._count.status
          return acc
        },
        {} as Record<string, number>,
      )

      return { total, activeInstances, byStatus }
    } catch (error) {
      logger.error("Error getting workflow statistics:", error)
      return { total: 0, activeInstances: 0, byStatus: {} }
    }
  }

  /**
   * Record API request metrics
   */
  public async recordApiMetrics(data: {
    path: string
    method: string
    statusCode: number
    responseTime: number
    userId?: string
    tenantId?: string
  }): Promise<void> {
    try {
      // Add to buffer
      this.apiMetricsBuffer.push({
        ...data,
        timestamp: new Date(),
      })

      // Keep buffer size manageable (last 1000 requests)
      if (this.apiMetricsBuffer.length > 1000) {
        this.apiMetricsBuffer = this.apiMetricsBuffer.slice(-1000)
      }

      // Clean old entries (older than 1 hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      this.apiMetricsBuffer = this.apiMetricsBuffer.filter((m) => m.timestamp >= oneHourAgo)

      // Log slow requests
      if (data.responseTime > 5000) {
        logger.warn(`Slow API request detected: ${data.method} ${data.path} - ${data.responseTime}ms`)
      }
    } catch (error) {
      logger.error("Error recording API metrics:", error)
    }
  }

  /**
   * Check if the system is healthy
   */
  public async isHealthy(): Promise<boolean> {
    try {
      const health = await this.getHealthStatus()
      return health.status === "healthy"
    } catch (error) {
      logger.error("Health check failed:", error)
      return false
    }
  }

  /**
   * Get detailed health check for specific component
   */
  public async getComponentHealth(component: "database" | "system" | "disk"): Promise<{
    healthy: boolean
    details: any
    alerts: string[]
  }> {
    const alerts: string[] = []
    let healthy = true
    let details: any = {}

    try {
      switch (component) {
        case "database":
          details = await this.getDatabaseStatus()
          if (details.status !== "connected") {
            healthy = false
            alerts.push("Database is not connected")
          }
          if (details.connections?.utilization > 80) {
            alerts.push("High database connection utilization")
          }
          break

        case "system":
          details = await this.getSystemInfo()
          if (details.memory.usedPercentage > 90) {
            healthy = false
            alerts.push("Critical memory usage")
          }
          if (details.loadAverage[0] > details.cpus * 2) {
            alerts.push("High CPU load")
          }
          break

        case "disk":
          details = await this.getDiskSpace()
          if (details.usedPercentage && Number.parseInt(details.usedPercentage) > 90) {
            healthy = false
            alerts.push("Critical disk space")
          }
          break
      }
    } catch (error) {
      healthy = false
      alerts.push(`Error checking ${component}: ${(error as Error).message}`)
    }

    return { healthy, details, alerts }
  }

  // Utility methods

  private async getCpuUsage(): Promise<number> {
    return new Promise((resolve) => {
      const startUsage = process.cpuUsage()
      const startTime = process.hrtime()

      setTimeout(() => {
        const currentUsage = process.cpuUsage(startUsage)
        const currentTime = process.hrtime(startTime)
        const totalTime = currentTime[0] * 1000000 + currentTime[1] / 1000
        const cpuPercent = ((currentUsage.user + currentUsage.system) / totalTime) * 100
        resolve(Math.round(cpuPercent * 100) / 100)
      }, 100)
    })
  }

  private getNetworkInterfaces(): any {
    const interfaces = os.networkInterfaces()
    const result: any = {}

    Object.keys(interfaces).forEach((name) => {
      const iface = interfaces[name]
      if (iface) {
        result[name] = iface
          .filter((details) => !details.internal)
          .map((details) => ({
            address: details.address,
            family: details.family,
            mac: details.mac,
          }))
      }
    })

    return result
  }

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / (3600 * 24))
    const hours = Math.floor((seconds % (3600 * 24)) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const remainingSeconds = Math.floor(seconds % 60)

    const parts = []
    if (days > 0) parts.push(`${days}d`)
    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0) parts.push(`${minutes}m`)
    if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds}s`)

    return parts.join(" ")
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes"

    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  private getFromCache(key: string): any {
    const cached = this.metricsCache.get(key)
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data
    }
    return null
  }

  private setCache(key: string, data: any): void {
    this.metricsCache.set(key, {
      data,
      timestamp: Date.now(),
    })
  }
}

// Export singleton instance
export const monitoringService = new MonitoringService()
