import { EventEmitter } from "events"
import cron from "node-cron"
import mongoose, { Schema, type Document } from "mongoose"
import { logger } from "../utils/logger"

// Define job status enum
export enum JobStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

// Define job interface
export interface IJob extends Document {
  name: string
  type: "cron" | "immediate" | "scheduled"
  status: JobStatus
  cronExpression?: string
  data: any
  result?: any
  error?: string
  scheduledFor?: Date
  startedAt?: Date
  completedAt?: Date
  createdAt: Date
  updatedAt: Date
  nextRunAt?: Date
  lastRunAt?: Date
  runCount: number
  maxRuns?: number
  retryCount: number
  maxRetries: number
  priority: number
  tags: string[]
  runImmediately?: boolean
}

// Define job schema
const jobSchema = new Schema<IJob>(
  {
    name: {
      type: String,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["cron", "immediate", "scheduled"],
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(JobStatus),
      default: JobStatus.PENDING,
      index: true,
    },
    cronExpression: {
      type: String,
      validate: {
        validator: (v: string) => (v ? cron.validate(v) : true),
        message: "Invalid cron expression",
      },
    },
    data: {
      type: Schema.Types.Mixed,
      default: {},
    },
    result: Schema.Types.Mixed,
    error: String,
    scheduledFor: {
      type: Date,
      index: true,
    },
    startedAt: Date,
    completedAt: Date,
    nextRunAt: {
      type: Date,
      index: true,
    },
    lastRunAt: Date,
    runCount: {
      type: Number,
      default: 0,
    },
    maxRuns: Number,
    retryCount: {
      type: Number,
      default: 0,
    },
    maxRetries: {
      type: Number,
      default: 3,
    },
    priority: {
      type: Number,
      default: 0,
      index: true,
    },
    tags: {
      type: [String],
      index: true,
    },
    runImmediately: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
)

// Create model
export const JobModel = mongoose.model<IJob>("Job", jobSchema)

// Define job handler type
type JobHandler = (job: IJob) => Promise<any>

// Scheduler service
export class SchedulerService extends EventEmitter {
  private jobHandlers: Map<string, JobHandler> = new Map()
  private cronJobs: Map<string, cron.ScheduledTask> = new Map()
  private pollingInterval: NodeJS.Timeout | null = null
  private isProcessing = false
  private concurrency = 5
  private pollIntervalMs = 5000 // 5 seconds

  constructor() {
    super()
    this.setMaxListeners(100) // Allow more listeners
  }

  /**
   * Initialize the scheduler
   */
  public async initialize(): Promise<void> {
    try {
      logger.info("Initializing scheduler service...")

      // Start polling for jobs
      this.startPolling()

      // Schedule cron jobs
      await this.scheduleCronJobs()

      logger.info("Scheduler service initialized")
    } catch (error) {
      logger.error("Failed to initialize scheduler service:", error)
      throw error
    }
  }

  /**
   * Shutdown the scheduler
   */
  public async shutdown(): Promise<void> {
    logger.info("Shutting down scheduler service...")

    // Stop polling
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }

    // Stop all cron jobs
    for (const [jobId, task] of this.cronJobs.entries()) {
      task.stop()
      logger.info(`Stopped cron job: ${jobId}`)
    }
    this.cronJobs.clear()

    logger.info("Scheduler service shut down")
  }

  /**
   * Register a job handler
   */
  public registerJobHandler(jobName: string, handler: JobHandler): void {
    this.jobHandlers.set(jobName, handler)
    logger.info(`Registered job handler for: ${jobName}`)
  }

  /**
   * Create a new job
   */
  public async createJob(jobData: {
    name: string
    type: "cron" | "immediate" | "scheduled"
    cronExpression?: string
    data?: any
    scheduledFor?: Date
    maxRuns?: number
    maxRetries?: number
    priority?: number
    tags?: string[]
    runImmediately?: boolean
  }): Promise<IJob> {
    try {
      // Validate job data
      if (jobData.type === "cron" && !jobData.cronExpression) {
        throw new Error("Cron expression is required for cron jobs")
      }

      if (jobData.type === "scheduled" && !jobData.scheduledFor) {
        throw new Error("scheduledFor is required for scheduled jobs")
      }

      // Calculate next run time for cron jobs
      let nextRunAt: Date | undefined
      if (jobData.type === "cron" && jobData.cronExpression) {
        nextRunAt = cron
          .schedule(jobData.cronExpression, () => {})
          .nextDate()
          .toDate()
      } else if (jobData.type === "scheduled") {
        nextRunAt = jobData.scheduledFor
      } else if (jobData.type === "immediate" || jobData.runImmediately) {
        nextRunAt = new Date()
      }

      // Create job
      const job = new JobModel({
        name: jobData.name,
        type: jobData.type,
        status: JobStatus.PENDING,
        cronExpression: jobData.cronExpression,
        data: jobData.data || {},
        scheduledFor: jobData.scheduledFor,
        nextRunAt,
        maxRuns: jobData.maxRuns,
        maxRetries: jobData.maxRetries || 3,
        priority: jobData.priority || 0,
        tags: jobData.tags || [],
        runImmediately: jobData.runImmediately,
      })

      await job.save()
      logger.info(`Created job: ${job.name} (${job._id})`)

      // Emit event
      this.emit("job:created", job)

      // If it's a cron job, schedule it
      if (job.type === "cron" && job.cronExpression) {
        this.scheduleCronJob(job)
      }

      // If it should run immediately, trigger processing
      if (job.runImmediately) {
        setImmediate(() => this.processJobs())
      }

      return job
    } catch (error) {
      logger.error("Error creating job:", error)
      throw error
    }
  }

  /**
   * Get a job by ID
   */
  public async getJob(jobId: string): Promise<IJob | null> {
    return JobModel.findById(jobId)
  }

  /**
   * Get jobs with filtering and pagination
   */
  public async getJobs(
    options: {
      status?: JobStatus | JobStatus[]
      name?: string
      type?: "cron" | "immediate" | "scheduled"
      tags?: string[]
      page?: number
      limit?: number
      sort?: string
      order?: "asc" | "desc"
    } = {},
  ): Promise<{
    jobs: IJob[]
    total: number
    page: number
    limit: number
    pages: number
  }> {
    try {
      const { status, name, type, tags, page = 1, limit = 20, sort = "createdAt", order = "desc" } = options

      // Build query
      const query: any = {}
      if (status) {
        query.status = Array.isArray(status) ? { $in: status } : status
      }
      if (name) {
        query.name = name
      }
      if (type) {
        query.type = type
      }
      if (tags && tags.length > 0) {
        query.tags = { $all: tags }
      }

      // Count total
      const total = await JobModel.countDocuments(query)

      // Get jobs
      const jobs = await JobModel.find(query)
        .sort({ [sort]: order === "asc" ? 1 : -1 })
        .skip((page - 1) * limit)
        .limit(limit)

      return {
        jobs,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      }
    } catch (error) {
      logger.error("Error getting jobs:", error)
      throw error
    }
  }

  /**
   * Cancel a job
   */
  public async cancelJob(jobId: string): Promise<IJob | null> {
    try {
      const job = await JobModel.findById(jobId)
      if (!job) {
        return null
      }

      // Only pending or scheduled jobs can be cancelled
      if (job.status !== JobStatus.PENDING && job.status !== JobStatus.RUNNING) {
        throw new Error(`Cannot cancel job with status: ${job.status}`)
      }

      // Update job status
      job.status = JobStatus.CANCELLED
      await job.save()

      // Emit event
      this.emit("job:cancelled", job)

      // If it's a cron job, stop it
      if (job.type === "cron" && this.cronJobs.has(job._id.toString())) {
        const cronJob = this.cronJobs.get(job._id.toString())
        if (cronJob) {
          cronJob.stop()
          this.cronJobs.delete(job._id.toString())
        }
      }

      logger.info(`Cancelled job: ${job.name} (${job._id})`)
      return job
    } catch (error) {
      logger.error(`Error cancelling job ${jobId}:`, error)
      throw error
    }
  }

  /**
   * Retry a failed job
   */
  public async retryJob(jobId: string): Promise<IJob | null> {
    try {
      const job = await JobModel.findById(jobId)
      if (!job) {
        return null
      }

      // Only failed jobs can be retried
      if (job.status !== JobStatus.FAILED) {
        throw new Error(`Cannot retry job with status: ${job.status}`)
      }

      // Reset job status
      job.status = JobStatus.PENDING
      job.nextRunAt = new Date()
      job.error = undefined
      await job.save()

      // Emit event
      this.emit("job:retry", job)

      // Trigger processing
      setImmediate(() => this.processJobs())

      logger.info(`Retrying job: ${job.name} (${job._id})`)
      return job
    } catch (error) {
      logger.error(`Error retrying job ${jobId}:`, error)
      throw error
    }
  }

  /**
   * Delete a job
   */
  public async deleteJob(jobId: string): Promise<boolean> {
    try {
      const job = await JobModel.findById(jobId)
      if (!job) {
        return false
      }

      // If it's a cron job, stop it
      if (job.type === "cron" && this.cronJobs.has(job._id.toString())) {
        const cronJob = this.cronJobs.get(job._id.toString())
        if (cronJob) {
          cronJob.stop()
          this.cronJobs.delete(job._id.toString())
        }
      }

      // Delete job
      await job.deleteOne()

      // Emit event
      this.emit("job:deleted", job)

      logger.info(`Deleted job: ${job.name} (${job._id})`)
      return true
    } catch (error) {
      logger.error(`Error deleting job ${jobId}:`, error)
      throw error
    }
  }

  /**
   * Clean up old jobs
   */
  public async cleanupJobs(
    options: {
      olderThan?: Date
      status?: JobStatus[]
      keepLastN?: number
    } = {},
  ): Promise<number> {
    try {
      const { olderThan, status, keepLastN } = options
      const query: any = {}

      // Filter by date
      if (olderThan) {
        query.updatedAt = { $lt: olderThan }
      }

      // Filter by status
      if (status && status.length > 0) {
        query.status = { $in: status }
      }

      // If keepLastN is specified, we need to handle this differently
      if (keepLastN && keepLastN > 0) {
        // Group by job name and get the oldest ones beyond keepLastN
        const jobNames = await JobModel.distinct("name", query)
        let deletedCount = 0

        for (const name of jobNames) {
          const jobs = await JobModel.find({ ...query, name })
            .sort({ updatedAt: -1 })
            .skip(keepLastN)

          if (jobs.length > 0) {
            const jobIds = jobs.map((job) => job._id)
            const result = await JobModel.deleteMany({ _id: { $in: jobIds } })
            deletedCount += result.deletedCount || 0
          }
        }

        logger.info(`Cleaned up ${deletedCount} old jobs`)
        return deletedCount
      } else {
        // Simple deletion
        const result = await JobModel.deleteMany(query)
        logger.info(`Cleaned up ${result.deletedCount} old jobs`)
        return result.deletedCount || 0
      }
    } catch (error) {
      logger.error("Error cleaning up jobs:", error)
      throw error
    }
  }

  /**
   * Start polling for jobs
   */
  private startPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
    }

    this.pollingInterval = setInterval(() => {
      this.processJobs().catch((error) => {
        logger.error("Error processing jobs:", error)
      })
    }, this.pollIntervalMs)

    logger.info(`Started polling for jobs every ${this.pollIntervalMs}ms`)
  }

  /**
   * Schedule all cron jobs from the database
   */
  private async scheduleCronJobs(): Promise<void> {
    try {
      // Find all active cron jobs
      const cronJobs = await JobModel.find({
        type: "cron",
        status: { $in: [JobStatus.PENDING] },
      })

      // Schedule each job
      for (const job of cronJobs) {
        this.scheduleCronJob(job)
      }

      logger.info(`Scheduled ${cronJobs.length} cron jobs`)
    } catch (error) {
      logger.error("Error scheduling cron jobs:", error)
      throw error
    }
  }

  /**
   * Schedule a single cron job
   */
  private scheduleCronJob(job: IJob): void {
    if (!job.cronExpression) {
      logger.warn(`Cannot schedule cron job without expression: ${job._id}`)
      return
    }

    // Stop existing job if it exists
    if (this.cronJobs.has(job._id.toString())) {
      const existingJob = this.cronJobs.get(job._id.toString())
      if (existingJob) {
        existingJob.stop()
      }
    }

    // Schedule new job
    const task = cron.schedule(job.cronExpression, async () => {
      try {
        // Create a new job instance for this run
        const newJob = new JobModel({
          name: job.name,
          type: "immediate", // Run immediately
          status: JobStatus.PENDING,
          data: job.data,
          maxRetries: job.maxRetries,
          priority: job.priority,
          tags: job.tags,
        })

        await newJob.save()
        logger.info(`Created new job instance from cron: ${newJob.name} (${newJob._id})`)

        // Trigger processing
        setImmediate(() => this.processJobs())
      } catch (error) {
        logger.error(`Error creating job from cron ${job._id}:`, error)
      }
    })

    // Store the task
    this.cronJobs.set(job._id.toString(), task)
    logger.info(`Scheduled cron job: ${job.name} (${job._id}) with expression: ${job.cronExpression}`)
  }

  /**
   * Process pending jobs
   */
  private async processJobs(): Promise<void> {
    // Prevent concurrent processing
    if (this.isProcessing) {
      return
    }

    this.isProcessing = true

    try {
      // Find pending jobs that are due
      const jobs = await JobModel.find({
        status: JobStatus.PENDING,
        $or: [{ nextRunAt: { $lte: new Date() } }, { runImmediately: true }],
      })
        .sort({ priority: -1, nextRunAt: 1 })
        .limit(this.concurrency)

      if (jobs.length === 0) {
        this.isProcessing = false
        return
      }

      logger.debug(`Processing ${jobs.length} jobs`)

      // Process jobs in parallel
      await Promise.all(
        jobs.map(async (job) => {
          try {
            // Mark job as running
            job.status = JobStatus.RUNNING
            job.startedAt = new Date()
            job.runImmediately = false
            await job.save()

            // Emit event
            this.emit("job:started", job)

            // Get handler
            const handler = this.jobHandlers.get(job.name)
            if (!handler) {
              throw new Error(`No handler registered for job: ${job.name}`)
            }

            // Execute handler
            const result = await handler(job)

            // Update job
            job.status = JobStatus.COMPLETED
            job.result = result
            job.completedAt = new Date()
            job.lastRunAt = job.startedAt
            job.runCount += 1

            // Calculate next run time for cron jobs
            if (job.type === "cron" && job.cronExpression) {
              job.nextRunAt = cron
                .schedule(job.cronExpression, () => {})
                .nextDate()
                .toDate()
            } else {
              job.nextRunAt = undefined
            }

            await job.save()

            // Emit event
            this.emit("job:completed", job)

            logger.info(`Completed job: ${job.name} (${job._id})`)
          } catch (error) {
            // Handle job failure
            job.status = JobStatus.FAILED
            job.error = (error as Error).message
            job.retryCount += 1

            // If retries are available, schedule retry
            if (job.retryCount < job.maxRetries) {
              job.status = JobStatus.PENDING
              job.nextRunAt = new Date(Date.now() + 60000 * Math.pow(2, job.retryCount)) // Exponential backoff
              logger.info(`Scheduling retry ${job.retryCount} for job: ${job.name} (${job._id})`)
            }

            await job.save()

            // Emit event
            this.emit("job:failed", job, error)

            logger.error(`Failed job: ${job.name} (${job._id}):`, error)
          }
        }),
      )
    } catch (error) {
      logger.error("Error in job processing:", error)
    } finally {
      this.isProcessing = false

      // Check if there are more jobs to process
      const pendingCount = await JobModel.countDocuments({
        status: JobStatus.PENDING,
        $or: [{ nextRunAt: { $lte: new Date() } }, { runImmediately: true }],
      })

      if (pendingCount > 0) {
        setImmediate(() => this.processJobs())
      }
    }
  }
}

// Export singleton instance
export const schedulerService = new SchedulerService()
