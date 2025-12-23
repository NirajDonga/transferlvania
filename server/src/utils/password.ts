import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

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
