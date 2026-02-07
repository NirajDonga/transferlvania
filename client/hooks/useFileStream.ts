/**
 * useFileStream Hook
 * Handles file reading, chunking, and streaming logic
 * Manages file transfers without blocking the main thread
 */

import { useRef, useCallback, useState } from 'react';
import { CHUNK_SIZE } from '@/types/socket-events';

interface FileStreamOptions {
  onProgress?: (percent: number) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

export const useFileStream = (options: FileStreamOptions = {}) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const optionsRef = useRef(options);
  const isCancelledRef = useRef(false);
  const offsetRef = useRef(0);
  const fileRef = useRef<File | null>(null);
  const readerRef = useRef<FileReader | null>(null);

  // Keep options ref updated
  optionsRef.current = options;

  const cancelStream = useCallback(() => {
    isCancelledRef.current = true;
    setIsStreaming(false);
    offsetRef.current = 0;
    fileRef.current = null;
  }, []);

  const streamFile = useCallback(async (
    file: File,
    sendChunk: (chunk: ArrayBuffer) => void,
    canSendMore: () => boolean,
    onBufferLow: (callback: () => void) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      setIsStreaming(true);
      isCancelledRef.current = false;
      offsetRef.current = 0;
      fileRef.current = file;

      const reader = new FileReader();
      readerRef.current = reader;

      const readNextSlice = (currentOffset: number) => {
        if (isCancelledRef.current) {
          setIsStreaming(false);
          reject(new Error('Transfer cancelled'));
          return;
        }

        const slice = file.slice(currentOffset, currentOffset + CHUNK_SIZE);
        reader.readAsArrayBuffer(slice);
      };

      reader.onload = () => {
        if (!reader.result || isCancelledRef.current) return;

        try {
          const chunk = reader.result as ArrayBuffer;
          const chunkSize = chunk.byteLength;
          
          sendChunk(chunk);
          
          offsetRef.current += chunkSize;
          const percent = Math.round((offsetRef.current / file.size) * 100);
          optionsRef.current.onProgress?.(percent);

          if (offsetRef.current < file.size) {
            if (canSendMore()) {
              readNextSlice(offsetRef.current);
            } else {
              onBufferLow(() => {
                if (!isCancelledRef.current) {
                  readNextSlice(offsetRef.current);
                }
              });
            }
          } else {
            setIsStreaming(false);
            optionsRef.current.onComplete?.();
            resolve();
          }
        } catch (error) {
          setIsStreaming(false);
          const err = error instanceof Error ? error : new Error('Send error');
          optionsRef.current.onError?.(err);
          reject(err);
        }
      };

      reader.onerror = () => {
        setIsStreaming(false);
        const err = new Error('File read error');
        optionsRef.current.onError?.(err);
        reject(err);
      };

      // Start reading
      readNextSlice(0);
    });
  }, []);

  return {
    isStreaming,
    streamFile,
    cancelStream,
  };
};
