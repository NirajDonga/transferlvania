/**
 * useFileHash Hook
 * Handles file hash calculation using Web Workers
 * Prevents UI blocking for large files
 */

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseFileHashOptions {
  onProgress?: (percent: number) => void;
}

export const useFileHash = (options: UseFileHashOptions = {}) => {
  const [isHashing, setIsHashing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const optionsRef = useRef(options);

  optionsRef.current = options;

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const calculateHash = useCallback(async (file: File): Promise<string> => {
    setIsHashing(true);
    setError(null);

    try {
      // Try using Web Worker for large files (> 10MB)
      if (file.size > 10 * 1024 * 1024 && typeof Worker !== 'undefined') {
        return await calculateHashWithWorker(file);
      }
      
      // For smaller files, calculate directly
      return await calculateHashDirect(file);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Hash calculation failed');
      setError(error);
      throw error;
    } finally {
      setIsHashing(false);
    }
  }, []);

  const calculateHashWithWorker = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker(
          new URL('../workers/hash.worker.ts', import.meta.url)
        );
        workerRef.current = worker;

        worker.onmessage = (e: MessageEvent) => {
          if (e.data.type === 'progress') {
            optionsRef.current.onProgress?.(e.data.percent);
          } else if (e.data.type === 'complete') {
            worker.terminate();
            workerRef.current = null;
            resolve(e.data.hash);
          } else if (e.data.type === 'error') {
            worker.terminate();
            workerRef.current = null;
            reject(new Error(e.data.message));
          }
        };

        worker.onerror = (err) => {
          worker.terminate();
          workerRef.current = null;
          reject(err);
        };

        worker.postMessage(file);
      } catch (err) {
        // Fallback to direct calculation if Worker fails
        calculateHashDirect(file).then(resolve).catch(reject);
      }
    });
  }, []);

  const calculateHashDirect = useCallback(async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }, []);

  // For verifying received file chunks
  const verifyHash = useCallback(async (
    chunks: Uint8Array[],
    expectedHash: string
  ): Promise<boolean> => {
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    
    const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const actualHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return actualHash === expectedHash;
  }, []);

  const cancelHash = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setIsHashing(false);
  }, []);

  return {
    isHashing,
    error,
    calculateHash,
    verifyHash,
    cancelHash,
  };
};
