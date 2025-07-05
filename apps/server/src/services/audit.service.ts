import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"

export interface AuditLog {
  id: string
  action: string
  entityType: string
  entityId: string
  userId?: string
  userEmail?: string
  userName?: string
  tenantId?: string
  details?: Record<string, any>
  changes?: {
    before?: Record<string, any>
    after?: Record<string, any>
    fields?: string[]
  }
  metadata?: {
    ipAddress?: string
    userAgent?: string
    sessionId?: string
    requestId?: string
    source?: string
    tags?: string[]
  }
  severity: "low" | "medium" | "high" | "critical"
  category: "authentication" | "authorization" | "data" | "system" | "security" | "compliance"
  timestamp: Date
  expiresAt?: Date
}

export interface AuditQuery {
  action?: string
  entityType?: string
  entityId?: string
  userId?: string
  userEmail?: string
  tenantId?: string
  severity?: string[]
  category?: string[]
  startDate?: Date
  endDate?: Date
  search?: string
  tags?: string[]
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: "asc" | "desc"
}

export interface AuditStats {
  totalLogs: number
  logsByAction: Record<string, number>
  logsByEntityType: Record<string, number>
  logsByUser: Record<string, number>
  logsBySeverity: Record<string, number>
  logsByCategory: Record<string, number>
  logsOverTime: Array<{ date: string; count: number }>
  topUsers: Array<{ userId: string; userName?: string; count: number }>
  recentActivity: AuditLog[]
}

export interface ComplianceReport {
  period: {
    start: Date
    end: Date
  }
  summary: {
    totalEvents: number
    securityEvents: number
    dataAccessEvents: number
    authenticationEvents: number
    authorizationEvents: number
    systemEvents: number
  }
  userActivity: Array<{
    userId: string
    userName?: string
    loginCount: number
    dataAccessCount: number
    lastActivity: Date
  }>
  dataAccess: Array<{
    entityType: string
    entityId: string
    accessCount: number
    users: string[]
    lastAccess: Date
  }>
  securityIncidents: Array<{
    type: string
    count: number
    severity: string
    lastOccurrence: Date
  }>
  complianceMetrics: {
    dataRetentionCompliance: number
    accessControlCompliance: number
    auditTrailCompleteness: number
    securityEventCoverage: number
  }
}

export class AuditService {
  private auditLogs: Map<string, AuditLog> = new Map()
  private indexedLogs: {
    byAction: Map<string, Set<string>>
    byEntityType: Map<string, Set<string>>
    byUserId: Map<string, Set<string>>
    byTenantId: Map<string, Set<string>>
    byCategory: Map<string, Set<string>>
    bySeverity: Map<string, Set<string>>
    byDate: Map<string, Set<string>>
  } = {
    byAction: new Map(),
    byEntityType: new Map(),
    byUserId: new Map(),
    byTenantId: new Map(),
    byCategory: new Map(),
    bySeverity: new Map(),
    byDate: new Map(),
  }

  constructor() {
    this.startCleanupTasks()
  }

  /**
   * Log an audit event
   */
  async log(data: {
    action: string
    entityType: string
    entityId: string
    userId?: string
    userEmail?: string
    userName?: string
    tenantId?: string
    details?: Record<string, any>
    changes?: {
      before?: Record<string, any>
      after?: Record<string, any>
      fields?: string[]
    }
    metadata?: {
      ipAddress?: string
      userAgent?: string
      sessionId?: string
      requestId?: string
      source?: string
      tags?: string[]
    }
    severity?: "low" | "medium" | "high" | "critical"
    category?: "authentication" | "authorization" | "data" | "system" | "security" | "compliance"
    expiresAt?: Date
  }): Promise<AuditLog> {
    try {
      const auditLog: AuditLog = {
        id: this.generateId(),
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        userId: data.userId,
        userEmail: data.userEmail,
        userName: data.userName,
        tenantId: data.tenantId,
        details: data.details,
        changes: data.changes,
        metadata: data.metadata,
        severity: data.severity || this.determineSeverity(data.action, data.category),
        category: data.category || this.determineCategory(data.action),
        timestamp: new Date(),
        expiresAt: data.expiresAt || this.calculateExpirationDate(data.category),
      }

      // Store audit log
      this.auditLogs.set(auditLog.id, auditLog)

      // Update indexes
      this.updateIndexes(auditLog)

      // Emit event for real-time monitoring
      this.emitAuditEvent(auditLog)

      // Check for security alerts
      await this.checkSecurityAlerts(auditLog)

      logger.debug("Audit log created", {
        id: auditLog.id,
        action: auditLog.action,
        entityType: auditLog.entityType,
        userId: auditLog.userId,
      })

      return auditLog
    } catch (error) {
      logger.error("Failed to create audit log:", error)
      throw ApiError.internal("Failed to create audit log")
    }
  }

