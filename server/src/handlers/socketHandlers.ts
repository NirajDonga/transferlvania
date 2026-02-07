import { Socket } from "socket.io";
import prisma from "../utils/prisma.js";
import { validateFileName, validateFileSize, validateFileType, validateFileExtension, validateUUID, validateSocketId } from "../utils/validation.js";
import { sessionManager } from "../utils/sessionManager.js";
import { encrypt, decrypt } from "../utils/encryption.js";

export function handleUploadInit(socket: Socket) {
  socket.on("upload-init", async (data) => {
    try {
      if (!data || typeof data !== 'object') {
        socket.emit("error", { message: "Invalid data format" });
        return;
      }

      if (!data.fileName || typeof data.fileName !== 'string') {
        socket.emit("error", { message: "File name is required" });
        return;
      }

      if (!data.fileSize || typeof data.fileSize !== 'number') {
        socket.emit("error", { message: "File size is required" });
        return;
      }

      if (!data.fileType || typeof data.fileType !== 'string') {
        socket.emit("error", { message: "File type is required" });
        return;
      }

      if (!data.fileHash || typeof data.fileHash !== 'string') {
        socket.emit("error", { message: "File hash is required" });
        return;
      }

      const fileNameValidation = validateFileName(data.fileName);
      if (!fileNameValidation.valid) {
        socket.emit("error", { message: fileNameValidation.error });
        return;
      }

      const fileSizeValidation = validateFileSize(data.fileSize);
      if (!fileSizeValidation.valid) {
        socket.emit("error", { message: fileSizeValidation.error });
        return;
      }

      const fileTypeValidation = validateFileType(data.fileType);
      if (!fileTypeValidation.valid) {
        socket.emit("error", { message: fileTypeValidation.error });
        return;
      }

      const extensionValidation = validateFileExtension(data.fileName);
      if (!extensionValidation.valid) {
        socket.emit("error", { message: extensionValidation.error });
        return;
      }

      const session = await prisma.fileSession.create({
        data: {
          fileName: encrypt(fileNameValidation.sanitized!),
          fileSize: BigInt(data.fileSize),
          fileType: encrypt(fileTypeValidation.sanitized!),
          fileHash: data.fileHash,
          status: "waiting",
        },
      });
      
      const oneTimeCode = sessionManager.register(session.id, socket.id);
      socket.join(session.id);

      socket.emit("upload-created", { 
        fileId: session.id,
        oneTimeCode: oneTimeCode
      });
    } catch (error) {
      console.error('Database error on upload-init:', error);
      socket.emit("error", { message: "Failed to create file session" });
    }
  });
}

export function handleJoinRoom(socket: Socket, io: any) {
  socket.on("join-room", async ({ fileId, code }) => {
    try {
      if (!fileId || typeof fileId !== 'string') {
        socket.emit("error", { message: "File ID is required" });
        return;
      }

      if (!code || typeof code !== 'string') {
        socket.emit("error", { message: "Connection code is required", invalidCode: true });
        return;
      }

      const uuidValidation = validateUUID(fileId);
      if (!uuidValidation.valid) {
        socket.emit("error", { message: uuidValidation.error });
        return;
      }

      const session = await prisma.fileSession.findUnique({
        where: { id: fileId },
      });

      if (!session) {
        socket.emit("error", { message: "File not found or expired" });
        return;
      }

      // Check if sender is still online
      if (!sessionManager.getSender(fileId)) {
        socket.emit("error", { message: "Sender is not online" });
        return;
      }

      // Validate one-time code
      const codeValidation = sessionManager.validateCode(fileId, code);
      if (!codeValidation.valid) {
        socket.emit("error", { message: codeValidation.error, invalidCode: true });
        return;
      }

      if (session.status === "completed") {
        socket.emit("error", { message: "This file has already been downloaded" });
        return;
      }

      await prisma.fileSession.update({
        where: { id: fileId },
        data: { status: "active" },
      });

      socket.join(fileId);

      const decryptedFileName = decrypt(session.fileName);
      const decryptedFileType = decrypt(session.fileType);
      
      socket.emit("file-meta", {
        fileName: decryptedFileName,
        fileSize: session.fileSize.toString(),
        fileType: decryptedFileType,
        fileHash: session.fileHash
      });

      socket.to(fileId).emit("receiver-joined", { receiverId: socket.id });

    } catch (error) {
      console.error('Error in join-room:', error);
      socket.emit("error", { message: "Failed to join room" });
    }
  });
}

export function handleSignal(socket: Socket, io: any) {
  socket.on("signal", ({ target, data, fileId }) => {
    try {
      if (!target || typeof target !== 'string') {
        return;
      }

      if (!data || typeof data !== 'object') {
        return;
      }

      if (!fileId || typeof fileId !== 'string') {
        return;
      }

      const targetValidation = validateSocketId(target);
      if (!targetValidation.valid) {
        return;
      }

      const senderInRoom = Array.from(socket.rooms).includes(fileId);
      if (!senderInRoom) {
        return;
      }

      const targetSocket = io.sockets.sockets.get(target);
      if (!targetSocket) {
        return;
      }

      const targetInRoom = Array.from(targetSocket.rooms).includes(fileId);
      if (!targetInRoom) {
        return;
      }

      socket.to(target).emit("signal", {
        from: socket.id,
        data,
      });
    } catch (error) {
      console.error('Error in signal handler:', error);
    }
  });
}

export function handleCancelTransfer(socket: Socket) {
  socket.on("cancel-transfer", ({ fileId, reason }) => {
    try {
      if (!fileId || typeof fileId !== 'string') return;
      
      socket.to(fileId).emit("transfer-cancelled", { reason });
    } catch (error) {
      console.error('Error in cancel-transfer:', error);
    }
  });
}
