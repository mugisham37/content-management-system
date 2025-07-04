// =============================================================================
// SERVER ENTRY POINT
// =============================================================================

import { createApp } from './app'
import { config } from './config'
import { Logger } from './utils/logger'

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function startServer(): Promise<void> {
  try {
    // Create Express application
    const app = createApp()

    // Start server
    const server = app.listen(config.server.port, config.server.host, () => {
      Logger.info(`🚀 Server started successfully!`)
      Logger.info(`📍 Environment: ${config.server.env}`)
      Logger.info(`🌐 Server running at: http://${config.server.host}:${config.server.port}`)
      Logger.info(`🏥 Health check: http://${config.server.host}:${config.server.port}${config.monitoring.healthCheck.path}`)
      Logger.info(`📚 API Documentation: http://${config.server.host}:${config.server.port}/api`)
      
      if (config.server.isDevelopment) {
        Logger.info(`🔧 Development mode enabled`)
        Logger.info(`📝 Database logging: ${config.database.logQueries ? 'enabled' : 'disabled'}`)
      }
    })

    // Handle server errors
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.syscall !== 'listen') {
        throw error
      }

      const bind = typeof config.server.port === 'string'
        ? 'Pipe ' + config.server.port
        : 'Port ' + config.server.port

      switch (error.code) {
        case 'EACCES':
          Logger.error(`${bind} requires elevated privileges`)
          process.exit(1)
          break
        case 'EADDRINUSE':
          Logger.error(`${bind} is already in use`)
          process.exit(1)
          break
        default:
          throw error
      }
    })

    // Graceful shutdown
    const gracefulShutdown = (signal: string) => {
      Logger.info(`Received ${signal}. Starting graceful shutdown...`)
      
      server.close(async (err) => {
        if (err) {
          Logger.error('Error during server shutdown:', err)
          process.exit(1)
        }

        try {
          // Close database connections
          const { prisma } = await import('@cms-platform/database')
          await prisma.$disconnect()
          Logger.info('Database connections closed')

          Logger.info('Graceful shutdown completed')
          process.exit(0)
        } catch (error) {
          Logger.error('Error during graceful shutdown:', error)
          process.exit(1)
        }
      })

      // Force shutdown after 30 seconds
      setTimeout(() => {
        Logger.error('Forced shutdown after timeout')
        process.exit(1)
      }, 30000)
    }

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
    process.on('SIGINT', () => gracefulShutdown('SIGINT'))

  } catch (error) {
    Logger.logError(error as Error, 'Server Startup')
    process.exit(1)
  }
}

// =============================================================================
// START THE SERVER
// =============================================================================

if (require.main === module) {
  startServer()
}

// =============================================================================
// EXPORTS
// =============================================================================

export { startServer }
export default startServer