  /**
   * Get audit logs with filtering and pagination
   */
  async getAuditLogs(query: AuditQuery = {}): Promise<{
    logs: AuditLog[]
    total: number
    page: number
    limit: number
    totalPages: number
  }> {
    try {
      const {
        action,
        entityType,
        entityId,
        userId,
        userEmail,
        tenantId,
        severity,
        category,
        startDate,
        endDate,
        search,
        tags,
        page = 1,
        limit = 20,
        sortBy = "timestamp",
        sortOrder = "desc",
      } = query

      // Get candidate log IDs from indexes
      let candidateIds = new Set<string>(this.auditLogs.keys())

      // Apply filters using indexes
      if (action && this.indexedLogs.byAction.has(action)) {
        candidateIds = this.intersectSets(candidateIds, this.indexedLogs.byAction.get(action)!)
      }

      if (entityType && this.indexedLogs.byEntityType.has(entityType)) {
        candidateIds = this.intersectSets(candidateIds, this.indexedLogs.byEntityType.get(entityType)!)
      }

      if (userId && this.indexedLogs.byUserId.has(userId)) {
        candidateIds = this.intersectSets(candidateIds, this.indexedLogs.byUserId.get(userId)!)
      }

      if (tenantId && this.indexedLogs.byTenantId.has(tenantId)) {
        candidateIds = this.intersectSets(candidateIds, this.indexedLogs.byTenantId.get(tenantId)!)
      }

      if (severity && severity.length > 0) {
        const severityIds = new Set<string>()
        for (const sev of severity) {
          if (this.indexedLogs.bySeverity.has(sev)) {
            this.unionSets(severityIds, this.indexedLogs.bySeverity.get(sev)!)
          }
        }
        candidateIds = this.intersectSets(candidateIds, severityIds)
      }

      if (category && category.length > 0) {
        const categoryIds = new Set<string>()
        for (const cat of category) {
          if (this.indexedLogs.byCategory.has(cat)) {
            this.unionSets(categoryIds, this.indexedLogs.byCategory.get(cat)!)
          }
        }
        candidateIds = this.intersectSets(candidateIds, categoryIds)
      }

      // Get actual logs and apply remaining filters
      let filteredLogs = Array.from(candidateIds)
        .map(id => this.auditLogs.get(id)!)
        .filter(log => {
          // Entity ID filter
          if (entityId && log.entityId !== entityId) return false

          // User email filter
          if (userEmail && log.userEmail !== userEmail) return false

          // Date range filter
          if (startDate && log.timestamp < startDate) return false
          if (endDate && log.timestamp > endDate) return false

          // Search filter
          if (search) {
            const searchLower = search.toLowerCase()
            const searchableText = [
              log.action,
              log.entityType,
              log.entityId,
              log.userEmail,
              log.userName,
              JSON.stringify(log.details),
              JSON.stringify(log.metadata),
            ].join(" ").toLowerCase()

            if (!searchableText.includes(searchLower)) return false
          }

          // Tags filter
          if (tags && tags.length > 0) {
            const logTags = log.metadata?.tags || []
            if (!tags.some(tag => logTags.includes(tag))) return false
          }

          return true
        })

      // Sort logs
      filteredLogs.sort((a, b) => {
        let aValue: any = a[sortBy as keyof AuditLog]
        let bValue: any = b[sortBy as keyof AuditLog]

        if (sortBy === "timestamp" || sortBy === "expiresAt") {
          aValue = aValue ? aValue.getTime() : 0
          bValue = bValue ? bValue.getTime() : 0
        }

        if (sortOrder === "desc") {
          return bValue > aValue ? 1 : bValue < aValue ? -1 : 0
        } else {
          return aValue > bValue ? 1 : aValue < bValue ? -1 : 0
        }
      })

      // Paginate
      const total = filteredLogs.length
      const totalPages = Math.ceil(total / limit)
      const startIndex = (page - 1) * limit
      const paginatedLogs = filteredLogs.slice(startIndex, startIndex + limit)

      return {
        logs: paginatedLogs,
        total,
        page,
        limit,
        totalPages,
      }
    } catch (error) {
      logger.error("Failed to get audit logs:", error)
      throw ApiError.internal("Failed to retrieve audit logs")
    }
  }

