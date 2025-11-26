// Password utilities - hash and verify without storing plaintext
import crypto from 'crypto';

/**
 * Hash a password using SHA-256
 * @param password - Plain text password
 * @returns Hashed password (hex string)
 */
export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Verify a password against a hash
 * @param password - Plain text password to verify
 * @param hash - Stored hash to compare against
 * @returns True if password matches
 */
export function verifyPassword(password: string, hash: string): boolean {
  const inputHash = hashPassword(password);
  return inputHash === hash;
}

/**
 * Validate password meets minimum requirements
 */
export function validatePassword(password: unknown): { valid: boolean; error?: string } {
  if (!password) {
    return { valid: true }; // Password is optional
  }

  if (typeof password !== 'string') {
    return { valid: false, error: 'Password must be a string' };
  }

  if (password.length < 4) {
    return { valid: false, error: 'Password must be at least 4 characters' };
  }

  if (password.length > 128) {
    return { valid: false, error: 'Password too long (max 128 characters)' };
  }

  return { valid: true };
}
