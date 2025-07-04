// =============================================================================
// SHARED CONSTANTS
// =============================================================================

// =============================================================================
// API CONSTANTS
// =============================================================================

export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/auth/login',
    LOGOUT: '/auth/logout',
    REGISTER: '/auth/register',
    REFRESH: '/auth/refresh',
    PROFILE: '/auth/profile',
    FORGOT_PASSWORD: '/auth/forgot-password',
    RESET_PASSWORD: '/auth/reset-password',
    VERIFY_EMAIL: '/auth/verify-email'
  },
  USERS: {
    LIST: '/users',
    CREATE: '/users',
    GET: (id: string) => `/users/${id}`,
    UPDATE: (id: string) => `/users/${id}`,
    DELETE: (id: string) => `/users/${id}`,
    AVATAR: (id: string) => `/users/${id}/avatar`
  },
  POSTS: {
    LIST: '/posts',
    CREATE: '/posts',
    GET: (id: string) => `/posts/${id}`,
    UPDATE: (id: string) => `/posts/${id}`,
    DELETE: (id: string) => `/posts/${id}`,
    PUBLISH: (id: string) => `/posts/${id}/publish`,
    UNPUBLISH: (id: string) => `/posts/${id}/unpublish`
  },
  CATEGORIES: {
    LIST: '/categories',
    CREATE: '/categories',
    GET: (id: string) => `/categories/${id}`,
    UPDATE: (id: string) => `/categories/${id}`,
    DELETE: (id: string) => `/categories/${id}`
  },
  TAGS: {
    LIST: '/tags',
    CREATE: '/tags',
    GET: (id: string) => `/tags/${id}`,
    UPDATE: (id: string) => `/tags/${id}`,
    DELETE: (id: string) => `/tags/${id}`
  },
  MEDIA: {
    LIST: '/media',
    UPLOAD: '/media/upload',
    GET: (id: string) => `/media/${id}`,
    UPDATE: (id: string) => `/media/${id}`,
    DELETE: (id: string) => `/media/${id}`
  },
  COMMENTS: {
    LIST: '/comments',
    CREATE: '/comments',
    GET: (id: string) => `/comments/${id}`,
    UPDATE: (id: string) => `/comments/${id}`,
    DELETE: (id: string) => `/comments/${id}`,
    APPROVE: (id: string) => `/comments/${id}/approve`,
    REJECT: (id: string) => `/comments/${id}/reject`
  },
  SETTINGS: {
    LIST: '/settings',
    GET: (key: string) => `/settings/${key}`,
    UPDATE: (key: string) => `/settings/${key}`
  }
} as const

// =============================================================================
// USER ROLES AND PERMISSIONS
// =============================================================================

export const USER_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  EDITOR: 'EDITOR',
  AUTHOR: 'AUTHOR',
  CONTRIBUTOR: 'CONTRIBUTOR',
  USER: 'USER'
} as const

export const ROLE_HIERARCHY = [
  USER_ROLES.SUPER_ADMIN,
  USER_ROLES.ADMIN,
  USER_ROLES.EDITOR,
  USER_ROLES.AUTHOR,
  USER_ROLES.CONTRIBUTOR,
  USER_ROLES.USER
] as const

export const PERMISSIONS = {
  // User permissions
  USERS_CREATE: 'users:create',
  USERS_READ: 'users:read',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',
  
  // Post permissions
  POSTS_CREATE: 'posts:create',
  POSTS_READ: 'posts:read',
  POSTS_UPDATE: 'posts:update',
  POSTS_DELETE: 'posts:delete',
  POSTS_PUBLISH: 'posts:publish',
  
  // Media permissions
  MEDIA_CREATE: 'media:create',
  MEDIA_READ: 'media:read',
  MEDIA_UPDATE: 'media:update',
  MEDIA_DELETE: 'media:delete',
  
  // Comment permissions
  COMMENTS_CREATE: 'comments:create',
  COMMENTS_READ: 'comments:read',
  COMMENTS_UPDATE: 'comments:update',
  COMMENTS_DELETE: 'comments:delete',
  COMMENTS_MODERATE: 'comments:moderate',
  
  // Category permissions
  CATEGORIES_CREATE: 'categories:create',
  CATEGORIES_READ: 'categories:read',
  CATEGORIES_UPDATE: 'categories:update',
  CATEGORIES_DELETE: 'categories:delete',
  
  // Tag permissions
  TAGS_CREATE: 'tags:create',
  TAGS_READ: 'tags:read',
  TAGS_UPDATE: 'tags:update',
  TAGS_DELETE: 'tags:delete',
  
  // Settings permissions
  SETTINGS_READ: 'settings:read',
  SETTINGS_UPDATE: 'settings:update'
} as const

// =============================================================================
// CONTENT STATUS
// =============================================================================

export const POST_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  SCHEDULED: 'SCHEDULED',
  ARCHIVED: 'ARCHIVED',
  TRASH: 'TRASH'
} as const

export const POST_TYPES = {
  POST: 'POST',
  PAGE: 'PAGE',
  PRODUCT: 'PRODUCT',
  EVENT: 'EVENT',
  CUSTOM: 'CUSTOM'
} as const

