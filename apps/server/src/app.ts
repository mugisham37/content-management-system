// =============================================================================
// EXPRESS APPLICATION SETUP
// =============================================================================

import express, { Application, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import { config, validateConfig } from './config'
import { Logger, morganStream } from './utils/logger'
import { sendErrorResponse, AppError, NotFoundError } from './utils/errors'

// =============================================================================
// APPLICATION INITIALIZATION
// =============================================================================

export function createApp(): Application {
  // Validate configuration
  validateConfig()

  const app: Application = express()

  // =============================================================================
  // SECURITY MIDDLEWARE
  // =============================================================================

  // Helmet for security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false
  }))

  // CORS configuration
  app.use(cors({
    origin: config.cors.origin,
    credentials: config.cors.credentials,
    optionsSuccessStatus: config.cors.optionsSuccessStatus,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'Cache-Control',
      'Pragma'
    ]
  }))

  // Rate limiting
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    message: {
      success: false,
      error: {
        message: config.rateLimit.message,
        code: 'RATE_LIMIT_EXCEEDED',
        statusCode: 429
      }
    },
    standardHeaders: config.rateLimit.standardHeaders,
    legacyHeaders: config.rateLimit.legacyHeaders,
    handler: (req: Request, res: Response) => {
      Logger.logSecurity('Rate limit exceeded', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path
      })
      
      res.status(429).json({
        success: false,
        error: {
          message: config.rateLimit.message,
          code: 'RATE_LIMIT_EXCEEDED',
          statusCode: 429,
          timestamp: new Date().toISOString()
        }
      })
    }
  })

  app.use('/api/', limiter)

  // =============================================================================
  // GENERAL MIDDLEWARE
  // =============================================================================

  // Compression
  app.use(compression())

  // Body parsing
  app.use(express.json({ 
    limit: '10mb',
    verify: (req: any, res, buf) => {
      req.rawBody = buf
    }
  }))
  app.use(express.urlencoded({ 
    extended: true, 
    limit: '10mb' 
  }))

  // Request logging
  if (config.server.isDevelopment) {
    app.use(morgan('dev'))
  } else {
    app.use(morgan('combined', { stream: morganStream }))
  }

  // Request ID and timing
  app.use((req: any, res: Response, next: NextFunction) => {
    req.requestId = Math.random().toString(36).substring(2, 15)
    req.startTime = Date.now()
    
    res.setHeader('X-Request-ID', req.requestId)
    
    next()
  })

  // =============================================================================
  // HEALTH CHECK ENDPOINTS
  // =============================================================================

  if (config.monitoring.healthCheck.enabled) {
    app.get(config.monitoring.healthCheck.path, (req: Request, res: Response) => {
      res.status(200).json({
        success: true,
        data: {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          environment: config.server.env,
          version: process.env.npm_package_version || '1.0.0'
        }
      })
    })

    app.get('/api/health/detailed', async (req: Request, res: Response) => {
      try {
        // Check database connection
        const { prisma } = await import('@cms-platform/database')
        await prisma.$queryRaw`SELECT 1`

        res.status(200).json({
          success: true,
          data: {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: config.server.env,
            version: process.env.npm_package_version || '1.0.0',
            services: {
              database: 'healthy',
              redis: 'healthy' // TODO: Add Redis health check
            },
            memory: {
              used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
              total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
            }
          }
        })
      } catch (error) {
        Logger.logError(error as Error, 'Health Check')
        res.status(503).json({
          success: false,
          error: {
            message: 'Service unhealthy',
            code: 'SERVICE_UNHEALTHY',
            statusCode: 503,
            timestamp: new Date().toISOString()
          }
        })
      }
    })
  }

  // =============================================================================
  // API ROUTES
  // =============================================================================

  // API base route
  app.get('/api', (req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        message: 'CMS Platform API',
        version: '1.0.0',
        environment: config.server.env,
        timestamp: new Date().toISOString()
      }
    })
  })

  // TODO: Add route imports here
  // app.use('/api/v1/auth', authRoutes)
  // app.use('/api/v1/users', userRoutes)
  // app.use('/api/v1/posts', postRoutes)
  // app.use('/api/v1/categories', categoryRoutes)
  // app.use('/api/v1/tags', tagRoutes)
  // app.use('/api/v1/media', mediaRoutes)
  // app.use('/api/v1/comments', commentRoutes)
  // app.use('/api/v1/settings', settingsRoutes)

  // =============================================================================
  // ERROR HANDLING
  // =============================================================================

  // 404 handler
  app.all('*', (req: Request, res: Response, next: NextFunction) => {
    next(new NotFoundError(`Route ${req.originalUrl} not found`))
  })

  // Global error handler
  app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
    // Log request completion time
    const responseTime = Date.now() - (req as any).startTime
    Logger.logRequest(req, res, responseTime)

    sendErrorResponse(res, error, req)
  })

  // =============================================================================
  // GRACEFUL SHUTDOWN HANDLERS
  // =============================================================================

  const gracefulShutdown = (signal: string) => {
    Logger.info(`Received ${signal}. Starting graceful shutdown...`)
    
    // Close server
    process.exit(0)
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))

  // Handle uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    Logger.logError(error, 'Uncaught Exception')
    process.exit(1)
  })

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    Logger.error('Unhandled Rejection at:', { promise, reason })
    process.exit(1)
  })

  return app
}

// =============================================================================
// EXPORTS
// =============================================================================

export default createApp
