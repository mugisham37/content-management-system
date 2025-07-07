"use strict";
// =============================================================================
// ELASTICSEARCH SERVICE
// =============================================================================
// High-level Elasticsearch integration for content management system
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElasticsearchService = exports.updateIndexMapping = exports.getIndexStats = exports.healthCheck = exports.reindexCollection = exports.bulkIndexDocuments = exports.searchDocuments = exports.deleteDocument = exports.updateDocument = exports.indexDocument = exports.closeElasticsearchConnection = exports.getElasticsearchClient = exports.initializeElasticsearch = void 0;
const elasticsearch_1 = require("@elastic/elasticsearch");
let esClient = null;
// Simple console logger implementation
const logger = {
    info: (message, ...args) => console.log(`[INFO] ${message}`, ...args),
    error: (message, ...args) => console.error(`[ERROR] ${message}`, ...args),
    debug: (message, ...args) => console.debug(`[DEBUG] ${message}`, ...args),
};
/**
 * Initialize Elasticsearch client
 */
const initializeElasticsearch = async (config) => {
    if (!config.enabled) {
        logger.info("Elasticsearch is disabled, skipping initialization");
        return;
    }
    try {
        logger.info("Connecting to Elasticsearch...");
        // Create Elasticsearch client
        esClient = new elasticsearch_1.Client({
            node: config.node,
            auth: config.auth
                ? {
                    username: config.auth.split(":")[0],
                    password: config.auth.split(":")[1],
                }
                : undefined,
        });
        // Check connection
        const info = await esClient.info();
        logger.info(`Connected to Elasticsearch ${info.version.number}`);
        // Check if required indices exist and create them if needed
        await ensureIndicesExist();
    }
    catch (error) {
        logger.error("Failed to connect to Elasticsearch:", error);
        throw error;
    }
};
exports.initializeElasticsearch = initializeElasticsearch;
/**
 * Get Elasticsearch client
 */
const getElasticsearchClient = () => {
    if (!esClient) {
        throw new Error("Elasticsearch client not initialized");
    }
    return esClient;
};
exports.getElasticsearchClient = getElasticsearchClient;
/**
 * Close Elasticsearch connection
 */
const closeElasticsearchConnection = async () => {
    if (esClient) {
        await esClient.close();
        esClient = null;
        logger.info("Elasticsearch connection closed");
    }
};
exports.closeElasticsearchConnection = closeElasticsearchConnection;
/**
 * Ensure required indices exist
 */
const ensureIndicesExist = async () => {
    if (!esClient)
        return;
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
    ];
    for (const index of requiredIndices) {
        try {
            const exists = await esClient.indices.exists({ index: index.name });
            if (!exists) {
                logger.info(`Creating Elasticsearch index: ${index.name}`);
                await esClient.indices.create({
                    index: index.name,
                    body: {
                        mappings: index.mappings,
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
                });
                logger.info(`Created Elasticsearch index: ${index.name}`);
            }
            else {
                logger.info(`Elasticsearch index already exists: ${index.name}`);
            }
        }
        catch (error) {
            logger.error(`Error creating Elasticsearch index ${index.name}:`, error);
        }
    }
};
/**
 * Index a document
 */
const indexDocument = async (index, document, config) => {
    if (!config?.enabled || !esClient)
        return;
    try {
        await esClient.index({
            index,
            id: document.id,
            document,
            refresh: true, // Make the document immediately searchable
        });
        logger.debug(`Indexed document in ${index}: ${document.id}`);
    }
    catch (error) {
        logger.error(`Error indexing document in ${index}:`, error);
        throw error;
    }
};
exports.indexDocument = indexDocument;
/**
 * Update a document
 */
const updateDocument = async (index, id, document, config) => {
    if (!config?.enabled || !esClient)
        return;
    try {
        await esClient.update({
            index,
            id,
            doc: document,
            refresh: true,
        });
        logger.debug(`Updated document in ${index}: ${id}`);
    }
    catch (error) {
        logger.error(`Error updating document in ${index}:`, error);
        throw error;
    }
};
exports.updateDocument = updateDocument;
/**
 * Delete a document
 */
const deleteDocument = async (index, id, config) => {
    if (!config?.enabled || !esClient)
        return;
    try {
        await esClient.delete({
            index,
            id,
            refresh: true,
        });
        logger.debug(`Deleted document from ${index}: ${id}`);
    }
    catch (error) {
        logger.error(`Error deleting document from ${index}:`, error);
        throw error;
    }
};
exports.deleteDocument = deleteDocument;
/**
 * Search documents
 */
const searchDocuments = async (index, query, options = {}, config) => {
    if (!config?.enabled || !esClient) {
        return { hits: [], total: 0 };
    }
    try {
        const { from = 0, size = 10, sort } = options;
        const response = await esClient.search({
            index,
            body: {
                from,
                size,
                sort,
                ...query,
            },
        });
        return {
            hits: response.hits.hits.map((hit) => ({
                ...hit._source,
                id: hit._id,
                score: hit._score,
            })),
            total: typeof response.hits.total === 'number' ? response.hits.total : response.hits.total?.value || 0,
            aggregations: response.aggregations,
        };
    }
    catch (error) {
        logger.error(`Error searching documents in ${index}:`, error);
        throw error;
    }
};
exports.searchDocuments = searchDocuments;
/**
 * Bulk index documents
 */
