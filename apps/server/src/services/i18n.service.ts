import { TranslationRepository } from "@cms-platform/database/repositories/translation.repository"
import { ApiError } from "../utils/errors"
import { logger } from "../utils/logger"
import { cacheService } from "./cache.service"
import { auditService } from "./audit.service"
import fs from "fs/promises"
import path from "path"
import { EventEmitter } from "events"
import yaml from "js-yaml"

export interface I18nServiceOptions {
  defaultLocale?: string
  fallbackLocale?: string
  enableCache?: boolean
  cacheTtl?: number
  enableAudit?: boolean
  enableHotReload?: boolean
  localesDir?: string
  enablePluralization?: boolean
  enableInterpolation?: boolean
  autoTranslateProvider?: "google" | "deepl" | "azure" | "aws"
  autoTranslateApiKey?: string
  maxCacheSize?: number
  enableFuzzyMatching?: boolean
  enableTranslationMemory?: boolean
}

export interface Translation {
  id: string
  key: string
  value: string
  locale: string
  namespace: string
  description?: string
  isPlural?: boolean
  pluralForms?: Record<string, string>
  variables?: string[]
  metadata?: Record<string, any>
  tenantId?: string
  createdAt: Date
  updatedAt: Date
  createdBy?: string
  updatedBy?: string
}

export interface TranslationImportOptions {
  format: "json" | "csv" | "xliff" | "po" | "yaml"
  locale: string
  namespace?: string
  overwrite?: boolean
  validate?: boolean
  tenantId?: string
  importedBy?: string
}

export interface TranslationExportOptions {
  format: "json" | "csv" | "xliff" | "po" | "yaml"
  locales?: string[]
  namespaces?: string[]
  includeMetadata?: boolean
  tenantId?: string
}

export interface TranslationStats {
  totalTranslations: number
  translationsByLocale: Record<string, number>
  translationsByNamespace: Record<string, number>
  completionRate: Record<string, number>
  missingTranslations: Array<{
    key: string
    namespace: string
    missingLocales: string[]
  }>
  recentActivity: Array<{
    action: string
    key: string
    locale: string
    timestamp: Date
    user?: string
  }>
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

export interface TranslationMemoryEntry {
  sourceText: string
  targetText: string
  sourceLocale: string
  targetLocale: string
  similarity: number
  context?: string
  metadata?: Record<string, any>
}

export interface FuzzyMatchResult {
  key: string
  value: string
  similarity: number
  namespace: string
}

export class I18nService extends EventEmitter {
  private translationRepo: TranslationRepository
  private options: I18nServiceOptions
  private translationCache: Map<string, Map<string, string>> = new Map()
  private pluralRules: Map<string, PluralRule> = new Map()
  private watchers: Map<string, fs.FSWatcher> = new Map()
  private loadedNamespaces: Set<string> = new Set()
  private translationMemory: Map<string, TranslationMemoryEntry[]> = new Map()

  constructor(options: I18nServiceOptions = {}) {
    super()
    this.translationRepo = new TranslationRepository()
    this.options = {
      defaultLocale: "en",
      fallbackLocale: "en",
      enableCache: true,
      cacheTtl: 3600, // 1 hour
      enableAudit: true,
      enableHotReload: true,
      localesDir: path.join(process.cwd(), "locales"),
      enablePluralization: true,
      enableInterpolation: true,
      maxCacheSize: 10000,
      enableFuzzyMatching: false,
      enableTranslationMemory: false,
      ...options,
    }

    this.initializePluralRules()
    this.setMaxListeners(100)

    if (this.options.enableHotReload) {
      this.setupFileWatchers()
    }

    if (this.options.enableTranslationMemory) {
      this.initializeTranslationMemory()
    }

    logger.info("I18n service initialized", this.options)
  }

  /**
   * Initialize plural rules for different locales
   */
  private initializePluralRules(): void {
    // English plural rules
    this.pluralRules.set("en", {
      locale: "en",
      rule: (count: number) => (count === 1 ? "one" : "other"),
      forms: ["one", "other"],
    })

    // Spanish plural rules
    this.pluralRules.set("es", {
      locale: "es",
      rule: (count: number) => (count === 1 ? "one" : "other"),
      forms: ["one", "other"],
    })

    // French plural rules
    this.pluralRules.set("fr", {
      locale: "fr",
      rule: (count: number) => (count <= 1 ? "one" : "other"),
      forms: ["one", "other"],
    })

    // German plural rules
    this.pluralRules.set("de", {
      locale: "de",
      rule: (count: number) => (count === 1 ? "one" : "other"),
      forms: ["one", "other"],
    })

    // Russian plural rules (more complex)
    this.pluralRules.set("ru", {
      locale: "ru",
      rule: (count: number) => {
        if (count % 10 === 1 && count % 100 !== 11) return "one"
        if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) return "few"
        return "many"
      },
      forms: ["one", "few", "many"],
    })

    // Arabic plural rules (very complex)
    this.pluralRules.set("ar", {
      locale: "ar",
      rule: (count: number) => {
        if (count === 0) return "zero"
        if (count === 1) return "one"
        if (count === 2) return "two"
        if (count % 100 >= 3 && count % 100 <= 10) return "few"
        if (count % 100 >= 11) return "many"
        return "other"
      },
      forms: ["zero", "one", "two", "few", "many", "other"],
    })

    // Polish plural rules
    this.pluralRules.set("pl", {
      locale: "pl",
      rule: (count: number) => {
        if (count === 1) return "one"
        if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) return "few"
        return "many"
      },
      forms: ["one", "few", "many"],
    })

    // Japanese (no plurals)
    this.pluralRules.set("ja", {
      locale: "ja",
      rule: () => "other",
      forms: ["other"],
    })

