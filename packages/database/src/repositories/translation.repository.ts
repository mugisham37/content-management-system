// =============================================================================
// TRANSLATION REPOSITORY - POSTGRESQL
// =============================================================================
// High-level abstraction for translation operations with comprehensive functionality

import { PrismaClient, Translation, Prisma } from '@prisma/client'
import { BaseRepository } from './base.repository'
import {
  CreateTranslationInput,
  UpdateTranslationInput,
  TranslationFilters,
  TranslationStats,
  TranslationMemoryEntry,
  TranslationRepositoryStats
} from '../types/translation.types'

export class TranslationRepository extends BaseRepository<Translation, CreateTranslationInput, UpdateTranslationInput> {
  protected modelName = 'Translation'
  protected model = this.prisma.translation

  constructor(prisma: PrismaClient) {
    super(prisma)
  }

  /**
   * Find translation by locale, namespace, and key
   */
  async findByKey(key: string, locale: string, namespace: string, tenantId?: string | null): Promise<Translation | null> {
    const where: any = { locale, namespace, key }
    if (tenantId !== undefined) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findFirst({ where })
    } catch (error) {
      this.handleError(error, 'findByKey')
    }
  }

  /**
   * Find translation by key or throw error
   */
  async findByKeyOrThrow(key: string, locale: string, namespace: string, tenantId?: string | null): Promise<Translation> {
    const translation = await this.findByKey(key, locale, namespace, tenantId)
    if (!translation) {
      throw new this.constructor.prototype.NotFoundError('Translation', `${locale}.${namespace}.${key}`)
    }
    return translation
  }

  /**
   * Find all translations with optional filters
   */
  async findAll(tenantId?: string | null, filters?: {
    locale?: string
    namespace?: string
    limit?: number
    offset?: number
  }): Promise<Translation[]> {
    const where: any = {}
    if (tenantId !== undefined) {
      where.tenantId = tenantId
    }
    if (filters?.locale) {
      where.locale = filters.locale
    }
    if (filters?.namespace) {
      where.namespace = filters.namespace
    }

    try {
      return await this.model.findMany({
        where,
        take: filters?.limit,
        skip: filters?.offset,
        orderBy: [{ locale: 'asc' }, { namespace: 'asc' }, { key: 'asc' }],
      })
    } catch (error) {
      this.handleError(error, 'findAll')
    }
  }

  /**
   * Find translations by locale
   */
  async findByLocale(locale: string, tenantId?: string | null): Promise<Translation[]> {
    const where: any = { locale }
    if (tenantId !== undefined) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: [{ namespace: 'asc' }, { key: 'asc' }],
      })
    } catch (error) {
      this.handleError(error, 'findByLocale')
    }
  }

  /**
   * Find translations by namespace
   */
  async findByNamespace(namespace: string, tenantId?: string | null): Promise<Translation[]> {
    const where: any = { namespace }
    if (tenantId !== undefined) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: [{ locale: 'asc' }, { key: 'asc' }],
      })
    } catch (error) {
      this.handleError(error, 'findByNamespace')
    }
  }

  /**
   * Find translations by locale and namespace
   */
  async findByLocaleAndNamespace(locale: string, namespace: string, tenantId?: string | null): Promise<Translation[]> {
    const where: any = { locale, namespace }
    if (tenantId !== undefined) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: { key: 'asc' },
      })
    } catch (error) {
      this.handleError(error, 'findByLocaleAndNamespace')
    }
  }

  /**
   * Find translations by tenant
   */
  async findByTenant(tenantId: string): Promise<Translation[]> {
    try {
      return await this.model.findMany({
        where: { tenantId },
        orderBy: [{ locale: 'asc' }, { namespace: 'asc' }, { key: 'asc' }],
      })
    } catch (error) {
      this.handleError(error, 'findByTenant')
    }
  }

  /**
   * Create a new translation
   */
  async create(data: CreateTranslationInput): Promise<Translation> {
    try {
      return await this.model.create({
        data: {
          locale: data.locale,
          namespace: data.namespace || 'common',
          key: data.key,
          value: data.value,
          tenantId: data.tenantId || null,
          // Only include fields that exist in the Prisma schema
          ...(data.description && { description: data.description }),
          ...(data.isPlural !== undefined && { isPlural: data.isPlural }),
          ...(data.pluralForms && { pluralForms: data.pluralForms }),
          ...(data.variables && { variables: data.variables }),
          ...(data.metadata && { metadata: data.metadata }),
        },
      })
    } catch (error) {
      this.handleError(error, 'create')
    }
  }

  /**
   * Update a translation
   */
  async updateTranslation(id: string, data: UpdateTranslationInput, tenantId?: string | null): Promise<Translation> {
    try {
      const updateData: any = {}
      
      if (data.locale !== undefined) updateData.locale = data.locale
      if (data.namespace !== undefined) updateData.namespace = data.namespace
      if (data.key !== undefined) updateData.key = data.key
      if (data.value !== undefined) updateData.value = data.value
      if (data.tenantId !== undefined) updateData.tenantId = data.tenantId
      if (data.description !== undefined) updateData.description = data.description
      if (data.isPlural !== undefined) updateData.isPlural = data.isPlural
      if (data.pluralForms !== undefined) updateData.pluralForms = data.pluralForms
      if (data.variables !== undefined) updateData.variables = data.variables
      if (data.metadata !== undefined) updateData.metadata = data.metadata

      return await this.model.update({
        where: { id },
        data: updateData,
      })
    } catch (error) {
      this.handleError(error, 'updateTranslation')
    }
  }

  /**
   * Delete a translation
   */
  async deleteTranslation(id: string, tenantId?: string | null): Promise<Translation> {
    try {
      return await this.model.delete({
        where: { id },
      })
    } catch (error) {
      this.handleError(error, 'deleteTranslation')
    }
  }

  /**
   * Find by ID
   */
  async findById(id: string): Promise<Translation | null> {
    try {
      return await this.model.findUnique({
        where: { id },
      })
    } catch (error) {
      this.handleError(error, 'findById')
    }
  }

  /**
   * Get all available locales
   */
  async getAvailableLocales(tenantId?: string | null): Promise<string[]> {
    const where: any = {}
    if (tenantId !== undefined) {
      where.tenantId = tenantId
    }

    try {
      const result = await this.model.findMany({
        where,
        select: { locale: true },
        distinct: ['locale'],
        orderBy: { locale: 'asc' },
      })

      return result.map(r => r.locale)
    } catch (error) {
      this.handleError(error, 'getAvailableLocales')
    }
  }

  /**
   * Get all available namespaces
   */
  async getAvailableNamespaces(locale?: string, tenantId?: string | null): Promise<string[]> {
    const where: any = {}
    if (locale) {
      where.locale = locale
    }
    if (tenantId !== undefined) {
      where.tenantId = tenantId
    }

    try {
      const result = await this.model.findMany({
        where,
        select: { namespace: true },
        distinct: ['namespace'],
        orderBy: { namespace: 'asc' },
      })

      return result.map(r => r.namespace)
    } catch (error) {
      this.handleError(error, 'getAvailableNamespaces')
    }
  }

  /**
   * Get translation keys for a namespace
   */
  async getKeysForNamespace(namespace: string, locale?: string, tenantId?: string | null): Promise<string[]> {
    const where: any = { namespace }
    if (locale) {
      where.locale = locale
    }
    if (tenantId !== undefined) {
      where.tenantId = tenantId
    }

    try {
      const result = await this.model.findMany({
        where,
        select: { key: true },
        distinct: ['key'],
        orderBy: { key: 'asc' },
      })

      return result.map(r => r.key)
    } catch (error) {
      this.handleError(error, 'getKeysForNamespace')
    }
  }

  /**
   * Search translations
   */
  async search(filters: TranslationFilters = {}): Promise<Translation[]> {
    const {
      locale,
      namespace,
      key,
      tenantId,
      search,
      keyPattern,
    } = filters

    const where: any = {}

    if (locale) {
      where.locale = locale
    }

    if (namespace) {
      where.namespace = namespace
    }

    if (key) {
      where.key = { contains: key, mode: 'insensitive' }
    }

    if (tenantId !== undefined) {
      where.tenantId = tenantId
    }

    if (search) {
      where.OR = [
        { key: { contains: search, mode: 'insensitive' } },
        { value: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (keyPattern) {
      where.key = { contains: keyPattern, mode: 'insensitive' }
    }

    try {
      return await this.model.findMany({
        where,
        orderBy: [{ locale: 'asc' }, { namespace: 'asc' }, { key: 'asc' }],
      })
    } catch (error) {
      this.handleError(error, 'search')
    }
  }

  /**
   * Get translations as nested object
   */
  async getTranslationsAsObject(locale: string, namespace?: string, tenantId?: string | null): Promise<Record<string, any>> {
    const where: any = { locale }
    if (namespace) {
      where.namespace = namespace
    }
    if (tenantId !== undefined) {
      where.tenantId = tenantId
    }

    try {
      const translations = await this.model.findMany({ where })
      
      const result: Record<string, any> = {}
      
      translations.forEach(translation => {
        const keys = translation.key.split('.')
        let current = result
        
        // Navigate/create nested structure
        for (let i = 0; i < keys.length - 1; i++) {
          const key = keys[i]
          if (!current[key]) {
            current[key] = {}
          }
          current = current[key]
        }
        
        // Set the final value
        current[keys[keys.length - 1]] = translation.value
      })

      return result
    } catch (error) {
      this.handleError(error, 'getTranslationsAsObject')
    }
  }

  /**
   * Bulk create or update translations
   */
  async bulkUpsert(translations: CreateTranslationInput[]): Promise<Translation[]> {
    try {
      const results: Translation[] = []

      for (const translation of translations) {
        const existing = await this.findByKey(
          translation.key,
          translation.locale,
          translation.namespace || 'common',
          translation.tenantId
        )

        if (existing) {
          const updated = await this.updateTranslation(existing.id, { value: translation.value })
          results.push(updated)
        } else {
          const created = await this.create(translation)
          results.push(created)
        }
      }

      return results
    } catch (error) {
      this.handleError(error, 'bulkUpsert')
    }
  }

  /**
   * Import translations from object
   */
  async importFromObject(
    locale: string,
    namespace: string,
    translations: Record<string, any>,
    tenantId?: string | null
  ): Promise<Translation[]> {
    const flatTranslations = this.flattenObject(translations)
    
    const translationInputs: CreateTranslationInput[] = Object.entries(flatTranslations).map(([key, value]) => ({
      locale,
      namespace,
      key,
      value: String(value),
      tenantId,
    }))

    return this.bulkUpsert(translationInputs)
  }

  /**
   * Export translations to object
   */
  async exportToObject(locale: string, namespace?: string, tenantId?: string | null): Promise<Record<string, any>> {
    return this.getTranslationsAsObject(locale, namespace, tenantId)
  }

  /**
   * Delete translations by namespace
   */
  async deleteByNamespace(namespace: string, locale?: string, tenantId?: string | null): Promise<{ count: number }> {
    const where: any = { namespace }
    if (locale) {
      where.locale = locale
    }
    if (tenantId !== undefined) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.deleteMany({ where })
    } catch (error) {
      this.handleError(error, 'deleteByNamespace')
    }
  }

  /**
   * Delete translations by locale
   */
  async deleteByLocale(locale: string, tenantId?: string | null): Promise<{ count: number }> {
    const where: any = { locale }
    if (tenantId !== undefined) {
      where.tenantId = tenantId
    }

    try {
      return await this.model.deleteMany({ where })
    } catch (error) {
      this.handleError(error, 'deleteByLocale')
    }
  }

  /**
   * Get translation statistics
   */
  async getStats(tenantId?: string | null): Promise<TranslationStats> {
    const where: any = {}
    if (tenantId !== undefined) {
      where.tenantId = tenantId
    }

    try {
      const [total, locales, namespaces, allTranslations] = await Promise.all([
        this.model.count({ where }),
        this.model.findMany({
          where,
          select: { locale: true },
          distinct: ['locale'],
        }),
        this.model.findMany({
          where,
          select: { namespace: true },
          distinct: ['namespace'],
        }),
        this.model.findMany({
          where,
          select: { locale: true, namespace: true, key: true, value: true },
        }),
      ])

      // Count by locale
      const byLocale: Record<string, number> = {}
      allTranslations.forEach(translation => {
        byLocale[translation.locale] = (byLocale[translation.locale] || 0) + 1
      })

      // Count by namespace
      const byNamespace: Record<string, number> = {}
      allTranslations.forEach(translation => {
        byNamespace[translation.namespace] = (byNamespace[translation.namespace] || 0) + 1
      })

      // Calculate completion rate per locale
      const completionRate: Record<string, number> = {}
      const totalKeys = new Set(allTranslations.map(t => `${t.namespace}.${t.key}`)).size
      
      locales.forEach(({ locale }) => {
        const localeTranslations = allTranslations.filter(t => t.locale === locale)
        completionRate[locale] = totalKeys > 0 ? (localeTranslations.length / totalKeys) * 100 : 100
      })

      // Calculate average key length
      const averageKeyLength = allTranslations.length > 0 
        ? allTranslations.reduce((sum, t) => sum + t.key.length, 0) / allTranslations.length 
        : 0

      return {
        totalTranslations: total,
        translationsByLocale: byLocale,
        translationsByNamespace: byNamespace,
        completionRate,
        locales: locales.length,
        namespaces: namespaces.length,
        averageKeyLength,
      }
    } catch (error) {
      this.handleError(error, 'getStats')
    }
  }

  /**
   * Find missing translations (keys that exist in one locale but not another)
   */
  async findMissingTranslations(
    sourceLocale: string,
    targetLocale: string,
    namespace?: string,
    tenantId?: string | null
  ): Promise<{ key: string; namespace: string; sourceValue: string }[]> {
    const sourceWhere: any = { locale: sourceLocale }
    const targetWhere: any = { locale: targetLocale }
    
    if (namespace) {
      sourceWhere.namespace = namespace
      targetWhere.namespace = namespace
    }
    if (tenantId !== undefined) {
      sourceWhere.tenantId = tenantId
      targetWhere.tenantId = tenantId
    }

    try {
      const [sourceTranslations, targetTranslations] = await Promise.all([
        this.model.findMany({
          where: sourceWhere,
          select: { key: true, namespace: true, value: true },
        }),
        this.model.findMany({
          where: targetWhere,
          select: { key: true, namespace: true },
        }),
      ])

      const targetKeys = new Set(
        targetTranslations.map(t => `${t.namespace}.${t.key}`)
      )

      return sourceTranslations
        .filter(source => !targetKeys.has(`${source.namespace}.${source.key}`))
        .map(source => ({
          key: source.key,
          namespace: source.namespace,
          sourceValue: source.value,
        }))
    } catch (error) {
      this.handleError(error, 'findMissingTranslations')
    }
  }

  /**
   * Copy translations from one locale to another
   */
  async copyLocale(
    sourceLocale: string,
    targetLocale: string,
    namespace?: string,
    tenantId?: string | null,
    overwrite = false
  ): Promise<Translation[]> {
    const sourceWhere: any = { locale: sourceLocale }
    if (namespace) {
      sourceWhere.namespace = namespace
    }
    if (tenantId !== undefined) {
      sourceWhere.tenantId = tenantId
    }

    try {
      const sourceTranslations = await this.model.findMany({ where: sourceWhere })
      const results: Translation[] = []

      for (const source of sourceTranslations) {
        const existing = await this.findByKey(
          source.key,
          targetLocale,
          source.namespace,
          tenantId
        )

        if (!existing || overwrite) {
          const translationData: CreateTranslationInput = {
            locale: targetLocale,
            namespace: source.namespace,
            key: source.key,
            value: source.value,
            tenantId: source.tenantId,
          }

          if (existing && overwrite) {
            const updated = await this.updateTranslation(existing.id, { value: source.value })
            results.push(updated)
          } else if (!existing) {
            const created = await this.create(translationData)
            results.push(created)
          }
        }
      }

      return results
    } catch (error) {
      this.handleError(error, 'copyLocale')
    }
  }

  /**
   * Get translation memory entries (placeholder - implement when TranslationMemory table is added)
   */
  async getTranslationMemory(): Promise<TranslationMemoryEntry[]> {
    // Return empty array for now - implement when TranslationMemory table is added to schema
    return []
  }

  /**
   * Add entry to translation memory (placeholder - implement when TranslationMemory table is added)
   */
  async addToTranslationMemory(entry: TranslationMemoryEntry): Promise<void> {
    // Placeholder - implement when TranslationMemory table is added to schema
    return Promise.resolve()
  }

  /**
   * Flatten nested object to dot notation keys
   */
  private flattenObject(obj: Record<string, any>, prefix = ''): Record<string, string> {
    const flattened: Record<string, string> = {}

    Object.keys(obj).forEach(key => {
      const value = obj[key]
      const newKey = prefix ? `${prefix}.${key}` : key

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        Object.assign(flattened, this.flattenObject(value, newKey))
      } else {
        flattened[newKey] = String(value)
      }
    })

    return flattened
  }
}
