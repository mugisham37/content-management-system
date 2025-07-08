import { EventEmitter } from "events"
import cron from "node-cron"
import { Pool } from "pg"
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
export interface IJob {
  id: string
  name: string
  type: "cron" | "immediate" | "scheduled"
  status: JobStatus
  cron_expression?: string
  data: any
  result?: any
  error?: string
  scheduled_for?: Date
  started_at?: Date
  completed_at?: Date
  created_at: Date
  updated_at: Date
  next_run_at?: Date
  last_run_at?: Date
  run_count: number
  max_runs?: number
  retry_count: number
  max_retries: number
  priority: number
  tags: string[]
  run_immediately?: boolean
}

// Define job handler type
type JobHandler = (job: IJob) => Promise<any>

// Database connection pool
let dbPool: Pool

// Initialize database connection
export function initializeDatabase(connectionString: string): void {
  dbPool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  })
}

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

      // Ensure database tables exist
      await this.ensureTablesExist()

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
   * Ensure database tables exist
   */
  private async ensureTablesExist(): Promise<void> {
    const client = await dbPool.connect()
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS jobs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL,
          type VARCHAR(20) NOT NULL CHECK (type IN ('cron', 'immediate', 'scheduled')),
          status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
          cron_expression VARCHAR(255),
          data JSONB DEFAULT '{}',
          result JSONB,
          error TEXT,
          scheduled_for TIMESTAMP WITH TIME ZONE,
          started_at TIMESTAMP WITH TIME ZONE,
          completed_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          next_run_at TIMESTAMP WITH TIME ZONE,
          last_run_at TIMESTAMP WITH TIME ZONE,
          run_count INTEGER DEFAULT 0,
          max_runs INTEGER,
          retry_count INTEGER DEFAULT 0,
          max_retries INTEGER DEFAULT 3,
          priority INTEGER DEFAULT 0,
          tags TEXT[] DEFAULT '{}',
          run_immediately BOOLEAN DEFAULT FALSE
        )
      `)

      // Create indexes for better performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_jobs_name ON jobs(name);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
        CREATE INDEX IF NOT EXISTS idx_jobs_next_run_at ON jobs(next_run_at);
        CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_for ON jobs(scheduled_for);
        CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority);
        CREATE INDEX IF NOT EXISTS idx_jobs_tags ON jobs USING GIN(tags);
        CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
        CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
        CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs(updated_at);
      `)

      // Create trigger for updated_at
      await client.query(`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ language 'plpgsql';
      `)

      await client.query(`
        DROP TRIGGER IF EXISTS update_jobs_updated_at ON jobs;
        CREATE TRIGGER update_jobs_updated_at
          BEFORE UPDATE ON jobs
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
      `)
    } finally {
      client.release()
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

    // Close database connections
    if (dbPool) {
      await dbPool.end()
    }

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
    const client = await dbPool.connect()
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
        const task = cron.schedule(jobData.cronExpression, () => {})
        nextRunAt = task.nextDate().toDate()
        task.stop()
      } else if (jobData.type === "scheduled") {
        nextRunAt = jobData.scheduledFor
      } else if (jobData.type === "immediate" || jobData.runImmediately) {
        nextRunAt = new Date()
      }

      // Validate cron expression
      if (jobData.cronExpression && !cron.validate(jobData.cronExpression)) {
        throw new Error("Invalid cron expression")
      }

      // Create job
      const result = await client.query(
        `
        INSERT INTO jobs (
          name, type, status, cron_expression, data, scheduled_for, 
          next_run_at, max_runs, max_retries, priority, tags, run_immediately
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `,
        [
          jobData.name,
          jobData.type,
          JobStatus.PENDING,
          jobData.cronExpression,
          JSON.stringify(jobData.data || {}),
          jobData.scheduledFor,
          nextRunAt,
          jobData.maxRuns,
          jobData.maxRetries || 3,
          jobData.priority || 0,
          jobData.tags || [],
          jobData.runImmediately || false,
        ],
      )

      const job = this.mapRowToJob(result.rows[0])

      logger.info(`Created job: ${job.name} (${job.id})`)

      // Emit event
      this.emit("job:created", job)

      // If it's a cron job, schedule it
      if (job.type === "cron" && job.cron_expression) {
        this.scheduleCronJob(job)
      }

      // If it should run immediately, trigger processing
      if (job.run_immediately) {
        setImmediate(() => this.processJobs())
      }

      return job
    } catch (error) {
      logger.error("Error creating job:", error)
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Get a job by ID
   */
  public async getJob(jobId: string): Promise<IJob | null> {
    const client = await dbPool.connect()
    try {
      const result = await client.query("SELECT * FROM jobs WHERE id = $1", [jobId])
      return result.rows.length > 0 ? this.mapRowToJob(result.rows[0]) : null
    } finally {
      client.release()
    }
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
    const client = await dbPool.connect()
    try {
      const { status, name, type, tags, page = 1, limit = 20, sort = "created_at", order = "desc" } = options

      // Build WHERE clause
      const conditions: string[] = []
      const params: any[] = []
      let paramIndex = 1

      if (status) {
        if (Array.isArray(status)) {
          conditions.push(`status = ANY($${paramIndex})`)
          params.push(status)
        } else {
          conditions.push(`status = $${paramIndex}`)
          params.push(status)
        }
        paramIndex++
      }

      if (name) {
        conditions.push(`name = $${paramIndex}`)
        params.push(name)
        paramIndex++
      }

      if (type) {
        conditions.push(`type = $${paramIndex}`)
        params.push(type)
        paramIndex++
      }

      if (tags && tags.length > 0) {
        conditions.push(`tags @> $${paramIndex}`)
        params.push(tags)
        paramIndex++
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

      // Count total
      const countResult = await client.query(`SELECT COUNT(*) FROM jobs ${whereClause}`, params)
      const total = Number.parseInt(countResult.rows[0].count)

      // Get jobs
      const validSortColumns = ["created_at", "updated_at", "name", "status", "priority", "next_run_at"]
      const sortColumn = validSortColumns.includes(sort) ? sort : "created_at"
      const sortOrder = order === "asc" ? "ASC" : "DESC"

      const offset = (page - 1) * limit
      const jobsResult = await client.query(
        `
        SELECT * FROM jobs ${whereClause}
        ORDER BY ${sortColumn} ${sortOrder}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
        [...params, limit, offset],
      )

      const jobs = jobsResult.rows.map((row) => this.mapRowToJob(row))

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
    } finally {
      client.release()
    }
  }

  /**
   * Cancel a job
   */
  public async cancelJob(jobId: string): Promise<IJob | null> {
    const client = await dbPool.connect()
    try {
      // Get current job
      const jobResult = await client.query("SELECT * FROM jobs WHERE id = $1", [jobId])
      if (jobResult.rows.length === 0) {
        return null
      }

      const currentJob = this.mapRowToJob(jobResult.rows[0])

      // Only pending or running jobs can be cancelled
      if (currentJob.status !== JobStatus.PENDING && currentJob.status !== JobStatus.RUNNING) {
        throw new Error(`Cannot cancel job with status: ${currentJob.status}`)
      }

      // Update job status
      const result = await client.query(
        `
        UPDATE jobs SET status = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `,
        [JobStatus.CANCELLED, jobId],
      )

      const job = this.mapRowToJob(result.rows[0])

      // Emit event
      this.emit("job:cancelled", job)

      // If it's a cron job, stop it
      if (job.type === "cron" && this.cronJobs.has(job.id)) {
        const cronJob = this.cronJobs.get(job.id)
        if (cronJob) {
          cronJob.stop()
          this.cronJobs.delete(job.id)
        }
      }

      logger.info(`Cancelled job: ${job.name} (${job.id})`)
      return job
    } catch (error) {
      logger.error(`Error cancelling job ${jobId}:`, error)
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Retry a failed job
   */
  public async retryJob(jobId: string): Promise<IJob | null> {
    const client = await dbPool.connect()
    try {
      // Get current job
      const jobResult = await client.query("SELECT * FROM jobs WHERE id = $1", [jobId])
      if (jobResult.rows.length === 0) {
        return null
      }

      const currentJob = this.mapRowToJob(jobResult.rows[0])

      // Only failed jobs can be retried
      if (currentJob.status !== JobStatus.FAILED) {
        throw new Error(`Cannot retry job with status: ${currentJob.status}`)
      }

      // Reset job status
      const result = await client.query(
        `
        UPDATE jobs SET 
          status = $1, 
          next_run_at = $2, 
          error = NULL,
          updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `,
        [JobStatus.PENDING, new Date(), jobId],
      )

      const job = this.mapRowToJob(result.rows[0])

      // Emit event
      this.emit("job:retry", job)

      // Trigger processing
      setImmediate(() => this.processJobs())

      logger.info(`Retrying job: ${job.name} (${job.id})`)
      return job
    } catch (error) {
      logger.error(`Error retrying job ${jobId}:`, error)
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Delete a job
   */
  public async deleteJob(jobId: string): Promise<boolean> {
    const client = await dbPool.connect()
    try {
      // Get job first
      const jobResult = await client.query("SELECT * FROM jobs WHERE id = $1", [jobId])
      if (jobResult.rows.length === 0) {
        return false
      }

      const job = this.mapRowToJob(jobResult.rows[0])

      // If it's a cron job, stop it
      if (job.type === "cron" && this.cronJobs.has(job.id)) {
        const cronJob = this.cronJobs.get(job.id)
        if (cronJob) {
          cronJob.stop()
          this.cronJobs.delete(job.id)
        }
      }

      // Delete job
      const result = await client.query("DELETE FROM jobs WHERE id = $1", [jobId])

      // Emit event
      this.emit("job:deleted", job)

      logger.info(`Deleted job: ${job.name} (${job.id})`)
      return result.rowCount > 0
    } catch (error) {
      logger.error(`Error deleting job ${jobId}:`, error)
      throw error
    } finally {
      client.release()
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
    const client = await dbPool.connect()
    try {
      const { olderThan, status, keepLastN } = options

      if (keepLastN && keepLastN > 0) {
        // Group by job name and delete oldest ones beyond keepLastN
        const conditions: string[] = []
        const params: any[] = []
        let paramIndex = 1

        if (olderThan) {
          conditions.push(`updated_at < $${paramIndex}`)
          params.push(olderThan)
          paramIndex++
        }

        if (status && status.length > 0) {
          conditions.push(`status = ANY($${paramIndex})`)
          params.push(status)
          paramIndex++
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

        // Get distinct job names
        const namesResult = await client.query(
          `
          SELECT DISTINCT name FROM jobs ${whereClause}
        `,
          params,
        )

        let totalDeleted = 0
        for (const row of namesResult.rows) {
          const jobName = row.name

          // Delete old jobs for this name, keeping the latest N
          const deleteResult = await client.query(
            `
            DELETE FROM jobs 
            WHERE id IN (
              SELECT id FROM jobs 
              WHERE name = $1 ${conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : ""}
              ORDER BY updated_at DESC 
              OFFSET $${paramIndex}
            )
          `,
            [jobName, ...params, keepLastN],
          )

          totalDeleted += deleteResult.rowCount || 0
        }

        logger.info(`Cleaned up ${totalDeleted} old jobs`)
        return totalDeleted
      } else {
        // Simple deletion
        const conditions: string[] = []
        const params: any[] = []
        let paramIndex = 1

        if (olderThan) {
          conditions.push(`updated_at < $${paramIndex}`)
          params.push(olderThan)
          paramIndex++
        }

        if (status && status.length > 0) {
          conditions.push(`status = ANY($${paramIndex})`)
          params.push(status)
          paramIndex++
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

        const result = await client.query(`DELETE FROM jobs ${whereClause}`, params)
        const deletedCount = result.rowCount || 0

        logger.info(`Cleaned up ${deletedCount} old jobs`)
        return deletedCount
      }
    } catch (error) {
      logger.error("Error cleaning up jobs:", error)
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Get job statistics
   */
  public async getJobStats(): Promise<{
    total: number
    byStatus: Record<JobStatus, number>
    byType: Record<string, number>
  }> {
    const client = await dbPool.connect()
    try {
      // Get total count
      const totalResult = await client.query("SELECT COUNT(*) as total FROM jobs")
      const total = Number.parseInt(totalResult.rows[0].total)

      // Get count by status
      const statusResult = await client.query(`
        SELECT status, COUNT(*) as count 
        FROM jobs 
        GROUP BY status
      `)

      const byStatus: Record<JobStatus, number> = {
        [JobStatus.PENDING]: 0,
        [JobStatus.RUNNING]: 0,
        [JobStatus.COMPLETED]: 0,
        [JobStatus.FAILED]: 0,
        [JobStatus.CANCELLED]: 0,
      }

      statusResult.rows.forEach((row) => {
        byStatus[row.status as JobStatus] = Number.parseInt(row.count)
      })

      // Get count by type
      const typeResult = await client.query(`
        SELECT type, COUNT(*) as count 
        FROM jobs 
        GROUP BY type
      `)

      const byType: Record<string, number> = {}
      typeResult.rows.forEach((row) => {
        byType[row.type] = Number.parseInt(row.count)
      })

      return { total, byStatus, byType }
    } finally {
      client.release()
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
    const client = await dbPool.connect()
    try {
      // Find all active cron jobs
      const result = await client.query(
        `
        SELECT * FROM jobs 
        WHERE type = 'cron' AND status = $1
      `,
        [JobStatus.PENDING],
      )

      const cronJobs = result.rows.map((row) => this.mapRowToJob(row))

      // Schedule each job
      for (const job of cronJobs) {
        this.scheduleCronJob(job)
      }

      logger.info(`Scheduled ${cronJobs.length} cron jobs`)
    } catch (error) {
      logger.error("Error scheduling cron jobs:", error)
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Schedule a single cron job
   */
  private scheduleCronJob(job: IJob): void {
    if (!job.cron_expression) {
      logger.warn(`Cannot schedule cron job without expression: ${job.id}`)
      return
    }

    // Stop existing job if it exists
    if (this.cronJobs.has(job.id)) {
      const existingJob = this.cronJobs.get(job.id)
      if (existingJob) {
        existingJob.stop()
      }
    }

    // Schedule new job
    const task = cron.schedule(job.cron_expression, async () => {
      try {
        // Create a new job instance for this run
        await this.createJob({
          name: job.name,
          type: "immediate", // Run immediately
          data: job.data,
          maxRetries: job.max_retries,
          priority: job.priority,
          tags: job.tags,
          runImmediately: true,
        })
      } catch (error) {
        logger.error(`Error creating job from cron ${job.id}:`, error)
      }
    })

    // Store the task
    this.cronJobs.set(job.id, task)
    logger.info(`Scheduled cron job: ${job.name} (${job.id}) with expression: ${job.cron_expression}`)
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
    const client = await dbPool.connect()

    try {
      // Find pending jobs that are due
      const result = await client.query(
        `
        SELECT * FROM jobs 
        WHERE status = $1 
        AND (next_run_at <= $2 OR run_immediately = true)
        ORDER BY priority DESC, next_run_at ASC
        LIMIT $3
      `,
        [JobStatus.PENDING, new Date(), this.concurrency],
      )

      const jobs = result.rows.map((row) => this.mapRowToJob(row))

      if (jobs.length === 0) {
        return
      }

      logger.debug(`Processing ${jobs.length} jobs`)

      // Process jobs in parallel
      await Promise.all(
        jobs.map(async (job) => {
          const jobClient = await dbPool.connect()
          try {
            // Mark job as running
            await jobClient.query(
              `
              UPDATE jobs SET 
                status = $1, 
                started_at = $2, 
                run_immediately = false,
                updated_at = NOW()
              WHERE id = $3
            `,
              [JobStatus.RUNNING, new Date(), job.id],
            )

            job.status = JobStatus.RUNNING
            job.started_at = new Date()

            // Emit event
            this.emit("job:started", job)

            // Get handler
            const handler = this.jobHandlers.get(job.name)
            if (!handler) {
              throw new Error(`No handler registered for job: ${job.name}`)
            }

            // Execute handler
            const result = await handler(job)

            // Calculate next run time for cron jobs
            let nextRunAt: Date | undefined
            if (job.type === "cron" && job.cron_expression) {
              const task = cron.schedule(job.cron_expression, () => {})
              nextRunAt = task.nextDate().toDate()
              task.stop()
            }

            // Update job as completed
            await jobClient.query(
              `
              UPDATE jobs SET 
                status = $1, 
                result = $2, 
                completed_at = $3,
                last_run_at = $4,
                run_count = run_count + 1,
                next_run_at = $5,
                updated_at = NOW()
              WHERE id = $6
            `,
              [JobStatus.COMPLETED, JSON.stringify(result), new Date(), job.started_at, nextRunAt, job.id],
            )

            job.status = JobStatus.COMPLETED
            job.result = result
            job.completed_at = new Date()

            // Emit event
            this.emit("job:completed", job)
            logger.info(`Completed job: ${job.name} (${job.id})`)
          } catch (error) {
            // Handle job failure
            const newRetryCount = job.retry_count + 1
            const shouldRetry = newRetryCount < job.max_retries
            const newStatus = shouldRetry ? JobStatus.PENDING : JobStatus.FAILED

            let nextRunAt: Date | undefined
            if (shouldRetry) {
              // Exponential backoff: 1min, 2min, 4min, etc.
              nextRunAt = new Date(Date.now() + 60000 * Math.pow(2, newRetryCount))
            }

            await jobClient.query(
              `
              UPDATE jobs SET 
                status = $1, 
                error = $2, 
                retry_count = $3,
                next_run_at = $4,
                updated_at = NOW()
              WHERE id = $5
            `,
              [newStatus, (error as Error).message, newRetryCount, nextRunAt, job.id],
            )

            job.status = newStatus
            job.error = (error as Error).message
            job.retry_count = newRetryCount

            if (shouldRetry) {
              logger.info(`Scheduling retry ${newRetryCount} for job: ${job.name} (${job.id})`)
            }

            // Emit event
            this.emit("job:failed", job, error)
            logger.error(`Failed job: ${job.name} (${job.id}):`, error)
          } finally {
            jobClient.release()
          }
        }),
      )
    } catch (error) {
      logger.error("Error in job processing:", error)
    } finally {
      client.release()
      this.isProcessing = false

      // Check if there are more jobs to process
      const pendingClient = await dbPool.connect()
      try {
        const pendingResult = await pendingClient.query(
          `
          SELECT COUNT(*) as count FROM jobs 
          WHERE status = $1 
          AND (next_run_at <= $2 OR run_immediately = true)
        `,
          [JobStatus.PENDING, new Date()],
        )

        const pendingCount = Number.parseInt(pendingResult.rows[0].count)
        if (pendingCount > 0) {
          setImmediate(() => this.processJobs())
        }
      } finally {
        pendingClient.release()
      }
    }
  }

  /**
   * Map database row to job interface
   */
  private mapRowToJob(row: any): IJob {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      status: row.status,
      cron_expression: row.cron_expression,
      data: row.data,
      result: row.result,
      error: row.error,
      scheduled_for: row.scheduled_for,
      started_at: row.started_at,
      completed_at: row.completed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      next_run_at: row.next_run_at,
      last_run_at: row.last_run_at,
      run_count: row.run_count,
      max_runs: row.max_runs,
      retry_count: row.retry_count,
      max_retries: row.max_retries,
      priority: row.priority,
      tags: row.tags,
      run_immediately: row.run_immediately,
    }
  }
}

// Export singleton instance
export const schedulerService = new SchedulerService()
