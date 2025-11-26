import crypto from 'crypto';

export function generateFileHash(data: ArrayBuffer): string {
  const hash = crypto.createHash('sha256');
  hash.update(Buffer.from(data));
  return hash.digest('hex');
}

export function generateChunkHash(data: ArrayBuffer): string {
  const hash = crypto.createHash('md5');
  hash.update(Buffer.from(data));
  return hash.digest('hex');
}

export function verifyHash(data: ArrayBuffer, expectedHash: string, algorithm: 'sha256' | 'md5' = 'sha256'): boolean {
  const hash = crypto.createHash(algorithm);
  hash.update(Buffer.from(data));
  const actualHash = hash.digest('hex');
  return actualHash === expectedHash;
}
