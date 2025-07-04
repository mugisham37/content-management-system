// =============================================================================
// BASE REPOSITORY - POSTGRESQL
// =============================================================================
// High-level abstraction for database operations with comprehensive error handling

import { PrismaClient, Prisma } from '@prisma/client'

export interface PaginationOptions {
  page?: number
  limit?: number
  orderBy?: Record<string, 'asc' | 'desc'>
}

export interface PaginationResult<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

export interface CursorPaginationOptions {
  first?: number
  after?: string
  last?: number
  before?: string
  orderBy?: Record<string, 'asc' | 'desc'>
}

export interface CursorPaginationResult<T> {
  edges: Array<{ cursor: string; node: T }>
  pageInfo: {
    hasNextPage: boolean
    hasPreviousPage: boolean
    startCursor?: string
    endCursor?: string
  }
  totalCount: number
}

export class DatabaseError extends Error {
  constructor(
    message: string,
    public code?: string,
    public originalError?: unknown
  ) {
    super(message)
    this.name = 'DatabaseError'
  }
}

export class NotFoundError extends DatabaseError {
  constructor(resource: string, identifier?: string) {
    super(
      identifier 
        ? `${resource} not found with identifier: ${identifier}`
        : `${resource} not found`
    )
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends DatabaseError {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class ValidationError extends DatabaseError {
  constructor(message: string, public field?: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export abstract class BaseRepository<T, CreateInput, UpdateInput> {
  protected abstract modelName: string
  protected abstract model: any

  constructor(protected prisma: PrismaClient) {}

  /**
   * Handle Prisma errors and convert to appropriate custom errors
   */
  protected handleError(error: unknown, operation: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case 'P2002':
          throw new ConflictError(`Unique constraint violation: ${error.meta?.target}`)
        case 'P2025':
          throw new NotFoundError(this.modelName)
        case 'P2003':
          throw new ValidationError('Foreign key constraint violation')
        case 'P2014':
          throw new ValidationError('Required relation violation')
        default:
          throw new DatabaseError(`Database error during ${operation}: ${error.message}`, error.code, error)
      }
    }

    if (error instanceof Prisma.PrismaClientValidationError) {
      throw new ValidationError(`Validation error during ${operation}: ${error.message}`)
    }

    throw new DatabaseError(`Unexpected error during ${operation}: ${String(error)}`, undefined, error)
  }

  /**
   * Find a record by ID
   */
  async findById(id: string, include?: Record<string, boolean>): Promise<T | null> {
    try {
      return await this.model.findUnique({
        where: { id },
        include,
      })
    } catch (error) {
      this.handleError(error, 'findById')
    }
  }

  /**
   * Find a record by ID or throw error
   */
  async findByIdOrThrow(id: string, include?: Record<string, boolean>): Promise<T> {
    const record = await this.findById(id, include)
    if (!record) {
      throw new NotFoundError(this.modelName, id)
    }
    return record
  }

  /**
   * Find a single record by filter
   */
  async findFirst(where: Record<string, any>, include?: Record<string, boolean>): Promise<T | null> {
    try {
      return await this.model.findFirst({
        where,
        include,
      })
    } catch (error) {
      this.handleError(error, 'findFirst')
    }
  }

  /**
   * Find a single record by filter or throw error
   */
  async findFirstOrThrow(where: Record<string, any>, include?: Record<string, boolean>): Promise<T> {
    const record = await this.findFirst(where, include)
    if (!record) {
      throw new NotFoundError(this.modelName)
    }
    return record
  }

  /**
   * Find many records
   */
  async findMany(
    where?: Record<string, any>,
    include?: Record<string, boolean>,
    orderBy?: Record<string, 'asc' | 'desc'>
  ): Promise<T[]> {
    try {
      return await this.model.findMany({
        where,
        include,
        orderBy,
      })
    } catch (error) {
      this.handleError(error, 'findMany')
    }
  }

  /**
   * Count records
   */
  async count(where?: Record<string, any>): Promise<number> {
    try {
      return await this.model.count({ where })
    } catch (error) {
      this.handleError(error, 'count')
    }
  }

  /**
   * Create a new record
   */
  async create(data: CreateInput, include?: Record<string, boolean>): Promise<T> {
    try {
      return await this.model.create({
        data,
        include,
      })
    } catch (error) {
      this.handleError(error, 'create')
    }
  }

  /**
   * Create many records
   */
  async createMany(data: CreateInput[]): Promise<{ count: number }> {
    try {
      return await this.model.createMany({
        data,
        skipDuplicates: true,
      })
    } catch (error) {
      this.handleError(error, 'createMany')
    }
  }

  /**
   * Update a record by ID
   */
  async update(
    id: string,
    data: UpdateInput,
    include?: Record<string, boolean>
  ): Promise<T> {
    try {
      return await this.model.update({
        where: { id },
        data,
        include,
      })
    } catch (error) {
      this.handleError(error, 'update')
    }
  }

  /**
   * Update many records
   */
  async updateMany(
    where: Record<string, any>,
    data: Partial<UpdateInput>
  ): Promise<{ count: number }> {
    try {
      return await this.model.updateMany({
        where,
        data,
      })
    } catch (error) {
      this.handleError(error, 'updateMany')
    }
  }

  /**
   * Upsert a record
   */
  async upsert(
    where: Record<string, any>,
    create: CreateInput,
    update: UpdateInput,
    include?: Record<string, boolean>
  ): Promise<T> {
    try {
      return await this.model.upsert({
        where,
        create,
        update,
        include,
      })
    } catch (error) {
      this.handleError(error, 'upsert')
    }
  }

  /**
   * Delete a record by ID
   */
  async delete(id: string): Promise<T> {
    try {
      return await this.model.delete({
        where: { id },
      })
    } catch (error) {
      this.handleError(error, 'delete')
    }
  }

  /**
   * Delete many records
   */
  async deleteMany(where: Record<string, any>): Promise<{ count: number }> {
    try {
      return await this.model.deleteMany({
        where,
      })
    } catch (error) {
      this.handleError(error, 'deleteMany')
    }
  }

  /**
   * Paginate records with offset-based pagination
   */
  async paginate(
    where?: Record<string, any>,
    options: PaginationOptions = {},
    include?: Record<string, boolean>
  ): Promise<PaginationResult<T>> {
    const { page = 1, limit = 10, orderBy } = options
    const skip = (page - 1) * limit

    try {
      const [data, total] = await Promise.all([
        this.model.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include,
        }),
        this.model.count({ where }),
      ])

      const totalPages = Math.ceil(total / limit)

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      }
    } catch (error) {
      this.handleError(error, 'paginate')
    }
  }

