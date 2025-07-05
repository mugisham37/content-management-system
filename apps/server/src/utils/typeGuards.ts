// =============================================================================
// TYPE GUARD UTILITIES
// =============================================================================

/**
 * Type guard to check if a value is an Error instance
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Type guard to check if a value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Type guard to check if a value is a number
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

/**
 * Type guard to check if a value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * Type guard to check if a value is an object (not array or null)
 */
export function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Type guard to check if a value is an array
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Type guard to check if a value is null
 */
export function isNull(value: unknown): value is null {
  return value === null;
}

/**
 * Type guard to check if a value is undefined
 */
export function isUndefined(value: unknown): value is undefined {
  return value === undefined;
}

/**
 * Type guard to check if a value is null or undefined
 */
export function isNullOrUndefined(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Type guard to check if a value is a Date instance
 */
export function isDate(value: unknown): value is Date {
  return value instanceof Date;
}

/**
 * Type guard to check if a value is a function
 */
export function isFunction(value: unknown): value is Function {
  return typeof value === 'function';
}

/**
 * Type guard to check if a value is a Promise
 */
export function isPromise<T = any>(value: unknown): value is Promise<T> {
  return value instanceof Promise || (
    isObject(value) && 
    isFunction((value as any).then) && 
    isFunction((value as any).catch)
  );
}

// =============================================================================
// SWAGGER-SPECIFIC TYPE GUARDS
// =============================================================================

/**
 * Interface for Swagger Info object
 */
export interface SwaggerInfo {
  title: string;
  version: string;
  description?: string;
  termsOfService?: string;
  contact?: {
    name?: string;
    email?: string;
    url?: string;
  };
  license?: {
    name: string;
    url?: string;
  };
  [key: string]: any;
}

/**
 * Interface for Swagger Paths object
 */
export interface SwaggerPaths {
  [path: string]: {
    [method: string]: any;
  };
}

/**
 * Interface for Swagger Document
 */
export interface SwaggerDocument {
  openapi?: string;
  swagger?: string;
  info: SwaggerInfo;
  paths: SwaggerPaths;
  components?: Record<string, any>;
  servers?: Array<{
    url: string;
    description?: string;
  }>;
  [key: string]: any;
}

/**
 * Type guard to check if an object has the required Swagger info structure
 */
export function isSwaggerInfo(obj: unknown): obj is SwaggerInfo {
  return (
    isObject(obj) &&
    isString(obj.title) &&
    isString(obj.version)
  );
}

/**
 * Type guard to check if an object has the required Swagger paths structure
 */
export function isSwaggerPaths(obj: unknown): obj is SwaggerPaths {
  return isObject(obj);
}

/**
 * Type guard to check if an object is a valid Swagger document
 */
export function isSwaggerDocument(obj: unknown): obj is SwaggerDocument {
  return (
    isObject(obj) &&
    'info' in obj &&
    'paths' in obj &&
    isSwaggerInfo(obj.info) &&
    isSwaggerPaths(obj.paths)
  );
}

// =============================================================================
// ERROR HANDLING TYPE GUARDS
// =============================================================================

/**
 * Type guard for HTTP errors with status codes
 */
export interface HttpError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
}

/**
 * Type guard to check if an error is an HTTP error
 */
export function isHttpError(error: unknown): error is HttpError {
  return (
    isError(error) &&
    (isNumber((error as any).status) || isNumber((error as any).statusCode))
  );
}

/**
 * Type guard for validation errors
 */
export interface ValidationError extends Error {
  details?: Array<{
    field: string;
    message: string;
    code?: string;
  }>;
}

/**
 * Type guard to check if an error is a validation error
 */
export function isValidationError(error: unknown): error is ValidationError {
  return (
    isError(error) &&
    'details' in error &&
    isArray((error as any).details)
  );
}

// =============================================================================
// UTILITY TYPE GUARDS
// =============================================================================

/**
 * Type guard to check if a value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

/**
 * Type guard to check if a value is a positive number
 */
export function isPositiveNumber(value: unknown): value is number {
  return isNumber(value) && value > 0;
}

/**
 * Type guard to check if a value is a valid email format
 */
export function isValidEmail(value: unknown): value is string {
  if (!isString(value)) return false;
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(value);
}

/**
 * Type guard to check if a value is a valid UUID
 */
export function isValidUUID(value: unknown): value is string {
  if (!isString(value)) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Type guard to check if a value is a valid URL
 */
export function isValidUrl(value: unknown): value is string {
  if (!isString(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// GENERIC TYPE HELPERS
// =============================================================================

/**
 * Helper type to ensure a value extends object
 */
export type ObjectLike = Record<string, any>;

/**
 * Type guard to check if a value is object-like (can be used with object utilities)
 */
export function isObjectLike(value: unknown): value is ObjectLike {
  return isObject(value);
}

/**
 * Type guard to check if a value can be safely cloned
 */
export function isCloneable(value: unknown): value is ObjectLike | unknown[] | Date | string | number | boolean | null {
  return (
    isObject(value) ||
    isArray(value) ||
    isDate(value) ||
    isString(value) ||
    isNumber(value) ||
    isBoolean(value) ||
    isNull(value)
  );
}

/**
 * Type guard to check if a value can be safely merged
 */
export function isMergeable(value: unknown): value is ObjectLike {
  return isObject(value);
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  // Basic type guards
  isError,
  isString,
  isNumber,
  isBoolean,
  isObject,
  isArray,
  isNull,
  isUndefined,
  isNullOrUndefined,
  isDate,
  isFunction,
  isPromise,
  
  // Swagger type guards
  isSwaggerInfo,
  isSwaggerPaths,
  isSwaggerDocument,
  
  // Error type guards
  isHttpError,
  isValidationError,
  
  // Utility type guards
  isNonEmptyString,
  isPositiveNumber,
  isValidEmail,
  isValidUUID,
  isValidUrl,
  
  // Generic helpers
  isObjectLike,
  isCloneable,
  isMergeable,
};