const bulkIndexDocuments = async (index, documents, config) => {
    if (!config?.enabled || !esClient || documents.length === 0)
        return;
    try {
        const operations = documents.flatMap((doc) => [{ index: { _index: index, _id: doc.id } }, doc]);
        await esClient.bulk({
            refresh: true,
            operations,
        });
        logger.debug(`Bulk indexed ${documents.length} documents in ${index}`);
    }
    catch (error) {
        logger.error(`Error bulk indexing documents in ${index}:`, error);
        throw error;
    }
};
exports.bulkIndexDocuments = bulkIndexDocuments;
/**
 * Reindex all documents from a collection
 */
const reindexCollection = async (index, collection, transform, config) => {
    if (!config?.enabled || !esClient)
        return;
    try {
        // Delete index if it exists
        const indexExists = await esClient.indices.exists({ index });
        if (indexExists) {
            await esClient.indices.delete({ index });
            logger.info(`Deleted existing index: ${index}`);
        }
        // Recreate index
        await ensureIndicesExist();
        // Prepare documents for bulk indexing
        const documents = collection.map((doc) => {
            const transformed = transform ? transform(doc) : doc;
            return {
                ...transformed,
                id: doc._id.toString(),
            };
        });
        // Bulk index in batches
        const batchSize = 500;
        for (let i = 0; i < documents.length; i += batchSize) {
            const batch = documents.slice(i, i + batchSize);
            await (0, exports.bulkIndexDocuments)(index, batch, config);
            logger.info(`Indexed batch ${i / batchSize + 1} of ${Math.ceil(documents.length / batchSize)}`);
        }
        logger.info(`Reindexed ${documents.length} documents in ${index}`);
    }
    catch (error) {
        logger.error(`Error reindexing collection in ${index}:`, error);
        throw error;
    }
};
exports.reindexCollection = reindexCollection;
/**
 * Check if Elasticsearch is available and healthy
 */
const healthCheck = async () => {
    if (!esClient) {
        return {
            status: 'unhealthy',
            error: 'Elasticsearch client not initialized'
        };
    }
    try {
        const info = await esClient.info();
        return {
            status: 'healthy',
            cluster: info.cluster_name,
            version: info.version.number
        };
    }
    catch (error) {
        return {
            status: 'unhealthy',
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
};
exports.healthCheck = healthCheck;
/**
 * Get index statistics
 */
const getIndexStats = async (index) => {
    if (!esClient) {
        throw new Error("Elasticsearch client not initialized");
    }
    try {
        const stats = await esClient.indices.stats({ index });
        const indexStats = stats.indices?.[index];
        return {
            docCount: indexStats?.total?.docs?.count || 0,
            storeSize: `${Math.round((indexStats?.total?.store?.size_in_bytes || 0) / 1024 / 1024 * 100) / 100} MB`,
            indexSize: `${Math.round((indexStats?.total?.store?.size_in_bytes || 0) / 1024 / 1024 * 100) / 100} MB`
        };
    }
    catch (error) {
        logger.error(`Error getting index stats for ${index}:`, error);
        throw error;
    }
};
exports.getIndexStats = getIndexStats;
/**
 * Create or update index mapping
 */
const updateIndexMapping = async (index, mappings) => {
    if (!esClient) {
        throw new Error("Elasticsearch client not initialized");
    }
    try {
        await esClient.indices.putMapping({
            index,
            body: {
                properties: mappings
            }
        });
        logger.info(`Updated mapping for index: ${index}`);
    }
    catch (error) {
        logger.error(`Error updating mapping for index ${index}:`, error);
        throw error;
    }
};
exports.updateIndexMapping = updateIndexMapping;
/**
 * Elasticsearch service class for easier integration
 */
class ElasticsearchService {
    config;
    constructor(config) {
        this.config = config;
    }
    async initialize() {
        return (0, exports.initializeElasticsearch)(this.config);
    }
    async close() {
        return (0, exports.closeElasticsearchConnection)();
    }
    getClient() {
        return (0, exports.getElasticsearchClient)();
    }
    async indexDocument(index, document) {
        return (0, exports.indexDocument)(index, document, this.config);
    }
    async updateDocument(index, id, document) {
        return (0, exports.updateDocument)(index, id, document, this.config);
    }
    async deleteDocument(index, id) {
        return (0, exports.deleteDocument)(index, id, this.config);
    }
    async searchDocuments(index, query, options) {
        return (0, exports.searchDocuments)(index, query, options, this.config);
    }
    async bulkIndexDocuments(index, documents) {
        return (0, exports.bulkIndexDocuments)(index, documents, this.config);
    }
    async reindexCollection(index, collection, transform) {
        return (0, exports.reindexCollection)(index, collection, transform, this.config);
    }
    async healthCheck() {
        return (0, exports.healthCheck)();
    }
    async getIndexStats(index) {
        return (0, exports.getIndexStats)(index);
    }
    async updateIndexMapping(index, mappings) {
        return (0, exports.updateIndexMapping)(index, mappings);
    }
    get isEnabled() {
        return this.config.enabled;
    }
}
exports.ElasticsearchService = ElasticsearchService;
// Export default service instance
exports.default = ElasticsearchService;
//# sourceMappingURL=elasticsearch.service.js.map