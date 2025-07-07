import { TenantPlan, UserRole } from '@prisma/client';
import { Prisma } from '@prisma/client';

// =============================================================================
// ENUM VALIDATION UTILITIES
// =============================================================================

export const validateUserRole = (role: string): UserRole => {
  if (!Object.values(UserRole).includes(role as UserRole)) {
    throw new Error(`Invalid user role: ${role}. Valid roles are: ${Object.values(UserRole).join(', ')}`);
  }
  return role as UserRole;
};

export const validateTenantPlan = (plan: string): TenantPlan => {
  if (!Object.values(TenantPlan).includes(plan as TenantPlan)) {
    throw new Error(`Invalid tenant plan: ${plan}. Valid plans are: ${Object.values(TenantPlan).join(', ')}`);
  }
  return plan as TenantPlan;
};

// =============================================================================
// JSON SANITIZATION UTILITIES
// =============================================================================

export const sanitizeJsonInput = (input: any): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined => {
  if (input === null) {
    return Prisma.JsonNull;
  }
  if (input === undefined) {
    return undefined;
  }
  // Deep clone to ensure it's serializable
  return JSON.parse(JSON.stringify(input));
};

export const sanitizeJsonInputOptional = (input: any): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined => {
  if (input === undefined) {
    return undefined;
  }
  return sanitizeJsonInput(input);
};

// =============================================================================
// TYPE CONVERSION UTILITIES
// =============================================================================

export const convertJsonValueToInputJson = (value: any): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return Prisma.JsonNull;
  }
  // Convert JsonValue to InputJsonValue by serializing and parsing
  return JSON.parse(JSON.stringify(value));
};

// =============================================================================
// STRING UTILITIES FOR DYNAMIC KEYS
// =============================================================================

export const safeStringReplace = (key: any, searchValue: string | RegExp, replaceValue: string): string => {
  // Convert key to string before using string methods
  return String(key).replace(searchValue, replaceValue);
};

export const processUsageLimitKey = (key: any): string => {
  // Convert key to string and process it safely
  return safeStringReplace(key, /([A-Z])/g, '_$1').toLowerCase();
};

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

export const isValidEnum = <T extends Record<string, string>>(enumObject: T, value: string): value is T[keyof T] => {
  return Object.values(enumObject).includes(value as T[keyof T]);
};

export const validateAndCastEnum = <T extends Record<string, string>>(
  enumObject: T,
  value: string,
  enumName: string
): T[keyof T] => {
  if (!isValidEnum(enumObject, value)) {
    throw new Error(`Invalid ${enumName}: ${value}. Valid values are: ${Object.values(enumObject).join(', ')}`);
  }
  return value as T[keyof T];
};
