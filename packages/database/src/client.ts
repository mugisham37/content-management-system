import { PrismaClient } from '@prisma/client'

// =============================================================================
// PRISMA CLIENT CONFIGURATION
// =============================================================================

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    errorFormat: 'pretty',
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// =============================================================================
// DATABASE CONNECTION UTILITIES
// =============================================================================

export async function connectDatabase() {
  try {
    await prisma.$connect()
    console.log('✅ Database connected successfully')
  } catch (error) {
    console.error('❌ Database connection failed:', error)
    throw error
  }
}

export async function disconnectDatabase() {
  try {
    await prisma.$disconnect()
    console.log('✅ Database disconnected successfully')
  } catch (error) {
    console.error('❌ Database disconnection failed:', error)
    throw error
  }
}

// =============================================================================
// DATABASE HEALTH CHECK
// =============================================================================

export async function checkDatabaseHealth() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return { status: 'healthy', timestamp: new Date().toISOString() }
  } catch (error) {
    return { 
      status: 'unhealthy', 
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString() 
    }
  }
}

// =============================================================================
// TRANSACTION UTILITIES
// =============================================================================

export async function withTransaction<T>(
  callback: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return await prisma.$transaction(callback)
}

// =============================================================================
// SOFT DELETE UTILITIES
// =============================================================================

export function excludeDeleted<T extends { deletedAt?: Date | null }>(
  records: T[]
): T[] {
  return records.filter(record => !record.deletedAt)
}

export function includeDeleted<T extends { deletedAt?: Date | null }>(
  records: T[]
): T[] {
  return records
}

// =============================================================================
// PAGINATION UTILITIES
// =============================================================================

export interface PaginationOptions {
  page?: number
  limit?: number
  orderBy?: string
  orderDirection?: 'asc' | 'desc'
}

export interface PaginatedResult<T> {
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

export async function paginate<T>(
  model: any,
  options: PaginationOptions = {},
  where: any = {},
  include: any = {}
): Promise<PaginatedResult<T>> {
  const page = Math.max(1, options.page || 1)
  const limit = Math.min(100, Math.max(1, options.limit || 10))
  const skip = (page - 1) * limit

  const [data, total] = await Promise.all([
    model.findMany({
      where,
      include,
      skip,
      take: limit,
      orderBy: options.orderBy ? {
        [options.orderBy]: options.orderDirection || 'desc'
      } : { createdAt: 'desc' }
    }),
    model.count({ where })
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
      hasPrev: page > 1
    }
  }
}

export default prisma
