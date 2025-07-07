import { Prisma, UserRole, TenantPlan } from '@prisma/client';

// =============================================================================
// PRISMA TYPE EXTENSIONS FOR TYPE SAFETY
// =============================================================================

// Type-safe JSON input for Prisma operations
export type SafeJsonValue = string | number | boolean | null | SafeJsonObject | SafeJsonArray;
export type SafeJsonObject = { [key: string]: SafeJsonValue };
export type SafeJsonArray = SafeJsonValue[];

// Extended update input types that handle JSON fields properly
export interface SafeTenantUpdateInput extends Omit<Prisma.TenantUpdateInput, 'usageLimits' | 'currentUsage'> {
  usageLimits?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  currentUsage?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
}

export interface SafeUserUpdateInput extends Omit<Prisma.UserUpdateInput, 'role'> {
  role?: UserRole;
}

// Type-safe JSON conversion utilities
export const convertToInputJson = (value: any): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined => {
  if (value === null) {
    return Prisma.JsonNull;
  }
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
};

// Type guards for safe casting
export const isValidJsonValue = (value: any): value is SafeJsonValue => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isValidJsonValue);
  if (typeof value === 'object') {
    return Object.values(value).every(isValidJsonValue);
  }
  return false;
};