export const COMMENT_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SPAM: 'SPAM'
} as const

// =============================================================================
// MEDIA CONSTANTS
// =============================================================================

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml'
] as const

export const ALLOWED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/avi',
  'video/mov'
] as const

export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv'
] as const

export const MAX_FILE_SIZES = {
  IMAGE: 5 * 1024 * 1024, // 5MB
  VIDEO: 100 * 1024 * 1024, // 100MB
  DOCUMENT: 10 * 1024 * 1024, // 10MB
  DEFAULT: 5 * 1024 * 1024 // 5MB
} as const

// =============================================================================
// PAGINATION CONSTANTS
// =============================================================================

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
  MIN_LIMIT: 1
} as const

// =============================================================================
// VALIDATION CONSTANTS
// =============================================================================

export const VALIDATION_RULES = {
  PASSWORD: {
    MIN_LENGTH: 8,
    MAX_LENGTH: 128,
    REQUIRE_UPPERCASE: true,
    REQUIRE_LOWERCASE: true,
    REQUIRE_NUMBERS: true,
    REQUIRE_SYMBOLS: false
  },
  USERNAME: {
    MIN_LENGTH: 3,
    MAX_LENGTH: 30,
    PATTERN: /^[a-zA-Z0-9_-]+$/
  },
  EMAIL: {
    MAX_LENGTH: 254,
    PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  POST: {
    TITLE_MAX_LENGTH: 200,
    EXCERPT_MAX_LENGTH: 500,
    SLUG_MAX_LENGTH: 200
  },
  CATEGORY: {
    NAME_MAX_LENGTH: 100,
    DESCRIPTION_MAX_LENGTH: 500
  },
  TAG: {
    NAME_MAX_LENGTH: 50,
    DESCRIPTION_MAX_LENGTH: 200
  }
} as const

// =============================================================================
// DATE FORMATS
// =============================================================================

export const DATE_FORMATS = {
  DISPLAY: 'MMM dd, yyyy',
  DISPLAY_WITH_TIME: 'MMM dd, yyyy HH:mm',
  ISO: "yyyy-MM-dd'T'HH:mm:ss.SSSxxx",
  SHORT: 'MM/dd/yyyy',
  LONG: 'MMMM dd, yyyy',
  TIME_ONLY: 'HH:mm:ss',
  RELATIVE: 'relative' // Special format for relative time
} as const

// =============================================================================
// THEME CONSTANTS
// =============================================================================

export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system'
} as const

export const BREAKPOINTS = {
  SM: '640px',
  MD: '768px',
  LG: '1024px',
  XL: '1280px',
  '2XL': '1536px'
} as const

// =============================================================================
// NOTIFICATION TYPES
// =============================================================================

export const NOTIFICATION_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error'
} as const

// =============================================================================
// CACHE KEYS
// =============================================================================

export const CACHE_KEYS = {
  USER_PROFILE: (userId: string) => `user:profile:${userId}`,
  USER_PERMISSIONS: (userId: string) => `user:permissions:${userId}`,
  POST: (postId: string) => `post:${postId}`,
  POSTS_LIST: (filters: string) => `posts:list:${filters}`,
  CATEGORIES: 'categories:all',
  TAGS: 'tags:all',
  SETTINGS: 'settings:all',
  SITE_SETTINGS: 'settings:site'
} as const

// =============================================================================
// ERROR CODES
// =============================================================================

export const ERROR_CODES = {
  // Authentication errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  REQUIRED_FIELD: 'REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  
  // Resource errors
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',
  
  // Server errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  
  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // File upload errors
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  UPLOAD_FAILED: 'UPLOAD_FAILED'
} as const

// =============================================================================
// REGEX PATTERNS
// =============================================================================

export const REGEX_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  USERNAME: /^[a-zA-Z0-9_-]+$/,
  SLUG: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  HEX_COLOR: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/,
  URL: /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/,
  PHONE: /^\+?[\d\s\-\(\)]+$/
} as const

// =============================================================================
// DEFAULT VALUES
// =============================================================================

export const DEFAULTS = {
  AVATAR: '/images/default-avatar.png',
  THUMBNAIL: '/images/default-thumbnail.png',
  COVER_IMAGE: '/images/default-cover.jpg',
  POSTS_PER_PAGE: 10,
  COMMENTS_PER_PAGE: 20,
  SEARCH_DEBOUNCE: 300,
  TOAST_DURATION: 5000,
  SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes
  CACHE_TTL: 5 * 60 * 1000 // 5 minutes
} as const

// =============================================================================
// FEATURE FLAGS
// =============================================================================

export const FEATURES = {
  COMMENTS: 'comments',
  SOCIAL_LOGIN: 'social_login',
  EMAIL_NOTIFICATIONS: 'email_notifications',
  PUSH_NOTIFICATIONS: 'push_notifications',
  ANALYTICS: 'analytics',
  SEO_TOOLS: 'seo_tools',
  MULTI_LANGUAGE: 'multi_language',
  DARK_MODE: 'dark_mode',
  REAL_TIME_UPDATES: 'real_time_updates'
} as const
