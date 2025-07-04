// =============================================================================
// SWAGGER DOCUMENTATION UTILITIES
// =============================================================================

import swaggerJsdoc from "swagger-jsdoc"
import swaggerUi from "swagger-ui-express"
import type { Express } from "express"
import { config } from "../config"
import { Logger } from "./logger"

// =============================================================================
// SWAGGER CONFIGURATION
// =============================================================================

/**
 * Get package.json version safely
 */
const getVersion = (): string => {
  try {
    const packageJson = require("../../package.json")
    return packageJson.version || "1.0.0"
  } catch {
    return "1.0.0"
  }
}

/**
 * Swagger definition with enhanced configuration
 */
const swaggerDefinition = {
  openapi: "3.0.0",
  info: {
    title: "CMS API Documentation",
    version: getVersion(),
    description: `
# Content Management System API

A comprehensive, multi-tenant content management system API built with Node.js, TypeScript, and PostgreSQL.

## Features

- **Multi-tenant Architecture**: Complete tenant isolation and management
- **Dynamic Content Types**: Create and manage custom content structures
- **Workflow Management**: Advanced content approval workflows
- **Media Management**: File upload, processing, and optimization
- **Plugin System**: Extensible architecture with custom plugins
- **Webhook Integration**: Real-time event notifications
- **Advanced Security**: JWT authentication, rate limiting, and data validation
- **Performance Optimized**: Caching, pagination, and query optimization

## Authentication

This API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:

\`\`\`
Authorization: Bearer <your-jwt-token>
\`\`\`

## Rate Limiting

API requests are rate-limited to prevent abuse. Current limits:
- **General API**: ${config.rateLimit.max} requests per ${Math.floor(config.rateLimit.windowMs / 60000)} minutes
- **Authentication**: Stricter limits apply to login/registration endpoints

## Pagination

List endpoints support pagination with the following query parameters:
- \`page\`: Page number (default: 1)
- \`limit\`: Items per page (default: ${config.pagination.defaultLimit}, max: ${config.pagination.maxLimit})

## Error Handling

All errors follow a consistent format:

\`\`\`json
{
  "success": false,
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE",
    "statusCode": 400,
    "details": {},
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
\`\`\`
    `,
    license: {
      name: "MIT",
      url: "https://opensource.org/licenses/MIT",
    },
    contact: {
      name: "API Support",
      url: "https://github.com/mugisham37/content-management-system",
      email: "support@cms-platform.com",
    },
    termsOfService: "https://cms-platform.com/terms",
  },
  servers: [
    {
      url: `http://localhost:${config.server.port}/api/v1`,
      description: "Development server",
    },
    {
      url: `https://api.cms-platform.com/v1`,
      description: "Production server",
    },
    {
      url: `https://staging-api.cms-platform.com/v1`,
      description: "Staging server",
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT token obtained from the authentication endpoint",
      },
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "API key for server-to-server authentication",
      },
    },
    parameters: {
      tenantId: {
        name: "tenantId",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "uuid",
        },
        description: "Unique identifier for the tenant",
      },
      page: {
        name: "page",
        in: "query",
        required: false,
        schema: {
          type: "integer",
          minimum: 1,
          default: 1,
        },
        description: "Page number for pagination",
      },
      limit: {
        name: "limit",
        in: "query",
        required: false,
        schema: {
          type: "integer",
          minimum: 1,
          maximum: config.pagination.maxLimit,
          default: config.pagination.defaultLimit,
        },
        description: "Number of items per page",
      },
      search: {
        name: "search",
        in: "query",
        required: false,
        schema: {
          type: "string",
          minLength: 1,
          maxLength: 255,
        },
        description: "Search query string",
      },
      sort: {
        name: "sort",
        in: "query",
        required: false,
        schema: {
          type: "string",
          enum: ["createdAt", "-createdAt", "updatedAt", "-updatedAt", "name", "-name"],
        },
        description: "Sort field and direction (prefix with - for descending)",
      },
    },
    responses: {
      Success: {
        description: "Successful operation",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: {
                  type: "boolean",
                  example: true,
                },
                data: {
                  type: "object",
                  description: "Response data",
                },
                message: {
                  type: "string",
                  description: "Success message",
                },
                timestamp: {
                  type: "string",
                  format: "date-time",
                },
              },
            },
          },
        },
      },
      PaginatedSuccess: {
        description: "Successful paginated operation",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                success: {
                  type: "boolean",
                  example: true,
                },
                data: {
                  type: "array",
                  items: {
                    type: "object",
                  },
                },
                pagination: {
                  type: "object",
                  properties: {
                    page: { type: "integer" },
                    limit: { type: "integer" },
                    total: { type: "integer" },
                    totalPages: { type: "integer" },
                    hasNext: { type: "boolean" },
                    hasPrev: { type: "boolean" },
                  },
                },
                timestamp: {
                  type: "string",
                  format: "date-time",
                },
              },
            },
          },
        },
      },
      BadRequest: {
        description: "Bad request - Invalid input",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Error",
            },
          },
        },
      },
      Unauthorized: {
        description: "Unauthorized - Authentication required",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Error",
            },
          },
        },
      },
      Forbidden: {
        description: "Forbidden - Insufficient permissions",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Error",
            },
          },
        },
      },
      NotFound: {
        description: "Resource not found",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Error",
            },
          },
        },
      },
      Conflict: {
        description: "Conflict - Resource already exists",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Error",
            },
          },
        },
      },
      ValidationError: {
        description: "Validation error - Invalid data format",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ValidationError",
            },
          },
        },
      },
      TooManyRequests: {
        description: "Too many requests - Rate limit exceeded",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Error",
            },
          },
        },
      },
      InternalServerError: {
        description: "Internal server error",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Error",
            },
          },
        },
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          success: {
            type: "boolean",
            example: false,
          },
          error: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "Error message",
              },
              code: {
                type: "string",
                description: "Error code",
              },
              statusCode: {
                type: "integer",
                description: "HTTP status code",
              },
              timestamp: {
                type: "string",
                format: "date-time",
              },
              path: {
                type: "string",
                description: "Request path",
              },
              method: {
                type: "string",
                description: "HTTP method",
              },
            },
            required: ["message", "code", "statusCode", "timestamp"],
          },
        },
        required: ["success", "error"],
      },
      ValidationError: {
        type: "object",
        properties: {
          success: {
            type: "boolean",
            example: false,
          },
          error: {
            type: "object",
            properties: {
              message: {
                type: "string",
                example: "Validation failed",
              },
              code: {
                type: "string",
                example: "VALIDATION_ERROR",
              },
              statusCode: {
                type: "integer",
                example: 422,
              },
              details: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    field: {
                      type: "string",
                      description: "Field name that failed validation",
                    },
                    message: {
                      type: "string",
                      description: "Validation error message",
                    },
                    code: {
                      type: "string",
                      description: "Validation error code",
                    },
                  },
                },
              },
              timestamp: {
                type: "string",
                format: "date-time",
              },
            },
            required: ["message", "code", "statusCode", "timestamp"],
          },
        },
        required: ["success", "error"],
      },
      User: {
        type: "object",
        properties: {
          id: {
            type: "string",
            format: "uuid",
            description: "Unique user identifier",
          },
          email: {
            type: "string",
            format: "email",
            description: "User email address",
          },
          firstName: {
            type: "string",
            description: "User first name",
          },
          lastName: {
            type: "string",
            description: "User last name",
          },
          avatar: {
            type: "string",
            format: "uri",
            description: "User avatar URL",
            nullable: true,
          },
          role: {
            type: "string",
            enum: ["SUPER_ADMIN", "ADMIN", "EDITOR", "AUTHOR", "VIEWER"],
            description: "User role",
          },
          status: {
            type: "string",
            enum: ["ACTIVE", "INACTIVE", "SUSPENDED", "PENDING"],
            description: "User status",
          },
          isActive: {
            type: "boolean",
            description: "Whether the user is active",
          },
          emailVerified: {
            type: "boolean",
            description: "Whether the user's email is verified",
          },
          lastLoginAt: {
            type: "string",
            format: "date-time",
            description: "Last login timestamp",
            nullable: true,
          },
          createdAt: {
            type: "string",
            format: "date-time",
            description: "User creation timestamp",
          },
          updatedAt: {
            type: "string",
            format: "date-time",
            description: "User last update timestamp",
          },
        },
        required: ["id", "email", "firstName", "lastName", "role", "status", "isActive", "emailVerified", "createdAt", "updatedAt"],
      },
      Tenant: {
        type: "object",
        properties: {
          id: {
            type: "string",
            format: "uuid",
            description: "Unique tenant identifier",
          },
          name: {
            type: "string",
            description: "Tenant name",
          },
          slug: {
            type: "string",
            description: "Tenant URL slug",
          },
          description: {
            type: "string",
            description: "Tenant description",
            nullable: true,
          },
          plan: {
            type: "string",
            enum: ["FREE", "BASIC", "PROFESSIONAL", "ENTERPRISE"],
            description: "Tenant subscription plan",
          },
          status: {
            type: "string",
            enum: ["ACTIVE", "SUSPENDED", "PENDING", "ARCHIVED"],
            description: "Tenant status",
          },
          customDomain: {
            type: "string",
            description: "Custom domain for the tenant",
            nullable: true,
          },
          createdAt: {
            type: "string",
            format: "date-time",
            description: "Tenant creation timestamp",
          },
          updatedAt: {
            type: "string",
            format: "date-time",
            description: "Tenant last update timestamp",
          },
        },
        required: ["id", "name", "slug", "plan", "status", "createdAt", "updatedAt"],
      },
      ContentType: {
        type: "object",
        properties: {
          id: {
            type: "string",
            format: "uuid",
            description: "Unique content type identifier",
          },
          name: {
            type: "string",
            description: "Content type name",
          },
          displayName: {
            type: "string",
            description: "Human-readable display name",
          },
          description: {
            type: "string",
            description: "Content type description",
            nullable: true,
          },
          isSystem: {
            type: "boolean",
            description: "Whether this is a system content type",
          },
          fields: {
            type: "array",
            description: "Dynamic field definitions",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string" },
                required: { type: "boolean" },
                validation: { type: "object" },
              },
            },
          },
          createdAt: {
            type: "string",
            format: "date-time",
            description: "Content type creation timestamp",
          },
          updatedAt: {
            type: "string",
            format: "date-time",
            description: "Content type last update timestamp",
          },
        },
        required: ["id", "name", "displayName", "isSystem", "fields", "createdAt", "updatedAt"],
      },
      Content: {
        type: "object",
        properties: {
          id: {
            type: "string",
            format: "uuid",
            description: "Unique content identifier",
          },
          data: {
            type: "object",
            description: "Dynamic content data",
          },
          status: {
            type: "string",
            enum: ["DRAFT", "PUBLISHED", "ARCHIVED"],
            description: "Content status",
          },
          locale: {
            type: "string",
            description: "Content locale",
            default: "en",
          },
          slug: {
            type: "string",
            description: "Content URL slug",
            nullable: true,
          },
          publishedAt: {
            type: "string",
            format: "date-time",
            description: "Content publication timestamp",
            nullable: true,
          },
          contentTypeId: {
            type: "string",
            format: "uuid",
            description: "Associated content type ID",
          },
          createdAt: {
            type: "string",
            format: "date-time",
            description: "Content creation timestamp",
          },
          updatedAt: {
            type: "string",
            format: "date-time",
            description: "Content last update timestamp",
          },
        },
        required: ["id", "data", "status", "locale", "contentTypeId", "createdAt", "updatedAt"],
      },
      Media: {
        type: "object",
        properties: {
          id: {
            type: "string",
            format: "uuid",
            description: "Unique media identifier",
          },
          filename: {
            type: "string",
            description: "File name",
          },
          originalName: {
            type: "string",
            description: "Original file name",
          },
          path: {
            type: "string",
            description: "File path",
          },
          url: {
            type: "string",
            format: "uri",
            description: "File URL",
          },
          type: {
            type: "string",
            enum: ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT", "OTHER"],
            description: "Media type",
          },
          metadata: {
            type: "object",
            description: "File metadata (size, dimensions, etc.)",
          },
          alt: {
            type: "string",
            description: "Alternative text",
            nullable: true,
          },
          caption: {
            type: "string",
            description: "Media caption",
            nullable: true,
          },
          tags: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Media tags",
          },
          createdAt: {
            type: "string",
            format: "date-time",
            description: "Media creation timestamp",
          },
          updatedAt: {
            type: "string",
            format: "date-time",
            description: "Media last update timestamp",
          },
        },
        required: ["id", "filename", "originalName", "path", "url", "type", "metadata", "tags", "createdAt", "updatedAt"],
      },
    },
  },
  security: [
    {
      bearerAuth: [],
    },
  ],
  tags: [
    {
      name: "Authentication",
      description: "User authentication and authorization endpoints",
    },
    {
      name: "Users",
      description: "User management endpoints",
    },
    {
      name: "Tenants",
      description: "Multi-tenant management endpoints",
    },
    {
      name: "Content Types",
      description: "Dynamic content type management",
    },
    {
      name: "Content",
      description: "Content management endpoints",
    },
    {
      name: "Media",
      description: "File and media management",
    },
    {
      name: "Workflows",
      description: "Content workflow management",
    },
    {
      name: "Webhooks",
      description: "Webhook management and delivery",
    },
    {
      name: "API Keys",
      description: "API key management for server-to-server authentication",
    },
    {
      name: "System",
      description: "System health and monitoring endpoints",
    },
  ],
}

