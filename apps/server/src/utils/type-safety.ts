/**
 * Type safety utility functions for handling null/undefined values and type conversions
 */

/**
 * Ensures a value is a string, providing a default value for null/undefined
 */
export function ensureString(value: string | null | undefined, defaultValue = ''): string {
  return value ?? defaultValue
}

/**
 * Ensures a value is converted to string from number or string, with fallback
 */
export function ensureStringFromNumber(value: number | string | null | undefined, defaultValue = '0'): string {
  if (value === null || value === undefined) {
    return defaultValue
  }
  return typeof value === 'number' ? value.toString() : value
}

/**
 * Safely parses an integer from a string or number, with fallback
 */
export function parseIntSafely(value: string | number | null | undefined, defaultValue = 0): number {
  if (value === null || value === undefined) {
    return defaultValue
  }
  
  const stringValue = typeof value === 'number' ? value.toString() : value
  const parsed = Number.parseInt(stringValue, 10)
  
  return Number.isNaN(parsed) ? defaultValue : parsed
}

/**
 * Checks if a value is a valid string (not null, undefined, or empty)
 */
export function isValidString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Safely converts a value to string for Number.parseInt usage
 */
export function toStringForParsing(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return '0'
  }
  return typeof value === 'number' ? value.toString() : value
}

/**
 * Safely converts a value to string with custom default value
 */
export function toStringForParsingWithDefault(
  value: number | string | null | undefined, 
  defaultValue = "0"
): string {
  if (value === null || value === undefined) {
    return defaultValue
  }
  return typeof value === 'number' ? value.toString() : value
}

/**
 * Safely parses integers with better type safety
 */
export function parseIntegerSafely(value: string | number | null | undefined, defaultValue = 0): number {
  if (value === null || value === undefined) {
    return defaultValue
  }
  
  const stringValue = typeof value === 'number' ? value.toString() : value
  const parsed = Number.parseInt(stringValue, 10)
  
  return Number.isNaN(parsed) ? defaultValue : parsed
}

/**
 * Handles nullable database strings with fallback
 */
export function handleNullableString(value: string | null, fallback = ''): string {
  return value ?? fallback
}
