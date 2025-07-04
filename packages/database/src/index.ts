// =============================================================================
// DATABASE PACKAGE - MAIN EXPORTS
// =============================================================================
// High-level database layer with PostgreSQL and Prisma ORM

// Export Prisma client and types
export * from './client'
export * from './types'

// Export all repositories
export { BaseRepository } from './repositories/base.repository'
export { UserRepository } from './repositories/user.repository'
export { TenantRepository } from './repositories/tenant.repository'
export { ContentTypeRepository } from './repositories/content-type.repository'
export { ContentRepository } from './repositories/content.repository'
export { MediaRepository } from './repositories/media.repository'
export { WebhookRepository, WebhookDeliveryRepository } from './repositories/webhook.repository'
export { WorkflowRepository, WorkflowEntryRepository } from './repositories/workflow.repository'

// Export Prisma types for external use
export type {
  User,
  Tenant,
  ContentType,
  Content,
  Media,
  Webhook,
  WorkflowEntry,
  Workflow,
  UserRole,
  UserStatus,
  TenantPlan,
  TenantStatus,
  ContentStatus,
  MediaType,
  WebhookEvent,
  WebhookStatus,
  WorkflowEntryStatus,
  Prisma,
} from '@prisma/client'

// Repository factory for easy instantiation
import { PrismaClient } from '@prisma/client'
import { UserRepository } from './repositories/user.repository'
import { TenantRepository } from './repositories/tenant.repository'
import { ContentTypeRepository } from './repositories/content-type.repository'
import { ContentRepository } from './repositories/content.repository'
import { MediaRepository } from './repositories/media.repository'
import { WebhookRepository, WebhookDeliveryRepository } from './repositories/webhook.repository'
import { WorkflowRepository, WorkflowEntryRepository } from './repositories/workflow.repository'

export interface DatabaseRepositories {
  user: UserRepository
  tenant: TenantRepository
  contentType: ContentTypeRepository
  content: ContentRepository
  media: MediaRepository
  webhook: WebhookRepository
  webhookDelivery: WebhookDeliveryRepository
  workflow: WorkflowRepository
  workflowEntry: WorkflowEntryRepository
}

/**
 * Create all repositories with a shared Prisma client
 */
export function createRepositories(prisma: PrismaClient): DatabaseRepositories {
  return {
    user: new UserRepository(prisma),
    tenant: new TenantRepository(prisma),
    contentType: new ContentTypeRepository(prisma),
    content: new ContentRepository(prisma),
    media: new MediaRepository(prisma),
    webhook: new WebhookRepository(prisma),
    webhookDelivery: new WebhookDeliveryRepository(prisma),
    workflow: new WorkflowRepository(prisma),
    workflowEntry: new WorkflowEntryRepository(prisma),
  }
}

/**
 * Database service class that provides access to all repositories
 */
export class DatabaseService {
  public readonly repositories: DatabaseRepositories

  constructor(private prisma: PrismaClient) {
    this.repositories = createRepositories(prisma)
  }

  /**
   * Get the Prisma client instance
   */
  get client(): PrismaClient {
    return this.prisma
  }

  /**
   * Execute a transaction
   */
  async transaction<T>(
    fn: (repositories: DatabaseRepositories, prisma: PrismaClient) => Promise<T>
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const transactionRepositories = createRepositories(tx as PrismaClient)
      return fn(transactionRepositories, tx as PrismaClient)
    })
  }

  /**
   * Disconnect from the database
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect()
  }

  /**
   * Connect to the database
   */
  async connect(): Promise<void> {
    await this.prisma.$connect()
  }

  /**
   * Check database health
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; latency?: number }> {
    try {
      const start = Date.now()
      await this.prisma.$queryRaw`SELECT 1`
      const latency = Date.now() - start

      return { status: 'healthy', latency }
    } catch (error) {
      return { status: 'unhealthy' }
    }
  }

  /**
   * Get database statistics
   */
  async getStatistics(): Promise<{
    users: number
    tenants: number
    contentTypes: number
    contents: number
    media: number
    webhooks: number
    workflows: number
    workflowEntries: number
  }> {
    try {
      const [
        users,
        tenants,
        contentTypes,
        contents,
        media,
        webhooks,
        workflows,
        workflowEntries,
      ] = await Promise.all([
        this.repositories.user.count(),
        this.repositories.tenant.count(),
        this.repositories.contentType.count(),
        this.repositories.content.count(),
        this.repositories.media.count(),
        this.repositories.webhook.count(),
        this.repositories.workflow.count(),
        this.repositories.workflowEntry.count(),
      ])

      return {
        users,
        tenants,
        contentTypes,
        contents,
        media,
        webhooks,
        workflows,
        workflowEntries,
      }
    } catch (error) {
      throw new Error(`Failed to get database statistics: ${error}`)
    }
  }
}

// Default export for convenience
export default DatabaseService