// =============================================================================
// SWAGGER OPTIONS
// =============================================================================

/**
 * Options for swagger-jsdoc
 */
const swaggerOptions = {
  definition: swaggerDefinition,
  apis: [
    "./src/routes/**/*.ts",
    "./src/controllers/**/*.ts",
    "./src/middleware/**/*.ts",
    "./src/validations/**/*.ts",
    "./src/types/**/*.ts",
  ],
}

// =============================================================================
// SWAGGER SETUP FUNCTIONS
// =============================================================================

/**
 * Initialize swagger specification
 */
const initializeSwaggerSpec = () => {
  try {
    return swaggerJsdoc(swaggerOptions)
  } catch (error) {
    Logger.error("Failed to initialize Swagger specification", { error: error.message })
    throw error
  }
}

/**
 * Setup Swagger middleware with enhanced configuration
 */
export const setupSwagger = (app: Express): void => {
  try {
    const swaggerSpec = initializeSwaggerSpec()

    // Custom CSS for better styling
    const customCss = `
      .swagger-ui .topbar { display: none; }
      .swagger-ui .info { margin: 20px 0; }
      .swagger-ui .info .title { color: #3b4151; }
      .swagger-ui .scheme-container { background: #fafafa; padding: 15px; margin: 20px 0; }
      .swagger-ui .btn.authorize { background-color: #49cc90; border-color: #49cc90; }
      .swagger-ui .btn.authorize:hover { background-color: #3ea175; border-color: #3ea175; }
    `

    // Swagger UI options
    const swaggerUiOptions = {
      customCss,
      customSiteTitle: "CMS API Documentation",
      customfavIcon: "/favicon.ico",
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: "none",
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        tryItOutEnabled: true,
      },
    }

    // Serve Swagger UI
    app.use("/api-docs", swaggerUi.serve)
    app.get("/api-docs", swaggerUi.setup(swaggerSpec, swaggerUiOptions))

    // Serve Swagger spec as JSON
    app.get("/api-docs.json", (req, res) => {
      res.setHeader("Content-Type", "application/json")
      res.json(swaggerSpec)
    })

    // Serve OpenAPI spec (alias for compatibility)
    app.get("/openapi.json", (req, res) => {
      res.setHeader("Content-Type", "application/json")
      res.json(swaggerSpec)
    })

    // Health check for documentation
    app.get("/api-docs/health", (req, res) => {
      res.json({
        success: true,
        message: "API documentation is healthy",
        timestamp: new Date().toISOString(),
        version: swaggerSpec.info.version,
      })
    })

    Logger.info("Swagger documentation setup completed", {
      endpoint: "/api-docs",
      specEndpoint: "/api-docs.json",
      version: swaggerSpec.info.version,
    })
  } catch (error) {
    Logger.error("Failed to setup Swagger documentation", { error: error.message })
    throw error
  }
}

