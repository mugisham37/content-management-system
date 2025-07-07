import { Client } from "@elastic/elasticsearch";
export interface ElasticsearchConfig {
    enabled: boolean;
    node: string;
    auth?: string;
}
/**
 * Initialize Elasticsearch client
 */
export declare const initializeElasticsearch: (config: ElasticsearchConfig) => Promise<void>;
/**
 * Get Elasticsearch client
 */
export declare const getElasticsearchClient: () => Client;
/**
 * Close Elasticsearch connection
 */
export declare const closeElasticsearchConnection: () => Promise<void>;
/**
 * Index a document
 */
export declare const indexDocument: <T extends {
    id: string;
}>(index: string, document: T, config?: ElasticsearchConfig) => Promise<void>;
/**
 * Update a document
 */
export declare const updateDocument: <T>(index: string, id: string, document: Partial<T>, config?: ElasticsearchConfig) => Promise<void>;
/**
 * Delete a document
 */
export declare const deleteDocument: (index: string, id: string, config?: ElasticsearchConfig) => Promise<void>;
/**
 * Search documents
 */
export declare const searchDocuments: <T, Q, A>(index: string, query: Q, options?: {
    from?: number;
    size?: number;
    sort?: any;
}, config?: ElasticsearchConfig) => Promise<{
    hits: T[];
    total: number;
    aggregations?: A;
}>;
/**
 * Bulk index documents
 */
export declare const bulkIndexDocuments: <T extends {
    id: string;
}>(index: string, documents: T[], config?: ElasticsearchConfig) => Promise<void>;
/**
 * Reindex all documents from a collection
 */
export declare const reindexCollection: <T extends {
    _id: any;
}>(index: string, collection: T[], transform?: (doc: T) => any, config?: ElasticsearchConfig) => Promise<void>;
/**
 * Check if Elasticsearch is available and healthy
 */
export declare const healthCheck: () => Promise<{
    status: "healthy" | "unhealthy";
    cluster?: string;
    version?: string;
    error?: string;
}>;
/**
 * Get index statistics
 */
export declare const getIndexStats: (index: string) => Promise<{
    docCount: number;
    storeSize: string;
    indexSize: string;
}>;
/**
 * Create or update index mapping
 */
export declare const updateIndexMapping: (index: string, mappings: Record<string, any>) => Promise<void>;
/**
 * Elasticsearch service class for easier integration
 */
export declare class ElasticsearchService {
    private config;
    constructor(config: ElasticsearchConfig);
    initialize(): Promise<void>;
    close(): Promise<void>;
    getClient(): Client;
    indexDocument<T extends {
        id: string;
    }>(index: string, document: T): Promise<void>;
    updateDocument<T>(index: string, id: string, document: Partial<T>): Promise<void>;
    deleteDocument(index: string, id: string): Promise<void>;
    searchDocuments<T, Q, A>(index: string, query: Q, options?: {
        from?: number;
        size?: number;
        sort?: any;
    }): Promise<{
        hits: T[];
        total: number;
        aggregations?: A;
    }>;
    bulkIndexDocuments<T extends {
        id: string;
    }>(index: string, documents: T[]): Promise<void>;
    reindexCollection<T extends {
        _id: any;
    }>(index: string, collection: T[], transform?: (doc: T) => any): Promise<void>;
    healthCheck(): Promise<{
        status: 'healthy' | 'unhealthy';
        cluster?: string;
        version?: string;
        error?: string;
    }>;
    getIndexStats(index: string): Promise<{
        docCount: number;
        storeSize: string;
        indexSize: string;
    }>;
    updateIndexMapping(index: string, mappings: Record<string, any>): Promise<void>;
    get isEnabled(): boolean;
}
export default ElasticsearchService;
//# sourceMappingURL=elasticsearch.service.d.ts.map