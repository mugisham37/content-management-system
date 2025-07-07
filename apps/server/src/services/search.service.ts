import { ElasticsearchService } from "./elasticsearch.service"
import { logger } from "../utils/logger"
import { config } from "../config"
import { cacheService } from "./cache.service"
import type { Content, User, Media, SearchAnalytics } from "@cms-platform/database/types"

interface SearchParams {
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
  boost?: Record<string, number>
  dateRange?: {
    field: string
    from?: string
    to?: string
  }
}

interface SearchResult<T = any> {
  hits: T[]
  total: number
  aggregations?: any
  suggestions?: string[]
  took?: number
  maxScore?: number
}

interface AutocompleteResult {
  suggestions: Array<{
    text: string
    score: number
    type: "content" | "user" | "media"
    id: string
  }>
}

interface SearchAnalyticsInput {
  query: string
  results: number
  timestamp: Date
  userId?: string
  tenantId?: string
  clickedResults?: string[]
}

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
  public async searchContent(params: SearchParams): Promise<SearchResult<Content>> {
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
        boost = {},
        dateRange,
      } = params

      const searchQuery: any = {
        query: {
          bool: {
            must: [
              query
                ? {
                    multi_match: {
                      query,
                      fields: this.applyBoost(fields, boost),
                      type: "best_fields",
                      fuzziness: "AUTO",
                      minimum_should_match: "75%",
                    },
                  }
                : { match_all: {} },
            ],
            filter: [],
            should: [],
          },
        },
        highlight: {
          fields: {
            title: { fragment_size: 150, number_of_fragments: 3 },
            description: { fragment_size: 150, number_of_fragments: 3 },
            "data.*": { fragment_size: 150, number_of_fragments: 3 },
          },
          pre_tags: ["<mark>"],
          post_tags: ["</mark>"],
        },
        aggs: {
          content_types: { terms: { field: "contentTypeId", size: 20 } },
          statuses: { terms: { field: "status", size: 10 } },
          locales: { terms: { field: "locale", size: 10 } },
          date_histogram: {
            date_histogram: {
              field: "createdAt",
              calendar_interval: "month",
            },
          },
        },
      }

      // Apply filters
      this.applyFilters(searchQuery, {
        tenantId,
        contentTypeId,
        status,
        locale,
        ...filters,
      })

      // Apply date range filter
      if (dateRange) {
        this.applyDateRangeFilter(searchQuery, dateRange)
      }

      // Apply boosting for recent content
      searchQuery.query.bool.should.push({
        function_score: {
          filter: { match_all: {} },
          functions: [
            {
              gauss: {
                createdAt: {
                  origin: "now",
                  scale: "30d",
                  decay: 0.5,
                },
              },
            },
          ],
          boost_mode: "multiply",
        },
      })

      const sortOptions: any = sort ? { [sort]: { order } } : { _score: { order: "desc" } }

      const cacheKey = `search:content:${this.generateCacheKey(params)}`
      const result = await cacheService.getOrSet(
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

      // Track search analytics
      await this.trackSearchAnalytics({
        query,
        results: result.total,
        timestamp: new Date(),
        tenantId,
      })

      return result as SearchResult<Content>
    } catch (error) {
      logger.error("Error searching content:", error)
      throw error
    }
  }

  /**
   * Search users
   */
  public async searchUsers(
    params: Omit<SearchParams, "contentTypeId" | "status" | "locale">,
  ): Promise<SearchResult<User>> {
    try {
      const {
        query,
        fields = ["name", "email", "username"],
        from = 0,
        size = 10,
        sort,
        order = "desc",
        filters = {},
        tenantId,
        boost = {},
      } = params

      const searchQuery: any = {
        query: {
          bool: {
            must: [
              query
                ? {
                    multi_match: {
                      query,
                      fields: this.applyBoost(fields, boost),
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
            name: {},
            email: {},
            username: {},
          },
          pre_tags: ["<mark>"],
          post_tags: ["</mark>"],
        },
        aggs: {
          roles: { terms: { field: "role", size: 10 } },
          status: { terms: { field: "status", size: 10 } },
        },
      }

      this.applyFilters(searchQuery, { tenantId, ...filters })

      const sortOptions: any = sort ? { [sort]: { order } } : { _score: { order: "desc" } }

      const cacheKey = `search:users:${this.generateCacheKey(params)}`
      return await cacheService.getOrSet(
        cacheKey,
        async () => {
          return await this.esService.searchDocuments("users", searchQuery, {
            from,
            size,
            sort: sortOptions,
          })
        },
        { ttl: 300 },
      )
    } catch (error) {
      logger.error("Error searching users:", error)
      throw error
    }
  }

  /**
   * Search media
   */
  public async searchMedia(
    params: Omit<SearchParams, "contentTypeId" | "status" | "locale">,
  ): Promise<SearchResult<Media>> {
    try {
      const {
        query,
        fields = ["name", "alt", "description", "tags"],
        from = 0,
        size = 10,
        sort,
        order = "desc",
        filters = {},
        tenantId,
        boost = {},
      } = params

      const searchQuery: any = {
        query: {
          bool: {
            must: [
              query
                ? {
                    multi_match: {
                      query,
                      fields: this.applyBoost(fields, boost),
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
            name: {},
            alt: {},
            description: {},
            tags: {},
          },
          pre_tags: ["<mark>"],
          post_tags: ["</mark>"],
        },
        aggs: {
          file_types: { terms: { field: "mimeType", size: 20 } },
          sizes: {
            range: {
              field: "size",
              ranges: [
                { to: 1024 * 1024, key: "small" },
                { from: 1024 * 1024, to: 10 * 1024 * 1024, key: "medium" },
                { from: 10 * 1024 * 1024, key: "large" },
              ],
            },
          },
        },
      }

      this.applyFilters(searchQuery, { tenantId, ...filters })

      const sortOptions: any = sort ? { [sort]: { order } } : { _score: { order: "desc" } }

      const cacheKey = `search:media:${this.generateCacheKey(params)}`
      return await cacheService.getOrSet(
        cacheKey,
        async () => {
          return await this.esService.searchDocuments("media", searchQuery, {
            from,
            size,
            sort: sortOptions,
          })
        },
        { ttl: 300 },
      )
    } catch (error) {
      logger.error("Error searching media:", error)
      throw error
    }
  }

  /**
   * Global search across all content types
   */
  public async globalSearch(params: SearchParams): Promise<{
    content: SearchResult<Content>
    users: SearchResult<User>
    media: SearchResult<Media>
    total: number
  }> {
    try {
      const [contentResults, userResults, mediaResults] = await Promise.all([
        this.searchContent({ ...params, size: params.size || 5 }),
        this.searchUsers({ ...params, size: params.size || 5 }),
        this.searchMedia({ ...params, size: params.size || 5 }),
      ])

      return {
        content: contentResults,
        users: userResults,
        media: mediaResults,
        total: contentResults.total + userResults.total + mediaResults.total,
      }
    } catch (error) {
      logger.error("Error in global search:", error)
      throw error
    }
  }

  /**
   * Autocomplete suggestions
   */
  public async autocomplete(query: string, tenantId?: string, limit = 10): Promise<AutocompleteResult> {
    try {
      const cacheKey = `autocomplete:${query}:${tenantId}:${limit}`
      return await cacheService.getOrSet(
        cacheKey,
        async () => {
          const suggestions: AutocompleteResult["suggestions"] = []

          // Get suggestions from different indices
          const [contentSuggestions, userSuggestions, mediaSuggestions] = await Promise.all([
            this.getAutocompleteSuggestions("content", query, ["title", "description"], tenantId, Math.ceil(limit / 3)),
            this.getAutocompleteSuggestions("users", query, ["name", "username"], tenantId, Math.ceil(limit / 3)),
            this.getAutocompleteSuggestions("media", query, ["name", "alt"], tenantId, Math.ceil(limit / 3)),
          ])

          suggestions.push(
            ...contentSuggestions.map((s) => ({ ...s, type: "content" as const })),
            ...userSuggestions.map((s) => ({ ...s, type: "user" as const })),
            ...mediaSuggestions.map((s) => ({ ...s, type: "media" as const })),
          )

          return {
            suggestions: suggestions.sort((a, b) => b.score - a.score).slice(0, limit),
          }
        },
        { ttl: 60 },
      )
    } catch (error) {
      logger.error("Error getting autocomplete suggestions:", error)
      return { suggestions: [] }
    }
  }

  /**
   * Get search suggestions based on popular queries
   */
  public async getSearchSuggestions(tenantId?: string, limit = 10): Promise<string[]> {
    try {
      const cacheKey = `search:suggestions:${tenantId}:${limit}`
      return await cacheService.getOrSet(
        cacheKey,
        async () => {
          // This would typically come from search analytics
          const searchQuery = {
            query: {
              bool: {
                filter: tenantId ? [{ term: { tenantId } }] : [],
              },
            },
            aggs: {
              popular_queries: {
                terms: {
                  field: "query.keyword",
                  size: limit,
                  order: { _count: "desc" },
                },
              },
            },
            size: 0,
          }

          const result = await this.esService.searchDocuments("search_analytics", searchQuery)
          const aggregations = result.aggregations as any
          return aggregations?.popular_queries?.buckets?.map((bucket: any) => bucket.key) || []
        },
        { ttl: 3600 },
      )
    } catch (error) {
      logger.error("Error getting search suggestions:", error)
      return []
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
        _id: content.id, // Add _id for reindexCollection compatibility
      })

      await this.esService.reindexCollection("content", contentCollection.map(c => ({ ...c, _id: c.id })), transform)
      await cacheService.deletePattern("search:content:*")
      logger.info("Content reindexing completed")
    } catch (error) {
      logger.error("Error reindexing content:", error)
      throw error
    }
  }

  /**
   * Reindex all users
   */
  public async reindexUsers(userCollection: User[]): Promise<void> {
    try {
      if (!this.esService.isEnabled) {
        logger.info("Elasticsearch is disabled, skipping user reindexing")
        return
      }

      logger.info(`Reindexing ${userCollection.length} users`)

      const transform = (user: User) => ({
        id: user.id,
        name: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
        username: user.email, // Using email as username since username doesn't exist in schema
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        tenantId: user.tenantId,
        _id: user.id, // Add _id for reindexCollection compatibility
      })

      await this.esService.reindexCollection("users", userCollection.map(u => ({ ...u, _id: u.id })), transform)
      await cacheService.deletePattern("search:users:*")
      logger.info("User reindexing completed")
    } catch (error) {
      logger.error("Error reindexing users:", error)
      throw error
    }
  }

  /**
   * Reindex all media
   */
  public async reindexMedia(mediaCollection: Media[]): Promise<void> {
    try {
      if (!this.esService.isEnabled) {
        logger.info("Elasticsearch is disabled, skipping media reindexing")
        return
      }

      logger.info(`Reindexing ${mediaCollection.length} media items`)

      const transform = (media: Media) => ({
        id: media.id,
        name: media.filename, // Use filename as name
        alt: media.alt,
        description: media.caption || media.alt || '', // Use caption or alt as description
        mimeType: media.mimeType,
        size: media.size,
        tags: media.tags || [],
        createdAt: media.createdAt,
        updatedAt: media.updatedAt,
        tenantId: media.tenantId,
        _id: media.id, // Add _id for reindexCollection compatibility
      })

      await this.esService.reindexCollection("media", mediaCollection.map(m => ({ ...m, _id: m.id })), transform)
      await cacheService.deletePattern("search:media:*")
      logger.info("Media reindexing completed")
    } catch (error) {
      logger.error("Error reindexing media:", error)
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
   * Index a single user
   */
  public async indexUser(user: User): Promise<void> {
    if (!this.esService.isEnabled) return

    try {
      const doc = {
        id: user.id,
        name: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
        username: user.email, // Using email as username since username doesn't exist in schema
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        tenantId: user.tenantId,
      }

      await this.esService.indexDocument("users", doc)
      await cacheService.deletePattern(`search:users:*`)
    } catch (error) {
      logger.error("Error indexing user:", error)
      throw error
    }
  }

  /**
   * Index a single media item
   */
  public async indexMedia(media: Media): Promise<void> {
    if (!this.esService.isEnabled) return

    try {
      const doc = {
        id: media.id,
        name: media.filename, // Use filename as name
        alt: media.alt,
        description: media.caption || media.alt || '', // Use caption or alt as description
        mimeType: media.mimeType,
        size: media.size,
        tags: media.tags || [],
        createdAt: media.createdAt,
        updatedAt: media.updatedAt,
        tenantId: media.tenantId,
      }

      await this.esService.indexDocument("media", doc)
      await cacheService.deletePattern(`search:media:*`)
    } catch (error) {
      logger.error("Error indexing media:", error)
      throw error
    }
  }

  /**
   * Bulk index documents
   */
  public async bulkIndex(
    operations: Array<{
      index: string
      operation: "index" | "update" | "delete"
      document?: any
      id: string
    }>,
  ): Promise<void> {
    if (!this.esService.isEnabled) return

    try {
      await this.esService.bulkOperation(operations)

      // Clear relevant caches
      const indices = [...new Set(operations.map((op) => op.index))]
      for (const index of indices) {
        await cacheService.deletePattern(`search:${index}:*`)
      }
    } catch (error) {
      logger.error("Error in bulk index operation:", error)
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

  /**
   * Delete a user from the index
   */
  public async deleteUserFromIndex(id: string): Promise<void> {
    if (!this.esService.isEnabled) return

    try {
      await this.esService.deleteDocument("users", id)
      await cacheService.deletePattern(`search:users:*`)
    } catch (error) {
      logger.error("Error deleting user from index:", error)
      throw error
    }
  }

  /**
   * Delete a media item from the index
   */
  public async deleteMediaFromIndex(id: string): Promise<void> {
    if (!this.esService.isEnabled) return

    try {
      await this.esService.deleteDocument("media", id)
      await cacheService.deletePattern(`search:media:*`)
    } catch (error) {
      logger.error("Error deleting media from index:", error)
      throw error
    }
  }

  /**
   * Get search analytics
   */
  public async getSearchAnalytics(params: {
    tenantId?: string
    from?: Date
    to?: Date
    limit?: number
  }): Promise<{
    totalSearches: number
    popularQueries: Array<{ query: string; count: number }>
    averageResults: number
    zeroResultQueries: Array<{ query: string; count: number }>
  }> {
    try {
      const { tenantId, from, to, limit = 10 } = params

      const searchQuery: any = {
        query: {
          bool: {
            filter: [],
          },
        },
        aggs: {
          total_searches: { value_count: { field: "query.keyword" } },
          popular_queries: {
            terms: { field: "query.keyword", size: limit },
          },
          zero_result_queries: {
            filter: { term: { results: 0 } },
            aggs: {
              queries: {
                terms: { field: "query.keyword", size: limit },
              },
            },
          },
          avg_results: { avg: { field: "results" } },
        },
        size: 0,
      }

      if (tenantId) {
        searchQuery.query.bool.filter.push({ term: { tenantId } })
      }

      if (from || to) {
        const dateRange: any = {}
        if (from) dateRange.gte = from.toISOString()
        if (to) dateRange.lte = to.toISOString()
        searchQuery.query.bool.filter.push({
          range: { timestamp: dateRange },
        })
      }

      const result = await this.esService.searchDocuments("search_analytics", searchQuery)
      const aggregations = result.aggregations as any

      return {
        totalSearches: aggregations?.total_searches?.value || 0,
        popularQueries:
          aggregations?.popular_queries?.buckets?.map((bucket: any) => ({
            query: bucket.key,
            count: bucket.doc_count,
          })) || [],
        averageResults: aggregations?.avg_results?.value || 0,
        zeroResultQueries:
          aggregations?.zero_result_queries?.queries?.buckets?.map((bucket: any) => ({
            query: bucket.key,
            count: bucket.doc_count,
          })) || [],
      }
    } catch (error) {
      logger.error("Error getting search analytics:", error)
      throw error
    }
  }

  /**
   * Clear all search caches
   */
  public async clearSearchCaches(): Promise<void> {
    try {
      await Promise.all([
        cacheService.deletePattern("search:content:*"),
        cacheService.deletePattern("search:users:*"),
        cacheService.deletePattern("search:media:*"),
        cacheService.deletePattern("autocomplete:*"),
      ])
      logger.info("Search caches cleared")
    } catch (error) {
      logger.error("Error clearing search caches:", error)
      throw error
    }
  }

  // Private helper methods

  private applyBoost(fields: string[], boost: Record<string, number>): string[] {
    return fields.map((field) => {
      const boostValue = boost[field]
      return boostValue ? `${field}^${boostValue}` : field
    })
  }

  private applyFilters(searchQuery: any, filters: Record<string, any>): void {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchQuery.query.bool.filter.push(
          Array.isArray(value) ? { terms: { [key]: value } } : { term: { [key]: value } },
        )
      }
    })
  }

  private applyDateRangeFilter(searchQuery: any, dateRange: NonNullable<SearchParams["dateRange"]>): void {
    const range: any = {}
    if (dateRange.from) range.gte = dateRange.from
    if (dateRange.to) range.lte = dateRange.to

    if (Object.keys(range).length > 0) {
      searchQuery.query.bool.filter.push({
        range: { [dateRange.field]: range },
      })
    }
  }

  private generateCacheKey(params: any): string {
    return Buffer.from(JSON.stringify(params)).toString("base64").slice(0, 32)
  }

  private async getAutocompleteSuggestions(
    index: string,
    query: string,
    fields: string[],
    tenantId?: string,
    limit = 5,
  ): Promise<Array<{ text: string; score: number; id: string }>> {
    try {
      const searchQuery: any = {
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query,
                  fields,
                  type: "phrase_prefix",
                },
              },
            ],
            filter: tenantId ? [{ term: { tenantId } }] : [],
          },
        },
        _source: ["id", ...fields],
        size: limit,
      }

      const result = await this.esService.searchDocuments(index, searchQuery)
      return result.hits.map((hit: any) => ({
        text: hit._source[fields[0]] || hit._source.name || hit._source.title,
        score: hit._score,
        id: hit._source.id,
      }))
    } catch (error) {
      logger.error(`Error getting autocomplete suggestions for ${index}:`, error)
      return []
    }
  }

  private async trackSearchAnalytics(analytics: SearchAnalyticsInput): Promise<void> {
    try {
      if (!this.esService.isEnabled) return

      await this.esService.indexDocument("search_analytics", {
        ...analytics,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      })
    } catch (error) {
      logger.error("Error tracking search analytics:", error)
      // Don't throw error for analytics tracking failures
    }
  }
}

export const searchService = new SearchService()
