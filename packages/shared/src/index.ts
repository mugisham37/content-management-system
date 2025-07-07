// =============================================================================
// SHARED PACKAGE EXPORTS
// =============================================================================

// Constants
export * from './constants'

// Types
export * from './types'
export * from './types/content-type'

// Utilities
export * from './utils'

// Content Type specific utilities (avoiding conflicts)
export {
  parseFieldsFromJson,
  serializeFieldsToJson,
  transformPrismaContentType,
  transformPrismaContentTypeWithFields,
  generateId,
  validateFieldDefinition,
  validateContentTypeData,
  mergeFields,
  validateFieldValue,
  type JsonValue,
  type JsonObject,
  type JsonArray
} from './utils/content-type.utils'

// Validations
export * from './validations'
