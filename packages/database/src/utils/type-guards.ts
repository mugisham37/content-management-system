// =============================================================================
// TYPE GUARD UTILITIES
// =============================================================================
// Safe type conversion utilities for database operations

/**
 * Ensures a value is a string, converting if necessary
 */
export function ensureString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return value.toString()
  if (typeof value === 'boolean') return value.toString()
  if (value === null || value === undefined) return ''
  return String(value)
}

/**
 * Ensures a value is a string or undefined, converting if necessary
 */
export function ensureStringOrUndefined(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number') return value.toString()
  if (typeof value === 'boolean') return value.toString()
  return String(value)
}

/**
 * Ensures a value is a valid ID string
 */
export function ensureId(value: unknown): string {
  const id = ensureString(value)
  if (!id || id.trim() === '') {
    throw new Error('Invalid ID provided: ID cannot be empty')
  }
  return id.trim()
}

/**
 * Ensures a value is a number, converting if necessary
 */
export function ensureNumber(value: unknown): number {
  if (typeof value === 'number' && !isNaN(value)) return value
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    if (!isNaN(parsed)) return parsed
  }
  if (value === null || value === undefined) return 0
  return 0
}

/**
 * Ensures a value is an integer, converting if necessary
 */
export function ensureInteger(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10)
    if (!isNaN(parsed)) return parsed
  }
  if (value === null || value === undefined) return 0
  return 0
}

/**
 * Ensures a value is a boolean, converting if necessary
 */
export function ensureBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    return lower === 'true' || lower === '1' || lower === 'yes'
  }
  if (typeof value === 'number') return value !== 0
  return Boolean(value)
}

/**
 * Ensures a value is a Date, converting if necessary
 */
export function ensureDate(value: unknown): Date {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    if (!isNaN(date.getTime())) return date
  }
  return new Date()
}

/**
 * Ensures a value is a Date or undefined, converting if necessary
 */
export function ensureDateOrUndefined(value: unknown): Date | undefined {
  if (value === null || value === undefined) return undefined
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    if (!isNaN(date.getTime())) return date
  }
  return undefined
}

/**
 * Safely extracts a property from an object
 */
export function safeGetProperty(obj: unknown, key: string): unknown {
  if (obj === null || obj === undefined) return undefined
  if (typeof obj === 'object' && key in obj) {
    return (obj as Record<string, unknown>)[key]
  }
  return undefined
}

/**
 * Safely extracts a string property from an object
 */
export function safeGetStringProperty(obj: unknown, key: string): string | undefined {
  const value = safeGetProperty(obj, key)
  return ensureStringOrUndefined(value)
}

/**
 * Safely extracts a number property from an object
 */
export function safeGetNumberProperty(obj: unknown, key: string): number | undefined {
  const value = safeGetProperty(obj, key)
  if (value === null || value === undefined) return undefined
  return ensureNumber(value)
}

/**
 * Type guard to check if a value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Type guard to check if a value is a valid object
 */
export function isValidObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Type guard to check if a value is an array
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/**
 * Safely converts unknown value to JSON-serializable object
 */
export function ensureJsonObject(value: unknown): Record<string, any> {
  if (isValidObject(value)) {
    return value as Record<string, any>
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (isValidObject(parsed)) {
        return parsed as Record<string, any>
      }
    } catch {
      // Fall through to default
    }
  }
  return {}
}

/**
 * Validates and ensures a value is a valid UUID string
 */
export function ensureUuid(value: unknown): string {
  const str = ensureString(value)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(str)) {
    throw new Error(`Invalid UUID format: ${str}`)
  }
  return str
}

/**
 * Validates and ensures a value is a valid UUID string or undefined
 */
export function ensureUuidOrUndefined(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  try {
    return ensureUuid(value)
  } catch {
    return undefined
  }
}
