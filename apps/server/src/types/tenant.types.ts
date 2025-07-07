import { TenantPlan, TenantStatus, UserRole } from '@prisma/client';

// =============================================================================
// TENANT DOMAIN TYPES
// =============================================================================

export interface TenantUsageLimits {
  maxUsers: number;
  maxStorage: number;
  maxContentTypes: number;
  maxContents: number;
  maxApiRequests: number;
  maxWebhooks: number;
  maxWorkflows: number;
  [key: string]: number; // Allow dynamic keys
}

export interface TenantCurrentUsage {
  users: number;
  storage: number;
  contentTypes: number;
  contents: number;
  apiRequests: number;
  webhooks: number;
  workflows: number;
  [key: string]: number; // Allow dynamic keys
}

export interface TenantUpdateData {
  name?: string;
  slug?: string;
  description?: string | null;
  plan?: TenantPlan;
  status?: TenantStatus;
  usageLimits?: TenantUsageLimits;
  currentUsage?: TenantCurrentUsage;
  settings?: Record<string, any>;
  securitySettings?: Record<string, any>;
  customBranding?: Record<string, any> | null;
  billingInfo?: Record<string, any> | null;
  customDomain?: string | null;
}

export interface UserUpdateData {
  role?: UserRole;
  email?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string | null;
  timezone?: string | null;
  status?: string;
  isActive?: boolean;
  preferences?: Record<string, any>;
  [key: string]: any;
}

// Type guards
export const isTenantUsageLimits = (value: any): value is TenantUsageLimits => {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.maxUsers === 'number' &&
    typeof value.maxStorage === 'number' &&
    typeof value.maxContentTypes === 'number' &&
    typeof value.maxContents === 'number' &&
    typeof value.maxApiRequests === 'number' &&
    typeof value.maxWebhooks === 'number' &&
    typeof value.maxWorkflows === 'number'
  );
};

export const isTenantCurrentUsage = (value: any): value is TenantCurrentUsage => {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.users === 'number' &&
    typeof value.storage === 'number' &&
    typeof value.contentTypes === 'number' &&
    typeof value.contents === 'number' &&
    typeof value.apiRequests === 'number' &&
    typeof value.webhooks === 'number' &&
    typeof value.workflows === 'number'
  );
};
