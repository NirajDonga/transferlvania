export function validateFileName(fileName: unknown): { valid: boolean; sanitized?: string; error?: string } {
  if (!fileName || typeof fileName !== 'string' || fileName.length === 0) {
    return { valid: false, error: "Invalid file name" };
  }

  const sanitized = fileName
    .replace(/\.\./g, '')
    .replace(/[\/\\]/g, '_')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .substring(0, 255);

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

const BLOCKED_EXTENSIONS = [
  'exe', 'dll', 'bat', 'cmd', 'com', 'scr', 'pif', 'vbs', 'js', 'jse',
  'wsf', 'wsh', 'msi', 'msp', 'hta', 'cpl', 'jar', 'ps1', 'psm1',
  'reg', 'vb', 'vbe', 'ws', 'application', 'gadget', 'msc', 'lnk',
  'app', 'deb', 'rpm', 'dmg', 'pkg', 'run', 'bin', 'elf'
];

const BLOCKED_MIME_TYPES = [
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-bat',
  'application/x-sh',
  'application/x-shellscript',
  'text/x-script.python',
  'application/x-perl',
  'application/x-ruby',
  'application/x-php',
];

export function validateFileType(fileType: unknown): { 
  valid: boolean; 
  sanitized?: string; 
  error?: string;
} {
  if (!fileType || typeof fileType !== 'string') {
    return { valid: false, error: "Invalid file type" };
  }

  const sanitized = fileType.substring(0, 100).toLowerCase();
  
  const isBlockedMime = BLOCKED_MIME_TYPES.some(mime => sanitized.includes(mime));
  if (isBlockedMime) {
    return {
      valid: false,
      error: "This file type is not allowed for security reasons. Executable files and scripts are blocked to prevent malware distribution."
    };
  }

  return { valid: true, sanitized };
}

export function validateFileExtension(fileName: string): {
  valid: boolean;
  error?: string;
  extension?: string;
} {
  const parts = fileName.toLowerCase().split('.');
  if (parts.length < 2) {
    return { valid: true };
  }

  const extension = parts[parts.length - 1]!;
  
  if (BLOCKED_EXTENSIONS.includes(extension)) {
    return {
      valid: false,
      extension: extension,
      error: `Files with .${extension} extension are not allowed. This file type can execute code and pose security risks.`
    };
  }

  const secondLastExtension = parts[parts.length - 2];
  const hasDoubleExtension = parts.length > 2 && secondLastExtension && BLOCKED_EXTENSIONS.includes(secondLastExtension);
  if (hasDoubleExtension && secondLastExtension) {
    return {
      valid: false,
      extension: secondLastExtension,
      error: `This file has a disguised executable extension (.${secondLastExtension}). This is blocked as it's a common malware technique.`
    };
  }

  return { valid: true };
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
