export function validateFileName(fileName: unknown): { valid: boolean; sanitized?: string; error?: string } {
  if (!fileName || typeof fileName !== 'string' || fileName.length === 0) {
    return { valid: false, error: "Invalid file name" };
  }

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
  if (typeof fileSize !== 'number') {
    return { valid: false, error: "Invalid file size" };
  }

  if (fileSize <= 0) {
    return { valid: false, error: "File size must be a positive number" };
  }

  if (fileSize > maxSize) {
    return { valid: false, error: `File size exceeds maximum limit (${(maxSize / (1024 * 1024 * 1024)).toFixed(0)}GB)` };
  }

  return { valid: true, size: fileSize };
}

const DANGEROUS_EXTENSIONS = [
  'exe', 'dll', 'bat', 'cmd', 'com', 'scr', 'pif', 'vbs', 'js', 'jse',
  'wsf', 'wsh', 'msi', 'msp', 'hta', 'cpl', 'jar', 'ps1', 'psm1',
  'reg', 'vb', 'vbe', 'ws', 'application', 'gadget', 'msc', 'lnk'
];

const SUSPICIOUS_MIME_TYPES = [
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-bat',
  'application/x-sh',
  'text/x-script.python',
];

export function validateFileType(fileType: unknown): { 
  valid: boolean; 
  sanitized?: string; 
  error?: string;
  isDangerous?: boolean;
  warningMessage?: string;
} {
  if (!fileType || typeof fileType !== 'string') {
    return { valid: false, error: "Invalid file type" };
  }

  const sanitized = fileType.substring(0, 100).toLowerCase();
  
  const isDangerousMime = SUSPICIOUS_MIME_TYPES.some(mime => sanitized.includes(mime));
  if (isDangerousMime) {
    return {
      valid: true,
      sanitized,
      isDangerous: true,
      warningMessage: "This file type may contain executable code. Exercise extreme caution."
    };
  }

  return { valid: true, sanitized };
}

export function checkDangerousFileExtension(fileName: string): {
  isDangerous: boolean;
  warningMessage?: string;
  extension?: string;
} {
  const parts = fileName.toLowerCase().split('.');
  if (parts.length < 2) {
    return { isDangerous: false };
  }

  const extension = parts[parts.length - 1]!;
  
  if (DANGEROUS_EXTENSIONS.includes(extension)) {
    return {
      isDangerous: true,
      extension: extension,
      warningMessage: `WARNING: .${extension} files can execute code on your computer. Only download if you trust the sender.`
    };
  }

  const secondLastExtension = parts[parts.length - 2];
  const hasDoubleExtension = parts.length > 2 && secondLastExtension && DANGEROUS_EXTENSIONS.includes(secondLastExtension);
  if (hasDoubleExtension && secondLastExtension) {
    return {
      isDangerous: true,
      extension: secondLastExtension,
      warningMessage: "WARNING: This file has a disguised executable extension. This is a common malware technique."
    };
  }

  return { isDangerous: false };
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