  /**
   * Cursor-based pagination for better performance on large datasets
   */
  async cursorPaginate(
    where?: Record<string, any>,
    options: CursorPaginationOptions = {},
    include?: Record<string, boolean>
  ): Promise<CursorPaginationResult<T>> {
    const { first, after, last, before, orderBy } = options

    if (first !== undefined && last !== undefined) {
      throw new ValidationError('Cannot specify both first and last')
    }

    const limit = first || last || 10

    try {
      // Build cursor conditions
      const cursorConditions: any = {}
      if (after) {
        cursorConditions.id = { gt: after }
      }
      if (before) {
        cursorConditions.id = { lt: before }
      }

      const finalWhere = where ? { ...where, ...cursorConditions } : cursorConditions

      // Get one extra record to check if there are more pages
      const records = await this.model.findMany({
        where: finalWhere,
        take: limit + 1,
        orderBy: orderBy || { id: 'asc' },
        include,
      })

      // Check if there are more records
      const hasMore = records.length > limit
      if (hasMore) {
        records.pop() // Remove the extra record
      }

      // If paginating backwards, reverse the results
      if (last) {
        records.reverse()
      }

      // Create edges with cursors
      const edges = records.map((record: any) => ({
        cursor: record.id,
        node: record,
      }))

      // Get total count
      const totalCount = await this.model.count({ where })

      // Build page info
      const pageInfo = {
        hasNextPage: last ? edges.length > 0 && before !== undefined : hasMore,
        hasPreviousPage: first ? edges.length > 0 && after !== undefined : hasMore,
        startCursor: edges.length > 0 ? edges[0].cursor : undefined,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : undefined,
      }

      return {
        edges,
        pageInfo,
        totalCount,
      }
    } catch (error) {
      this.handleError(error, 'cursorPaginate')
    }
  }

  /**
   * Execute a transaction
   */
  async transaction<R>(
    fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<R>
  ): Promise<R> {
    try {
      return await this.prisma.$transaction(fn)
    } catch (error) {
      this.handleError(error, 'transaction')
    }
  }

  /**
   * Execute raw SQL query
   */
  async executeRaw(sql: string, values?: any[]): Promise<any> {
    try {
      return await this.prisma.$executeRawUnsafe(sql, ...(values || []))
    } catch (error) {
      this.handleError(error, 'executeRaw')
    }
  }

  /**
   * Query raw SQL
   */
  async queryRaw<T = any>(sql: string, values?: any[]): Promise<T[]> {
    try {
      return await this.prisma.$queryRawUnsafe(sql, ...(values || []))
    } catch (error) {
      this.handleError(error, 'queryRaw')
    }
  }
}
