// =============================================================================
// WORKFLOW REPOSITORY - POSTGRESQL
// =============================================================================
// Workflow management with step tracking and approval processes

import { PrismaClient, Workflow, WorkflowEntry, WorkflowEntryStatus, Prisma } from '@prisma/client'
import { BaseRepository } from './base.repository'

export type WorkflowCreateInput = Prisma.WorkflowCreateInput
export type WorkflowUpdateInput = Prisma.WorkflowUpdateInput
export type WorkflowEntryCreateInput = Prisma.WorkflowEntryCreateInput
export type WorkflowEntryUpdateInput = Prisma.WorkflowEntryUpdateInput

export interface WorkflowWithRelations extends Workflow {
  entries?: WorkflowEntry[]
  tenant?: any
}

export interface WorkflowEntryWithRelations extends WorkflowEntry {
  workflow?: Workflow
  content?: any
  steps?: any[]
}

export class WorkflowRepository extends BaseRepository<Workflow, WorkflowCreateInput, WorkflowUpdateInput> {
  protected modelName = 'Workflow'
  protected model = this.prisma.workflow

  constructor(prisma: PrismaClient) {
    super(prisma)
  }

  /**
   * Find workflows by content type
   */
  async findByContentType(contentTypeId: string, tenantId?: string): Promise<Workflow[]> {
    const where: any = {
      contentTypes: { has: contentTypeId },
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Find default workflow for content type
   */
  async findDefaultForContentType(contentTypeId: string, tenantId?: string): Promise<Workflow | null> {
    const where: any = {
      contentTypes: { has: contentTypeId },
      isDefault: true,
    }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findFirst(where)
  }

  /**
   * Find default workflows
   */
  async findDefaults(tenantId?: string): Promise<Workflow[]> {
    const where: any = { isDefault: true }
    if (tenantId) {
      where.tenantId = tenantId
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Set workflow as default
   */
  async setAsDefault(workflowId: string): Promise<Workflow> {
    const workflow = await this.findByIdOrThrow(workflowId)

    // First, unset default flag for other workflows with same content types
    if (workflow.contentTypeIds && workflow.contentTypeIds.length > 0) {
      await this.prisma.workflow.updateMany({
        where: {
          id: { not: workflowId },
          contentTypeIds: { hasSome: workflow.contentTypeIds },
          isDefault: true,
          tenantId: workflow.tenantId,
        },
        data: { isDefault: false },
      })
    }

    return this.update(workflowId, { isDefault: true })
  }

  /**
   * Add content types to workflow
   */
  async addContentTypes(workflowId: string, contentTypeIds: string[]): Promise<Workflow> {
    const workflow = await this.findByIdOrThrow(workflowId)
    const currentContentTypes = workflow.contentTypeIds || []
    const uniqueContentTypes = [...new Set([...currentContentTypes, ...contentTypeIds])]

    return this.update(workflowId, { contentTypeIds: uniqueContentTypes })
  }

  /**
   * Remove content types from workflow
   */
  async removeContentTypes(workflowId: string, contentTypeIds: string[]): Promise<Workflow> {
    const workflow = await this.findByIdOrThrow(workflowId)
    const currentContentTypes = workflow.contentTypeIds || []
    const updatedContentTypes = currentContentTypes.filter(ct => !contentTypeIds.includes(ct))

    return this.update(workflowId, { contentTypeIds: updatedContentTypes })
  }

  /**
   * Search workflows
   */
  async search(
    query: string,
    tenantId?: string,
    options: {
      isDefault?: boolean
      limit?: number
      offset?: number
    } = {}
  ): Promise<Workflow[]> {
    const { isDefault, limit = 50, offset = 0 } = options

    const where: any = {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    }

    if (isDefault !== undefined) {
      where.isDefault = isDefault
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      })
    } catch (error) {
      this.handleError(error, 'search')
    }
  }

  /**
   * Find workflows with relations
   */
  async findWithRelations(
    where?: Record<string, any>,
    includeRelations: {
      entries?: boolean
      contentTypes?: boolean
      tenant?: boolean
    } = {}
  ): Promise<WorkflowWithRelations[]> {
    return this.findMany(where, includeRelations) as Promise<WorkflowWithRelations[]>
  }

  /**
   * Get workflow statistics
   */
  async getStatistics(tenantId?: string): Promise<{
    total: number
    defaults: number
    totalEntries: number
    activeEntries: number
    completedEntries: number
  }> {
    const where: any = {}
    if (tenantId) {
      where.tenantId = tenantId
    }

    try {
      const [
        total,
        defaults,
        totalEntries,
        activeEntries,
        completedEntries,
      ] = await Promise.all([
        this.count(where),
        this.count({ ...where, isDefault: true }),
        this.prisma.workflowEntry.count({
          where: tenantId ? { workflow: { tenantId } } : {},
        }),
        this.prisma.workflowEntry.count({
          where: {
            status: WorkflowEntryStatus.IN_PROGRESS,
            ...(tenantId ? { workflow: { tenantId } } : {}),
          },
        }),
        this.prisma.workflowEntry.count({
          where: {
            status: WorkflowEntryStatus.APPROVED,
            ...(tenantId ? { workflow: { tenantId } } : {}),
          },
        }),
      ])

      return {
        total,
        defaults,
        totalEntries,
        activeEntries,
        completedEntries,
      }
    } catch (error) {
      this.handleError(error, 'getStatistics')
    }
  }
}

export class WorkflowEntryRepository extends BaseRepository<WorkflowEntry, WorkflowEntryCreateInput, WorkflowEntryUpdateInput> {
  protected modelName = 'WorkflowEntry'
  protected model = this.prisma.workflowEntry

  constructor(prisma: PrismaClient) {
    super(prisma)
  }

  /**
   * Find entries by workflow
   */
  async findByWorkflow(workflowId: string): Promise<WorkflowEntry[]> {
    return this.findMany({ workflowId }, undefined, { createdAt: 'desc' })
  }

  /**
   * Find entries by content
   */
  async findByContent(contentId: string): Promise<WorkflowEntry[]> {
    return this.findMany({ contentId }, undefined, { createdAt: 'desc' })
  }

  /**
   * Find active entry for content
   */
  async findActiveForContent(contentId: string): Promise<WorkflowEntry | null> {
    return this.findFirst({
      contentId,
      status: WorkflowEntryStatus.IN_PROGRESS,
    })
  }

  /**
   * Find entries by status
   */
  async findByStatus(status: WorkflowEntryStatus, tenantId?: string): Promise<WorkflowEntry[]> {
    const where: any = { status }
    if (tenantId) {
      where.workflow = { tenantId }
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Find entries assigned to user
   */
  async findAssignedToUser(userId: string, tenantId?: string): Promise<WorkflowEntry[]> {
    const where: any = {
      status: WorkflowEntryStatus.IN_PROGRESS,
      steps: {
        some: {
          assignedTo: { has: userId },
          status: WorkflowEntryStatus.IN_PROGRESS,
        },
      },
    }
    if (tenantId) {
      where.workflow = { tenantId }
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Complete workflow step
   */
  async completeStep(
    entryId: string,
    stepId: string,
    userId: string,
    approve: boolean,
    comments?: string
  ): Promise<WorkflowEntry> {
    const entry = await this.findByIdOrThrow(entryId)

    // This would require complex JSON operations in PostgreSQL
    // For now, we'll implement a simplified version
    // In a real implementation, you might want to use a separate WorkflowStep table

    if (!approve) {
      return this.update(entryId, {
        status: WorkflowEntryStatus.REJECTED,
        updatedAt: new Date(),
      })
    }

    // For approved steps, you would need to implement step progression logic
    // This is simplified for the example
    return this.update(entryId, {
      status: WorkflowEntryStatus.APPROVED,
      updatedAt: new Date(),
    })
  }

  /**
   * Assign users to workflow step
   */
  async assignUsers(entryId: string, stepId: string, userIds: string[]): Promise<WorkflowEntry> {
    // This would require complex JSON operations
    // In a real implementation, you might want to use a separate table for step assignments
    const entry = await this.findByIdOrThrow(entryId)
    return entry // Simplified implementation
  }

  /**
   * Cancel workflow
   */
  async cancel(entryId: string): Promise<WorkflowEntry> {
    const entry = await this.findByIdOrThrow(entryId)

    if (entry.status !== WorkflowEntryStatus.IN_PROGRESS) {
      throw new Error('Workflow is not in progress')
    }

    return this.update(entryId, {
      status: WorkflowEntryStatus.CANCELED,
      currentStepId: null,
      updatedAt: new Date(),
    })
  }

  /**
   * Search workflow entries
   */
  async search(
    query: string,
    tenantId?: string,
    options: {
      status?: WorkflowEntryStatus
      workflowId?: string
      limit?: number
      offset?: number
    } = {}
  ): Promise<WorkflowEntry[]> {
    const { status, workflowId, limit = 50, offset = 0 } = options

    const where: any = {}

    if (status) {
      where.status = status
    }

    if (workflowId) {
      where.workflowId = workflowId
    }

    if (tenantId) {
      where.workflow = { tenantId }
    }

    // For content search, you might want to join with content table
    // This is simplified for the example

    try {
      return await this.model.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      })
    } catch (error) {
      this.handleError(error, 'search')
    }
  }

  /**
   * Find entries with relations
   */
  async findWithRelations(
    where?: Record<string, any>,
    includeRelations: {
      workflow?: boolean
      content?: boolean
      currentStep?: boolean
      steps?: boolean
    } = {}
  ): Promise<WorkflowEntryWithRelations[]> {
    return this.findMany(where, includeRelations) as Promise<WorkflowEntryWithRelations[]>
  }

  /**
   * Get entry statistics
   */
  async getStatistics(tenantId?: string): Promise<{
    total: number
    inProgress: number
    approved: number
    rejected: number
    canceled: number
    averageCompletionTime?: number
  }> {
    const where: any = {}
    if (tenantId) {
      where.workflow = { tenantId }
    }

    try {
      const [
        total,
        inProgress,
        approved,
        rejected,
        canceled,
      ] = await Promise.all([
        this.count(where),
        this.count({ ...where, status: WorkflowEntryStatus.IN_PROGRESS }),
        this.count({ ...where, status: WorkflowEntryStatus.APPROVED }),
        this.count({ ...where, status: WorkflowEntryStatus.REJECTED }),
        this.count({ ...where, status: WorkflowEntryStatus.CANCELED }),
      ])

      return {
        total,
        inProgress,
        approved,
        rejected,
        canceled,
      }
    } catch (error) {
      this.handleError(error, 'getStatistics')
    }
  }

  /**
   * Find entries by date range
   */
  async findByDateRange(
    startDate: Date,
    endDate: Date,
    tenantId?: string
  ): Promise<WorkflowEntry[]> {
    const where: any = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    }
    if (tenantId) {
      where.workflow = { tenantId }
    }

    return this.findMany(where, undefined, { createdAt: 'desc' })
  }

  /**
   * Get pending approvals for user
   */
  async getPendingApprovals(userId: string, tenantId?: string): Promise<WorkflowEntry[]> {
    const where: any = {
      status: WorkflowEntryStatus.IN_PROGRESS,
      steps: {
        some: {
          assignedTo: { has: userId },
          status: WorkflowEntryStatus.IN_PROGRESS,
        },
      },
    }
    if (tenantId) {
      where.workflow = { tenantId }
    }

    return this.findMany(where, { workflow: true, content: true }, { createdAt: 'desc' })
  }
}
