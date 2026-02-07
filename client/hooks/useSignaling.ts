/**
 * useSignaling Hook - Handles Socket.IO communication for P2P signaling
 */

import { useEffect, useRef, useCallback } from 'react';
import { socket } from '@/lib/socket';
import type {
  ReceiverJoinedPayload,
  SignalPayload,
  TransferCancelledPayload,
  UploadCreatedPayload,
  ErrorPayload,
  FileMetaData,
  UploadInitPayload,
  SignalEmitPayload,
} from '@/types/socket-events';

export interface SignalingEvents {
  onReceiverJoined?: (data: ReceiverJoinedPayload) => void;
  onSignal?: (data: SignalPayload) => void;
  onTransferCancelled?: (data: TransferCancelledPayload) => void;
  onUploadCreated?: (data: UploadCreatedPayload) => void;
  onError?: (data: ErrorPayload) => void;
  onFileMeta?: (data: FileMetaData) => void;
}

export const useSignaling = (events: SignalingEvents) => {
  const savedHandlers = useRef(events);

  useEffect(() => {
    savedHandlers.current = events;
  }, [events]);

  useEffect(() => {
    const handlers = {
      receiverJoined: (data: ReceiverJoinedPayload) => savedHandlers.current.onReceiverJoined?.(data),
      signal: (data: SignalPayload) => savedHandlers.current.onSignal?.(data),
      transferCancelled: (data: TransferCancelledPayload) => savedHandlers.current.onTransferCancelled?.(data),
      uploadCreated: (data: UploadCreatedPayload) => savedHandlers.current.onUploadCreated?.(data),
      error: (data: ErrorPayload) => savedHandlers.current.onError?.(data),
      fileMeta: (data: FileMetaData) => savedHandlers.current.onFileMeta?.(data),
    };

    socket.on("receiver-joined", handlers.receiverJoined);
    socket.on("signal", handlers.signal);
    socket.on("transfer-cancelled", handlers.transferCancelled);
    socket.on("upload-created", handlers.uploadCreated);
    socket.on("error", handlers.error);
    socket.on("file-meta", handlers.fileMeta);

    return () => {
      socket.off("receiver-joined", handlers.receiverJoined);
      socket.off("signal", handlers.signal);
      socket.off("transfer-cancelled", handlers.transferCancelled);
      socket.off("upload-created", handlers.uploadCreated);
      socket.off("error", handlers.error);
      socket.off("file-meta", handlers.fileMeta);
    };
  }, []);

  const sendSignal = useCallback((payload: SignalEmitPayload) => {
    socket.emit("signal", payload);
  }, []);

  const emitUploadInit = useCallback((payload: UploadInitPayload) => {
    socket.emit("upload-init", payload);
  }, []);

  const joinRoom = useCallback((fileId: string, code: string) => {
    socket.emit("join-room", { fileId, code });
  }, []);

  const cancelTransfer = useCallback((fileId: string, reason: string) => {
    socket.emit("cancel-transfer", { fileId, reason });
  }, []);

  const emitTransferComplete = useCallback((fileId: string) => {
    socket.emit("transfer-complete", { fileId });
  }, []);

  return { sendSignal, emitUploadInit, joinRoom, cancelTransfer, emitTransferComplete };
};
