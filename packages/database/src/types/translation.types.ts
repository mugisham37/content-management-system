// =============================================================================
// TRANSLATION TYPES
// =============================================================================

export interface Translation {
  id: string
  locale: string
  namespace: string
  key: string
  value: string
  tenantId: string | null // Match database schema
  description?: string | null
  isPlural?: boolean | null
  pluralForms?: Record<string, string> | null
  variables?: string[] | null
  metadata?: Record<string, any> | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateTranslationInput {
  locale: string
  namespace?: string
  key: string
  value: string
  tenantId?: string | null
  description?: string
  isPlural?: boolean
  pluralForms?: Record<string, string>
  variables?: string[]
  metadata?: Record<string, any>
}

export interface UpdateTranslationInput {
  locale?: string
  namespace?: string
  key?: string
  value?: string
  tenantId?: string | null
  description?: string
  isPlural?: boolean
  pluralForms?: Record<string, string>
  variables?: string[]
  metadata?: Record<string, any>
}

export interface TranslationStats {
  totalTranslations: number // Match service expectations
  translationsByLocale: Record<string, number>
  translationsByNamespace: Record<string, number>
  completionRate: Record<string, number>
  locales: number
  namespaces: number
  averageKeyLength: number
  missingTranslations?: Array<{
    key: string
    namespace: string
    missingLocales: string[]
  }>
  recentActivity?: Array<{
    action: string
    key: string
    locale: string
    timestamp: Date
    user?: string
  }>
}

export interface TranslationMemoryEntry {
  sourceText: string
  targetText: string
  sourceLocale: string
  targetLocale: string
  similarity: number
  context?: string
  metadata?: Record<string, any>
}

export interface TranslationFilters {
  locale?: string
  namespace?: string
  key?: string
  tenantId?: string | null
  search?: string
  keyPattern?: string
}

export interface TranslationImportOptions {
  format: "json" | "csv" | "xliff" | "po" | "yaml"
  locale: string
  namespace?: string
  overwrite?: boolean
  validate?: boolean
  tenantId?: string | null
  importedBy?: string
}

export interface TranslationExportOptions {
  format: "json" | "csv" | "xliff" | "po" | "yaml"
  locales?: string[]
  namespaces?: string[]
  includeMetadata?: boolean
  tenantId?: string | null
}

export interface PluralRule {
  locale: string
  rule: (count: number) => string
  forms: string[]
}

export interface InterpolationContext {
  variables: Record<string, any>
  locale: string
  namespace: string
  escapeHtml?: boolean
  dateFormat?: string
  numberFormat?: Intl.NumberFormatOptions
}

export interface FuzzyMatchResult {
  key: string
  value: string
  similarity: number
  namespace: string
}

export interface FileChangeInfo<T = string> {
  eventType: 'change' | 'rename' | 'delete'
  filename: T
  stats?: any
}

// Repository specific types
export interface TranslationRepositoryStats {
  total: number
  byLocale: Record<string, number>
  byNamespace: Record<string, number>
  locales: number
  namespaces: number
}
