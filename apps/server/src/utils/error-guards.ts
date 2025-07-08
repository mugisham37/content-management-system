/**
 * Error handling utilities for TypeScript strict mode
 */

export function isError(error: unknown): error is Error {
  return error instanceof Error
}

export function getErrorMessage(error: unknown): string {
  if (isError(error)) return error.message
  if (typeof error === 'string') return error
  return 'An unknown error occurred'
}

export function getErrorStack(error: unknown): string | undefined {
  if (isError(error)) return error.stack
  return undefined
}

export interface ErrorInfo {
  message: string
  stack?: string
}

export function extractErrorInfo(error: unknown): ErrorInfo {
  return {
    message: getErrorMessage(error),
    stack: getErrorStack(error)
  }
}