/**
 * Generate API documentation for a specific route
 */
export const generateRouteDoc = (
  method: string,
  path: string,
  summary: string,
  description: string,
  tags: string[],
  parameters?: any[],
  requestBody?: any,
  responses?: any
) => {
  return {
    [method.toLowerCase()]: {
      summary,
      description,
      tags,
      parameters: parameters || [],
      requestBody,
      responses: responses || {
        200: { $ref: "#/components/responses/Success" },
        400: { $ref: "#/components/responses/BadRequest" },
        401: { $ref: "#/components/responses/Unauthorized" },
        403: { $ref: "#/components/responses/Forbidden" },
        404: { $ref: "#/components/responses/NotFound" },
        500: { $ref: "#/components/responses/InternalServerError" },
      },
      security: [{ bearerAuth: [] }],
    },
  }
}

/**
 * Generate schema definition
 */
export const generateSchema = (name: string, properties: any, required?: string[]) => {
  return {
    [name]: {
      type: "object",
      properties,
      required: required || [],
    },
  }
}

/**
 * Validate Swagger specification
 */
export const validateSwaggerSpec = (): boolean => {
  try {
    const spec = initializeSwaggerSpec()
    
    // Basic validation checks
    if (!spec.info || !spec.info.title || !spec.info.version) {
      throw new Error("Invalid Swagger specification: missing required info fields")
    }

    if (!spec.paths || Object.keys(spec.paths).length === 0) {
      Logger.warn("Swagger specification has no paths defined")
    }

    Logger.info("Swagger specification validation passed")
    return true
  } catch (error) {
    Logger.error("Swagger specification validation failed", { error: error.message })
    return false
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  setupSwagger,
  generateRouteDoc,
  generateSchema,
  validateSwaggerSpec,
  swaggerDefinition,
  swaggerOptions,
}
