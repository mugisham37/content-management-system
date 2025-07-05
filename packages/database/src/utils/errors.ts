// =============================================================================
// DATABASE ERROR UTILITIES
// =============================================================================
// Centralized error handling for database operations

export class DatabaseError extends Error {
  constructor(
    message: string,
    public code?: string,
    public originalError?: unknown
  ) {
    super(message)
    this.name = 'DatabaseError'
  }
}

export class NotFoundError extends DatabaseError {
  constructor(resource: string, identifier?: string) {
    super(
      identifier 
        ? `${resource} not found with identifier: ${identifier}`
        : `${resource} not found`
    )
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends DatabaseError {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class ValidationError extends DatabaseError {
  constructor(message: string, public field?: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
