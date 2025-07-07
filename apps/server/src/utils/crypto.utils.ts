// =============================================================================
// CRYPTO UTILITIES
// =============================================================================

import * as crypto from 'crypto'
import * as bcrypt from 'bcryptjs'

export class CryptoUtils {
  /**
   * Hash a password using bcrypt
   */
  static async hashPassword(password: string): Promise<string> {
    const saltRounds = 12
    return bcrypt.hash(password, saltRounds)
  }

  /**
   * Verify a password against a hash
   */
  static async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash)
  }

  /**
   * Generate a secure API key
   */
  static generateApiKey(): string {
    return `ak_${crypto.randomBytes(32).toString('hex')}`
  }

  /**
   * Hash API key for secure storage
   */
  static async hashApiKey(key: string): Promise<string> {
    const saltRounds = 12
    return bcrypt.hash(key, saltRounds)
  }

  /**
   * Verify API key against hash
   */
  static async verifyApiKey(key: string, hash: string): Promise<boolean> {
    return bcrypt.compare(key, hash)
  }

  /**
   * Generate secure random string
   */
  static generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex')
  }

  /**
   * Create HMAC signature
   */
  static createHmacSignature(data: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(data).digest('hex')
  }

  /**
   * Verify HMAC signature
   */
  static verifyHmacSignature(data: string, signature: string, secret: string): boolean {
    const expectedSignature = this.createHmacSignature(data, secret)
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  }

  /**
   * Generate a random token
   */
  static generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex')
  }

  /**
   * Generate a UUID
   */
  static generateUUID(): string {
    return crypto.randomUUID()
  }

  /**
   * Hash data using SHA-256
   */
  static sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex')
  }
}

// Export convenience functions for backward compatibility
export const hashPassword = CryptoUtils.hashPassword
export const comparePassword = CryptoUtils.comparePassword
