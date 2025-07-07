import { EventEmitter } from "events"
import { logger } from "../utils/logger"
import { ApiError } from "../utils/errors"
import axios, { AxiosRequestConfig, AxiosResponse } from "axios"
import { cacheService } from "./cache.service"

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

          // Prepare response headers - convert to string record
          const responseHeaders: Record<string, string> = {}
          Object.entries(response.headers).forEach(([key, value]) => {
            if (value !== undefined) {
              responseHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value)
            }
          })
          if (route.config.transformation?.responseHeaders) {
            Object.assign(responseHeaders, route.config.transformation.responseHeaders)
          }

          // Calculate response size
          const responseSize = JSON.stringify(responseData).length

          return {
            status: response.status,
            headers: responseHeaders,
            body: responseData,
            duration: 0, // Will be set by caller
            size: responseSize,
            transformed: !!route.config.transformation?.response,
          }
        } catch (error) {
          lastError = error
          if (attempt === maxRetries - 1) {
            throw error
          }
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
        }
      }

      throw lastError
    } catch (error) {
      logger.error(`Proxy route error for ${route.id}:`, error)
      throw ApiError.internal("Proxy request failed")
    }
  }

  /**
   * Check rate limiting
   */
  private async checkRateLimit(context: RequestContext, route: Route): Promise<void> {
    const { limit, window } = route.config.rateLimit!
    const identifier = context.user?.id || context.headers['x-forwarded-for'] || 'anonymous'
    const key = `${route.id}:${identifier}`
    
    const now = Date.now()
    let rateLimitData = this.rateLimiters.get(key)

    if (!rateLimitData || now > rateLimitData.resetTime) {
      rateLimitData = {
        requests: 1,
        resetTime: now + window,
      }
      this.rateLimiters.set(key, rateLimitData)
      return
    }

    if (rateLimitData.requests >= limit) {
      throw ApiError.tooManyRequests(`Rate limit exceeded. Limit: ${limit} requests per ${window}ms`)
    }

    rateLimitData.requests++
    this.rateLimiters.set(key, rateLimitData)
  }

  /**
   * Check circuit breaker
   */
  private checkCircuitBreaker(route: Route): void {
    const { threshold, timeout } = route.config.circuitBreaker!
    const circuitBreaker = this.circuitBreakers.get(route.id)

    if (!circuitBreaker) {
      this.circuitBreakers.set(route.id, {
        failures: 0,
        lastFailureTime: 0,
        state: "closed",
      })
      return
    }

    const now = Date.now()

    switch (circuitBreaker.state) {
      case "closed":
        // Circuit is closed, allow requests
        return
      case "open":
        // Check if we should transition to half-open
        if (now - circuitBreaker.lastFailureTime > timeout) {
          circuitBreaker.state = "half-open"
          return
        }
        throw ApiError.serviceUnavailable("Circuit breaker is open")
      case "half-open":
        // Allow one request to test the service
        return
    }
  }

  /**
   * Get cached response
   */
  private async getCachedResponse(context: RequestContext, route: Route): Promise<ResponseContext | null> {
    try {
      const cacheKey = this.generateCacheKey(context, route)
      const cached = await cacheService.get<ResponseContext>(cacheKey, context.tenant?.id)
      
      if (cached) {
        logger.debug(`Cache hit for route ${route.id}`, { cacheKey })
        return cached
      }

      return null
    } catch (error) {
      logger.error(`Cache get error for route ${route.id}:`, error)
      return null
    }
  }

  /**
   * Handle redirect route
   */
  private handleRedirectRoute(context: RequestContext, route: Route): ResponseContext {
    const redirectUrl = route.target
    
    // Add query parameters to redirect URL if needed
    const url = new URL(redirectUrl)
    Object.entries(context.query).forEach(([key, value]) => {
      url.searchParams.set(key, String(value))
    })

    return {
      status: 302,
      headers: {
        'Location': url.toString(),
        'Cache-Control': 'no-cache',
      },
      body: { redirect: url.toString() },
      duration: 0,
      size: JSON.stringify({ redirect: url.toString() }).length,
    }
  }

  /**
   * Handle function route
   */
  private async handleFunctionRoute(context: RequestContext, route: Route): Promise<ResponseContext> {
    try {
      // This is a placeholder for serverless function execution
      // In a real implementation, this would invoke the actual function
      const functionResult = {
        success: true,
        data: {
          message: `Function executed for route ${route.id}`,
          input: {
            path: context.path,
            method: context.method,
            query: context.query,
            body: context.body,
          },
          timestamp: new Date().toISOString(),
        },
      }

      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: functionResult,
        duration: 0,
        size: JSON.stringify(functionResult).length,
      }
    } catch (error) {
      logger.error(`Function route error for ${route.id}:`, error)
      throw ApiError.internal("Function execution failed")
    }
  }

  /**
   * Handle mock route
   */
  private handleMockRoute(context: RequestContext, route: Route): ResponseContext {
    const mockResponse = route.config.metadata?.mockResponse || {
      message: `Mock response for ${route.name}`,
      path: context.path,
      method: context.method,
      timestamp: new Date().toISOString(),
    }

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Mock-Response': 'true',
      },
      body: mockResponse,
      duration: 0,
      size: JSON.stringify(mockResponse).length,
    }
  }

  /**
   * Handle webhook route
   */
  private async handleWebhookRoute(context: RequestContext, route: Route): Promise<ResponseContext> {
    try {
      // Validate webhook signature if configured
      const webhookSecret = route.config.metadata?.webhookSecret
      if (webhookSecret) {
        const signature = context.headers['x-webhook-signature']
        if (!signature || !this.validateWebhookSignature(context.body, signature, webhookSecret)) {
          throw ApiError.unauthorized("Invalid webhook signature")
        }
      }

      // Process webhook payload
      const webhookResult = {
        success: true,
        message: "Webhook processed successfully",
        payload: context.body,
        timestamp: new Date().toISOString(),
      }

      // Emit webhook event for further processing
      this.emit("webhook:received", {
        route: route.id,
        payload: context.body,
        context,
      })

      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: webhookResult,
        duration: 0,
        size: JSON.stringify(webhookResult).length,
      }
    } catch (error) {
      logger.error(`Webhook route error for ${route.id}:`, error)
      throw error
    }
  }

  /**
   * Cache response
   */
  private async cacheResponse(context: RequestContext, route: Route, response: ResponseContext): Promise<void> {
    try {
      const { ttl } = route.config.caching!
      const cacheKey = this.generateCacheKey(context, route)
      
      await cacheService.set(cacheKey, response, { ttl, namespace: context.tenant?.id })
      logger.debug(`Response cached for route ${route.id}`, { cacheKey, ttl })
    } catch (error) {
      logger.error(`Cache set error for route ${route.id}:`, error)
    }
  }

  /**
   * Update metrics
   */
  private updateMetrics(route: Route, response: ResponseContext, duration: number): void {
    try {
      // Update general metrics
      const requests = this.metrics.get("requests") || 0
      this.metrics.set("requests", requests + 1)

      const latencyArray = this.metrics.get("latency") || []
      latencyArray.push(duration)
      if (latencyArray.length > 1000) {
        latencyArray.shift() // Keep only last 1000 entries
      }
      this.metrics.set("latency", latencyArray)

      // Update route-specific metrics
      const routeKey = `route:${route.id}`
      const routeMetrics = this.metrics.get(routeKey) || {
        requests: 0,
        errors: 0,
        totalDuration: 0,
        avgDuration: 0,
      }

      routeMetrics.requests++
      routeMetrics.totalDuration += duration
      routeMetrics.avgDuration = routeMetrics.totalDuration / routeMetrics.requests

      if (response.status >= 400) {
        routeMetrics.errors++
      }

      this.metrics.set(routeKey, routeMetrics)

      // Emit metrics event
      this.emit("metrics:updated", {
        route: route.id,
        response: response.status,
        duration,
        timestamp: new Date(),
      })
    } catch (error) {
      logger.error("Error updating metrics:", error)
    }
  }

  /**
   * Update circuit breaker on success
   */
  private updateCircuitBreakerSuccess(route: Route): void {
    const circuitBreaker = this.circuitBreakers.get(route.id)
    if (!circuitBreaker) return

    if (circuitBreaker.state === "half-open") {
      // Reset circuit breaker to closed state
      circuitBreaker.state = "closed"
      circuitBreaker.failures = 0
      circuitBreaker.lastFailureTime = 0
    }
  }

  /**
   * Update circuit breaker on failure
   */
  private updateCircuitBreakerFailure(route: Route): void {
    const { threshold } = route.config.circuitBreaker!
    let circuitBreaker = this.circuitBreakers.get(route.id)

    if (!circuitBreaker) {
      circuitBreaker = {
        failures: 0,
        lastFailureTime: 0,
        state: "closed",
      }
      this.circuitBreakers.set(route.id, circuitBreaker)
    }

    circuitBreaker.failures++
    circuitBreaker.lastFailureTime = Date.now()

    if (circuitBreaker.failures >= threshold) {
      circuitBreaker.state = "open"
      logger.warn(`Circuit breaker opened for route ${route.id}`, {
        failures: circuitBreaker.failures,
        threshold,
      })
    }
  }

  /**
   * Update error metrics
   */
  private updateErrorMetrics(route: Route | undefined, error: any, duration: number): void {
    try {
      // Update general error metrics
      const errors = this.metrics.get("errors") || 0
      this.metrics.set("errors", errors + 1)

      // Update route-specific error metrics
      if (route) {
        const routeKey = `route:${route.id}`
        const routeMetrics = this.metrics.get(routeKey) || {
          requests: 0,
          errors: 0,
          totalDuration: 0,
          avgDuration: 0,
        }

        routeMetrics.errors++
        this.metrics.set(routeKey, routeMetrics)
      }

      // Emit error event
      this.emit("error:occurred", {
        route: route?.id,
        error: error.message,
        duration,
        timestamp: new Date(),
      })
    } catch (err) {
      logger.error("Error updating error metrics:", err)
    }
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(context: RequestContext, route: Route): string {
    const varyBy = route.config.caching?.varyBy || []
    const keyParts = [
      `route:${route.id}`,
      `path:${context.path}`,
      `method:${context.method}`,
    ]

    // Add vary-by headers to cache key
    varyBy.forEach(header => {
      const value = context.headers[header.toLowerCase()]
      if (value) {
        keyParts.push(`${header}:${value}`)
      }
    })

    // Add query parameters to cache key
    const queryString = new URLSearchParams(context.query).toString()
    if (queryString) {
      keyParts.push(`query:${queryString}`)
    }

    return keyParts.join("|")
  }

  /**
   * Validate webhook signature
   */
  private validateWebhookSignature(payload: any, signature: string, secret: string): boolean {
    try {
      // This is a basic implementation - in production, use proper HMAC validation
      const crypto = require('crypto')
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex')
      
      return signature === `sha256=${expectedSignature}`
    } catch (error) {
      logger.error("Error validating webhook signature:", error)
      return false
    }
  }

  /**
   * Get service health status
   */
  public getHealthStatus(): {
    status: string
    routes: number
    activeRoutes: number
    metrics: any
  } {
    const activeRoutes = Array.from(this.routes.values()).filter(
      route => route.status === RouteStatus.ACTIVE
    ).length

    return {
      status: "healthy",
      routes: this.routes.size,
      activeRoutes,
      metrics: Object.fromEntries(this.metrics),
    }
  }

  /**
   * Get route by ID
   */
  public getRoute(id: string): Route | undefined {
    return this.routes.get(id)
  }

  /**
   * Get all routes
   */
  public getAllRoutes(): Route[] {
    return Array.from(this.routes.values())
  }

  /**
   * Add or update route
   */
  public addRoute(route: Route): void {
    this.addRouteToCache(route)
    logger.info(`Route ${route.id} added/updated`)
  }

  /**
   * Remove route
   */
  public removeRoute(id: string): boolean {
    const route = this.routes.get(id)
    if (!route) return false

    this.routes.delete(id)
    
    // Remove from pattern routes
    const pattern = this.getRoutePattern(route.path)
    const patternRoutes = this.routePatterns.get(pattern)
    if (patternRoutes) {
      const index = patternRoutes.findIndex(r => r.id === id)
      if (index !== -1) {
        patternRoutes.splice(index, 1)
        if (patternRoutes.length === 0) {
          this.routePatterns.delete(pattern)
        }
      }
    }

    // Clean up related data
    this.circuitBreakers.delete(id)
    this.healthChecks.delete(id)
    this.metrics.delete(`route:${id}`)

    logger.info(`Route ${id} removed`)
    return true
  }
}
