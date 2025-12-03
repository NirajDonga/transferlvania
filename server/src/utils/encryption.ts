import crypto from 'crypto';
import { logger } from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // For AES, this is always 16
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;

// Get key from env or generate a temporary one (warn in logs)
let ENCRYPTION_KEY: Buffer;

try {
  if (process.env.METADATA_ENCRYPTION_KEY) {
    // Support hex string or raw string
    if (process.env.METADATA_ENCRYPTION_KEY.length === 64) {
        ENCRYPTION_KEY = Buffer.from(process.env.METADATA_ENCRYPTION_KEY, 'hex');
    } else {
        // Derive a 32-byte key from the string using scrypt
        ENCRYPTION_KEY = crypto.scryptSync(process.env.METADATA_ENCRYPTION_KEY, 'salt', 32);
    }
  } else {
    console.warn('WARNING: METADATA_ENCRYPTION_KEY not set. Using temporary random key. Data will be unreadable after restart.');
    ENCRYPTION_KEY = crypto.randomBytes(32);
  }
} catch (error) {
  console.error('Failed to initialize encryption key:', error);
  ENCRYPTION_KEY = crypto.randomBytes(32);
}

export function encrypt(text: string): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    logger.log('error', 'Encryption failed', { details: error });
    throw new Error('Encryption failed');
  }
}

export function decrypt(text: string): string {
  try {
    const parts = text.split(':');
    if (parts.length !== 3) {
        // Fallback for unencrypted legacy data if necessary, or just throw
        return text; 
    }
    
    const ivHex = parts[0];
    const authTagHex = parts[1];
    const encryptedText = parts[2];

    if (!ivHex || !authTagHex || !encryptedText) {
        return text;
    }
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    logger.log('error', 'Decryption failed', { details: error });
    // Return original text if decryption fails (might be unencrypted data)
    return text;
  }
}
