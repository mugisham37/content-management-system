import { Client } from "@elastic/elasticsearch"

let esClient: Client | null = null

// Configuration interface
export interface ElasticsearchConfig {
  enabled: boolean
  node: string
  auth?: string
}

// Logger interface (simplified for database package)
interface Logger {
  info: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
  debug: (message: string, ...args: any[]) => void
}

// Simple console logger implementation
const logger: Logger = {
  info: (message: string, ...args: any[]) => console.log(`[INFO] ${message}`, ...args),
  error: (message: string, ...args: any[]) => console.error(`[ERROR] ${message}`, ...args),
  debug: (message: string, ...args: any[]) => console.debug(`[DEBUG] ${message}`, ...args),
}

/**
 * Initialize Elasticsearch client
 */
export const initializeElasticsearch = async (config: ElasticsearchConfig): Promise<void> => {
  if (!config.enabled) {
    logger.info("Elasticsearch is disabled, skipping initialization")
    return
  }

  try {
    logger.info("Connecting to Elasticsearch...")

    // Create Elasticsearch client
    esClient = new Client({
      node: config.node,
      auth: config.auth
        ? {
            username: config.auth.split(":")[0],
            password: config.auth.split(":")[1],
          }
        : undefined,
    })

    // Check connection
    const info = await esClient.info()
    logger.info(`Connected to Elasticsearch ${info.version.number}`)

    // Check if required indices exist and create them if needed
    await ensureIndicesExist()
  } catch (error) {
    logger.error("Failed to connect to Elasticsearch:", error)
    throw error
  }
}

/**
 * Get Elasticsearch client
 */
export const getElasticsearchClient = (): Client => {
  if (!esClient) {
    throw new Error("Elasticsearch client not initialized")
  }
  return esClient
}

/**
 * Close Elasticsearch connection
 */
export const closeElasticsearchConnection = async (): Promise<void> => {
  if (esClient) {
    await esClient.close()
    esClient = null
    logger.info("Elasticsearch connection closed")
  }
}

/**
 * Ensure required indices exist
 */
const ensureIndicesExist = async (): Promise<void> => {
  if (!esClient) return

  const requiredIndices = [
    {
      name: "content",
      mappings: {
        properties: {
          contentTypeId: { type: "keyword" },
          title: { type: "text" },
          description: { type: "text" },
          slug: { type: "keyword" },
          status: { type: "keyword" },
          locale: { type: "keyword" },
          data: { type: "object", enabled: false },
          createdAt: { type: "date" },
          updatedAt: { type: "date" },
          publishedAt: { type: "date" },
          createdBy: { type: "keyword" },
          updatedBy: { type: "keyword" },
          publishedBy: { type: "keyword" },
        },
      },
    },
    {
      name: "users",
      mappings: {
        properties: {
          email: { type: "keyword" },
          firstName: { type: "text" },
          lastName: { type: "text" },
          role: { type: "keyword" },
          isActive: { type: "boolean" },
          lastLogin: { type: "date" },
          createdAt: { type: "date" },
          updatedAt: { type: "date" },
        },
      },
    },
    {
      name: "media",
      mappings: {
        properties: {
          filename: { type: "text" },
          originalFilename: { type: "text" },
          mimeType: { type: "keyword" },
          type: { type: "keyword" },
          size: { type: "long" },
          url: { type: "keyword" },
          alt: { type: "text" },
          title: { type: "text" },
          description: { type: "text" },
          tags: { type: "keyword" },
          folder: { type: "keyword" },
          createdAt: { type: "date" },
          createdBy: { type: "keyword" },
          updatedAt: { type: "date" },
        },
      },
    },
  ]

  for (const index of requiredIndices) {
    try {
      const exists = await esClient.indices.exists({ index: index.name })

      if (!exists) {
        logger.info(`Creating Elasticsearch index: ${index.name}`)
        await esClient.indices.create({
          index: index.name,
          body: {
            mappings: index.mappings as any,
            settings: {
              number_of_shards: 1,
              number_of_replicas: 1,
              analysis: {
                analyzer: {
                  default: {
                    type: "standard",
                  },
                },
              },
            },
          },
        } as any)
        logger.info(`Created Elasticsearch index: ${index.name}`)
      } else {
        logger.info(`Elasticsearch index already exists: ${index.name}`)
      }
    } catch (error) {
      logger.error(`Error creating Elasticsearch index ${index.name}:`, error)
    }
  }
}

/**
 * Index a document
 */
