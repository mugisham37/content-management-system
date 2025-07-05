import { EventEmitter } from "events"
import { logger } from "../utils/logger"
import { ApiError } from "../utils/errors"
import axios, { AxiosRequestConfig, AxiosResponse } from "axios"
import { createHmac } from "crypto"
import { VM } from "vm2"

// Define route types
export enum RouteType {
  PROXY = "proxy",
  REDIRECT = "redirect",
  FUNCTION = "function",
  MOCK = "mock",
  WEBHOOK = "webhook",
}

// Define route methods
export type ApiGatewayRouteMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD" | "ALL"

// Define route status
export enum RouteStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  MAINTENANCE = "maintenance",
  DEPRECATED = "deprecated",
}

// Define route interface
export interface Route {
  id: string
  tenantId?: string
  name: string
  description?: string
  type: RouteType
  methods: ApiGatewayRouteMethod[]
  path: string
  target: string
  status: RouteStatus
  isPublic: boolean
  priority: number
  config: {
    headers?: Record<string, string>
    queryParams?: Record<string, string>
    timeout?: number
    retries?: number
    circuitBreaker?: {
      enabled: boolean
      threshold: number
      timeout: number
      resetTimeout: number
    }
    caching?: {
      enabled: boolean
      ttl: number
      varyBy?: string[]
      excludeHeaders?: string[]
    }
    rateLimit?: {
      limit: number
      window: number
      skipSuccessfulRequests?: boolean
      skipFailedRequests?: boolean
    }
    authentication?: {
      required: boolean
      type: "bearer" | "basic" | "apikey" | "oauth2"
      roles?: string[]
      scopes?: string[]
    }
    cors?: {
      enabled: boolean
      origins?: string[]
      methods?: string[]
      headers?: string[]
      credentials?: boolean
    }
    compression?: {
      enabled: boolean
      threshold: number
      algorithms: string[]
    }
    transformation?: {
      request?: string
      response?: string
      requestHeaders?: Record<string, string>
      responseHeaders?: Record<string, string>
    }
    validation?: {
      requestSchema?: any
      responseSchema?: any
      validateHeaders?: boolean
      validateQuery?: boolean
      validateBody?: boolean
    }
    monitoring?: {
      enabled: boolean
      metrics: string[]
      alerts?: {
        errorRate?: number
        responseTime?: number
        availability?: number
      }
    }
    loadBalancing?: {
      strategy: "round-robin" | "weighted" | "least-connections" | "ip-hash"
      targets: Array<{
        url: string
        weight?: number
        health?: boolean
      }>
      healthCheck?: {
        enabled: boolean
        path: string
        interval: number
        timeout: number
        retries: number
      }
    }
    plugins?: string[]
    metadata?: Record<string, any>
  }
  createdAt: Date
  updatedAt: Date
  createdBy?: string
  updatedBy?: string
}

// Define request context
export interface RequestContext {
  id: string
  method: string
  path: string
  headers: Record<string, string>
  query: Record<string, any>
  body: any
  user?: any
  tenant?: any
  startTime: number
  route?: Route
  metadata: Record<string, any>
}

// Define response context
export interface ResponseContext {
  status: number
  headers: Record<string, string>
  body: any
  cached?: boolean
  transformed?: boolean
  duration: number
  size: number
}

// Circuit breaker state
interface CircuitBreakerState {
  failures: number
  lastFailureTime: number
  state: "closed" | "open" | "half-open"
}

// Rate limiter state
interface RateLimiterState {
  requests: number
  resetTime: number
}

// API Gateway service
export class ApiGatewayService extends EventEmitter {
  private routes: Map<string, Route> = new Map()
  private routePatterns: Map<string, Route[]> = new Map()
  private transformationCache: Map<string, Function> = new Map()
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map()
  private rateLimiters: Map<string, RateLimiterState> = new Map()
  private healthChecks: Map<string, boolean> = new Map()
  private metrics: Map<string, any> = new Map()
  private cacheService: any // Will be injected when available

  constructor() {
    super()
    this.setMaxListeners(100)
    this.initializeHealthChecks()
    this.initializeMetrics()
  }

