/**
 * Web Worker for SHA-256 hash calculation
 * Runs in background thread to prevent UI blocking
 * Supports progress reporting for large files
 */

const CHUNK_SIZE = 64 * 1024 * 1024; // 64MB chunks for progress reporting

self.onmessage = async (e: MessageEvent<File>) => {
  const file = e.data;
  
  try {
    // For smaller files, hash directly
    if (file.size <= CHUNK_SIZE) {
      const buffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      self.postMessage({ type: 'complete', hash: hashHex });
      return;
    }

    // For larger files, read in chunks and report progress
    // Note: SubtleCrypto doesn't support incremental hashing,
    // so we need to read the entire file, but we can report progress
    const totalSize = file.size;
    let offset = 0;
    const chunks: ArrayBuffer[] = [];

    while (offset < totalSize) {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const chunk = await slice.arrayBuffer();
      chunks.push(chunk);
      
      offset += chunk.byteLength;
      const percent = Math.round((offset / totalSize) * 50); // First 50% is reading
      self.postMessage({ type: 'progress', percent });
    }

    // Combine all chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let combinedOffset = 0;
    
    for (const chunk of chunks) {
      combined.set(new Uint8Array(chunk), combinedOffset);
      combinedOffset += chunk.byteLength;
    }

    self.postMessage({ type: 'progress', percent: 75 }); // 75% after combining

    // Calculate hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    self.postMessage({ type: 'progress', percent: 100 });
    self.postMessage({ type: 'complete', hash: hashHex });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    self.postMessage({ type: 'error', message });
  }
};

// Required for TypeScript module resolution
export {};