export const indexDocument = async <T extends { id: string }>(
  index: string,
  document: T,
  config?: ElasticsearchConfig
): Promise<void> => {
  if (!config?.enabled || !esClient) return

  try {
    await esClient.index({
      index,
      id: document.id,
      document,
      refresh: true, // Make the document immediately searchable
    })
    logger.debug(`Indexed document in ${index}: ${document.id}`)
  } catch (error) {
    logger.error(`Error indexing document in ${index}:`, error)
    throw error
  }
}

/**
 * Update a document
 */
export const updateDocument = async <T>(
  index: string,
  id: string,
  document: Partial<T>,
  config?: ElasticsearchConfig
): Promise<void> => {
  if (!config?.enabled || !esClient) return

  try {
    await esClient.update({
      index,
      id,
      doc: document,
      refresh: true,
    })
    logger.debug(`Updated document in ${index}: ${id}`)
  } catch (error) {
    logger.error(`Error updating document in ${index}:`, error)
    throw error
  }
}

/**
 * Delete a document
 */
export const deleteDocument = async (
  index: string,
  id: string,
  config?: ElasticsearchConfig
): Promise<void> => {
  if (!config?.enabled || !esClient) return

  try {
    await esClient.delete({
      index,
      id,
      refresh: true,
    })
    logger.debug(`Deleted document from ${index}: ${id}`)
  } catch (error) {
    logger.error(`Error deleting document from ${index}:`, error)
    throw error
  }
}

/**
 * Search documents
 */
export const searchDocuments = async <T, Q, A>(
  index: string,
  query: Q,
  options: {
    from?: number
    size?: number
    sort?: any
  } = {},
  config?: ElasticsearchConfig
): Promise<{
  hits: T[]
  total: number
  aggregations?: A
}> => {
  if (!config?.enabled || !esClient) {
    return { hits: [], total: 0 }
  }

  try {
    const { from = 0, size = 10, sort } = options

    const response = await esClient.search({
      index,
      body: {
        from,
        size,
        sort,
        ...query,
      },
    })

    return {
      hits: response.hits.hits.map((hit: any) => ({
        ...(hit._source as T),
        id: hit._id,
        score: hit._score,
      })),
      total: typeof response.hits.total === 'number' ? response.hits.total : response.hits.total?.value || 0,
      aggregations: response.aggregations as A,
    }
  } catch (error) {
    logger.error(`Error searching documents in ${index}:`, error)
    throw error
  }
}

/**
 * Bulk index documents
 */
export const bulkIndexDocuments = async <T extends { id: string }>(
  index: string,
  documents: T[],
  config?: ElasticsearchConfig
): Promise<void> => {
  if (!config?.enabled || !esClient || documents.length === 0) return

  try {
    const operations = documents.flatMap((doc) => [{ index: { _index: index, _id: doc.id } }, doc])

    await esClient.bulk({
      refresh: true,
      operations,
    })

    logger.debug(`Bulk indexed ${documents.length} documents in ${index}`)
  } catch (error) {
    logger.error(`Error bulk indexing documents in ${index}:`, error)
    throw error
  }
}

/**
 * Reindex all documents from a collection
 */
export const reindexCollection = async <T extends { _id: any }>(
  index: string,
  collection: T[],
  transform?: (doc: T) => any,
  config?: ElasticsearchConfig
): Promise<void> => {
  if (!config?.enabled || !esClient) return

  try {
    // Delete index if it exists
    const indexExists = await esClient.indices.exists({ index })
    if (indexExists) {
      await esClient.indices.delete({ index })
      logger.info(`Deleted existing index: ${index}`)
    }

    // Recreate index
    await ensureIndicesExist()

    // Prepare documents for bulk indexing
    const documents = collection.map((doc) => {
      const transformed = transform ? transform(doc) : doc
      return {
        ...transformed,
        id: doc._id.toString(),
      }
    })

    // Bulk index in batches
    const batchSize = 500
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize)
      await bulkIndexDocuments(index, batch, config)
      logger.info(`Indexed batch ${i / batchSize + 1} of ${Math.ceil(documents.length / batchSize)}`)
    }

    logger.info(`Reindexed ${documents.length} documents in ${index}`)
  } catch (error) {
    logger.error(`Error reindexing collection in ${index}:`, error)
    throw error
  }
}

/**
 * Check if Elasticsearch is available and healthy
 */
