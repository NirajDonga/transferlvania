import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;

if (!process.env.METADATA_ENCRYPTION_KEY) {
  console.error('FATAL: METADATA_ENCRYPTION_KEY environment variable is required');
  process.exit(1);
}

let ENCRYPTION_KEY: Buffer;

try {
  if (process.env.METADATA_ENCRYPTION_KEY.length === 64) {
    ENCRYPTION_KEY = Buffer.from(process.env.METADATA_ENCRYPTION_KEY, 'hex');
  } else {
    ENCRYPTION_KEY = crypto.scryptSync(process.env.METADATA_ENCRYPTION_KEY, 'salt', 32);
  }
} catch (error) {
  console.error('Failed to initialize encryption key:', error);
  process.exit(1);
}

export function encrypt(text: string): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error('Encryption failed');
  }
}

export function decrypt(text: string): string {
  try {
    const parts = text.split(':');
    if (parts.length !== 3) {
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
    console.error('Decryption failed:', error);
    return text;
  }
}
