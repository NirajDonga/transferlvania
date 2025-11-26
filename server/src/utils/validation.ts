// Validation utilities for input sanitization and validation

export function validateFileName(fileName: unknown): { valid: boolean; sanitized?: string; error?: string } {
  if (!fileName || typeof fileName !== 'string' || fileName.length === 0) {
    return { valid: false, error: "Invalid file name" };
  }

  // Sanitize fileName - remove path traversal and dangerous characters
  const sanitized = fileName
    .replace(/\.\./g, '') // Remove ..
    .replace(/[\/\\]/g, '_') // Replace slashes
    .replace(/[<>:"|?*\x00-\x1f]/g, '_') // Remove invalid characters
    .substring(0, 255); // Limit length

  if (sanitized.length === 0) {
    return { valid: false, error: "File name becomes empty after sanitization" };
  }

  return { valid: true, sanitized };
}

export function validateFileSize(fileSize: unknown, maxSize: number = 100 * 1024 * 1024 * 1024): { valid: boolean; size?: number; error?: string } {
  if (!fileSize || typeof fileSize !== 'string') {
    return { valid: false, error: "Invalid file size" };
  }

  const fileSizeNum = parseInt(fileSize);
  if (isNaN(fileSizeNum) || fileSizeNum <= 0) {
    return { valid: false, error: "File size must be a positive number" };
  }

  if (fileSizeNum > maxSize) {
    return { valid: false, error: `File size exceeds maximum limit (${(maxSize / (1024 * 1024 * 1024)).toFixed(0)}GB)` };
  }

  return { valid: true, size: fileSizeNum };
}

export function validateFileType(fileType: unknown): { valid: boolean; sanitized?: string; error?: string } {
  if (!fileType || typeof fileType !== 'string') {
    return { valid: false, error: "Invalid file type" };
  }

  const sanitized = fileType.substring(0, 100);
  return { valid: true, sanitized };
}

export function validateUUID(id: unknown): { valid: boolean; error?: string } {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: "Invalid ID" };
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return { valid: false, error: "Invalid ID format" };
  }

  return { valid: true };
}

export function validateSocketId(socketId: unknown): { valid: boolean; error?: string } {
  if (!socketId || typeof socketId !== 'string' || socketId.length === 0) {
    return { valid: false, error: "Invalid socket ID" };
  }

  return { valid: true };
}