  /**
   * Get audit logs for a specific entity
   */
  async getEntityAuditLogs(
    entityType: string,
    entityId: string,
    options: {
      page?: number
      limit?: number
      startDate?: Date
      endDate?: Date
    } = {}
  ): Promise<{
    logs: AuditLog[]
    total: number
    page: number
    limit: number
  }> {
    return this.getAuditLogs({
      entityType,
      entityId,
      ...options,
    })
  }

  /**
   * Get audit logs for a specific user
   */
  async getUserAuditLogs(
    userId: string,
    options: {
      page?: number
      limit?: number
      startDate?: Date
      endDate?: Date
    } = {}
  ): Promise<{
    logs: AuditLog[]
    total: number
    page: number
    limit: number
  }> {
    return this.getAuditLogs({
      userId,
      ...options,
    })
  }

  /**
   * Get recent audit logs
   */
  async getRecentAuditLogs(limit = 20): Promise<AuditLog[]> {
    try {
      const allLogs = Array.from(this.auditLogs.values())
      return allLogs
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit)
    } catch (error) {
      logger.error("Failed to get recent audit logs:", error)
      throw ApiError.internal("Failed to retrieve recent audit logs")
    }
  }

  /**
   * Get audit statistics
   */
  async getAuditStats(
    tenantId?: string,
    timeRange?: {
      start: Date
      end: Date
    }
  ): Promise<AuditStats> {
    try {
      let logs = Array.from(this.auditLogs.values())

      // Filter by tenant
      if (tenantId) {
        logs = logs.filter(log => log.tenantId === tenantId)
      }

      // Filter by time range
      if (timeRange) {
        logs = logs.filter(log => 
          log.timestamp >= timeRange.start && 
          log.timestamp <= timeRange.end
        )
      }

      const totalLogs = logs.length

      // Group by action
      const logsByAction: Record<string, number> = {}
      logs.forEach(log => {
        logsByAction[log.action] = (logsByAction[log.action] || 0) + 1
      })

      // Group by entity type
      const logsByEntityType: Record<string, number> = {}
      logs.forEach(log => {
        logsByEntityType[log.entityType] = (logsByEntityType[log.entityType] || 0) + 1
      })

      // Group by user
      const logsByUser: Record<string, number> = {}
      logs.forEach(log => {
        if (log.userId) {
          logsByUser[log.userId] = (logsByUser[log.userId] || 0) + 1
        }
      })

      // Group by severity
      const logsBySeverity: Record<string, number> = {}
      logs.forEach(log => {
        logsBySeverity[log.severity] = (logsBySeverity[log.severity] || 0) + 1
      })

      // Group by category
      const logsByCategory: Record<string, number> = {}
      logs.forEach(log => {
        logsByCategory[log.category] = (logsByCategory[log.category] || 0) + 1
      })

      // Group by date
      const logsByDate: Record<string, number> = {}
      logs.forEach(log => {
        const date = log.timestamp.toISOString().split('T')[0]
        logsByDate[date] = (logsByDate[date] || 0) + 1
      })

      const logsOverTime = Object.entries(logsByDate)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date))

      // Top users
      const topUsers = Object.entries(logsByUser)
        .map(([userId, count]) => {
          const userLog = logs.find(log => log.userId === userId)
          return {
            userId,
            userName: userLog?.userName,
            count,
          }
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)

      // Recent activity
      const recentActivity = logs
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, 10)

      return {
        totalLogs,
        logsByAction,
        logsByEntityType,
        logsByUser,
        logsBySeverity,
        logsByCategory,
        logsOverTime,
        topUsers,
        recentActivity,
      }
    } catch (error) {
      logger.error("Failed to get audit stats:", error)
      throw ApiError.internal("Failed to retrieve audit statistics")
    }
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(
    startDate: Date,
    endDate: Date,
    tenantId?: string
  ): Promise<ComplianceReport> {
    try {
      let logs = Array.from(this.auditLogs.values())

      // Filter by tenant
      if (tenantId) {
        logs = logs.filter(log => log.tenantId === tenantId)
      }

      // Filter by date range
      logs = logs.filter(log => 
        log.timestamp >= startDate && 
        log.timestamp <= endDate
      )

      // Summary statistics
      const totalEvents = logs.length
      const securityEvents = logs.filter(log => log.category === "security").length
      const dataAccessEvents = logs.filter(log => log.category === "data").length
      const authenticationEvents = logs.filter(log => log.category === "authentication").length
      const authorizationEvents = logs.filter(log => log.category === "authorization").length
      const systemEvents = logs.filter(log => log.category === "system").length

      // User activity analysis
      const userActivityMap = new Map<string, {
        loginCount: number
        dataAccessCount: number
        lastActivity: Date
      }>()

      logs.forEach(log => {
        if (log.userId) {
          const existing = userActivityMap.get(log.userId) || {
            loginCount: 0,
            dataAccessCount: 0,
            lastActivity: new Date(0),
          }

          if (log.action.includes("login")) {
            existing.loginCount++
          }
          if (log.category === "data") {
            existing.dataAccessCount++
          }
          if (log.timestamp > existing.lastActivity) {
            existing.lastActivity = log.timestamp
          }

          userActivityMap.set(log.userId, existing)
        }
      })

      const userActivity = Array.from(userActivityMap.entries()).map(([userId, activity]) => {
        const userLog = logs.find(log => log.userId === userId)
        return {
          userId,
          userName: userLog?.userName,
          ...activity,
        }
      })

      // Data access analysis
      const dataAccessMap = new Map<string, {
        accessCount: number
        users: Set<string>
        lastAccess: Date
      }>()

      logs.filter(log => log.category === "data").forEach(log => {
        const key = `${log.entityType}:${log.entityId}`
        const existing = dataAccessMap.get(key) || {
          accessCount: 0,
          users: new Set(),
          lastAccess: new Date(0),
        }

        existing.accessCount++
        if (log.userId) {
          existing.users.add(log.userId)
        }
        if (log.timestamp > existing.lastAccess) {
          existing.lastAccess = log.timestamp
        }

        dataAccessMap.set(key, existing)
      })

      const dataAccess = Array.from(dataAccessMap.entries()).map(([key, access]) => {
        const [entityType, entityId] = key.split(":")
        return {
          entityType,
          entityId,
          accessCount: access.accessCount,
          users: Array.from(access.users),
          lastAccess: access.lastAccess,
        }
      })

      // Security incidents analysis
      const securityIncidentMap = new Map<string, {
        count: number
        severity: string
        lastOccurrence: Date
      }>()

      logs.filter(log => log.category === "security").forEach(log => {
        const existing = securityIncidentMap.get(log.action) || {
          count: 0,
          severity: log.severity,
          lastOccurrence: new Date(0),
        }

        existing.count++
        if (log.timestamp > existing.lastOccurrence) {
          existing.lastOccurrence = log.timestamp
          existing.severity = log.severity
        }

        securityIncidentMap.set(log.action, existing)
      })

      const securityIncidents = Array.from(securityIncidentMap.entries()).map(([type, incident]) => ({
        type,
        ...incident,
      }))

      // Compliance metrics (simplified calculations)
      const complianceMetrics = {
        dataRetentionCompliance: this.calculateDataRetentionCompliance(logs),
        accessControlCompliance: this.calculateAccessControlCompliance(logs),
        auditTrailCompleteness: this.calculateAuditTrailCompleteness(logs),
        securityEventCoverage: this.calculateSecurityEventCoverage(logs),
      }

      return {
        period: {
          start: startDate,
          end: endDate,
        },
        summary: {
          totalEvents,
          securityEvents,
          dataAccessEvents,
          authenticationEvents,
          authorizationEvents,
          systemEvents,
        },
        userActivity,
        dataAccess,
        securityIncidents,
        complianceMetrics,
      }
    } catch (error) {
      logger.error("Failed to generate compliance report:", error)
      throw ApiError.internal("Failed to generate compliance report")
    }
  }

  /**
   * Delete old audit logs
   */
  async deleteOldAuditLogs(olderThan: Date): Promise<number> {
    try {
      let deletedCount = 0

      for (const [id, log] of this.auditLogs) {
        if (log.timestamp < olderThan || (log.expiresAt && log.expiresAt < new Date())) {
          this.auditLogs.delete(id)
          this.removeFromIndexes(log)
          deletedCount++
        }
      }

      logger.info(`Deleted ${deletedCount} old audit logs`)
      return deletedCount
    } catch (error) {
      logger.error("Failed to delete old audit logs:", error)
      throw ApiError.internal("Failed to delete old audit logs")
    }
  }

  /**
   * Export audit logs
   */
  async exportAuditLogs(
    query: AuditQuery,
    format: "json" | "csv" = "json"
  ): Promise<string> {
    try {
      const { logs } = await this.getAuditLogs({ ...query, limit: 10000 })

      if (format === "csv") {
        return this.convertToCSV(logs)
      } else {
        return JSON.stringify(logs, null, 2)
      }
    } catch (error) {
      logger.error("Failed to export audit logs:", error)
      throw ApiError.internal("Failed to export audit logs")
    }
  }

  // Private helper methods

  private generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private determineSeverity(action: string, category?: string): "low" | "medium" | "high" | "critical" {
    if (category === "security" || action.includes("delete") || action.includes("admin")) {
      return "high"
    }
    if (action.includes("create") || action.includes("update")) {
      return "medium"
    }
    return "low"
  }

  private determineCategory(action: string): "authentication" | "authorization" | "data" | "system" | "security" | "compliance" {
    if (action.includes("login") || action.includes("logout") || action.includes("auth")) {
      return "authentication"
    }
    if (action.includes("permission") || action.includes("role") || action.includes("access")) {
      return "authorization"
    }
    if (action.includes("create") || action.includes("read") || action.includes("update") || action.includes("delete")) {
      return "data"
    }
    if (action.includes("security") || action.includes("breach") || action.includes("attack")) {
      return "security"
    }
    if (action.includes("compliance") || action.includes("audit")) {
      return "compliance"
    }
    return "system"
  }

  private calculateExpirationDate(category?: string): Date {
    const now = new Date()
    const days = category === "security" ? 2555 : 365 // 7 years for security, 1 year for others
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  }

  private updateIndexes(log: AuditLog): void {
    // Update action index
    if (!this.indexedLogs.byAction.has(log.action)) {
      this.indexedLogs.byAction.set(log.action, new Set())
    }
    this.indexedLogs.byAction.get(log.action)!.add(log.id)

    // Update entity type index
    if (!this.indexedLogs.byEntityType.has(log.entityType)) {
      this.indexedLogs.byEntityType.set(log.entityType, new Set())
    }
    this.indexedLogs.byEntityType.get(log.entityType)!.add(log.id)

    // Update user ID index
    if (log.userId) {
      if (!this.indexedLogs.byUserId.has(log.userId)) {
        this.indexedLogs.byUserId.set(log.userId, new Set())
      }
      this.indexedLogs.byUserId.get(log.userId)!.add(log.id)
    }

    // Update tenant ID index
    if (log.tenantId) {
      if (!this.indexedLogs.byTenantId.has(log.tenantId)) {
        this.indexedLogs.byTenantId.set(log.tenantId, new Set())
      }
      this.indexedLogs.byTenantId.get(log.tenantId)!.add(log.id)
    }

    // Update category index
    if (!this.indexedLogs.byCategory.has(log.category)) {
      this.indexedLogs.byCategory.set(log.category, new Set())
    }
    this.indexedLogs.byCategory.get(log.category)!.add(log.id)

    // Update severity index
    if (!this.indexedLogs.bySeverity.has(log.severity)) {
      this.indexedLogs.bySeverity.set(log.severity, new Set())
    }
    this.indexedLogs.bySeverity.get(log.severity)!.add(log.id)

    // Update date index
    const dateKey = log.timestamp.toISOString().split('T')[0]
    if (!this.indexedLogs.byDate.has(dateKey)) {
      this.indexedLogs.byDate.set(dateKey, new Set())
    }
    this.indexedLogs.byDate.get(dateKey)!.add(log.id)
  }

  private removeFromIndexes(log: AuditLog): void {
    this.indexedLogs.byAction.get(log.action)?.delete(log.id)
    this.indexedLogs.byEntityType.get(log.entityType)?.delete(log.id)
    if (log.userId) {
      this.indexedLogs.byUserId.get(log.userId)?.delete(log.id)
    }
    if (log.tenantId) {
      this.indexedLogs.byTenantId.get(log.tenantId)?.delete(log.id)
    }
    this.indexedLogs.byCategory.get(log.category)?.delete(log.id)
    this.indexedLogs.bySeverity.get(log.severity)?.delete(log.id)
    const dateKey = log.timestamp.toISOString().split('T')[0]
    this.indexedLogs.byDate.get(dateKey)?.delete(log.id)
  }

  private intersectSets<T>(setA: Set<T>, setB: Set<T>): Set<T> {
    const result = new Set<T>()
    for (const item of setA) {
      if (setB.has(item)) {
        result.add(item)
      }
    }
    return result
  }

  private unionSets<T>(setA: Set<T>, setB: Set<T>): void {
    for (const item of setB) {
      setA.add(item)
    }
  }

  private emitAuditEvent(log: AuditLog): void {
    // In a real implementation, this would emit to event bus or websocket
    logger.debug("Audit event emitted", { logId: log.id, action: log.action })
  }

  private async checkSecurityAlerts(log: AuditLog): Promise<void> {
    // Check for suspicious patterns
    if (log.severity === "critical" || log.category === "security") {
      logger.warn("Security alert triggered", {
        logId: log.id,
        action: log.action,
        severity: log.severity,
        userId: log.userId,
      })
    }
  }

  private startCleanupTasks(): void {
    // Clean up expired logs every hour
    setInterval(() => {
      this.deleteOldAuditLogs(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000))
    }, 60 * 60 * 1000)
  }

  private calculateDataRetentionCompliance(logs: AuditLog[]): number {
    // Simplified calculation - percentage of logs with proper expiration dates
    const logsWithExpiration = logs.filter(log => log.expiresAt).length
    return logs.length > 0 ? (logsWithExpiration / logs.length) * 100 : 100
  }

  private calculateAccessControlCompliance(logs: AuditLog[]): number {
    // Simplified calculation - percentage of access events with proper authorization
    const accessLogs = logs.filter(log => log.category === "authorization")
    const successfulAccess = accessLogs.filter(log => !log.action.includes("denied")).length
    return accessLogs.length > 0 ? (successfulAccess / accessLogs.length) * 100 : 100
  }

  private calculateAuditTrailCompleteness(logs: AuditLog[]): number {
    // Simplified calculation - percentage of logs with complete metadata
    const completeMetadata = logs.filter(log => 
      log.metadata && 
      log.metadata.ipAddress && 
      log.metadata.userAgent
    ).length
    return logs.length > 0 ? (completeMetadata / logs.length) * 100 : 100
  }

  private calculateSecurityEventCoverage(logs: AuditLog[]): number {
    // Simplified calculation - percentage of security events captured
    const securityLogs = logs.filter(log => log.category === "security")
    const totalEvents = logs.length
    return totalEvents > 0 ? (securityLogs.length / totalEvents) * 100 : 100
  }

  private convertToCSV(logs: AuditLog[]): string {
    if (logs.length === 0) return ""

    const headers = [
      "id", "timestamp", "action", "entityType", "entityId", 
      "userId", "userEmail", "userName", "tenantId", "severity", 
      "category", "details", "metadata"
    ]

    const csvRows = [headers.join(",")]

    for (const log of logs) {
      const row = [
        log.id,
        log.timestamp.
