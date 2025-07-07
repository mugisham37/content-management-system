import { EventEmitter } from "events"
import { prisma } from "@cms-platform/database/client"
import { logger } from "../utils/logger"
import { ApiError } from "../utils/errors"
import { schedulerService } from "./scheduler.service"
import type { Workflow, WorkflowInstance } from "@cms-platform/database/types"

// Define workflow enums
export enum WorkflowStepType {
  APPROVAL = "APPROVAL",
  NOTIFICATION = "NOTIFICATION",
  CONDITION = "CONDITION",
  ACTION = "ACTION",
  DELAY = "DELAY",
  FORK = "FORK",
  JOIN = "JOIN",
}

export enum WorkflowStepStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  REJECTED = "REJECTED",
  SKIPPED = "SKIPPED",
  FAILED = "FAILED",
}

export enum WorkflowStatus {
  DRAFT = "DRAFT",
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  ARCHIVED = "ARCHIVED",
}

export enum WorkflowInstanceStatus {
  PENDING = "PENDING",
  RUNNING = "RUNNING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
  SUSPENDED = "SUSPENDED",
}

export enum WorkflowTriggerType {
  CONTENT_CREATED = "CONTENT_CREATED",
  CONTENT_UPDATED = "CONTENT_UPDATED",
  CONTENT_PUBLISHED = "CONTENT_PUBLISHED",
  CONTENT_UNPUBLISHED = "CONTENT_UNPUBLISHED",
  CONTENT_DELETED = "CONTENT_DELETED",
  CONTENT_STATUS_CHANGED = "CONTENT_STATUS_CHANGED",
  USER_CREATED = "USER_CREATED",
  USER_UPDATED = "USER_UPDATED",
  USER_DELETED = "USER_DELETED",
  MEDIA_UPLOADED = "MEDIA_UPLOADED",
  MEDIA_UPDATED = "MEDIA_UPDATED",
  MEDIA_DELETED = "MEDIA_DELETED",
  SCHEDULED = "SCHEDULED",
  MANUAL = "MANUAL",
  API = "API",
}