  /**
   * Initialize the API Gateway service
   */
  public async initialize(): Promise<void> {
    try {
      logger.info("Initializing API gateway service...")

      // Load routes from database
      await this.loadRoutes()

      // Start health check monitoring
      this.startHealthCheckMonitoring()

      // Start metrics collection
      this.startMetricsCollection()

      logger.info("API gateway service initialized")
    } catch (error) {
      logger.error("Error initializing API gateway service:", error)
      throw error
    }
  }

  /**
   * Load routes from database
   */
  private async loadRoutes(): Promise<void> {
    try {
      // Clear existing routes
      this.routes.clear()
      this.routePatterns.clear()
      this.transformationCache.clear()

      // In a real implementation, this would load from database
      // For now, we'll add some example routes
      const exampleRoutes: Route[] = [
        {
          id: "content-api",
          name: "Content API",
          description: "Proxy to content management API",
          type: RouteType.PROXY,
          methods: ["GET", "POST", "PUT", "DELETE"],
          path: "/api/content/*",
          target: "http://content-service:3001",
          status: RouteStatus.ACTIVE,
          isPublic: false,
          priority: 1,
          config: {
            timeout: 30000,
            retries: 3,
            authentication: {
              required: true,
              type: "bearer",
              roles: ["admin", "editor"],
            },
            caching: {
              enabled: true,
              ttl: 300,
              varyBy: ["authorization"],
            },
            rateLimit: {
              limit: 100,
              window: 60000,
            },
            monitoring: {
              enabled: true,
              metrics: ["requests", "errors", "latency"],
            },
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "media-api",
          name: "Media API",
          description: "Proxy to media service",
          type: RouteType.PROXY,
          methods: ["GET", "POST", "DELETE"],
          path: "/api/media/*",
          target: "http://media-service:3002",
          status: RouteStatus.ACTIVE,
          isPublic: true,
          priority: 2,
          config: {
            timeout: 60000,
            compression: {
              enabled: true,
              threshold: 1024,
              algorithms: ["gzip", "deflate"],
            },
            cors: {
              enabled: true,
              origins: ["*"],
              methods: ["GET", "POST"],
            },
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]

      // Add routes to cache
      for (const route of exampleRoutes) {
        this.addRouteToCache(route)
      }

      logger.info(`Loaded ${exampleRoutes.length} routes`)
    } catch (error) {
      logger.error("Error loading routes:", error)
      throw error
    }
  }

  /**
   * Add route to cache
   */
  private addRouteToCache(route: Route): void {
    // Add to direct routes
    this.routes.set(route.id, route)

    // Add to pattern routes
    const pattern = this.getRoutePattern(route.path)
    if (!this.routePatterns.has(pattern)) {
      this.routePatterns.set(pattern, [])
    }
    this.routePatterns.get(pattern)?.push(route)

    // Sort by priority (higher priority first)
    this.routePatterns.get(pattern)?.sort((a, b) => b.priority - a.priority)

    // Precompile transformations
    if (route.config.transformation) {
      if (route.config.transformation.request) {
        this.compileTransformation(route.id, "request", route.config.transformation.request)
      }
      if (route.config.transformation.response) {
        this.compileTransformation(route.id, "response", route.config.transformation.response)
      }
    }
  }

  /**
   * Get route pattern for matching
   */
  private getRoutePattern(path: string): string {
    return path.replace(/\/:[^/]+/g, "/*").replace(/\/\*/g, "/*")
  }

  /**
   * Compile transformation code
   */
  private compileTransformation(routeId: string, type: "request" | "response", code: string): Function {
    try {
      const cacheKey = `${routeId}:${type}`

      if (this.transformationCache.has(cacheKey)) {
        return this.transformationCache.get(cacheKey)!
      }

      // Simple function compilation (replace VM2 for now)
      const fn = new Function("data", `return (function(data) { ${code} })(data)`)
      this.transformationCache.set(cacheKey, fn)

      return fn
    } catch (error) {
      logger.error(`Error compiling ${type} transformation for route ${routeId}:`, error)
      throw error
    }
  }

  /**
   * Initialize health checks
   */
  private initializeHealthChecks(): void {
    // Initialize health check system
    logger.info("Initializing health checks")
  }

  /**
   * Initialize metrics collection
   */
  private initializeMetrics(): void {
    // Initialize metrics collection
    this.metrics.set("requests", 0)
    this.metrics.set("errors", 0)
    this.metrics.set("latency", [])
    logger.info("Initializing metrics collection")
  }

  /**
   * Start health check monitoring
   */
  private startHealthCheckMonitoring(): void {
    setInterval(() => {
      this.performHealthChecks()
    }, 30000) // Every 30 seconds
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    setInterval(() => {
      this.collectMetrics()
    }, 60000) // Every minute
  }

  /**
   * Perform health checks on all routes
   */
  private async performHealthChecks(): Promise<void> {
    for (const route of this.routes.values()) {
      if (route.config.loadBalancing?.healthCheck?.enabled) {
        await this.checkRouteHealth(route)
      }
    }
  }

  /**
   * Check health of a specific route
   */
  private async checkRouteHealth(route: Route): Promise<void> {
    try {
      const healthCheckPath = route.config.loadBalancing?.healthCheck?.path || "/health"
      const timeout = route.config.loadBalancing?.healthCheck?.timeout || 5000

      const response = await axios.get(`${route.target}${healthCheckPath}`, {
        timeout,
        validateStatus: () => true,
      })

      const isHealthy = response.status >= 200 && response.status < 300
      this.healthChecks.set(route.id, isHealthy)

      if (!isHealthy) {
        logger.warn(`Health check failed for route ${route.id}: ${response.status}`)
        this.emit("route:unhealthy", route)
      }
    } catch (error) {
      this.healthChecks.set(route.id, false)
      logger.error(`Health check error for route ${route.id}:`, error)
      this.emit("route:unhealthy", route)
    }
  }

  /**
   * Collect metrics
   */
  private collectMetrics(): void {
    // Emit metrics for monitoring systems
    this.emit("metrics:collected", {
      timestamp: new Date(),
      metrics: Object.fromEntries(this.metrics),
    })
  }

  /**
   * Find matching route for request
   */
  public findRoute(path: string, method: string, tenantId?: string): Route | null {
    try {
      // Find matching patterns
      for (const [pattern, routes] of this.routePatterns) {
        if (this.matchesPattern(path, pattern)) {
          for (const route of routes) {
            if (route.status !== RouteStatus.ACTIVE) continue
            if (!route.methods.includes("ALL") && !route.methods.includes(method as ApiGatewayRouteMethod)) continue
            if (route.tenantId && tenantId && route.tenantId !== tenantId) continue
            if (this.matchesPath(path, route.path)) {
              return route
            }
          }
        }
      }

      return null
    } catch (error) {
      logger.error("Error finding route:", error)
      return null
    }
  }

  /**
   * Check if path matches pattern
   */
  private matchesPattern(path: string, pattern: string): boolean {
    const pathParts = path.split("/")
    const patternParts = pattern.split("/")

    if (pathParts.length < patternParts.length) return false

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === "*") continue
      if (pathParts[i] !== patternParts[i]) return false
    }

    return true
  }

  /**
   * Check if path matches route path exactly
   */
  private matchesPath(path: string, routePath: string): boolean {
    const pathParts = path.split("/")
    const routeParts = routePath.split("/")

    if (routePath.endsWith("*")) {
      const baseRouteParts = routeParts.slice(0, -1)
      return pathParts.length >= baseRouteParts.length &&
             baseRouteParts.every((part, i) => part === pathParts[i] || part.startsWith(":"))
    }

    if (pathParts.length !== routeParts.length) return false

    return routeParts.every((part, i) => part === pathParts[i] || part.startsWith(":"))
  }

  /**
   * Extract path parameters
   */
  private extractPathParams(path: string, routePath: string): Record<string, string> {
    const params: Record<string, string> = {}
    const pathParts = path.split("/")
    const routeParts = routePath.split("/")

    for (let i = 0; i < routeParts.length && i < pathParts.length; i++) {
      if (routeParts[i].startsWith(":")) {
        const paramName = routeParts[i].substring(1)
        params[paramName] = pathParts[i]
      }
    }

    return params
  }

  /**
   * Handle API request
   */
  public async handleRequest(context: RequestContext): Promise<ResponseContext> {
    const startTime = Date.now()

    try {
      // Find matching route
      const route = this.findRoute(context.path, context.method, context.tenant?.id)
      if (!route) {
        throw ApiError.notFound("Route not found")
      }

      context.route = route

      // Check authentication
      if (route.config.authentication?.required && !context.user) {
        throw ApiError.unauthorized("Authentication required")
      }

      // Check authorization
      if (route.config.authentication?.roles && context.user) {
        const userRoles = Array.isArray(context.user.roles) ? context.user.roles : [context.user.role]
        const hasRequiredRole = route.config.authentication.roles.some(role => userRoles.includes(role))
        if (!hasRequiredRole) {
          throw ApiError.forbidden("Insufficient permissions")
        }
      }

      // Check rate limiting
      if (route.config.rateLimit) {
        await this.checkRateLimit(context, route)
      }

      // Check circuit breaker
      if (route.config.circuitBreaker?.enabled) {
        this.checkCircuitBreaker(route)
      }

      // Check cache
      if (route.config.caching?.enabled) {
        const cachedResponse = await this.getCachedResponse(context, route)
        if (cachedResponse) {
          return {
            ...cachedResponse,
            duration: Date.now() - startTime,
            cached: true,
          }
        }
      }

      // Handle based on route type
      let response: ResponseContext
      switch (route.type) {
        case RouteType.PROXY:
          response = await this.handleProxyRoute(context, route)
          break
        case RouteType.REDIRECT:
          response = this.handleRedirectRoute(context, route)
          break
        case RouteType.FUNCTION:
          response = await this.handleFunctionRoute(context, route)
          break
        case RouteType.MOCK:
          response = this.handleMockRoute(context, route)
          break
        case RouteType.WEBHOOK:
          response = await this.handleWebhookRoute(context, route)
          break
        default:
          throw ApiError.badRequest("Invalid route type")
      }

      // Cache response if enabled
      if (route.config.caching?.enabled && response.status < 400) {
        await this.cacheResponse(context, route, response)
      }

      // Update metrics
      this.updateMetrics(route, response, Date.now() - startTime)

      // Update circuit breaker on success
      if (route.config.circuitBreaker?.enabled) {
        this.updateCircuitBreakerSuccess(route)
      }

      response.duration = Date.now() - startTime
      return response

    } catch (error) {
      const duration = Date.now() - startTime

      // Update circuit breaker on failure
      if (context.route?.config.circuitBreaker?.enabled) {
        this.updateCircuitBreakerFailure(context.route)
      }

      // Update error metrics
      this.updateErrorMetrics(context.route, error, duration)

      throw error
    }
  }

  /**
   * Handle proxy route
   */
  private async handleProxyRoute(context: RequestContext, route: Route): Promise<ResponseContext> {
    try {
      // Extract path parameters
      const pathParams = this.extractPathParams(context.path, route.path)

      // Build target URL
      let targetUrl = route.target
      if (route.path.endsWith("*")) {
        const basePath = route.path.slice(0, -1)
        const remainingPath = context.path.substring(basePath.length - 1)
        targetUrl += remainingPath
      }

      // Replace path parameters
      for (const [key, value] of Object.entries(pathParams)) {
        targetUrl = targetUrl.replace(`:${key}`, value)
      }

      // Add query parameters
      const queryParams = new URLSearchParams()
      for (const [key, value] of Object.entries(context.query)) {
        queryParams.set(key, String(value))
      }
      if (route.config.queryParams) {
        for (const [key, value] of Object.entries(route.config.queryParams)) {
          queryParams.set(key, value)
        }
      }
      if (queryParams.toString()) {
        targetUrl += `?${queryParams.toString()}`
      }

      // Prepare headers
      const headers = { ...context.headers }
      if (route.config.headers) {
        Object.assign(headers, route.config.headers)
      }
      if (route.config.transformation?.requestHeaders) {
        Object.assign(headers, route.config.transformation.requestHeaders)
      }

      // Transform request body
      let body = context.body
      if (route.config.transformation?.request) {
        const transformFn = this.transformationCache.get(`${route.id}:request`)
        if (transformFn) {
          body = transformFn(body)
        }
      }

      // Make request with retries
      let lastError: any
      const maxRetries = route.config.retries || 1

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const config: AxiosRequestConfig = {
            method: context.method as any,
            url: targetUrl,
            headers,
            data: body,
            timeout: route.config.timeout || 30000,
            validateStatus: () => true,
          }

          const response = await axios(config)

          // Transform response
          let responseData = response.data
          if (route.config.transformation?.response) {
            const transformFn = this.transformationCache.get(`${route.id}:response`)
            if (transformFn) {
              responseData = transformFn(responseData)
            }
          }

          // Prepare response headers
          const responseHeaders = { ...response.headers }
          if
