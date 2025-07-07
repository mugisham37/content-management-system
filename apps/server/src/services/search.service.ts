import { ElasticsearchService } from "./elasticsearch.service"
import { logger } from "../utils/logger"
import { config } from "../config"
import { cacheService } from "./cache.service"
import type { Content, User, Media } from "@cms-platform/database/types"

export class SearchService {
  private esService: ElasticsearchService

  constructor() {
    this.esService = new ElasticsearchService({
      enabled: config.elasticsearch.enabled,
      node: config.elasticsearch.node,
      auth: config.elasticsearch.auth,
    })
  }

  /**
   * Search content
   */
  public async searchContent(params: {
    query: string
    contentTypeId?: string
    status?: string
    locale?: string
    fields?: string[]
    from?: number
    size?: number
    sort?: string
    order?: "asc" | "desc"
    filters?: Record<string, any>
    tenantId?: string
  }): Promise<{
    hits: any[]
    total: number
    aggregations?: any
  }> {
    try {
      const {
        query,
        contentTypeId,
        status,
        locale,
        fields = ["title", "description", "data"],
        from = 0,
        size = 10,
        sort,
        order = "desc",
        filters = {},
        tenantId,
      } = params

      const searchQuery: any = {
        query: {
          bool: {
            must: [
              query
                ? {
                    multi_match: {
                      query,
                      fields,
                      type: "best_fields",
                      fuzziness: "AUTO",
                    },
                  }
                : { match_all: {} },
            ],
            filter: [],
          },
        },
        highlight: {
          fields: {
            title: {},
            description: {},
            "data.*": {},
          },
          pre_tags: ["<em>"],
          post_tags: ["</em>"],
        },
        aggs: {
          content_types: { terms: { field: "contentTypeId", size: 20 } },
          statuses: { terms: { field: "status", size: 10 } },
          locales: { terms: { field: "locale", size: 10 } },
        },
      }

      if (tenantId) {
        searchQuery.query.bool.filter.push({ term: { tenantId } })
      }
      if (contentTypeId) {
        searchQuery.query.bool.filter.push({ term: { contentTypeId } })
      }
      if (status) {
        searchQuery.query.bool.filter.push({ term: { status } })
      }
      if (locale) {
        searchQuery.query.bool.filter.push({ term: { locale } })
      }

      Object.entries(filters).forEach(([key, value]) => {
        searchQuery.query.bool.filter.push(
          Array.isArray(value) ? { terms: { [key]: value } } : { term: { [key]: value } },
        )
      })

      const sortOptions: any = sort ? { [sort]: { order } } : { _score: { order: "desc" } }

      const cacheKey = `search:content:${JSON.stringify(params)}`
      return await cacheService.getOrSet(
        cacheKey,
        async () => {
          return await this.esService.searchDocuments("content", searchQuery, {
            from,
            size,
            sort: sortOptions,
          })
        },
        { ttl: 300 },
      )
    } catch (error) {
      logger.error("Error searching content:", error)
      throw error
    }
  }

  /**
   * Reindex all content
   */
  public async reindexContent(contentCollection: Content[]): Promise<void> {
    try {
      if (!this.esService.isEnabled) {
        logger.info("Elasticsearch is disabled, skipping reindexing")
        return
      }

      logger.info(`Reindexing ${contentCollection.length} content items`)

      const transform = (content: Content) => ({
        id: content.id,
        contentTypeId: content.contentTypeId,
        title: (content.data as any)?.title,
        description: (content.data as any)?.description,
        slug: content.slug,
        status: content.status,
        locale: content.locale,
        data: content.data,
        createdAt: content.createdAt,
        updatedAt: content.updatedAt,
        publishedAt: content.publishedAt,
        createdBy: content.createdById,
        updatedBy: content.updatedById,
        publishedBy: content.publishedById,
        tenantId: content.tenantId,
      })

      await this.esService.reindexCollection("content", contentCollection, transform)
      await cacheService.deletePattern("search:content:*")
      logger.info("Content reindexing completed")
    } catch (error) {
      logger.error("Error reindexing content:", error)
      throw error
    }
  }

  /**
   * Index a single content item
   */
  public async indexContent(content: Content): Promise<void> {
    if (!this.esService.isEnabled) return

    try {
      const doc = {
        id: content.id,
        contentTypeId: content.contentTypeId,
        title: (content.data as any)?.title,
        description: (content.data as any)?.description,
        slug: content.slug,
        status: content.status,
        locale: content.locale,
        data: content.data,
        createdAt: content.createdAt,
        updatedAt: content.updatedAt,
        publishedAt: content.publishedAt,
        createdBy: content.createdById,
        updatedBy: content.updatedById,
        publishedBy: content.publishedById,
        tenantId: content.tenantId,
      }
      await this.esService.indexDocument("content", doc)
      await cacheService.deletePattern(`search:content:*`)
    } catch (error) {
      logger.error("Error indexing content:", error)
      throw error
    }
  }

  /**
   * Delete a content item from the index
   */
  public async deleteContentFromIndex(id: string): Promise<void> {
    if (!this.esService.isEnabled) return
    try {
      await this.esService.deleteDocument("content", id)
      await cacheService.deletePattern(`search:content:*`)
    } catch (error) {
      logger.error("Error deleting content from index:", error)
      throw error
    }
  }
}

export const searchService = new SearchService()