export class WorkflowService extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(100)
    this.registerJobHandlers()
  }

  /**
   * Create a new workflow
   */
  public async createWorkflow(data: {
    name: string
    description?: string
    contentTypeId?: string
    steps: {
      name: string
      type: WorkflowStepType
      description?: string
      config: Record<string, any>
      nextSteps: string[]
      position: { x: number; y: number }
      order: number
    }[]
    triggers: {
      type: WorkflowTriggerType
      config: Record<string, any>
    }[]
    startStepId: string
    createdBy: string
    isDefault?: boolean
    tenantId?: string
  }): Promise<Workflow> {
    try {
      // Validate workflow
      this.validateWorkflow(data)

      // Check if default workflow already exists for content type
      if (data.isDefault && data.contentTypeId) {
        const existingDefault = await prisma.workflow.findFirst({
          where: {
            contentTypeId: data.contentTypeId,
            isDefault: true,
            status: { not: WorkflowStatus.ARCHIVED },
            ...(data.tenantId ? { tenantId: data.tenantId } : {}),
          },
        })

        if (existingDefault) {
          throw ApiError.conflict(`A default workflow already exists for this content type: ${existingDefault.name}`)
        }
      }

      // Create workflow with transaction
      const workflow = await prisma.$transaction(async (tx) => {
        const newWorkflow = await tx.workflow.create({
          data: {
            name: data.name,
            description: data.description,
            contentTypeId: data.contentTypeId,
            status: WorkflowStatus.DRAFT,
            startStepId: data.startStepId,
            createdBy: data.createdBy,
            isDefault: data.isDefault || false,
            tenantId: data.tenantId,
          },
        })

        // Create workflow steps
        const stepPromises = data.steps.map((step) =>
          tx.workflowStep.create({
            data: {
              workflowId: newWorkflow.id,
              name: step.name,
              type: step.type,
              description: step.description,
              config: step.config,
              nextSteps: step.nextSteps,
              position: step.position,
              order: step.order,
            },
          }),
        )

        await Promise.all(stepPromises)

        // Create workflow triggers
        const triggerPromises = data.triggers.map((trigger) =>
          tx.workflowTrigger.create({
            data: {
              workflowId: newWorkflow.id,
              type: trigger.type,
              config: trigger.config,
            },
          }),
        )

        await Promise.all(triggerPromises)

        return newWorkflow
      })

      logger.info(`Created workflow: ${workflow.name} (${workflow.id})`)
      this.emit("workflow:created", workflow)

      return workflow as Workflow
    } catch (error) {
      logger.error("Error creating workflow:", error)
      throw error
    }
  }

  /**
   * Update a workflow
   */
  public async updateWorkflow(
    id: string,
    data: {
      name?: string
      description?: string
      status?: WorkflowStatus
      contentTypeId?: string
      steps?: {
        id?: string
        name: string
        type: WorkflowStepType
        description?: string
        config: Record<string, any>
        nextSteps: string[]
        position: { x: number; y: number }
        order: number
      }[]
      triggers?: {
        type: WorkflowTriggerType
        config: Record<string, any>
      }[]
      startStepId?: string
      updatedBy: string
      isDefault?: boolean
    },
  ): Promise<Workflow> {
    try {
      const workflow = await prisma.workflow.findUnique({
        where: { id },
        include: {
          steps: true,
          triggers: true,
        },
      })

      if (!workflow) {
        throw ApiError.notFound("Workflow not found")
      }

      // Check if workflow is being set as default
      if (data.isDefault && data.isDefault !== workflow.isDefault && workflow.contentTypeId) {
        const existingDefault = await prisma.workflow.findFirst({
          where: {
            id: { not: id },
            contentTypeId: workflow.contentTypeId,
            isDefault: true,
            status: { not: WorkflowStatus.ARCHIVED },
            ...(workflow.tenantId ? { tenantId: workflow.tenantId } : {}),
          },
        })

        if (existingDefault) {
          throw ApiError.conflict(`A default workflow already exists for this content type: ${existingDefault.name}`)
        }
      }

      // Update workflow with transaction
      const updatedWorkflow = await prisma.$transaction(async (tx) => {
        // Update workflow
        const updated = await tx.workflow.update({
          where: { id },
          data: {
            name: data.name,
            description: data.description,
            status: data.status,
            contentTypeId: data.contentTypeId,
            startStepId: data.startStepId,
            updatedBy: data.updatedBy,
            isDefault: data.isDefault,
            version: { increment: 1 },
          },
        })

        // Update steps if provided
        if (data.steps) {
          // Delete existing steps
          await tx.workflowStep.deleteMany({
            where: { workflowId: id },
          })

          // Create new steps
          const stepPromises = data.steps.map((step) =>
            tx.workflowStep.create({
              data: {
                workflowId: id,
                name: step.name,
                type: step.type,
                description: step.description,
                config: step.config,
                nextSteps: step.nextSteps,
                position: step.position,
                order: step.order,
              },
            }),
          )

          await Promise.all(stepPromises)
        }

        // Update triggers if provided
        if (data.triggers) {
          // Delete existing triggers
          await tx.workflowTrigger.deleteMany({
            where: { workflowId: id },
          })

          // Create new triggers
          const triggerPromises = data.triggers.map((trigger) =>
            tx.workflowTrigger.create({
              data: {
                workflowId: id,
                type: trigger.type,
                config: trigger.config,
              },
            }),
          )

          await Promise.all(triggerPromises)
        }

        return updated
      })

      logger.info(`Updated workflow: ${updatedWorkflow.name} (${updatedWorkflow.id})`)
      this.emit("workflow:updated", updatedWorkflow)

      return updatedWorkflow as Workflow
    } catch (error) {
      logger.error(`Error updating workflow ${id}:`, error)
      throw error
    }
  }

  /**
   * Get a workflow by ID
   */
  public async getWorkflow(id: string, includeSteps = true): Promise<Workflow> {
    try {
      const workflow = await prisma.workflow.findUnique({
        where: { id },
        include: {
          steps: includeSteps
            ? {
                orderBy: { order: "asc" },
              }
            : false,
          triggers: true,
          instances: {
            take: 5,
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              status: true,
              createdAt: true,
              completedAt: true,
            },
          },
          _count: {
            select: {
              instances: true,
            },
          },
        },
      })

      if (!workflow) {
        throw ApiError.notFound("Workflow not found")
      }

      return workflow as Workflow
    } catch (error) {
      logger.error(`Error getting workflow ${id}:`, error)
      throw error
    }
  }

  /**
   * Get workflows with filtering and pagination
   */
  public async getWorkflows(params: {
    contentTypeId?: string
    status?: WorkflowStatus | WorkflowStatus[]
    triggerType?: WorkflowTriggerType
    isDefault?: boolean
    search?: string
    page?: number
    limit?: number
    sort?: string
    order?: "asc" | "desc"
    tenantId?: string
    includeSteps?: boolean
  }): Promise<{
    workflows: Workflow[]
    total: number
    page: number
    limit: number
    totalPages: number
    stats: {
      byStatus: Record<WorkflowStatus, number>
      byTriggerType: Record<WorkflowTriggerType, number>
      totalActive: number
      totalInstances: number
    }
  }> {
    try {
      const {
        contentTypeId,
        status,
        triggerType,
        isDefault,
        search,
        page = 1,
        limit = 20,
        sort = "createdAt",
        order = "desc",
        tenantId,
        includeSteps = false,
      } = params

      // Build where clause
      const where: any = {}

      if (contentTypeId) {
        where.contentTypeId = contentTypeId
      }

      if (status) {
        where.status = Array.isArray(status) ? { in: status } : status
      }

      if (isDefault !== undefined) {
        where.isDefault = isDefault
      }

      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ]
      }

      if (tenantId) {
        where.tenantId = tenantId
      }

      if (triggerType) {
        where.triggers = {
          some: { type: triggerType },
        }
      }

      // Get total count, workflows, and stats in parallel
      const [total, workflows, statusStats, triggerStats, instanceCount] = await Promise.all([
        prisma.workflow.count({ where }),
        prisma.workflow.findMany({
          where,
          orderBy: { [sort]: order },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            steps: includeSteps
              ? {
                  orderBy: { order: "asc" },
                }
              : false,
            triggers: true,
            _count: {
              select: {
                instances: true,
              },
            },
          },
        }),
        prisma.workflow.groupBy({
          by: ["status"],
          where: { ...where, tenantId },
          _count: { status: true },
        }),
        prisma.workflowTrigger.groupBy({
          by: ["type"],
          where: {
            workflow: { ...where },
          },
          _count: { type: true },
        }),
        prisma.workflowInstance.count({
          where: {
            workflow: { ...where },
          },
        }),
      ])

      // Build stats
      const byStatus = Object.values(WorkflowStatus).reduce(
        (acc, status) => {
          acc[status] = statusStats.find((s) => s.status === status)?._count.status || 0
          return acc
        },
        {} as Record<WorkflowStatus, number>,
      )

      const byTriggerType = Object.values(WorkflowTriggerType).reduce(
        (acc, type) => {
          acc[type] = triggerStats.find((t) => t.type === type)?._count.type || 0
          return acc
        },
        {} as Record<WorkflowTriggerType, number>,
      )

      return {
        workflows: workflows as Workflow[],
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        stats: {
          byStatus,
          byTriggerType,
          totalActive: byStatus[WorkflowStatus.ACTIVE] || 0,
          totalInstances: instanceCount,
        },
      }
    } catch (error) {
      logger.error("Error getting workflows:", error)
      throw error
    }
  }

  /**
   * Delete a workflow
   */
  public async deleteWorkflow(id: string, force = false): Promise<void> {
    try {
      const workflow = await prisma.workflow.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              instances: {
                where: {
                  status: {
                    in: [WorkflowInstanceStatus.PENDING, WorkflowInstanceStatus.RUNNING],
                  },
                },
              },
            },
          },
        },
      })

      if (!workflow) {
        throw ApiError.notFound("Workflow not found")
      }

      // Check if workflow has active instances
      if (!force && workflow._count.instances > 0) {
        throw ApiError.conflict(
          `Cannot delete workflow with ${workflow._count.instances} active instances. Use force=true to override.`,
        )
      }

      await prisma.$transaction(async (tx) => {
        if (force) {
          // Cancel all active instances
          await tx.workflowInstance.updateMany({
            where: {
              workflowId: id,
              status: {
                in: [WorkflowInstanceStatus.PENDING, WorkflowInstanceStatus.RUNNING],
              },
            },
            data: {
              status: WorkflowInstanceStatus.CANCELLED,
              completedAt: new Date(),
            },
          })
        }

        // Delete workflow steps
        await tx.workflowStep.deleteMany({
          where: { workflowId: id },
        })

        // Delete workflow triggers
        await tx.workflowTrigger.deleteMany({
          where: { workflowId: id },
        })

        // Delete workflow
        await tx.workflow.delete({
          where: { id },
        })
      })

      logger.info(`Deleted workflow: ${workflow.name} (${workflow.id})`)
      this.emit("workflow:deleted", workflow)
    } catch (error) {
      logger.error(`Error deleting workflow ${id}:`, error)
      throw error
    }
  }

  /**
   * Get default workflow for content type
   */
  public async getDefaultWorkflow(contentTypeId: string, tenantId?: string): Promise<Workflow | null> {
    try {
      const workflow = await prisma.workflow.findFirst({
        where: {
          contentTypeId,
          isDefault: true,
          status: WorkflowStatus.ACTIVE,
          ...(tenantId ? { tenantId } : {}),
        },
        include: {
          steps: {
            orderBy: { order: "asc" },
          },
          triggers: true,
        },
      })

      return workflow as Workflow | null
    } catch (error) {
      logger.error(`Error getting default workflow for content type ${contentTypeId}:`, error)
      throw error
    }
  }

  /**
   * Trigger workflow
   */
  public async triggerWorkflow(params: {
    triggerType: WorkflowTriggerType
    contentId?: string
    contentTypeId?: string
    userId?: string
    mediaId?: string
    data?: Record<string, any>
    createdBy: string
    tenantId?: string
  }): Promise<WorkflowInstance | null> {
    try {
      const { triggerType, contentId, contentTypeId, userId, mediaId, data = {}, createdBy, tenantId } = params

      // Find matching workflows
      const workflows = await prisma.workflow.findMany({
        where: {
          status: WorkflowStatus.ACTIVE,
          ...(contentTypeId ? { contentTypeId } : {}),
          ...(tenantId ? { tenantId } : {}),
          triggers: {
            some: { type: triggerType },
          },
        },
        include: {
          steps: {
            orderBy: { order: "asc" },
          },
          triggers: true,
        },
      })

      if (workflows.length === 0) {
        logger.debug(`No workflows found for trigger ${triggerType}`)
        return null
      }

      // Use default workflow if available, otherwise use the first one
      const workflow = workflows.find((w) => w.isDefault) || workflows[0]

      // Create workflow instance
      const instance = await this.createWorkflowInstance({
        workflowId: workflow.id,
        contentId,
        contentTypeId: contentTypeId || workflow.contentTypeId,
        userId,
        mediaId,
        data,
        createdBy,
        tenantId,
      })

      return instance
    } catch (error) {
      logger.error(`Error triggering workflow for ${params.triggerType}:`, error)
      throw error
    }
  }

  /**
   * Create workflow instance
   */
  public async createWorkflowInstance(params: {
    workflowId: string
    contentId?: string
    contentTypeId?: string
    userId?: string
    mediaId?: string
    data?: Record<string, any>
    createdBy: string
    tenantId?: string
  }): Promise<WorkflowInstance> {
    try {
      const { workflowId, contentId, contentTypeId, userId, mediaId, data = {}, createdBy, tenantId } = params

      // Get workflow with steps
      const workflow = await this.getWorkflow(workflowId, true)

      if (!workflow.steps || workflow.steps.length === 0) {
        throw ApiError.badRequest("Workflow has no steps")
      }

      // Find start step
      const startStep = workflow.steps.find((step) => step.id === workflow.startStepId)
      if (!startStep) {
        throw ApiError.badRequest("Workflow start step not found")
      }

      // Create instance with transaction
      const instance = await prisma.$transaction(async (tx) => {
        const newInstance = await tx.workflowInstance.create({
          data: {
            workflowId,
            contentId,
            contentTypeId: contentTypeId || workflow.contentTypeId,
            userId,
            mediaId,
            status: WorkflowInstanceStatus.PENDING,
            currentStepId: workflow.startStepId,
            data,
            createdBy,
            tenantId,
          },
        })

        // Create initial step
        await tx.workflowInstanceStep.create({
          data: {
            instanceId: newInstance.id,
            stepId: workflow.startStepId,
            status: WorkflowStepStatus.PENDING,
          },
        })

        return newInstance
      })

      logger.info(`Created workflow instance: ${instance.id} for workflow ${workflowId}`)
      this.emit("workflow:instance:created", instance)

      // Start workflow execution
      setImmediate(() => {
        this.executeWorkflowInstance(instance.id).catch((error) => {
          logger.error(`Error executing workflow instance ${instance.id}:`, error)
        })
      })

      return instance as WorkflowInstance
    } catch (error) {
      logger.error("Error creating workflow instance:", error)
      throw error
    }
  }

  /**
   * Get workflow instance
   */
  public async getWorkflowInstance(id: string): Promise<WorkflowInstance> {
    try {
      const instance = await prisma.workflowInstance.findUnique({
        where: { id },
        include: {
          workflow: {
            include: {
              steps: {
                orderBy: { order: "asc" },
              },
            },
          },
          steps: {
            orderBy: { createdAt: "asc" },
          },
        },
      })

      if (!instance) {
        throw ApiError.notFound("Workflow instance not found")
      }

      return instance as WorkflowInstance
    } catch (error) {
      logger.error(`Error getting workflow instance ${id}:`, error)
      throw error
    }
  }

  /**
   * Get workflow instances with filtering and pagination
   */
  public async getWorkflowInstances(params: {
    workflowId?: string
    contentId?: string
    contentTypeId?: string
    userId?: string
    mediaId?: string
    status?: WorkflowInstanceStatus | WorkflowInstanceStatus[]
    createdBy?: string
    page?: number
    limit?: number
    sort?: string
    order?: "asc" | "desc"
    tenantId?: string
  }): Promise<{
    instances: WorkflowInstance[]
    total: number
    page: number
    limit: number
    totalPages: number
    stats: {
      byStatus: Record<WorkflowInstanceStatus, number>
      avgExecutionTime: number
      successRate: number
    }
  }> {
    try {
      const {
        workflowId,
        contentId,
        contentTypeId,
        userId,
        mediaId,
        status,
        createdBy,
        page = 1,
        limit = 20,
        sort = "createdAt",
        order = "desc",
        tenantId,
      } = params

      // Build where clause
      const where: any = {}

      if (workflowId) where.workflowId = workflowId
      if (contentId) where.contentId = contentId
      if (contentTypeId) where.contentTypeId = contentTypeId
      if (userId) where.userId = userId
      if (mediaId) where.mediaId = mediaId
      if (createdBy) where.createdBy = createdBy
      if (tenantId) where.tenantId = tenantId

      if (status) {
        where.status = Array.isArray(status) ? { in: status } : status
      }

      // Get total count, instances, and stats in parallel
      const [total, instances, statusStats, executionStats] = await Promise.all([
        prisma.workflowInstance.count({ where }),
        prisma.workflowInstance.findMany({
          where,
          orderBy: { [sort]: order },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            workflow: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
            steps: {
              orderBy: { createdAt: "asc" },
              take: 5,
            },
          },
        }),
        prisma.workflowInstance.groupBy({
          by: ["status"],
          where,
          _count: { status: true },
        }),
        prisma.workflowInstance.aggregate({
          where: {
            ...where,
            startedAt: { not: null },
            completedAt: { not: null },
          },
          _avg: {
            executionTime: true,
          },
        }),
      ])

      // Build stats
      const byStatus = Object.values(WorkflowInstanceStatus).reduce(
        (acc, status) => {
          acc[status] = statusStats.find((s) => s.status === status)?._count.status || 0
          return acc
        },
        {} as Record<WorkflowInstanceStatus, number>,
      )

      const successRate = total > 0 ? (byStatus[WorkflowInstanceStatus.COMPLETED] / total) * 100 : 0

      return {
        instances: instances as WorkflowInstance[],
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        stats: {
          byStatus,
          avgExecutionTime: executionStats._avg.executionTime || 0,
          successRate,
        },
      }
    } catch (error) {
      logger.error("Error getting workflow instances:", error)
      throw error
    }
  }

  /**
   * Cancel workflow instance
   */
  public async cancelWorkflowInstance(id: string, userId: string, reason?: string): Promise<WorkflowInstance> {
    try {
      const instance = await prisma.workflowInstance.findUnique({
        where: { id },
      })

      if (!instance) {
        throw ApiError.notFound("Workflow instance not found")
      }

      // Check if instance can be cancelled
      if (
        ![WorkflowInstanceStatus.PENDING, WorkflowInstanceStatus.RUNNING, WorkflowInstanceStatus.SUSPENDED].includes(
          instance.status as WorkflowInstanceStatus,
        )
      ) {
        throw ApiError.badRequest(`Cannot cancel workflow instance with status ${instance.status}`)
      }

      // Update instance
      const cancelledInstance = await prisma.workflowInstance.update({
        where: { id },
        data: {
          status: WorkflowInstanceStatus.CANCELLED,
          completedAt: new Date(),
          result: {
            cancelled: true,
            reason: reason || "Cancelled by user",
            cancelledBy: userId,
          },
        },
        include: {
          workflow: true,
          steps: true,
        },
      })

      logger.info(`Cancelled workflow instance: ${id}`)
      this.emit("workflow:instance:cancelled", cancelledInstance)

      return cancelledInstance as WorkflowInstance
    } catch (error) {
      logger.error(`Error cancelling workflow instance ${id}:`, error)
      throw error
    }
  }

  /**
   * Complete workflow step
   */
  public async completeWorkflowStep(params: {
    instanceId: string
    stepId: string
    userId: string
    result?: any
    notes?: string
    nextStepId?: string
  }): Promise<WorkflowInstance> {
    try {
      const { instanceId, stepId, userId, result, notes, nextStepId } = params

      const instance = await this.getWorkflowInstance(instanceId)

      // Check if instance is active
      if (
        ![WorkflowInstanceStatus.RUNNING, WorkflowInstanceStatus.PENDING].includes(
          instance.status as WorkflowInstanceStatus,
        )
      ) {
        throw ApiError.badRequest(`Cannot complete step in workflow instance with status ${instance.status}`)
      }

      // Check if step exists and is current
      if (instance.currentStepId !== stepId) {
        throw ApiError.badRequest(`Step ${stepId} is not the current step of the workflow instance`)
      }

      // Find step in workflow
      const step = instance.workflow.steps.find((s) => s.id === stepId)
      if (!step) {
        throw ApiError.badRequest(`Step ${stepId} not found in workflow`)
      }

      // Update step and instance with transaction
      const updatedInstance = await prisma.$transaction(async (tx) => {
        // Update step status
        await tx.workflowInstanceStep.updateMany({
          where: {
            instanceId,
            stepId,
          },
          data: {
            status: WorkflowStepStatus.COMPLETED,
            completedAt: new Date(),
            assignedTo: userId,
            result,
            notes,
          },
        })

        // Determine next step
        let nextStep: string | undefined
        if (nextStepId && step.nextSteps.includes(nextStepId)) {
          nextStep = nextStepId
        } else if (step.nextSteps.length === 1) {
          nextStep = step.nextSteps[0]
        } else if (step.nextSteps.length === 0) {
          // No next steps, workflow is complete
          return await tx.workflowInstance.update({
            where: { id: instanceId },
            data: {
              status: WorkflowInstanceStatus.COMPLETED,
              completedAt: new Date(),
              currentStepId: null,
              result: {
                completed: true,
                finalStep: stepId,
                finalResult: result,
              },
            },
            include: {
              workflow: true,
              steps: true,
            },
          })
        }

        // Update instance with next step
        const updated = await tx.workflowInstance.update({
          where: { id: instanceId },
          data: {
            status: WorkflowInstanceStatus.RUNNING,
            currentStepId: nextStep,
          },
          include: {
            workflow: true,
            steps: true,
          },
        })

        // Create next step if it exists
        if (nextStep) {
          await tx.workflowInstanceStep.create({
            data: {
              instanceId,
              stepId: nextStep,
              status: WorkflowStepStatus.PENDING,
            },
          })
        }

        return updated
      })

      logger.info(`Completed workflow step ${stepId} in instance ${instanceId}`)
      this.emit("workflow:step:completed", {
        instance: updatedInstance,
        stepId,
        userId,
        result,
        notes,
      })

      // Continue workflow execution if there's a next step
      if (updatedInstance.currentStepId) {
        setImmediate(() => {
          this.executeWorkflowInstance(instanceId).catch((error) => {
            logger.error(`Error executing workflow instance ${instanceId}:`, error)
          })
        })
      }

      return updatedInstance as WorkflowInstance
    } catch (error) {
      logger.error(`Error completing workflow step ${params.stepId} in instance ${params.instanceId}:`, error)
      throw error
    }
  }

  /**
   * Reject workflow step
   */
  public async rejectWorkflowStep(params: {
    instanceId: string
    stepId: string
    userId: string
    reason: string
  }): Promise<WorkflowInstance> {
    try {
      const { instanceId, stepId, userId, reason } = params

      const instance = await this.getWorkflowInstance(instanceId)

      // Check if instance is active
      if (
        ![WorkflowInstanceStatus.RUNNING, WorkflowInstanceStatus.PENDING].includes(
          instance.status as WorkflowInstanceStatus,
        )
      ) {
        throw ApiError.badRequest(`Cannot reject step in workflow instance with status ${instance.status}`)
      }

      // Check if step exists and is current
      if (instance.currentStepId !== stepId) {
        throw ApiError.badRequest(`Step ${stepId} is not the current step of the workflow instance`)
      }

      // Update step and instance with transaction
      const updatedInstance = await prisma.$transaction(async (tx) => {
        // Update step status
        await tx.workflowInstanceStep.updateMany({
          where: {
            instanceId,
            stepId,
          },
          data: {
            status: WorkflowStepStatus.REJECTED,
            completedAt: new Date(),
            assignedTo: userId,
            notes: reason,
          },
        })

        // Update instance status
        return await tx.workflowInstance.update({
          where: { id: instanceId },
          data: {
            status: WorkflowInstanceStatus.FAILED,
            completedAt: new Date(),
            currentStepId: null,
            result: {
              rejected: true,
              stepId,
              reason,
              rejectedBy: userId,
            },
          },
          include: {
            workflow: true,
            steps: true,
          },
        })
      })

      logger.info(`Rejected workflow step ${stepId} in instance ${instanceId}`)
      this.emit("workflow:step:rejected", {
        instance: updatedInstance,
        stepId,
        userId,
        reason,
      })

      return updatedInstance as WorkflowInstance
    } catch (error) {
      logger.error(`Error rejecting workflow step ${params.stepId} in instance ${params.instanceId}:`, error)
      throw error
    }
  }

  /**
   * Assign workflow step
   */
  public async assignWorkflowStep(params: {
    instanceId: string
    stepId: string
    assigneeId: string
    assignerId: string
  }): Promise<WorkflowInstance> {
    try {
      const { instanceId, stepId, assigneeId, assignerId } = params

      const instance = await this.getWorkflowInstance(instanceId)

      // Check if instance is active
      if (
        ![WorkflowInstanceStatus.RUNNING, WorkflowInstanceStatus.PENDING].includes(
          instance.status as WorkflowInstanceStatus,
        )
      ) {
        throw ApiError.badRequest(`Cannot assign step in workflow instance with status ${instance.status}`)
      }

      // Check if step exists and is current
      if (instance.currentStepId !== stepId) {
        throw ApiError.badRequest(`Step ${stepId} is not the current step of the workflow instance`)
      }

      // Update step assignment
      await prisma.workflowInstanceStep.updateMany({
        where: {
          instanceId,
          stepId,
        },
        data: {
          assignedTo: assigneeId,
          status: WorkflowStepStatus.IN_PROGRESS,
        },
      })

      const updatedInstance = await this.getWorkflowInstance(instanceId)

      logger.info(`Assigned workflow step ${stepId} to user ${assigneeId} in instance ${instanceId}`)
      this.emit("workflow:step:assigned", {
        instance: updatedInstance,
        stepId,
        assigneeId,
        assignerId,
      })

      return updatedInstance
    } catch (error) {
      logger.error(`Error assigning workflow step ${params.stepId} in instance ${params.instanceId}:`, error)
      throw error
    }
  }

  // Private methods

  private validateWorkflow(data: {
    name: string
    steps: any[]
    startStepId: string
  }): void {
    if (!data.name) {
      throw ApiError.badRequest("Workflow name is required")
    }

    if (!data.steps || data.steps.length === 0) {
      throw ApiError.badRequest("Workflow must have at least one step")
    }

    if (!data.startStepId) {
      throw ApiError.badRequest("Workflow start step is required")
    }

    this.validateWorkflowSteps(data.steps, data.startStepId)
  }

  private validateWorkflowSteps(steps: any[], startStepId: string): void {
    // Check if start step exists
    const startStep = steps.find((step) => step.id === startStepId)
    if (!startStep) {
      throw ApiError.badRequest(`Start step ${startStepId} not found in workflow steps`)
    }

    // Check for duplicate step orders
    const orders = steps.map((step) => step.order)
    const uniqueOrders = new Set(orders)
    if (orders.length !== uniqueOrders.size) {
      throw ApiError.badRequest("Workflow contains duplicate step orders")
    }

    // Check if all next steps exist
    for (const step of steps) {
      for (const nextStepId of step.nextSteps) {
        if (!steps.some((s) => s.id === nextStepId)) {
          throw ApiError.badRequest(`Next step ${nextStepId} not found in workflow steps`)
        }
      }
    }

    // Validate step configurations
    for (const step of steps) {
      this.validateStepConfig(step)
    }
  }

  private validateStepConfig(step: any): void {
    switch (step.type) {
      case WorkflowStepType.APPROVAL:
        if (!step.config.approvers || !Array.isArray(step.config.approvers) || step.config.approvers.length === 0) {
          throw ApiError.badRequest(`Approval step ${step.name} must have at least one approver`)
        }
        break
      case WorkflowStepType.NOTIFICATION:
        if (!step.config.recipients || !Array.isArray(step.config.recipients) || step.config.recipients.length === 0) {
          throw ApiError.badRequest(`Notification step ${step.name} must have at least one recipient`)
        }
        if (!step.config.message) {
          throw ApiError.badRequest(`Notification step ${step.name} must have a message`)
        }
        break
      case WorkflowStepType.CONDITION:
        if (!step.config.condition) {
          throw ApiError.badRequest(`Condition step ${step.name} must have a condition`)
        }
        break
      case WorkflowStepType.ACTION:
        if (!step.config.action) {
          throw ApiError.badRequest(`Action step ${step.name} must have an action`)
        }
        break
      case WorkflowStepType.DELAY:
        if (!step.config.duration || step.config.duration <= 0) {
          throw ApiError.badRequest(`Delay step ${step.name} must have a positive duration`)
        }
        if (!step.config.unit || !["seconds", "minutes", "hours", "days"].includes(step.config.unit)) {
          throw ApiError.badRequest(`Delay step ${step.name} must have a valid unit`)
        }
        break
    }
  }

  private async executeWorkflowInstance(instanceId: string): Promise<void> {
    try {
      const instance = await this.getWorkflowInstance(instanceId)

      // Check if instance is active
      if (
        ![WorkflowInstanceStatus.PENDING, WorkflowInstanceStatus.RUNNING].includes(
          instance.status as WorkflowInstanceStatus,
        )
      ) {
        return
      }

      // Get current step
      if (!instance.currentStepId) {
        return
      }

      const step = instance.workflow.steps.find((s) => s.id === instance.currentStepId)
      if (!step) {
        logger.error(`Step ${instance.currentStepId} not found in workflow ${instance.workflowId}`)
        return
      }

      // Update instance status to running
      if (instance.status === WorkflowInstanceStatus.PENDING) {
        await prisma.workflowInstance.update({
          where: { id: instanceId },
          data: {
            status: WorkflowInstanceStatus.RUNNING,
            startedAt: new Date(),
          },
        })
      }

      // Execute step based on type
      switch (step.type) {
        case WorkflowStepType.APPROVAL:
          await this.handleApprovalStep(instance, step)
          break
        case WorkflowStepType.NOTIFICATION:
          await this.handleNotificationStep(instance, step)
          break
        case WorkflowStepType.CONDITION:
          await this.handleConditionStep(instance, step)
          break
        case WorkflowStepType.ACTION:
          await this.handleActionStep(instance, step)
          break
        case WorkflowStepType.DELAY:
          await this.handleDelayStep(instance, step)
          break
        default:
          logger.warn(`Unhandled step type: ${step.type}`)
          break
      }
    } catch (error) {
      logger.error(`Error executing workflow instance ${instanceId}:`, error)

      // Mark instance as failed
      await prisma.workflowInstance.update({
        where: { id: instanceId },
        data: {
          status: WorkflowInstanceStatus.FAILED,
          completedAt: new Date(),
          result: {
            error: (error as Error).message,
          },
        },
      })
    }
  }

  private async handleApprovalStep(instance: WorkflowInstance, step: any): Promise<void> {
    // Approval steps require user interaction - just wait
    logger.info(`Approval step ${step.id} waiting for user action in instance ${instance.id}`)
  }

  private async handleNotificationStep(instance: WorkflowInstance, step: any): Promise<void> {
    try {
      const { recipients, title, message } = step.config

      // Send notifications (placeholder - would integrate with notification service)
      logger.info(`Sending notifications for step ${step.id} in instance ${instance.id}`)

      // Auto-complete step
      await this.completeWorkflowStep({
        instanceId: instance.id,
        stepId: step.id,
        userId: instance.createdBy,
        result: {
          notificationSent: true,
          recipients,
        },
      })
    } catch (error) {
      logger.error(`Error handling notification step ${step.id}:`, error)
    }
  }

  private async handleConditionStep(instance: WorkflowInstance, step: any): Promise<void> {
    try {
      const { condition } = step.config

      // Simple condition evaluation (placeholder)
      let result = false
      if (typeof condition === "string") {
        // Evaluate condition against instance data
        result = this.evaluateCondition(condition, instance.data)
      }

      // Determine next step based on condition result
      const nextStepId = result ? step.config.trueStepId : step.config.falseStepId

      await this.completeWorkflowStep({
        instanceId: instance.id,
        stepId: step.id,
        userId: instance.createdBy,
        result: { condition, result },
        nextStepId,
      })
    } catch (error) {
      logger.error(`Error handling condition step ${step.id}:`, error)
    }
  }

  private async handleActionStep(instance: WorkflowInstance, step: any): Promise<void> {
    try {
      const { action, params } = step.config

      // Execute action (placeholder)
      const result = await this.executeAction(action, params, instance)

      await this.completeWorkflowStep({
        instanceId: instance.id,
        stepId: step.id,
        userId: instance.createdBy,
        result,
      })
    } catch (error) {
      logger.error(`Error handling action step ${step.id}:`, error)
    }
  }

  private async handleDelayStep(instance: WorkflowInstance, step: any): Promise<void> {
    try {
      const { duration, unit } = step.config

      // Calculate delay in milliseconds
      let delayMs = 0
      switch (unit) {
        case "seconds":
          delayMs = duration * 1000
          break
        case "minutes":
          delayMs = duration * 60 * 1000
          break
        case "hours":
          delayMs = duration * 60 * 60 * 1000
          break
        case "days":
          delayMs = duration * 24 * 60 * 60 * 1000
          break
        default:
          delayMs = duration * 1000
      }

      // Schedule job to complete step after delay
      await schedulerService.createJob({
        name: "workflow_delay_completion",
        type: "SCHEDULED" as any,
        scheduledFor: new Date(Date.now() + delayMs),
        data: {
          instanceId: instance.id,
          stepId: step.id,
          userId: instance.createdBy,
        },
        maxRetries: 3,
        tenantId: instance.tenantId,
      })

      logger.info(`Scheduled delay of ${duration} ${unit} for workflow instance ${instance.id} step ${step.id}`)
    } catch (error) {
      logger.error(`Error handling delay step ${step.id}:`, error)
    }
  }

  private evaluateCondition(condition: string, data: any): boolean {
    // Simple condition evaluation - in production this would be more sophisticated
    try {
      // eslint-disable-next-line no-new-func
      const evalFn = new Function("data", `return ${condition}`)
      return evalFn(data)
    } catch {
      return false
    }
  }

  private async executeAction(action: string, params: any, instance: WorkflowInstance): Promise<any> {
    // Placeholder for action execution
    logger.info(`Executing action ${action} for instance ${instance.id}`)
    return { action, params, success: true }
  }

  private registerJobHandlers(): void {
    // Register job handler for workflow delay completion
    schedulerService.registerJobHandler("workflow_delay_completion", async (job) => {
      try {
        const { instanceId, stepId, userId } = job.data

        await this.completeWorkflowStep({
          instanceId,
          stepId,
          userId,
          result: { delayed: true },
        })

        return { success: true }
      } catch (error) {
        logger.error("Error handling workflow delay completion job:", error)
        throw error
      }
    })
  }
}

// Export singleton instance
export const workflowService = new WorkflowService()
