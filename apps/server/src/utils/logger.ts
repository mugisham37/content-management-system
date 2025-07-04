// =============================================================================
// LOGGER UTILITY
// =============================================================================

import winston from 'winston'
import path from 'path'
import { config } from '../config'

// =============================================================================
// LOG LEVELS
// =============================================================================

const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
}

const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white'
}

winston.addColors(logColors)

// =============================================================================
// LOG FORMATS
// =============================================================================

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
)

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
)

// =============================================================================
// TRANSPORTS
// =============================================================================

const transports: winston.transport[] = [
  // Console transport
  new winston.transports.Console({
    format: consoleFormat,
    level: config.server.isDevelopment ? 'debug' : 'info'
  })
]

// File transport (if enabled)
if (config.logging.file.enabled) {
  transports.push(
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log'),
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  )
}

// =============================================================================
// LOGGER INSTANCE
// =============================================================================

const logger = winston.createLogger({
  level: config.logging.level,
  levels: logLevels,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'cms-server',
    environment: config.server.env
  },
  transports,
  exitOnError: false
})

// =============================================================================
// STREAM FOR MORGAN
// =============================================================================

export const morganStream = {
  write: (message: string) => {
    logger.http(message.substring(0, message.lastIndexOf('\n')))
  }
}

// =============================================================================
// LOGGER METHODS
// =============================================================================

export class Logger {
  static error(message: string, meta?: any): void {
    logger.error(message, meta)
  }

  static warn(message: string, meta?: any): void {
    logger.warn(message, meta)
  }

  static info(message: string, meta?: any): void {
    logger.info(message, meta)
  }

  static http(message: string, meta?: any): void {
    logger.http(message, meta)
  }

  static debug(message: string, meta?: any): void {
    logger.debug(message, meta)
  }

  static logRequest(req: any, res: any, responseTime?: number): void {
    const { method, url, ip, headers } = req
    const { statusCode } = res
    
    const logData = {
      method,
      url,
      ip,
      userAgent: headers['user-agent'],
      statusCode,
      responseTime: responseTime ? `${responseTime}ms` : undefined
    }

    if (statusCode >= 400) {
      logger.error('HTTP Request Error', logData)
    } else {
      logger.http('HTTP Request', logData)
    }
  }

  static logError(error: Error, context?: string): void {
    logger.error(`${context ? `[${context}] ` : ''}${error.message}`, {
      stack: error.stack,
      name: error.name,
      context
    })
  }

  static logDatabaseQuery(query: string, duration?: number): void {
    if (config.database.logQueries) {
      logger.debug('Database Query', {
        query,
        duration: duration ? `${duration}ms` : undefined
      })
    }
  }

  static logAuth(action: string, userId?: string, ip?: string): void {
    logger.info(`Auth: ${action}`, {
      userId,
      ip,
      timestamp: new Date().toISOString()
    })
  }

  static logSecurity(event: string, details: any): void {
    logger.warn(`Security Event: ${event}`, {
      ...details,
      timestamp: new Date().toISOString()
    })
  }

  static logPerformance(operation: string, duration: number, metadata?: any): void {
    logger.info(`Performance: ${operation}`, {
      duration: `${duration}ms`,
      ...metadata
    })
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default logger
export { logger }
