// =============================================================================
// CRYPTO UTILITIES
// =============================================================================

import * as crypto from 'crypto'
import * as bcrypt from 'bcryptjs'

export class CryptoUtils {
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
}
