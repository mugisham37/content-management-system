// =============================================================================
// CONTENT TYPE UTILITIES - SHARED
// =============================================================================
// Utility functions for content type data transformation and validation

import { 
  FieldDefinition, 
  CreateFieldDefinition, 
  UpdateFieldDefinition,
  ContentType, 
  ContentTypeWithFields 
} from '../types/content-type';

// Define JsonValue type locally to avoid Prisma dependency
export type JsonValue = string | number | boolean | JsonObject | JsonArray | null;
export type JsonObject = { [Key in string]?: JsonValue };
export type JsonArray = JsonValue[];

/**
 * Parse fields from JSON to FieldDefinition array
 */
export function parseFieldsFromJson(fieldsJson: JsonValue): FieldDefinition[] {
  if (!fieldsJson || typeof fieldsJson !== 'object' || !Array.isArray(fieldsJson)) {
    return [];
  }
  
  return fieldsJson.map((field: any) => ({
    id: field.id || generateId(),
    name: field.name || '',
    type: field.type || 'text',
    displayName: field.displayName || field.name || '',
    description: field.description,
    required: field.required || false,
    defaultValue: field.defaultValue,
    validation: field.validation || {},
    settings: field.settings || {},
    isSystem: field.isSystem || false,
    isLocalized: field.isLocalized || false,
    order: field.order || 0,
    contentTypeId: field.contentTypeId || '',
    createdAt: field.createdAt ? new Date(field.createdAt) : new Date(),
    updatedAt: field.updatedAt ? new Date(field.updatedAt) : new Date(),
  })) as FieldDefinition[];
}

/**
 * Serialize fields to JSON for database storage
 */