export const healthCheck = async (): Promise<{
  status: 'healthy' | 'unhealthy'
  cluster?: string
  version?: string
  error?: string
}> => {
  if (!esClient) {
    return {
      status: 'unhealthy',
      error: 'Elasticsearch client not initialized'
    }
  }

  try {
    const info = await esClient.info()
    return {
      status: 'healthy',
      cluster: info.cluster_name,
      version: info.version.number
    }
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Get index statistics
 */
export const getIndexStats = async (index: string): Promise<{
  docCount: number
  storeSize: string
  indexSize: string
}> => {
  if (!esClient) {
    throw new Error("Elasticsearch client not initialized")
  }

  try {
    const stats = await esClient.indices.stats({ index })
    const indexStats = stats.indices?.[index]

    return {
      docCount: indexStats?.total?.docs?.count || 0,
      storeSize: `${Math.round((indexStats?.total?.store?.size_in_bytes || 0) / 1024 / 1024 * 100) / 100} MB`,
      indexSize: `${Math.round((indexStats?.total?.store?.size_in_bytes || 0) / 1024 / 1024 * 100) / 100} MB`
    }
  } catch (error) {
    logger.error(`Error getting index stats for ${index}:`, error)
    throw error
  }
}

/**
 * Create or update index mapping
 */
export const updateIndexMapping = async (
  index: string,
  mappings: Record<string, any>
): Promise<void> => {
  if (!esClient) {
    throw new Error("Elasticsearch client not initialized")
  }

  try {
    await esClient.indices.putMapping({
      index,
      body: {
        properties: mappings
      }
    })
    logger.info(`Updated mapping for index: ${index}`)
  } catch (error) {
    logger.error(`Error updating mapping for index ${index}:`, error)
    throw error
  }
}

/**
 * Elasticsearch service class for easier integration
 */
export class ElasticsearchService {
  private config: ElasticsearchConfig

  constructor(config: ElasticsearchConfig) {
    this.config = config
  }

  async initialize(): Promise<void> {
    return initializeElasticsearch(this.config)
  }

  async close(): Promise<void> {
    return closeElasticsearchConnection()
  }

  getClient(): Client {
    return getElasticsearchClient()
  }

  async indexDocument<T extends { id: string }>(index: string, document: T): Promise<void> {
    return indexDocument(index, document, this.config)
  }

  async updateDocument<T>(index: string, id: string, document: Partial<T>): Promise<void> {
    return updateDocument(index, id, document, this.config)
  }

  async deleteDocument(index: string, id: string): Promise<void> {
    return deleteDocument(index, id, this.config)
  }

  async searchDocuments<T, Q, A>(
    index: string,
    query: Q,
    options?: { from?: number; size?: number; sort?: any }
  ): Promise<{ hits: T[]; total: number; aggregations?: A }> {
    return searchDocuments(index, query, options, this.config)
  }

  async bulkIndexDocuments<T extends { id: string }>(index: string, documents: T[]): Promise<void> {
    return bulkIndexDocuments(index, documents, this.config)
  }

  async reindexCollection<T extends { _id: any }>(
    index: string,
    collection: T[],
    transform?: (doc: T) => any
  ): Promise<void> {
    return reindexCollection(index, collection, transform, this.config)
  }

  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; cluster?: string; version?: string; error?: string }> {
    return healthCheck()
  }

  async getIndexStats(index: string): Promise<{ docCount: number; storeSize: string; indexSize: string }> {
    return getIndexStats(index)
  }

  async updateIndexMapping(index: string, mappings: Record<string, any>): Promise<void> {
    return updateIndexMapping(index, mappings)
  }

  async bulkOperation(operations: Array<{
    index?: string
    operation: "index" | "update" | "delete"
    document?: any
    id: string
  }>): Promise<void> {
    if (!this.config.enabled || !esClient || operations.length === 0) return

    try {
      const body = []
      
      for (const op of operations) {
        if (op.operation === "index") {
          body.push({ index: { _index: op.index, _id: op.id } })
          body.push(op.document)
        } else if (op.operation === "update") {
          body.push({ update: { _index: op.index, _id: op.id } })
          body.push({ doc: op.document })
        } else if (op.operation === "delete") {
          body.push({ delete: { _index: op.index, _id: op.id } })
        }
      }

      await esClient.bulk({
        body,
        refresh: true
      })

      logger.debug(`Bulk operation completed with ${operations.length} operations`)
    } catch (error) {
      logger.error("Error in bulk operation:", error)
      throw error
    }
  }

  get isEnabled(): boolean {
    return this.config.enabled
  }
}

// Export default service instance
export default ElasticsearchService