    // Chinese (no plurals)
    this.pluralRules.set("zh", {
      locale: "zh",
      rule: () => "other",
      forms: ["other"],
    })
  }

  /**
   * Initialize translation memory
   */
  private async initializeTranslationMemory(): Promise<void> {
    try {
      // Load existing translation memory from database or file
      const memoryEntries = await this.translationRepo.getTranslationMemory()
      for (const entry of memoryEntries) {
        const key = `${entry.sourceLocale}-${entry.targetLocale}`
        if (!this.translationMemory.has(key)) {
          this.translationMemory.set(key, [])
        }
        this.translationMemory.get(key)!.push(entry)
      }
      logger.info("Translation memory initialized", { entries: memoryEntries.length })
    } catch (error) {
      logger.error("Failed to initialize translation memory:", error)
    }
  }

  /**
   * Setup file watchers for hot reload
   */
  private async setupFileWatchers(): Promise<void> {
    try {
      await fs.mkdir(this.options.localesDir!, { recursive: true })

      const watcherPromise = new Promise<void>((resolve, reject) => {
        const watcher = fs.watch(this.options.localesDir!, { recursive: true })

        watcher.on("change", async (eventType, filename) => {
          if (eventType === "change" && filename?.endsWith(".json")) {
            await this.reloadTranslationsFromFile(filename)
          }
        })

        watcher.on("error", reject)
        resolve()
      })

      await watcherPromise
    } catch (error) {
      logger.error("Failed to setup file watchers:", error)
    }
  }

  /**
   * Reload translations from file
   */
  private async reloadTranslationsFromFile(filename: string): Promise<void> {
    try {
      const filePath = path.join(this.options.localesDir!, filename)
      const [locale, namespace] = path.basename(filename, ".json").split(".")

      const content = await fs.readFile(filePath, "utf-8")
      const translations = JSON.parse(content)

      await this.importTranslations(translations, {
        format: "json",
        locale,
        namespace: namespace || "common",
        overwrite: true,
      })

      this.emit("translations:reloaded", { locale, namespace, filename })
      logger.info("Translations reloaded from file", { filename, locale, namespace })
    } catch (error) {
      logger.error("Failed to reload translations from file:", error)
    }
  }

  /**
   * Get cache key for translations
   */
  private getCacheKey(locale: string, namespace: string, tenantId?: string): string {
    return tenantId ? `i18n:${tenantId}:${locale}:${namespace}` : `i18n:${locale}:${namespace}`
  }

  /**
   * Load translations for locale and namespace
   */
  private async loadTranslations(locale: string, namespace: string, tenantId?: string): Promise<Map<string, string>> {
    const cacheKey = this.getCacheKey(locale, namespace, tenantId)

    // Try cache first
    if (this.options.enableCache) {
      const cached = this.translationCache.get(cacheKey)
      if (cached) {
        return cached
      }

      // Try external cache
      const externalCached = await cacheService.get<Record<string, string>>(cacheKey)
      if (externalCached) {
        const translationMap = new Map(Object.entries(externalCached))
        this.translationCache.set(cacheKey, translationMap)
        return translationMap
      }
    }

    // Load from database
    const translations = await this.translationRepo.findByLocaleAndNamespace(locale, namespace, tenantId)
    const translationMap = new Map<string, string>()

    for (const translation of translations) {
      translationMap.set(translation.key, translation.value)
    }

    // Cache the result
    if (this.options.enableCache) {
      // Check cache size limit
      if (this.translationCache.size >= this.options.maxCacheSize!) {
        // Remove oldest entries (simple LRU)
        const firstKey = this.translationCache.keys().next().value
        this.translationCache.delete(firstKey)
      }

      this.translationCache.set(cacheKey, translationMap)
      await cacheService.set(cacheKey, Object.fromEntries(translationMap), {
        ttl: this.options.cacheTtl,
        namespace: tenantId,
      })
    }

    this.loadedNamespaces.add(`${locale}:${namespace}`)
    return translationMap
  }

  /**
   * Clear translation cache
   */
  private async clearTranslationCache(locale?: string, namespace?: string, tenantId?: string): Promise<void> {
    if (locale && namespace) {
      const cacheKey = this.getCacheKey(locale, namespace, tenantId)
      this.translationCache.delete(cacheKey)
      await cacheService.delete(cacheKey, tenantId)
    } else {
      // Clear all cache
      this.translationCache.clear()
      await cacheService.deletePattern("i18n:*", tenantId)
    }
  }

  /**
   * Apply pluralization to translation
   */
  private applyPluralization(
    translation: string,
    count: number,
    locale: string,
    pluralForms?: Record<string, string>,
  ): string {
    if (!this.options.enablePluralization || !pluralForms) {
      return translation
    }

    const pluralRule = this.pluralRules.get(locale)
    if (!pluralRule) {
      return translation
    }

    const form = pluralRule.rule(count)
    return pluralForms[form] || translation
  }

  /**
   * Apply interpolation to translation
   */
  private applyInterpolation(translation: string, context: InterpolationContext): string {
    if (!this.options.enableInterpolation || !context.variables) {
      return translation
    }

    let result = translation

    // Replace variables
    for (const [key, value] of Object.entries(context.variables)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g")
      let processedValue = String(value)

      // Format dates
      if (value instanceof Date && context.dateFormat) {
        processedValue = value.toLocaleDateString(context.locale, {
          ...(context.dateFormat === "short" && { dateStyle: "short" }),
          ...(context.dateFormat === "medium" && { dateStyle: "medium" }),
          ...(context.dateFormat === "long" && { dateStyle: "long" }),
          ...(context.dateFormat === "full" && { dateStyle: "full" }),
        })
      }

      // Format numbers
      if (typeof value === "number" && context.numberFormat) {
        processedValue = value.toLocaleString(context.locale, context.numberFormat)
      }

      // Escape HTML if needed
      if (context.escapeHtml) {
        processedValue = processedValue
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;")
      }

      result = result.replace(regex, processedValue)
    }

    return result
  }

  /**
   * Calculate string similarity for fuzzy matching
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2
    const shorter = str1.length > str2.length ? str2 : str1

    if (longer.length === 0) {
      return 1.0
    }

    const editDistance = this.levenshteinDistance(longer, shorter)
    return (longer.length - editDistance) / longer.length
  }

  /**
   * Calculate Levenshtein distance
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = []

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i]
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1]
        } else {
          matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        }
      }
    }

    return matrix[str2.length][str1.length]
  }

  /**
   * Find fuzzy matches for a translation key
   */
  private async findFuzzyMatches(
    key: string,
    locale: string,
    namespace: string,
    tenantId?: string,
    threshold = 0.7,
  ): Promise<FuzzyMatchResult[]> {
    if (!this.options.enableFuzzyMatching) {
      return []
    }

    try {
      const translations = await this.translationRepo.findByLocaleAndNamespace(locale, namespace, tenantId)
      const matches: FuzzyMatchResult[] = []

      for (const translation of translations) {
        const similarity = this.calculateSimilarity(key, translation.key)
        if (similarity >= threshold) {
          matches.push({
            key: translation.key,
            value: translation.value,
            similarity,
            namespace,
          })
        }
      }

      return matches.sort((a, b) => b.similarity - a.similarity)
    } catch (error) {
      logger.error("Failed to find fuzzy matches:", error)
      return []
    }
  }

  /**
   * Extract variables from translation string
   */
  private extractVariables(translation: string): string[] {
    const variableRegex = /{{\\s*([^}]+)\\s*}}/g
    const variables: string[] = []
    let match

    while ((match = variableRegex.exec(translation)) !== null) {
      const variable = match[1].trim()
      if (!variables.includes(variable)) {
        variables.push(variable)
      }
    }

    return variables
  }

  /**
   * Validate translations object
   */
  private validateTranslations(translations: Record<string, any>): string[] {
    const errors: string[] = []

    for (const [key, value] of Object.entries(translations)) {
      // Check key format
      if (!key || typeof key !== "string") {
        errors.push(`Invalid key: ${key}`)
        continue
      }

      // Check for reserved characters in key
      if (key.includes("..") || key.startsWith(".") || key.endsWith(".")) {
        errors.push(`Invalid key format: ${key}`)
      }

      // Check value
      if (value === null || value === undefined) {
        errors.push(`Empty value for key: ${key}`)
        continue
      }

      // If value is object, validate plural forms
      if (typeof value === "object" && !Array.isArray(value)) {
        if (value._pluralForms) {
          const pluralForms = value._pluralForms
          if (typeof pluralForms !== "object") {
            errors.push(`Invalid plural forms for key: ${key}`)
          }
        }
      }

      // Check for unmatched interpolation brackets
      const stringValue = typeof value === "string" ? value : value._value || JSON.stringify(value)
      const openBrackets = (stringValue.match(/{{/g) || []).length
      const closeBrackets = (stringValue.match(/}}/g) || []).length
      if (openBrackets !== closeBrackets) {
        errors.push(`Unmatched interpolation brackets in key: ${key}`)
      }
    }

    return errors
  }

  /**
   * Parse CSV format
   */
  private parseCSV(data: string): Record<string, string> {
    const translations: Record<string, string> = {}
    const lines = data.split("\n")

    // Skip header if present
    const startIndex = lines[0]?.includes("key") ? 1 : 0

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const [key, value] = line.split(",").map((cell) => cell.replace(/^"(.*)"$/, "$1").replace(/""/g, '"'))

      if (key && value) {
        translations[key] = value
      }
    }

    return translations
  }

  /**
   * Parse XLIFF format
   */
  private parseXLIFF(data: string): Record<string, string> {
    const translations: Record<string, string> = {}

    // Simple XLIFF parsing (would use proper XML parser in production)
    const transUnitRegex =
      /<trans-unit[^>]*id="([^"]*)"[^>]*>[\s\S]*?<source[^>]*>([\s\S]*?)<\/source>[\s\S]*?<target[^>]*>([\s\S]*?)<\/target>[\s\S]*?<\/trans-unit>/g

    let match
    while ((match = transUnitRegex.exec(data)) !== null) {
      const [, id, , target] = match
      if (id && target) {
        translations[id] = target.trim()
      }
    }

    return translations
  }

  /**
   * Parse PO format
   */
  private parsePO(data: string): Record<string, string> {
    const translations: Record<string, string> = {}
    const lines = data.split("\n")

    let currentMsgid = ""
    let currentMsgstr = ""
    let inMsgid = false
    let inMsgstr = false

    for (const line of lines) {
      const trimmedLine = line.trim()

      if (trimmedLine.startsWith("msgid ")) {
        if (currentMsgid && currentMsgstr) {
          translations[currentMsgid] = currentMsgstr
        }
        currentMsgid = trimmedLine.substring(6).replace(/^"(.*)"$/, "$1")
        currentMsgstr = ""
        inMsgid = true
        inMsgstr = false
      } else if (trimmedLine.startsWith("msgstr ")) {
        currentMsgstr = trimmedLine.substring(7).replace(/^"(.*)"$/, "$1")
        inMsgid = false
        inMsgstr = true
      } else if (trimmedLine.startsWith('"') && (inMsgid || inMsgstr)) {
        const content = trimmedLine.replace(/^"(.*)"$/, "$1")
        if (inMsgid) {
          currentMsgid += content
        } else if (inMsgstr) {
          currentMsgstr += content
        }
      }
    }

    // Add the last translation
    if (currentMsgid && currentMsgstr) {
      translations[currentMsgid] = currentMsgstr
    }

    return translations
  }

  /**
   * Parse YAML format
   */
  private parseYAML(data: string): Record<string, string> {
    try {
      const parsed = yaml.load(data) as Record<string, any>
      return this.flattenObject(parsed)
    } catch (error) {
      throw new Error(`Invalid YAML format: ${(error as Error).message}`)
    }
  }

  /**
   * Flatten nested object to dot notation
   */
  private flattenObject(obj: Record<string, any>, prefix = ""): Record<string, string> {
    const flattened: Record<string, string> = {}

    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}.${key}` : key

      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        Object.assign(flattened, this.flattenObject(value, newKey))
      } else {
        flattened[newKey] = String(value)
      }
    }

    return flattened
  }

  /**
   * Format translations as CSV
   */
  private formatAsCSV(data: Record<string, any>): string {
    const rows: string[] = ["key,value,locale,namespace"]

    for (const [locale, namespaces] of Object.entries(data)) {
      for (const [namespace, translations] of Object.entries(namespaces as Record<string, any>)) {
        for (const [key, value] of Object.entries(translations as Record<string, any>)) {
          const csvValue = typeof value === "string" ? value : JSON.stringify(value)
          const escapedValue = `"${csvValue.replace(/"/g, '""')}"`
          rows.push(`"${key}",${escapedValue},"${locale}","${namespace}"`)
        }
      }
    }

    return rows.join("\n")
  }

  /**
   * Format translations as XLIFF
   */
  private formatAsXLIFF(data: Record<string, any>): string {
    let xliff = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xliff += '<xliff version="1.2">\n'

    for (const [locale, namespaces] of Object.entries(data)) {
      for (const [namespace, translations] of Object.entries(namespaces as Record<string, any>)) {
        xliff += `  <file source-language="en" target-language="${locale}" datatype="plaintext">\n`
        xliff += "    <body>\n"

        for (const [key, value] of Object.entries(translations as Record<string, any>)) {
          const stringValue = typeof value === "string" ? value : JSON.stringify(value)
          xliff += `      <trans-unit id="${key}">\n`
          xliff += `        <source>${key}</source>\n`
          xliff += `        <target>${stringValue}</target>\n`
          xliff += "      </trans-unit>\n"
        }

        xliff += "    </body>\n"
        xliff += "  </file>\n"
      }
    }

    xliff += "</xliff>"
    return xliff
  }

  /**
   * Format translations as PO
   */
  private formatAsPO(data: Record<string, any>): string {
    let po = "# Translation file\n"
    po += 'msgid ""\n'
    po += 'msgstr ""\n'
    po += '"Content-Type: text/plain; charset=UTF-8\\n"\n\n'

    for (const [locale, namespaces] of Object.entries(data)) {
      for (const [namespace, translations] of Object.entries(namespaces as Record<string, any>)) {
        for (const [key, value] of Object.entries(translations as Record<string, any>)) {
          const stringValue = typeof value === "string" ? value : JSON.stringify(value)
          po += `msgid "${key}"\n`
          po += `msgstr "${stringValue}"\n\n`
        }
      }
    }

    return po
  }

  /**
   * Format translations as YAML
   */
  private formatAsYAML(data: Record<string, any>): string {
    return yaml.dump(data, { indent: 2 })
  }

  /**
   * Translate a key
   */
  async translate(
    key: string,
    options: {
      locale?: string
      namespace?: string
      variables?: Record<string, any>
      count?: number
      defaultValue?: string
      escapeHtml?: boolean
      dateFormat?: string
      numberFormat?: Intl.NumberFormatOptions
      tenantId?: string
    } = {},
  ): Promise<string> {
    try {
      const {
        locale = this.options.defaultLocale!,
        namespace = "common",
        variables,
        count,
        defaultValue,
        escapeHtml = false,
        dateFormat,
        numberFormat,
        tenantId,
      } = options

      // Load translations for the locale and namespace
      const translations = await this.loadTranslations(locale, namespace, tenantId)
      let translation = translations.get(key)

      // Try fallback locale if translation not found
      if (!translation && locale !== this.options.fallbackLocale) {
        const fallbackTranslations = await this.loadTranslations(this.options.fallbackLocale!, namespace, tenantId)
        translation = fallbackTranslations.get(key)
      }

      // Try fuzzy matching if enabled and still not found
      if (!translation && this.options.enableFuzzyMatching) {
        const fuzzyMatches = await this.findFuzzyMatches(key, locale, namespace, tenantId)
        if (fuzzyMatches.length > 0) {
          translation = fuzzyMatches[0].value
          logger.info("Used fuzzy match for translation", {
            key,
            locale,
            namespace,
            matchedKey: fuzzyMatches[0].key,
            similarity: fuzzyMatches[0].similarity,
          })
        }
      }

      // Use default value if still not found
      if (!translation) {
        translation = defaultValue || key
      }

      // Get full translation object for pluralization
      let translationObj: Translation | null = null
      if (count !== undefined) {
        translationObj = await this.translationRepo.findByKey(key, locale, namespace, tenantId)
      }

      // Apply pluralization
      if (count !== undefined && translationObj?.pluralForms) {
        translation = this.applyPluralization(translation, count, locale, translationObj.pluralForms)
      }

      // Apply interpolation
      if (variables || count !== undefined) {
        const interpolationContext: InterpolationContext = {
          variables: { ...variables, ...(count !== undefined && { count }) },
          locale,
          namespace,
          escapeHtml,
          dateFormat,
          numberFormat,
        }
        translation = this.applyInterpolation(translation, interpolationContext)
      }

      return translation
    } catch (error) {
      logger.error("Translation failed:", error)
      return options.defaultValue || key
    }
  }

  /**
   * Translate multiple keys at once
   */
  async translateBatch(
    keys: string[],
    options: {
      locale?: string
      namespace?: string
      variables?: Record<string, Record<string, any>>
      tenantId?: string
    } = {},
  ): Promise<Record<string, string>> {
    try {
      const { locale = this.options.defaultLocale!, namespace = "common", variables = {}, tenantId } = options

      const result: Record<string, string> = {}

      // Load translations once for all keys
      const translations = await this.loadTranslations(locale, namespace, tenantId)

      for (const key of keys) {
        result[key] = await this.translate(key, {
          locale,
          namespace,
          variables: variables[key],
          tenantId,
        })
      }

      return result
    } catch (error) {
      logger.error("Batch translation failed:", error)
      throw error
    }
  }

  /**
   * Create or update translation
   */
  async upsertTranslation(
    data: {
      key: string
      value: string
      locale: string
      namespace?: string
      description?: string
      isPlural?: boolean
      pluralForms?: Record<string, string>
      variables?: string[]
      metadata?: Record<string, any>
      tenantId?: string
    },
    userId?: string,
  ): Promise<Translation> {
    try {
      const {
        key,
        value,
        locale,
        namespace = "common",
        description,
        isPlural = false,
        pluralForms,
        variables,
        metadata,
        tenantId,
      } = data

      // Check if translation exists
      const existing = await this.translationRepo.findByKey(key, locale, namespace, tenantId)

      let translation: Translation

      if (existing) {
        // Update existing translation
        translation = await this.translationRepo.update(
          existing.id,
          {
            value,
            description,
            isPlural,
            pluralForms,
            variables,
            metadata,
            updatedBy: userId,
          },
          tenantId,
        )
      } else {
        // Create new translation
        translation = await this.translationRepo.create({
          key,
          value,
          locale,
          namespace,
          description,
          isPlural,
          pluralForms,
          variables,
          metadata,
          tenantId,
          createdBy: userId,
          updatedBy: userId,
        })
      }

      // Update translation memory if enabled
      if (this.options.enableTranslationMemory && !existing) {
        await this.addToTranslationMemory({
          sourceText: key,
          targetText: value,
          sourceLocale: this.options.defaultLocale!,
          targetLocale: locale,
          similarity: 1.0,
          context: namespace,
          metadata: { key, namespace },
        })
      }

      // Clear cache
      await this.clearTranslationCache(locale, namespace, tenantId)

      // Emit event
      this.emit("translation:upserted", {
        translation,
        isNew: !existing,
        userId,
        tenantId,
      })

      // Audit log
      if (this.options.enableAudit && userId) {
        await auditService.log({
          action: existing ? "translation.update" : "translation.create",
          entityType: "Translation",
          entityId: translation.id,
          userId,
          details: {
            key,
            locale,
            namespace,
            isPlural,
          },
        })
      }

      logger.info("Translation upserted", {
        id: translation.id,
        key,
        locale,
        namespace,
        isNew: !existing,
        userId,
        tenantId,
      })

      return translation
    } catch (error) {
      logger.error("Failed to upsert translation:", error)
      throw error
    }
  }

  /**
   * Delete translation
   */
  async deleteTranslation(
    key: string,
    locale: string,
    namespace = "common",
    tenantId?: string,
    userId?: string,
  ): Promise<void> {
    try {
      const translation = await this.translationRepo.findByKey(key, locale, namespace, tenantId)
      if (!translation) {
        throw ApiError.notFound("Translation not found")
      }

      await this.translationRepo.delete(translation.id, tenantId)

      // Clear cache
      await this.clearTranslationCache(locale, namespace, tenantId)

      // Emit event
      this.emit("translation:deleted", {
        translation,
        userId,
        tenantId,
      })

      // Audit log
      if (this.options.enableAudit && userId) {
        await auditService.log({
          action: "translation.delete",
          entityType: "Translation",
          entityId: translation.id,
          userId,
          details: {
            key,
            locale,
            namespace,
          },
        })
      }

      logger.info("Translation deleted", {
        id: translation.id,
        key,
        locale,
        namespace,
        userId,
        tenantId,
      })
    } catch (error) {
      logger.error("Failed to delete translation:", error)
      throw error
    }
  }

  /**
   * Get all translations for a locale and namespace
   */
  async getTranslations(locale: string, namespace = "common", tenantId?: string): Promise<Record<string, string>> {
    try {
      const translations = await this.loadTranslations(locale, namespace, tenantId)
      return Object.fromEntries(translations)
    } catch (error) {
      logger.error("Failed to get translations:", error)
      throw error
    }
  }

  /**
   * Get available locales
   */
  async getAvailableLocales(tenantId?: string): Promise<string[]> {
    try {
      return await this.translationRepo.getAvailableLocales(tenantId)
    } catch (error) {
      logger.error("Failed to get available locales:", error)
      throw error
    }
  }

  /**
   * Get available namespaces
   */
  async getAvailableNamespaces(locale?: string, tenantId?: string): Promise<string[]> {
    try {
      return await this.translationRepo.getAvailableNamespaces(locale, tenantId)
    } catch (error) {
      logger.error("Failed to get available namespaces:", error)
      throw error
    }
  }

  /**
   * Import translations from various formats
   */
  async importTranslations(
    data: any,
    options: TranslationImportOptions,
  ): Promise<{
    imported: number
    updated: number
    errors: string[]
  }> {
    try {
      const { format, locale, namespace = "common", overwrite = false, validate = true, tenantId, importedBy } = options

      let translations: Record<string, any> = {}
      const errors: string[] = []

      // Parse data based on format
      switch (format) {
        case "json":
          translations = typeof data === "string" ? JSON.parse(data) : data
          break
        case "csv":
          translations = this.parseCSV(data)
          break
        case "xliff":
          translations = this.parseXLIFF(data)
          break
        case "po":
          translations = this.parsePO(data)
          break
        case "yaml":
          translations = this.parseYAML(data)
          break
        default:
          throw ApiError.badRequest(`Unsupported import format: ${format}`)
      }

      // Validate translations if enabled
      if (validate) {
        const validationErrors = this.validateTranslations(translations)
        errors.push(...validationErrors)
      }

      let imported = 0
      let updated = 0

      // Import translations
      for (const [key, value] of Object.entries(translations)) {
        try {
          // Check if translation exists
          const existing = await this.translationRepo.findByKey(key, locale, namespace, tenantId)

          if (existing && !overwrite) {
            continue // Skip existing translations if overwrite is false
          }

          // Process value (handle plurals and metadata)
          let translationValue = value
          let isPlural = false
          let pluralForms: Record<string, string> | undefined
          let variables: string[] | undefined

          if (typeof value === "object" && value !== null) {
            if (value._value) {
              translationValue = value._value
              isPlural = value._isPlural || false
              pluralForms = value._pluralForms
              variables = value._variables
            } else {
              // Treat as plural forms
              isPlural = true
              pluralForms = value
              translationValue = value.other || value.one || Object.values(value)[0]
            }
          }

          // Extract variables from translation
          if (!variables) {
            variables = this.extractVariables(String(translationValue))
          }

          await this.upsertTranslation(
            {
              key,
              value: String(translationValue),
              locale,
              namespace,
              isPlural,
              pluralForms,
              variables,
              tenantId,
            },
            importedBy,
          )

          if (existing) {
            updated++
          } else {
            imported++
          }
        } catch (error) {
          errors.push(`Failed to import key '${key}': ${(error as Error).message}`)
        }
      }

      // Clear cache after import
      await this.clearTranslationCache(locale, namespace, tenantId)

      logger.info("Translations imported", {
        format,
        locale,
        namespace,
        imported,
        updated,
        errors: errors.length,
        tenantId,
      })

      return { imported, updated, errors }
    } catch (error) {
      logger.error("Failed to import translations:", error)
      throw error
    }
  }

  /**
   * Export translations to various formats
   */
  async exportTranslations(options: TranslationExportOptions): Promise<{
    format: string
    data: string
    filename: string
    mimeType: string
  }> {
    try {
      const { format, locales, namespaces, includeMetadata = false, tenantId } = options

      // Get available locales and namespaces if not specified
      const targetLocales = locales || (await this.getAvailableLocales(tenantId))
      const targetNamespaces = namespaces || (await this.getAvailableNamespaces(undefined, tenantId))

      const exportData: Record<string, any> = {}

      // Collect translations
      for (const locale of targetLocales) {
        exportData[locale] = {}
        for (const namespace of targetNamespaces) {
          const translations = await this.translationRepo.findByLocaleAndNamespace(locale, namespace, tenantId)

          if (translations.length > 0) {
            exportData[locale][namespace] = {}

            for (const translation of translations) {
              if (includeMetadata) {
                exportData[locale][namespace][translation.key] = {
                  _value: translation.value,
                  _isPlural: translation.isPlural,
                  _pluralForms: translation.pluralForms,
                  _variables: translation.variables,
                  _description: translation.description,
                  _metadata: translation.metadata,
                }
              } else if (translation.isPlural && translation.pluralForms) {
                exportData[locale][namespace][translation.key] = translation.pluralForms
              } else {
                exportData[locale][namespace][translation.key] = translation.value
              }
            }
          }
        }
      }

      // Format data based on export format
      let formattedData: string
      let mimeType: string
      let fileExtension: string

      switch (format) {
        case "json":
          formattedData = JSON.stringify(exportData, null, 2)
          mimeType = "application/json"
          fileExtension = "json"
          break
        case "csv":
          formattedData = this.formatAsCSV(exportData)
          mimeType = "text/csv"
          fileExtension = "csv"
          break
        case "xliff":
          formattedData = this.formatAsXLIFF(exportData)
          mimeType = "application/xml"
          fileExtension = "xliff"
          break
        case "po":
          formattedData = this.formatAsPO(exportData)
          mimeType = "text/plain"
          fileExtension = "po"
          break
        case "yaml":
          formattedData = this.formatAsYAML(exportData)
          mimeType = "text/yaml"
          fileExtension = "yaml"
          break
        default:
          throw ApiError.badRequest(`Unsupported export format: ${format}`)
      }

      const filename = `translations-${Date.now()}.${fileExtension}`

      logger.info("Translations exported", {
        format,
        locales: targetLocales.length,
        namespaces: targetNamespaces.length,
        filename,
        tenantId,
      })

      return {
        format,
        data: formattedData,
        filename,
        mimeType,
      }
    } catch (error) {
      logger.error("Failed to export translations:", error)
      throw error
    }
  }

  /**
   * Get translation statistics
   */
  async getStats(tenantId?: string): Promise<TranslationStats> {
    try {
      const stats = await this.translationRepo.getStats(tenantId)
      return stats
    } catch (error) {
      logger.error("Failed to get translation stats:", error)
      throw error
    }
  }

  /**
   * Find missing translations
   */
  async findMissingTranslations(
    baseLocale: string,
    targetLocales: string[],
    namespace?: string,
    tenantId?: string,
  ): Promise<
    Array<{
      key: string
      namespace: string
      baseValue: string
      missingLocales: string[]
    }>
  > {
    try {
      const missing: Array<{
        key: string
        namespace: string
        baseValue: string
        missingLocales: string[]
      }> = []

      // Get all namespaces if not specified
      const namespaces = namespace ? [namespace] : await this.getAvailableNamespaces(baseLocale, tenantId)

      for (const ns of namespaces) {
        // Get base translations
        const baseTranslations = await this.translationRepo.findByLocaleAndNamespace(baseLocale, ns, tenantId)

        for (const baseTranslation of baseTranslations) {
          const missingLocales: string[] = []

          // Check each target locale
          for (const targetLocale of targetLocales) {
            const targetTranslation = await this.translationRepo.findByKey(
              baseTranslation.key,
              targetLocale,
              ns,
              tenantId,
            )

            if (!targetTranslation) {
              missingLocales.push(targetLocale)
            }
          }

          if (missingLocales.length > 0) {
            missing.push({
              key: baseTranslation.key,
              namespace: ns,
              baseValue: baseTranslation.value,
              missingLocales,
            })
          }
        }
      }

      return missing
    } catch (error) {
      logger.error("Failed to find missing translations:", error)
      throw error
    }
  }

  /**
   * Add entry to translation memory
   */
  private async addToTranslationMemory(entry: TranslationMemoryEntry): Promise<void> {
    if (!this.options.enableTranslationMemory) {
      return
    }

    const key = `${entry.sourceLocale}-${entry.targetLocale}`
    if (!this.translationMemory.has(key)) {
      this.translationMemory.set(key, [])
    }

    const entries = this.translationMemory.get(key)!
    entries.push(entry)

    // Keep only the most recent 1000 entries per language pair
    if (entries.length > 1000) {
      entries.splice(0, entries.length - 1000)
    }

    // Persist to database
    await this.translationRepo.addToTranslationMemory(entry)
  }

  /**
   * Search translation memory
   */
  async searchTranslationMemory(
    sourceText: string,
    sourceLocale: string,
    targetLocale: string,
    threshold = 0.8,
  ): Promise<TranslationMemoryEntry[]> {
    if (!this.options.enableTranslationMemory) {
      return []
    }

    const key = `${sourceLocale}-${targetLocale}`
    const entries = this.translationMemory.get(key) || []

    const matches: TranslationMemoryEntry[] = []

    for (const entry of entries) {
      const similarity = this.calculateSimilarity(sourceText, entry.sourceText)
      if (similarity >= threshold) {
        matches.push({
          ...entry,
          similarity,
        })
      }
    }

    return matches.sort((a, b) => b.similarity - a.similarity)
  }

  /**
   * Auto-translate missing translations using a translation service
   */
  async autoTranslate(
    sourceLocale: string,
    targetLocale: string,
    keys?: string[],
    namespace = "common",
    tenantId?: string,
    userId?: string,
  ): Promise<{
    translated: number
    errors: string[]
  }> {
    try {
      const errors: string[] = []
      let translated = 0

      // Get source translations
      const sourceTranslations = keys
        ? await Promise.all(keys.map((key) => this.translationRepo.findByKey(key, sourceLocale, namespace, tenantId)))
        : await this.translationRepo.findByLocaleAndNamespace(sourceLocale, namespace, tenantId)

      for (const sourceTranslation of sourceTranslations) {
        if (!sourceTranslation) continue

        try {
          // Check if target translation already exists
          const existingTarget = await this.translationRepo.findByKey(
            sourceTranslation.key,
            targetLocale,
            namespace,
            tenantId,
          )

          if (existingTarget) {
            continue // Skip if already exists
          }

          // Try translation memory first
          let translatedValue = ""
          if (this.options.enableTranslationMemory) {
            const memoryMatches = await this.searchTranslationMemory(
              sourceTranslation.value,
              sourceLocale,
              targetLocale,
              0.9,
            )

            if (memoryMatches.length > 0) {
              translatedValue = memoryMatches[0].targetText
              logger.info("Used translation memory", {
                key: sourceTranslation.key,
                similarity: memoryMatches[0].similarity,
              })
            }
          }

          // Use auto-translation service if no memory match
          if (!translatedValue) {
            translatedValue = await this.callTranslationService(sourceTranslation.value, sourceLocale, targetLocale)
          }

          // Create the translation
          await this.upsertTranslation(
            {
              key: sourceTranslation.key,
              value: translatedValue,
              locale: targetLocale,
              namespace,
              description: `Auto-translated from ${sourceLocale}`,
              variables: sourceTranslation.variables,
              metadata: {
                autoTranslated: true,
                sourceLocale,
                translatedAt: new Date().toISOString(),
                translationProvider: this.options.autoTranslateProvider,
              },
              tenantId,
            },
            userId,
          )

          // Add to translation memory
          if (this.options.enableTranslationMemory) {
            await this.addToTranslationMemory({
              sourceText: sourceTranslation.value,
              targetText: translatedValue,
              sourceLocale,
              targetLocale,
              similarity: 1.0,
              context: namespace,
              metadata: {
                key: sourceTranslation.key,
                autoTranslated: true,
              },
            })
          }

          translated++
          logger.info("Auto-translated", {
            key: sourceTranslation.key,
            sourceLocale,
            targetLocale,
            namespace,
          })
        } catch (error) {
          const errorMessage = `Failed to auto-translate key '${sourceTranslation.key}': ${(error as Error).message}`
          errors.push(errorMessage)
          logger.error(errorMessage, error)
        }
      }

      // Clear cache after auto-translation
      await this.clearTranslationCache(targetLocale, namespace, tenantId)

      logger.info("Auto-translation completed", {
        sourceLocale,
        targetLocale,
        namespace,
        translated,
        errors: errors.length,
        tenantId,
      })

      return { translated, errors }
    } catch (error) {
      logger.error("Failed to auto-translate:", error)
      throw error
    }
  }

  /**
   * Call external translation service
   */
  private async callTranslationService(text: string, sourceLocale: string, targetLocale: string): Promise<string> {
    if (!this.options.autoTranslateProvider || !this.options.autoTranslateApiKey) {
      throw new Error("Auto-translation provider not configured")
    }

    // This is a placeholder implementation
    // In a real implementation, you would integrate with services like:
    // - Google Translate API
    // - DeepL API
    // - Azure Translator
    // - AWS Translate

    switch (this.options.autoTranslateProvider) {
      case "google":
        return await this.callGoogleTranslate(text, sourceLocale, targetLocale)
      case "deepl":
        return await this.callDeepL(text, sourceLocale, targetLocale)
      case "azure":
        return await this.callAzureTranslator(text, sourceLocale, targetLocale)
      case "aws":
        return await this.callAWSTranslate(text, sourceLocale, targetLocale)
      default:
        throw new Error(`Unsupported translation provider: ${this.options.autoTranslateProvider}`)
    }
  }

  /**
   * Call Google Translate API (placeholder)
   */
  private async callGoogleTranslate(text: string, sourceLocale: string, targetLocale: string): Promise<string> {
    // Placeholder implementation
    return `[GOOGLE_TRANSLATED:${sourceLocale}->${targetLocale}] ${text}`
  }

  /**
   * Call DeepL API (placeholder)
   */
  private async callDeepL(text: string, sourceLocale: string, targetLocale: string): Promise<string> {
    // Placeholder implementation
    return `[DEEPL_TRANSLATED:${sourceLocale}->${targetLocale}] ${text}`
  }

  /**
   * Call Azure Translator (placeholder)
   */
  private async callAzureTranslator(text: string, sourceLocale: string, targetLocale: string): Promise<string> {
    // Placeholder implementation
    return `[AZURE_TRANSLATED:${sourceLocale}->${targetLocale}] ${text}`
  }

  /**
   * Call AWS Translate (placeholder)
   */
  private async callAWSTranslate(text: string, sourceLocale: string, targetLocale: string): Promise<string> {
    // Placeholder implementation
    return `[AWS_TRANSLATED:${sourceLocale}->${targetLocale}] ${text}`
  }

  /**
   * Bulk operations for translations
   */
  async bulkUpsertTranslations(
    translations: Array<{
      key: string
      value: string
      locale: string
      namespace?: string
      description?: string
      isPlural?: boolean
      pluralForms?: Record<string, string>
      variables?: string[]
      metadata?: Record<string, any>
      tenantId?: string
    }>,
    userId?: string,
  ): Promise<{
    created: number
    updated: number
    errors: string[]
  }> {
    const results = { created: 0, updated: 0, errors: [] as string[] }

    for (const translationData of translations) {
      try {
        const existing = await this.translationRepo.findByKey(
          translationData.key,
          translationData.locale,
          translationData.namespace || "common",
          translationData.tenantId,
        )

        await this.upsertTranslation(translationData, userId)

        if (existing) {
          results.updated++
        } else {
          results.created++
        }
      } catch (error) {
        results.errors.push(`Failed to upsert ${translationData.key}: ${(error as Error).message}`)
      }
    }

    return results
  }

  /**
   * Validate translation completeness
   */
  async validateTranslationCompleteness(
    baseLocale: string,
    targetLocales: string[],
    namespaces?: string[],
    tenantId?: string,
  ): Promise<{
    completionRate: Record<string, number>
    missingCount: Record<string, number>
    totalKeys: number
  }> {
    const targetNamespaces = namespaces || (await this.getAvailableNamespaces(baseLocale, tenantId))
    const completionRate: Record<string, number> = {}
    const missingCount: Record<string, number> = {}
    let totalKeys = 0

    // Get total keys from base locale
    for (const namespace of targetNamespaces) {
      const baseTranslations = await this.translationRepo.findByLocaleAndNamespace(baseLocale, namespace, tenantId)
      totalKeys += baseTranslations.length
    }

    // Calculate completion for each target locale
    for (const targetLocale of targetLocales) {
      let translatedKeys = 0
      let missing = 0

      for (const namespace of targetNamespaces) {
        const baseTranslations = await this.translationRepo.findByLocaleAndNamespace(baseLocale, namespace, tenantId)
        const targetTranslations = await this.translationRepo.findByLocaleAndNamespace(
          targetLocale,
          namespace,
          tenantId,
        )

        const targetKeySet = new Set(targetTranslations.map((t) => t.key))

        for (const baseTranslation of baseTranslations) {
          if (targetKeySet.has(baseTranslation.key)) {
            translatedKeys++
          } else {
            missing++
          }
        }
      }

      completionRate[targetLocale] = totalKeys > 0 ? (translatedKeys / totalKeys) * 100 : 100
      missingCount[targetLocale] = missing
    }

    return {
      completionRate,
      missingCount,
      totalKeys,
    }
  }

  /**
   * Clean up unused translations
   */
  async cleanupUnusedTranslations(
    usedKeys: string[],
    locale?: string,
    namespace?: string,
    tenantId?: string,
    userId?: string,
  ): Promise<{
    deleted: number
    errors: string[]
  }> {
    const results = { deleted: 0, errors: [] as string[] }
    const usedKeySet = new Set(usedKeys)

    try {
      // Get all translations for the specified criteria
      const allTranslations =
        locale && namespace
          ? await this.translationRepo.findByLocaleAndNamespace(locale, namespace, tenantId)
          : await this.translationRepo.findAll(tenantId)

      for (const translation of allTranslations) {
        if (!usedKeySet.has(translation.key)) {
          try {
            await this.deleteTranslation(translation.key, translation.locale, translation.namespace, tenantId, userId)
            results.deleted++
          } catch (error) {
            results.errors.push(`Failed to delete ${translation.key}: ${(error as Error).message}`)
          }
        }
      }
    } catch (error) {
      results.errors.push(`Failed to cleanup translations: ${(error as Error).message}`)
    }

    return results
  }

  /**
   * Get translation health report
   */
  async getHealthReport(tenantId?: string): Promise<{
    totalTranslations: number
    locales: string[]
    namespaces: string[]
    completionRates: Record<string, number>
    duplicateKeys: Array<{ key: string; locales: string[] }>
    emptyTranslations: Array<{ key: string; locale: string; namespace: string }>
    longTranslations: Array<{ key: string; locale: string; length: number }>
    cacheHitRate: number
    memoryUsage: {
      cacheSize: number
      translationMemorySize: number
    }
  }> {
    const stats = await this.getStats(tenantId)
    const locales = await this.getAvailableLocales(tenantId)
    const namespaces = await this.getAvailableNamespaces(undefined, tenantId)

    // Find duplicate keys across locales
    const duplicateKeys: Array<{ key: string; locales: string[] }> = []
    const keyLocaleMap: Record<string, string[]> = {}

    for (const locale of locales) {
      for (const namespace of namespaces) {
        const translations = await this.translationRepo.findByLocaleAndNamespace(locale, namespace, tenantId)
        for (const translation of translations) {
          const key = `${namespace}.${translation.key}`
          if (!keyLocaleMap[key]) {
            keyLocaleMap[key] = []
          }
          keyLocaleMap[key].push(locale)
        }
      }
    }

    for (const [key, localeList] of Object.entries(keyLocaleMap)) {
      if (localeList.length > 1) {
        duplicateKeys.push({ key, locales: localeList })
      }
    }

    // Find empty translations
    const emptyTranslations: Array<{ key: string; locale: string; namespace: string }> = []
    const longTranslations: Array<{ key: string; locale: string; length: number }> = []

    for (const locale of locales) {
      for (const namespace of namespaces) {
        const translations = await this.translationRepo.findByLocaleAndNamespace(locale, namespace, tenantId)
        for (const translation of translations) {
          if (!translation.value || translation.value.trim().length === 0) {
            emptyTranslations.push({
              key: translation.key,
              locale: translation.locale,
              namespace: translation.namespace,
            })
          }
          if (translation.value.length > 500) {
            longTranslations.push({
              key: translation.key,
              locale: translation.locale,
              length: translation.value.length,
            })
          }
        }
      }
    }

    return {
      totalTranslations: stats.totalTranslations,
      locales,
      namespaces,
      completionRates: stats.completionRate,
      duplicateKeys,
      emptyTranslations,
      longTranslations,
      cacheHitRate: 0, // Would need to track cache hits/misses
      memoryUsage: {
        cacheSize: this.translationCache.size,
        translationMemorySize: this.translationMemory.size,
      },
    }
  }

  /**
   * Preload translations for better performance
   */
  async preloadTranslations(locales: string[], namespaces: string[], tenantId?: string): Promise<void> {
    try {
      const preloadPromises: Promise<void>[] = []

      for (const locale of locales) {
        for (const namespace of namespaces) {
          preloadPromises.push(
            this.loadTranslations(locale, namespace, tenantId).then(() => {
              logger.debug("Preloaded translations", { locale, namespace, tenantId })
            }),
          )
        }
      }

      await Promise.all(preloadPromises)
      logger.info("Translation preloading completed", {
        locales: locales.length,
        namespaces: namespaces.length,
        tenantId,
      })
    } catch (error) {
      logger.error("Failed to preload translations:", error)
      throw error
    }
  }

  /**
   * Sync translations with external source
   */
  async syncTranslations(
    source: "file" | "api" | "database",
    config: {
      url?: string
      filePath?: string
      apiKey?: string
      locale?: string
      namespace?: string
      tenantId?: string
    },
  ): Promise<{
    synced: number
    errors: string[]
  }> {
    const results = { synced: 0, errors: [] as string[] }

    try {
      let translationsData: Record<string, any> = {}

      switch (source) {
        case "file":
          if (!config.filePath) {
            throw new Error("File path is required for file sync")
          }
          const fileContent = await fs.readFile(config.filePath, "utf-8")
          const fileExtension = path.extname(config.filePath).toLowerCase()

          switch (fileExtension) {
            case ".json":
              translationsData = JSON.parse(fileContent)
              break
            case ".yaml":
            case ".yml":
              translationsData = this.parseYAML(fileContent)
              break
            default:
              throw new Error(`Unsupported file format: ${fileExtension}`)
          }
          break

        case "api":
          if (!config.url) {
            throw new Error("URL is required for API sync")
          }
          const response = await fetch(config.url, {
            headers: {
              ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
              "Content-Type": "application/json",
            },
          })

          if (!response.ok) {
            throw new Error(`API sync failed: ${response.statusText}`)
          }

          translationsData = await response.json()
          break

        case "database":
          // Sync from another database or tenant
          const sourceTranslations = await this.translationRepo.findAll(config.tenantId)
          for (const translation of sourceTranslations) {
            translationsData[translation.key] = translation.value
          }
          break

        default:
          throw new Error(`Unsupported sync source: ${source}`)
      }

      // Import the synced translations
      const importResult = await this.importTranslations(translationsData, {
        format: "json",
        locale: config.locale || this.options.defaultLocale!,
        namespace: config.namespace || "common",
        overwrite: true,
        tenantId: config.tenantId,
      })

      results.synced = importResult.imported + importResult.updated
      results.errors = importResult.errors

      logger.info("Translation sync completed", {
        source,
        synced: results.synced,
        errors: results.errors.length,
      })
    } catch (error) {
      results.errors.push(`Sync failed: ${(error as Error).message}`)
      logger.error("Translation sync failed:", error)
    }

    return results
  }

  /**
   * Generate translation keys from source code
   */
  async generateKeysFromSource(
    sourceFiles: string[],
    options: {
      keyPattern?: RegExp
      extractComments?: boolean
      namespace?: string
      locale?: string
      tenantId?: string
    } = {},
  ): Promise<{
    keys: Array<{
      key: string
      defaultValue?: string
      file: string
      line: number
      context?: string
    }>
    errors: string[]
  }> {
    const {
      keyPattern = /(?:t|translate|i18n)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      extractComments = true,
      namespace = "common",
      locale = this.options.defaultLocale!,
      tenantId,
    } = options

    const keys: Array<{
      key: string
      defaultValue?: string
      file: string
      line: number
      context?: string
    }> = []
    const errors: string[] = []

    for (const filePath of sourceFiles) {
      try {
        const content = await fs.readFile(filePath, "utf-8")
        const lines = content.split("\n")

        lines.forEach((line, index) => {
          let match
          while ((match = keyPattern.exec(line)) !== null) {
            const key = match[1]
            let context: string | undefined
            let defaultValue: string | undefined

            // Extract comment context if enabled
            if (extractComments && index > 0) {
              const prevLine = lines[index - 1].trim()
              if (prevLine.startsWith("//") || prevLine.startsWith("/*")) {
                context = prevLine.replace(/^\/\/\s*|^\/\*\s*|\s*\*\/$/, "")
              }
            }

            // Try to extract default value from function call
            const defaultValueMatch = line.match(new RegExp(`${match[0]}[^,]*,\\s*['"\`]([^'"\`]+)['"\`]`))
            if (defaultValueMatch) {
              defaultValue = defaultValueMatch[1]
            }

            keys.push({
              key,
              defaultValue,
              file: filePath,
              line: index + 1,
              context,
            })
          }
        })
      } catch (error) {
        errors.push(`Failed to process file ${filePath}: ${(error as Error).message}`)
      }
    }

    // Remove duplicates
    const uniqueKeys = keys.filter((item, index, self) => index === self.findIndex((t) => t.key === item.key))

    logger.info("Generated translation keys from source", {
      files: sourceFiles.length,
      keys: uniqueKeys.length,
      errors: errors.length,
    })

    return {
      keys: uniqueKeys,
      errors,
    }
  }

  /**
   * Dispose of the service and clean up resources
   */
  async dispose(): Promise<void> {
    try {
      // Close file watchers
      for (const [path, watcher] of this.watchers) {
        watcher.close()
        logger.debug("Closed file watcher", { path })
      }
      this.watchers.clear()

      // Clear caches
      this.translationCache.clear()
      this.translationMemory.clear()

      // Remove all listeners
      this.removeAllListeners()

      logger.info("I18n service disposed")
    } catch (error) {
      logger.error("Failed to dispose I18n service:", error)
      throw error
    }
  }
}

// Export singleton instance
export const i18nService = new I18nService()
