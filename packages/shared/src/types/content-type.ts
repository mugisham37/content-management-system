// =============================================================================
// CONTENT TYPE TYPES - SHARED
// =============================================================================
// Comprehensive type definitions for content type management

// Base FieldDefinition interface
export interface FieldDefinition {
  id: string;
  name: string;
  type: string;
  displayName: string;
  description?: string;
  required: boolean;
  defaultValue?: any;
  validation?: {
    required?: boolean;
    unique?: boolean;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    enum?: string[];
    message?: string;
  };
  validationRules?: ValidationRule[]; // Add this for backward compatibility
  options?: Record<string, any>; // Add this property
  settings?: Record<string, any>;
  isSystem?: boolean;
  isLocalized?: boolean;
  order?: number;
  contentTypeId: string;
  createdAt: Date;
  updatedAt: Date;
}

// For creating new fields (without auto-generated properties)
export interface CreateFieldDefinition {
  name: string;
  type: string;
  displayName: string;
  description?: string;
  required?: boolean;
  defaultValue?: any;
  validation?: {
    required?: boolean;
    unique?: boolean;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    enum?: string[];
    message?: string;
  };
  validationRules?: ValidationRule[]; // Add this for backward compatibility
  options?: Record<string, any>; // Add this property
  settings?: Record<string, any>;
  isSystem?: boolean;
  isLocalized?: boolean;
  order?: number;
}

// For updating existing fields
export interface UpdateFieldDefinition extends Partial<CreateFieldDefinition> {
  id?: string;
  name?: string; // Make name optional for updates
}

// Base ContentType interface
export interface ContentType {
  id: string;
  name: string;
  displayName: string;
  description?: string; // Changed from string | null to string | undefined
  isSystem: boolean;
  tenantId?: string;
  createdById?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ContentType with parsed fields
export interface ContentTypeWithFields extends ContentType {
  fields: FieldDefinition[];
}

// For creating new content types
export interface CreateContentTypeInput {
  name: string;
  displayName: string;
  description?: string;
  isSystem?: boolean;
  fields?: CreateFieldDefinition[];
  tenantId?: string;
}

// For updating content types
export interface UpdateContentTypeInput {
  name?: string;
  displayName?: string;
  description?: string;
  fields?: (CreateFieldDefinition | UpdateFieldDefinition)[];
}

// Paginated response
export interface PaginatedContentTypes {
  contentTypes: ContentTypeWithFields[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Validation result
export interface ContentTypeValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// Statistics
export interface ContentTypeStats {
  totalTypes: number;
  activeTypes: number;
  totalFields: number;
  fieldsByType: Record<string, number>;
  mostUsedTypes: Array<{ id: string; name: string; usageCount: number }>;
}

// Field Type interface
export interface FieldType {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  dataType: string;
  uiType: string;
  isSystem: boolean;
  isBuiltIn: boolean;
  validations?: any[];
  settings?: Record<string, any>;
  pluginId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Validation Rule interface
export interface ValidationRule {
  id: string;
  fieldId: string;
  ruleType: 'minLength' | 'maxLength' | 'pattern' | 'min' | 'max' | 'custom' | 'required' | 'unique' | 'enum';
  value: string | number | string[];
  errorMessage?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
