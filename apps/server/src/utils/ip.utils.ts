// =============================================================================
// IP ADDRESS UTILITIES
// =============================================================================

import { isIP } from 'net'

export class IpUtils {
  /**
   * Check if an IP address is within a CIDR range
   */
  static isIpInCidr(ip: string, cidr: string): boolean {
    try {
      // Validate IP address
      if (!isIP(ip)) {
        return false
      }

      // Handle single IP (no CIDR notation)
      if (!cidr.includes('/')) {
        return ip === cidr
      }

      const [network, prefixLength] = cidr.split('/')
      const prefix = parseInt(prefixLength, 10)

      // Validate network address
      if (!isIP(network)) {
        return false
      }

      // Check if both are IPv4
      if (isIP(ip) === 4 && isIP(network) === 4) {
        return this.isIPv4InCidr(ip, network, prefix)
      }

      // Check if both are IPv6
      if (isIP(ip) === 6 && isIP(network) === 6) {
        return this.isIPv6InCidr(ip, network, prefix)
      }

      return false
    } catch (error) {
      return false
    }
  }

  /**
   * Check if IPv4 address is in CIDR range
   */
  private static isIPv4InCidr(ip: string, network: string, prefixLength: number): boolean {
    if (prefixLength < 0 || prefixLength > 32) {
      return false
    }

    const ipInt = this.ipv4ToInt(ip)
    const networkInt = this.ipv4ToInt(network)
    const mask = (0xffffffff << (32 - prefixLength)) >>> 0

    return (ipInt & mask) === (networkInt & mask)
  }

  /**
   * Check if IPv6 address is in CIDR range
   */
  private static isIPv6InCidr(ip: string, network: string, prefixLength: number): boolean {
    if (prefixLength < 0 || prefixLength > 128) {
      return false
    }

    const ipBytes = this.ipv6ToBytes(ip)
    const networkBytes = this.ipv6ToBytes(network)

    const fullBytes = Math.floor(prefixLength / 8)
    const remainingBits = prefixLength % 8

    // Check full bytes
    for (let i = 0; i < fullBytes; i++) {
      if (ipBytes[i] !== networkBytes[i]) {
        return false
      }
    }

    // Check remaining bits
    if (remainingBits > 0) {
      const mask = (0xff << (8 - remainingBits)) & 0xff
      if ((ipBytes[fullBytes] & mask) !== (networkBytes[fullBytes] & mask)) {
        return false
      }
    }

    return true
  }

  /**
   * Convert IPv4 address to integer
   */
  private static ipv4ToInt(ip: string): number {
    const parts = ip.split('.').map(part => parseInt(part, 10))
    return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
  }

  /**
   * Convert IPv6 address to byte array
   */
  private static ipv6ToBytes(ip: string): number[] {
    // Expand IPv6 address to full form
    const expanded = this.expandIPv6(ip)
    const parts = expanded.split(':')
    const bytes: number[] = []

    for (const part of parts) {
      const value = parseInt(part, 16)
      bytes.push((value >> 8) & 0xff)
      bytes.push(value & 0xff)
    }

    return bytes
  }

  /**
   * Expand IPv6 address to full form
   */
  private static expandIPv6(ip: string): string {
    // Handle :: notation
    if (ip.includes('::')) {
      const parts = ip.split('::')
      const left = parts[0] ? parts[0].split(':') : []
      const right = parts[1] ? parts[1].split(':') : []
      const missing = 8 - left.length - right.length
      const middle = Array(missing).fill('0000')
      const expanded = [...left, ...middle, ...right]
      return expanded.map(part => part.padStart(4, '0')).join(':')
    }

    // Already expanded or no :: notation
    return ip.split(':').map(part => part.padStart(4, '0')).join(':')
  }

  /**
   * Validate CIDR notation
   */
  static isValidCidr(cidr: string): boolean {
    try {
      if (!cidr.includes('/')) {
        return isIP(cidr) !== 0
      }

      const [network, prefixLength] = cidr.split('/')
      const prefix = parseInt(prefixLength, 10)

      if (!isIP(network)) {
        return false
      }

      if (isIP(network) === 4) {
        return prefix >= 0 && prefix <= 32
      }

      if (isIP(network) === 6) {
        return prefix >= 0 && prefix <= 128
      }

      return false
    } catch (error) {
      return false
    }
  }

  /**
   * Get IP version (4 or 6)
   */
  static getIpVersion(ip: string): 4 | 6 | null {
    const version = isIP(ip)
    return version === 4 ? 4 : version === 6 ? 6 : null
  }

  /**
   * Normalize IP address
   */
  static normalizeIp(ip: string): string {
    const version = isIP(ip)
    if (version === 6) {
      return this.expandIPv6(ip).toLowerCase()
    }
    return ip
  }

  /**
   * Check if IP is private/internal
   */
  static isPrivateIp(ip: string): boolean {
    if (isIP(ip) === 4) {
      return this.isPrivateIPv4(ip)
    }
    if (isIP(ip) === 6) {
      return this.isPrivateIPv6(ip)
    }
    return false
  }

  /**
   * Check if IPv4 is private
   */
  private static isPrivateIPv4(ip: string): boolean {
    const privateRanges = [
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '127.0.0.0/8',
      '169.254.0.0/16'
    ]

    return privateRanges.some(range => this.isIpInCidr(ip, range))
  }

  /**
   * Check if IPv6 is private
   */
  private static isPrivateIPv6(ip: string): boolean {
    const privateRanges = [
      'fc00::/7',  // Unique local addresses
      'fe80::/10', // Link-local addresses
      '::1/128'    // Loopback
    ]

    return privateRanges.some(range => this.isIpInCidr(ip, range))
  }
}
