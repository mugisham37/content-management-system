// =============================================================================
// SERVER CONFIGURATION
// =============================================================================

import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config()

// =============================================================================
// ENVIRONMENT VALIDATION
// =============================================================================

const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET'
] as const

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar])

if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`)
}

// =============================================================================
// CONFIGURATION OBJECT
// =============================================================================

export const config = {
  // Server Configuration
  server: {
    port: parseInt(process.env.PORT || '8000', 10),
    host: process.env.HOST || 'localhost',
    env: process.env.NODE_ENV || 'development',
    isDevelopment: process.env.NODE_ENV === 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isTest: process.env.NODE_ENV === 'test'
  },

  // Database Configuration
  database: {
    url: process.env.DATABASE_URL!,
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10),
    connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '60000', 10),
    logQueries: process.env.DB_LOG_QUERIES === 'true'
  },

  // Redis Configuration
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'cms:',
    ttl: parseInt(process.env.REDIS_TTL || '3600', 10) // 1 hour default
  },

  // JWT Configuration
  jwt: {
    secret: process.env.JWT_SECRET!,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET!,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    issuer: process.env.JWT_ISSUER || 'cms-platform',
    audience: process.env.JWT_AUDIENCE || 'cms-users'
  },

  // CORS Configuration
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || [
      'http://localhost:3000',
      'http://localhost:3001'
    ],
    credentials: true,
    optionsSuccessStatus: 200
  },

  // File Upload Configuration
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
    allowedImageTypes: [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml'
    ],
    allowedVideoTypes: [
      'video/mp4',
      'video/webm',
      'video/ogg'
    ],
    allowedDocumentTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ],
    uploadDir: process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'),
    tempDir: process.env.TEMP_DIR || path.join(process.cwd(), 'temp')
  },

  // Email Configuration
  email: {
    smtp: {
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    },
    from: {
      name: process.env.EMAIL_FROM_NAME || 'CMS Platform',
      address: process.env.EMAIL_FROM_ADDRESS || 'noreply@cms-platform.com'
    },
    templates: {
      dir: path.join(process.cwd(), 'src', 'templates', 'email')
    }
  },

  // Rate Limiting Configuration
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10), // 100 requests per window
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false
  },

  // Security Configuration
  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
    sessionSecret: process.env.SESSION_SECRET || 'your-session-secret',
    cookieSecret: process.env.COOKIE_SECRET || 'your-cookie-secret',
    csrfSecret: process.env.CSRF_SECRET || 'your-csrf-secret'
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'combined',
    file: {
      enabled: process.env.LOG_FILE_ENABLED === 'true',
      filename: process.env.LOG_FILE_NAME || 'app.log',
      maxSize: process.env.LOG_FILE_MAX_SIZE || '10m',
      maxFiles: parseInt(process.env.LOG_FILE_MAX_FILES || '5', 10)
    }
  },

  // Cache Configuration
  cache: {
    ttl: parseInt(process.env.CACHE_TTL || '300', 10), // 5 minutes
    max: parseInt(process.env.CACHE_MAX || '1000', 10), // Max 1000 items
    checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD || '600', 10) // Check every 10 minutes
  },

  // Pagination Configuration
  pagination: {
    defaultLimit: parseInt(process.env.PAGINATION_DEFAULT_LIMIT || '10', 10),
    maxLimit: parseInt(process.env.PAGINATION_MAX_LIMIT || '100', 10)
  },

  // Search Configuration
  search: {
    enabled: process.env.SEARCH_ENABLED !== 'false',
    provider: process.env.SEARCH_PROVIDER || 'database', // 'database' | 'elasticsearch'
    elasticsearch: {
      node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
      index: process.env.ELASTICSEARCH_INDEX || 'cms-content'
    }
  },

  // Elasticsearch Configuration
  elasticsearch: {
    enabled: process.env.ELASTICSEARCH_ENABLED === 'true',
    node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
    auth: process.env.ELASTICSEARCH_AUTH,
  },

  // Monitoring Configuration
  monitoring: {
    enabled: process.env.MONITORING_ENABLED === 'true',
    healthCheck: {
      enabled: process.env.HEALTH_CHECK_ENABLED !== 'false',
      path: process.env.HEALTH_CHECK_PATH || '/health'
    },
    metrics: {
      enabled: process.env.METRICS_ENABLED === 'true',
      path: process.env.METRICS_PATH || '/metrics'
    }
  },

  // Feature Flags
  features: {
    registration: process.env.FEATURE_REGISTRATION !== 'false',
    socialLogin: process.env.FEATURE_SOCIAL_LOGIN === 'true',
    emailVerification: process.env.FEATURE_EMAIL_VERIFICATION === 'true',
    twoFactorAuth: process.env.FEATURE_TWO_FACTOR_AUTH === 'true',
    comments: process.env.FEATURE_COMMENTS !== 'false',
    notifications: process.env.FEATURE_NOTIFICATIONS === 'true',
    analytics: process.env.FEATURE_ANALYTICS === 'true'
  }
} as const

// =============================================================================
// CONFIGURATION VALIDATION
// =============================================================================

export function validateConfig(): void {
  // Validate port
  if (config.server.port < 1 || config.server.port > 65535) {
    throw new Error('Invalid port number. Must be between 1 and 65535.')
  }

  // Validate JWT secret
  if (config.jwt.secret.length < 32) {
    throw new Error('JWT secret must be at least 32 characters long.')
  }

  // Validate database URL
  if (!config.database.url.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection string.')
  }

  // Validate upload directory
  if (!path.isAbsolute(config.upload.uploadDir)) {
    throw new Error('Upload directory must be an absolute path.')
  }

  // Validate email configuration if email features are enabled
  if (config.features.emailVerification && !config.email.smtp.auth.user) {
    throw new Error('SMTP configuration is required when email verification is enabled.')
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default config