export function serializeFieldsToJson(fields: (CreateFieldDefinition | FieldDefinition)[]): JsonValue {
  return fields.map(field => ({
    ...field,
    id: 'id' in field ? field.id : generateId(),
    contentTypeId: 'contentTypeId' in field ? field.contentTypeId : '',
    createdAt: 'createdAt' in field ? field.createdAt.toISOString() : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

/**
 * Transform Prisma ContentType to application ContentType
 */
export function transformPrismaContentType(prismaContentType: any): ContentType {
  return {
    id: prismaContentType.id,
    name: prismaContentType.name,
    displayName: prismaContentType.displayName,
    description: prismaContentType.description || undefined, // Convert null to undefined
    isSystem: prismaContentType.isSystem,
    tenantId: prismaContentType.tenantId || undefined,
    createdById: prismaContentType.createdById || undefined,
    createdAt: prismaContentType.createdAt,
    updatedAt: prismaContentType.updatedAt,
  };
}

/**
 * Transform Prisma ContentType with fields to application ContentTypeWithFields
 */
export function transformPrismaContentTypeWithFields(prismaContentType: any): ContentTypeWithFields {
  return {
    ...transformPrismaContentType(prismaContentType),
    fields: parseFieldsFromJson(prismaContentType.fields),
  };
}

/**
 * Generate a unique ID for fields
 */
export function generateId(): string {
  return `field_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Validate field definition
 */
export function validateFieldDefinition(field: CreateFieldDefinition | FieldDefinition): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check required properties
  if (!field.name || field.name.trim().length === 0) {
    errors.push('Field name is required');
  }

  if (!field.displayName || field.displayName.trim().length === 0) {
    errors.push('Field display name is required');
  }

  if (!field.type || field.type.trim().length === 0) {
    errors.push('Field type is required');
  }

  // Validate field name format
  if (field.name && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.name)) {
    errors.push('Field name must start with a letter and contain only letters, numbers, and underscores');
  }

  // Validate validation rules
  if (field.validation) {
    const { min, max, minLength, maxLength } = field.validation;

    if (min !== undefined && max !== undefined && min > max) {
      errors.push('Minimum value cannot be greater than maximum value');
    }

    if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
      errors.push('Minimum length cannot be greater than maximum length');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate content type data
 */
export function validateContentTypeData(data: any): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Validate name
  if (!data.name || data.name.trim().length === 0) {
    errors.push('Content type name is required');
  } else if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(data.name)) {
    errors.push('Content type name must start with a letter and contain only letters, numbers, and underscores');
  }

  // Validate display name
  if (!data.displayName || data.displayName.trim().length === 0) {
    errors.push('Content type display name is required');
  }

  // Validate fields if provided
  if (data.fields && Array.isArray(data.fields)) {
    const fieldNames = new Set<string>();
    
    data.fields.forEach((field: any, index: number) => {
      const fieldValidation = validateFieldDefinition(field);
      if (!fieldValidation.isValid) {
        fieldValidation.errors.forEach(error => {
          errors.push(`Field ${index + 1}: ${error}`);
        });
      }

      // Check for duplicate field names
      if (field.name) {
        if (fieldNames.has(field.name)) {
          errors.push(`Duplicate field name: ${field.name}`);
        }
        fieldNames.add(field.name);
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Merge field arrays for updates
 */
export function mergeFields(
  existingFields: FieldDefinition[],
  newFields: (CreateFieldDefinition | UpdateFieldDefinition)[]
): FieldDefinition[] {
  const fieldMap = new Map(existingFields.map(field => [field.id, field]));

  newFields.forEach(field => {
    if ('id' in field) {
      // Update existing field
      const existingField = fieldMap.get(field.id);
      if (existingField) {
        fieldMap.set(field.id, {
          ...existingField,
          ...field,
          updatedAt: new Date(),
        });
      }
    } else {
      // Add new field
      const newField: FieldDefinition = {
        ...field,
        id: generateId(),
        required: field.required || false,
        contentTypeId: '', // Will be set by the service
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      fieldMap.set(newField.id, newField);
    }
  });

  return Array.from(fieldMap.values());
}

/**
 * Check if value is a valid date
 */
export function isValidDate(value: any): boolean {
  const date = new Date(value);
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Check if value is a valid email
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Check if value is a valid URL
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate field value against field definition
 */
export function validateFieldValue(field: FieldDefinition, value: any): string[] {
  const errors: string[] = [];
  const validation = field.validation || {};

  // Check required
  if (validation.required && (value === undefined || value === null || value === '')) {
    errors.push(`Field '${field.displayName}' is required`);
    return errors;
  }

  // Skip further validation if value is empty and not required
  if (value === undefined || value === null || value === '') {
    return errors;
  }

  // Type-specific validation
  switch (field.type.toLowerCase()) {
    case 'string':
    case 'text':
      if (typeof value !== 'string') {
        errors.push(`Field '${field.displayName}' must be a string`);
      } else {
        if (validation.minLength && value.length < validation.minLength) {
          errors.push(`Field '${field.displayName}' must be at least ${validation.minLength} characters`);
        }
        if (validation.maxLength && value.length > validation.maxLength) {
          errors.push(`Field '${field.displayName}' must be at most ${validation.maxLength} characters`);
        }
        if (validation.pattern && !new RegExp(validation.pattern).test(value)) {
          errors.push(`Field '${field.displayName}' format is invalid`);
        }
      }
      break;

    case 'number':
    case 'integer':
    case 'float':
      if (typeof value !== 'number') {
        errors.push(`Field '${field.displayName}' must be a number`);
      } else {
        if (validation.min !== undefined && value < validation.min) {
          errors.push(`Field '${field.displayName}' must be at least ${validation.min}`);
        }
        if (validation.max !== undefined && value > validation.max) {
          errors.push(`Field '${field.displayName}' must be at most ${validation.max}`);
        }
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`Field '${field.displayName}' must be a boolean`);
      }
      break;

    case 'date':
    case 'datetime':
      if (!isValidDate(value)) {
        errors.push(`Field '${field.displayName}' must be a valid date`);
      }
      break;

    case 'email':
      if (typeof value === 'string' && !isValidEmail(value)) {
        errors.push(`Field '${field.displayName}' must be a valid email`);
      }
      break;

    case 'url':
      if (typeof value === 'string' && !isValidUrl(value)) {
        errors.push(`Field '${field.displayName}' must be a valid URL`);
      }
      break;

    case 'enum':
      if (validation.enum && !validation.enum.includes(value)) {
        errors.push(`Field '${field.displayName}' must be one of: ${validation.enum.join(', ')}`);
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        errors.push(`Field '${field.displayName}' must be an array`);
      }
      break;
  }

  return errors;
}
