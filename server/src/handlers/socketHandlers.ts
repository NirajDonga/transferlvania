import { Socket } from "socket.io";
import prisma from "../utils/prisma.js";
import { validateFileName, validateFileSize, validateFileType, validateUUID, validateSocketId, checkDangerousFileExtension } from "../utils/validation.js";
import { hashPassword, verifyPassword, validatePassword } from "../utils/password.js";
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

      const dangerousCheck = checkDangerousFileExtension(data.fileName);
      const fileTypeWarning = fileTypeValidation.isDangerous ? fileTypeValidation.warningMessage : null;
      const extensionWarning = dangerousCheck.isDangerous ? dangerousCheck.warningMessage : null;

      let passwordHash: string | null = null;
      if (data.password) {
        if (typeof data.password !== 'string') {
          socket.emit("error", { message: "Invalid password format" });
          return;
        }
        const passwordValidation = validatePassword(data.password);
        if (!passwordValidation.valid) {
          socket.emit("error", { message: passwordValidation.error });
          return;
        }
        passwordHash = hashPassword(data.password);
      }

      const session = await prisma.fileSession.create({
        data: {
          fileName: encrypt(fileNameValidation.sanitized!),
          fileSize: BigInt(data.fileSize),
          fileType: encrypt(fileTypeValidation.sanitized!),
          passwordHash: passwordHash,
          status: "waiting",
        },
      });
      
      sessionManager.register(session.id, socket.id);
      socket.join(session.id);

      const warnings = [extensionWarning, fileTypeWarning].filter(Boolean);
      socket.emit("upload-created", { 
        fileId: session.id,
        warnings: warnings.length > 0 ? warnings : undefined
      });
    } catch (error) {
      console.error('Database error on upload-init:', error);
      socket.emit("error", { message: "Failed to create file session" });
    }
  });
}

export function handleJoinRoom(socket: Socket, io: any) {
  socket.on("join-room", async ({ fileId, password }) => {
    try {
      if (!fileId || typeof fileId !== 'string') {
        socket.emit("error", { message: "File ID is required" });
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

      if (session.passwordHash) {
        if (!password || typeof password !== 'string') {
          socket.emit("error", { message: "Password required", passwordRequired: true });
          return;
        }

        if (!verifyPassword(password, session.passwordHash)) {
          socket.emit("error", { message: "Incorrect password", passwordRequired: true });
          return;
        }
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

      const dangerousCheck = checkDangerousFileExtension(decryptedFileName);
      const fileTypeValidation = validateFileType(decryptedFileType);
      
      const warnings = [];
      if (dangerousCheck.isDangerous) {
        warnings.push(dangerousCheck.warningMessage);
      }
      if (fileTypeValidation.isDangerous) {
        warnings.push(fileTypeValidation.warningMessage);
      }
      
      socket.emit("file-meta", {
        fileName: decryptedFileName,
        fileSize: session.fileSize.toString(),
        fileType: decryptedFileType,
        isDangerous: dangerousCheck.isDangerous || fileTypeValidation.isDangerous,
        warnings: warnings.length > 0 ? warnings : undefined
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

export function handleTransferStateChange(socket: Socket) {
  socket.on("transfer-state-change", ({ fileId, state, reason }) => {
    try {
      if (!fileId || typeof fileId !== 'string') return;
      if (!state || typeof state !== 'string') return;
      
      socket.to(fileId).emit("transfer-state-update", { state, reason, from: socket.id });
    } catch (error) {
      console.error('Error in transfer-state-change:', error);
    }
  });
}

export function handlePauseTransfer(socket: Socket) {
  socket.on("pause-transfer", ({ fileId }) => {
    try {
      if (!fileId || typeof fileId !== 'string') return;
      if (!sessionManager.isSender(fileId, socket.id)) return;
      
      socket.to(fileId).emit("transfer-paused", { from: socket.id });
    } catch (error) {
      console.error('Error in pause-transfer:', error);
    }
  });
}

export function handleCancelTransfer(socket: Socket) {
  socket.on("cancel-transfer", ({ fileId, reason }) => {
    try {
      if (!fileId || typeof fileId !== 'string') return;
      if (!sessionManager.isSender(fileId, socket.id)) return;
      
      socket.to(fileId).emit("transfer-cancelled", { reason, from: socket.id });
    } catch (error) {
      console.error('Error in cancel-transfer:', error);
    }
  });
}

export function handleResumeTransfer(socket: Socket) {
  socket.on("resume-transfer", ({ fileId }) => {
    try {
      if (!fileId || typeof fileId !== 'string') return;
      if (!sessionManager.isSender(fileId, socket.id)) return;
      
      socket.to(fileId).emit("transfer-resumed", { from: socket.id });
    } catch (error) {
      console.error('Error in resume-transfer:', error);
    }
  });
}
