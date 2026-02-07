/**
 * Shared TypeScript interfaces for Socket.IO events
 * Single source of truth for client-server communication
 */

// ============ Server → Client Events ============

export interface FileMetaData {
  fileName: string;
  fileSize: number;
  fileType: string;
  fileHash?: string;
  isDangerous?: boolean;
  warnings?: string[];
}

export interface ReceiverJoinedPayload {
  receiverId: string;
}

export interface SignalPayload {
  from?: string;
  data: RTCSessionDescriptionInit | { candidate: RTCIceCandidate };
}

export interface TransferCancelledPayload {
  reason: string;
}

export interface UploadCreatedPayload {
  fileId: string;
  oneTimeCode: string;
  warnings?: string[];
}

export interface ErrorPayload {
  message: string;
  invalidCode?: boolean;
}

export interface ServerToClientEvents {
  "receiver-joined": (data: ReceiverJoinedPayload) => void;
  "file-meta": (data: FileMetaData) => void;
  "signal": (data: SignalPayload) => void;
  "transfer-cancelled": (data: TransferCancelledPayload) => void;
  "transfer-paused": () => void;
  "transfer-resumed": () => void;
  "upload-created": (data: UploadCreatedPayload) => void;
  "error": (data: ErrorPayload) => void;
}

// ============ Client → Server Events ============

export interface UploadInitPayload {
  fileName: string;
  fileSize: number;
  fileType: string;
  fileHash: string;
}

export interface SignalEmitPayload {
  target: string;
  data: RTCSessionDescriptionInit | { candidate: RTCIceCandidate };
  fileId: string;
}

export interface JoinRoomPayload {
  fileId: string;
  code: string;
}

export interface CancelTransferPayload {
  fileId: string;
  reason: string;
}

export interface TransferCompletePayload {
  fileId: string;
}

export interface ClientToServerEvents {
  "upload-init": (data: UploadInitPayload) => void;
  "signal": (data: SignalEmitPayload) => void;
  "join-room": (data: JoinRoomPayload) => void;
  "cancel-transfer": (data: CancelTransferPayload) => void;
  "transfer-complete": (data: TransferCompletePayload) => void;
}

// ============ Constants ============

export const CHUNK_SIZE = 16384;
export const MAX_BUFFER_AMOUNT = 65535;

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" }
];
