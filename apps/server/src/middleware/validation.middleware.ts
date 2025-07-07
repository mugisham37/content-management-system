import type { Request, Response, NextFunction } from "express"
import type { ObjectSchema } from "joi"
import { ApiError } from "../utils/errors"
import { Logger } from "../utils/logger"

export interface ValidationOptions {
  body?: ObjectSchema
  query?: ObjectSchema
  params?: ObjectSchema
  headers?: ObjectSchema
  allowUnknown?: boolean
  stripUnknown?: boolean
  abortEarly?: boolean
}

export class ValidationMiddleware {
  /**
   * Create validation middleware from Joi schemas
   */
  public validateRequest = (options: ValidationOptions) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const requestId = (req as any).requestId
      const errors: any[] = []

      try {
        // Validate request body
        if (options.body && req.body) {
          const { error, value } = options.body.validate(req.body, {
            allowUnknown: options.allowUnknown || false,
            stripUnknown: options.stripUnknown || true,
            abortEarly: options.abortEarly || false
          })

          if (error) {
            errors.push(...error.details.map(detail => ({
              field: detail.path.join('.'),
              message: detail.message,
              type: detail.type,
              location: 'body'
            })))
          } else {
            req.body = value
          }
        }

        // Validate query parameters
        if (options.query && req.query) {
          const { error, value } = options.query.validate(req.query, {
            allowUnknown: options.allowUnknown || false,
            stripUnknown: options.stripUnknown || true,
            abortEarly: options.abortEarly || false
          })

          if (error) {
            errors.push(...error.details.map(detail => ({
              field: detail.path.join('.'),
              message: detail.message,
              type: detail.type,
              location: 'query'
            })))
          } else {
            req.query = value
          }
        }

        // Validate path parameters
        if (options.params && req.params) {
          const { error, value } = options.params.validate(req.params, {
            allowUnknown: options.allowUnknown || false,
            stripUnknown: options.stripUnknown || true,
            abortEarly: options.abortEarly || false
          })

          if (error) {
            errors.push(...error.details.map(detail => ({
              field: detail.path.join('.'),
              message: detail.message,
              type: detail.type,
              location: 'params'
            })))
          } else {
            req.params = value
          }
        }

        // Validate headers
        if (options.headers && req.headers) {
          const { error, value } = options.headers.validate(req.headers, {
            allowUnknown: options.allowUnknown || true,
            stripUnknown: options.stripUnknown || false,
            abortEarly: options.abortEarly || false
          })

          if (error) {
            errors.push(...error.details.map(detail => ({
              field: detail.path.join('.'),
              message: detail.message,
              type: detail.type,
              location: 'headers'
            })))
          }
        }

        // If there are validation errors, return them
        if (errors.length > 0) {
          Logger.warn("Request validation failed", {
            errors,
            path: req.path,
            method: req.method,
            requestId
          })

          return next(new ApiError(422, "Validation failed", "VALIDATION_ERROR", errors))
        }

        next()
      } catch (error) {
        Logger.error("Validation middleware error:", { error, requestId })
        next(new ApiError(500, "Validation processing error", "VALIDATION_PROCESSING_ERROR"))
      }
    }
  }

  /**
   * Validate file upload requirements
   */
  public validateFileUpload = (options: {
    maxSize?: number
    allowedMimeTypes?: string[]
    allowedExtensions?: string[]
    required?: boolean
    maxFiles?: number
  }) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const requestId = (req as any).requestId
      const files = (req as any).files || []
      const file = (req as any).file

      try {
        // Check if file is required
        if (options.required && !file && files.length === 0) {
          return next(new ApiError(400, "File upload is required", "FILE_REQUIRED"))
        }

        // Check file count
        if (options.maxFiles && files.length > options.maxFiles) {
          return next(new ApiError(400, `Maximum ${options.maxFiles} files allowed`, "TOO_MANY_FILES"))
        }

        // Validate each file
        const filesToValidate = file ? [file] : files
        
        for (const uploadedFile of filesToValidate) {
          // Check file size
          if (options.maxSize && uploadedFile.size > options.maxSize) {
            return next(new ApiError(413, `File size exceeds maximum allowed size of ${Math.round(options.maxSize / 1024 / 1024)}MB`, "FILE_TOO_LARGE"))
          }

          // Check MIME type
          if (options.allowedMimeTypes && !options.allowedMimeTypes.includes(uploadedFile.mimetype)) {
            return next(new ApiError(400, `File type ${uploadedFile.mimetype} is not allowed`, "INVALID_FILE_TYPE", {
              allowedTypes: options.allowedMimeTypes
            }))
          }

          // Check file extension
          if (options.allowedExtensions) {
            const fileExtension = uploadedFile.originalname.split('.').pop()?.toLowerCase()
            if (!fileExtension || !options.allowedExtensions.includes(fileExtension)) {
              return next(new ApiError(400, `File extension .${fileExtension} is not allowed`, "INVALID_FILE_EXTENSION", {
                allowedExtensions: options.allowedExtensions
              }))
            }
          }

          // Basic security checks
          if (this.isExecutableFile(uploadedFile.originalname)) {
            Logger.logSecurity("Executable file upload attempt blocked", {
              filename: uploadedFile.originalname,
              mimetype: uploadedFile.mimetype,
              requestId,
              ip: req.ip
            })
            return next(new ApiError(400, "Executable files are not allowed", "EXECUTABLE_FILE_NOT_ALLOWED"))
          }
        }

        next()
      } catch (error) {
        Logger.error("File validation error:", { error, requestId })
        next(new ApiError(500, "File validation error", "FILE_VALIDATION_ERROR"))
      }
    }
  }

  /**
   * Validate pagination parameters
   */
  public validatePagination = (options: {
    maxLimit?: number
    defaultLimit?: number
    defaultOffset?: number
  } = {}) => {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        const maxLimit = options.maxLimit || 100
        const defaultLimit = options.defaultLimit || 20
        const defaultOffset = options.defaultOffset || 0

        // Parse and validate limit
        let limit = parseInt(req.query.limit as string) || defaultLimit
        if (limit < 1) limit = defaultLimit
        if (limit > maxLimit) limit = maxLimit

        // Parse and validate offset
        let offset = parseInt(req.query.offset as string) || defaultOffset
        if (offset < 0) offset = defaultOffset

        // Parse and validate page (alternative to offset)
        if (req.query.page) {
          const page = parseInt(req.query.page as string)
          if (page > 0) {
            offset = (page - 1) * limit
          }
        }

        // Attach validated pagination to request
        ;(req as any).pagination = {
          limit,
          offset,
          page: Math.floor(offset / limit) + 1
        }

        next()
      } catch (error) {
        Logger.error("Pagination validation error:", error)
        next(new ApiError(400, "Invalid pagination parameters", "INVALID_PAGINATION"))
      }
    }
  }

  /**
   * Validate sorting parameters
   */
  public validateSorting = (allowedFields: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        const sortBy = req.query.sortBy as string
        const sortOrder = (req.query.sortOrder as string)?.toLowerCase()

        if (sortBy) {
          // Validate sort field
          if (!allowedFields.includes(sortBy)) {
            return next(new ApiError(400, `Invalid sort field. Allowed fields: ${allowedFields.join(', ')}`, "INVALID_SORT_FIELD"))
          }

          // Validate sort order
          if (sortOrder && !['asc', 'desc'].includes(sortOrder)) {
            return next(new ApiError(400, "Sort order must be 'asc' or 'desc'", "INVALID_SORT_ORDER"))
          }

          // Attach validated sorting to request
          ;(req as any).sorting = {
            field: sortBy,
            order: sortOrder || 'asc'
          }
        }

        next()
      } catch (error) {
        Logger.error("Sorting validation error:", error)
        next(new ApiError(400, "Invalid sorting parameters", "INVALID_SORTING"))
      }
    }
  }

  /**
   * Validate search parameters
   */
  public validateSearch = (options: {
    minLength?: number
    maxLength?: number
    allowedFields?: string[]
  } = {}) => {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        const search = req.query.search as string
        const searchFields = req.query.searchFields as string | string[]

        if (search) {
          const minLength = options.minLength || 2
          const maxLength = options.maxLength || 100

          // Validate search term length
          if (search.length < minLength) {
            return next(new ApiError(400, `Search term must be at least ${minLength} characters`, "SEARCH_TOO_SHORT"))
          }

          if (search.length > maxLength) {
            return next(new ApiError(400, `Search term must be no more than ${maxLength} characters`, "SEARCH_TOO_LONG"))
          }

          // Validate search fields
          if (searchFields && options.allowedFields) {
            const fieldsArray = Array.isArray(searchFields) ? searchFields : [searchFields]
            const invalidFields = fieldsArray.filter(field => !options.allowedFields!.includes(field))
            
            if (invalidFields.length > 0) {
              return next(new ApiError(400, `Invalid search fields: ${invalidFields.join(', ')}`, "INVALID_SEARCH_FIELDS"))
            }
          }

          // Attach validated search to request
          ;(req as any).search = {
            term: search,
            fields: searchFields ? (Array.isArray(searchFields) ? searchFields : [searchFields]) : undefined
          }
        }

        next()
      } catch (error) {
        Logger.error("Search validation error:", error)
        next(new ApiError(400, "Invalid search parameters", "INVALID_SEARCH"))
      }
    }
  }

  /**
   * Validate date range parameters
   */
  public validateDateRange = (options: {
    startDateField?: string
    endDateField?: string
    maxRangeDays?: number
  } = {}) => {
    return (req: Request, res: Response, next: NextFunction) => {
      try {
        const startDateField = options.startDateField || 'startDate'
        const endDateField = options.endDateField || 'endDate'
        const startDateStr = req.query[startDateField] as string
        const endDateStr = req.query[endDateField] as string

        if (startDateStr || endDateStr) {
          let startDate: Date | undefined
          let endDate: Date | undefined

          // Parse start date
          if (startDateStr) {
            startDate = new Date(startDateStr)
            if (isNaN(startDate.getTime())) {
              return next(new ApiError(400, `Invalid ${startDateField} format`, "INVALID_START_DATE"))
            }
          }

          // Parse end date
          if (endDateStr) {
            endDate = new Date(endDateStr)
            if (isNaN(endDate.getTime())) {
              return next(new ApiError(400, `Invalid ${endDateField} format`, "INVALID_END_DATE"))
            }
          }

          // Validate date range
          if (startDate && endDate && startDate > endDate) {
            return next(new ApiError(400, "Start date must be before end date", "INVALID_DATE_RANGE"))
          }

          // Check maximum range
          if (options.maxRangeDays && startDate && endDate) {
            const rangeDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
            if (rangeDays > options.maxRangeDays) {
              return next(new ApiError(400, `Date range cannot exceed ${options.maxRangeDays} days`, "DATE_RANGE_TOO_LARGE"))
            }
          }

          // Attach validated date range to request
          ;(req as any).dateRange = {
            startDate,
            endDate
          }
        }

        next()
      } catch (error) {
        Logger.error("Date range validation error:", error)
        next(new ApiError(400, "Invalid date range parameters", "INVALID_DATE_RANGE"))
      }
    }
  }

  /**
   * Check if file is executable
   */
  private isExecutableFile(filename: string): boolean {
    const executableExtensions = [
      'exe', 'bat', 'cmd', 'com', 'pif', 'scr', 'vbs', 'js', 'jar',
      'sh', 'py', 'pl', 'php', 'asp', 'aspx', 'jsp', 'ps1'
    ]
    
    const extension = filename.split('.').pop()?.toLowerCase()
    return extension ? executableExtensions.includes(extension) : false
  }

  /**
   * Sanitize input to prevent XSS
   */
  public sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
    try {
      // Recursively sanitize object
      const sanitizeObject = (obj: any): any => {
        if (typeof obj === 'string') {
          return obj
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
            .replace(/javascript:/gi, '')
            .replace(/on\w+\s*=/gi, '')
        }
        
        if (Array.isArray(obj)) {
          return obj.map(sanitizeObject)
        }
        
        if (obj && typeof obj === 'object') {
          const sanitized: any = {}
          for (const [key, value] of Object.entries(obj)) {
            sanitized[key] = sanitizeObject(value)
          }
          return sanitized
        }
        
        return obj
      }

      // Sanitize request body
      if (req.body) {
        req.body = sanitizeObject(req.body)
      }

      // Sanitize query parameters
      if (req.query) {
        req.query = sanitizeObject(req.query)
      }

      next()
    } catch (error) {
      Logger.error("Input sanitization error:", error)
      next(new ApiError(500, "Input sanitization error", "SANITIZATION_ERROR"))
    }
  }
}

// Create and export middleware instances
const validationMiddleware = new ValidationMiddleware()

export const validateRequest = validationMiddleware.validateRequest
export const validateFileUpload = validationMiddleware.validateFileUpload
export const validatePagination = validationMiddleware.validatePagination
export const validateSorting = validationMiddleware.validateSorting
export const validateSearch = validationMiddleware.validateSearch
export const validateDateRange = validationMiddleware.validateDateRange
export const sanitizeInput = validationMiddleware.sanitizeInput

// Export class for advanced usage (already exported at class declaration)
