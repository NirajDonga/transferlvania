import { Socket } from "socket.io";
import prisma from "../utils/prisma.js";
import { validateFileName, validateFileSize, validateFileType, validateUUID, validateSocketId, checkDangerousFileExtension } from "../utils/validation.js";
import { uploadInitLimiter, joinRoomLimiter } from "../middleware/rateLimiter.js";
import { hashPassword, verifyPassword, validatePassword } from "../utils/password.js";
import { sessionManager } from "../utils/sessionManager.js";
import { logger } from "../utils/logger.js";
import { sessionLimiter } from "../middleware/sessionLimiter.js";
import { encrypt, decrypt } from "../utils/encryption.js";

export function handleUploadInit(socket: Socket) {
  socket.on("upload-init", async (data) => {
    try {
      const rateLimitResult = uploadInitLimiter.check(socket.id);
      if (!rateLimitResult.allowed) {
        const waitTime = Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000);
        logger.trackSuspiciousActivity(socket.handshake.address, 'Upload rate limit exceeded');
        socket.emit("error", { message: `Too many upload attempts. Please wait ${waitTime} seconds.` });
        return;
      }

      const sessionLimitResult = sessionLimiter.check(socket.handshake.address);
      if (!sessionLimitResult.allowed) {
        logger.log('security', 'Session creation blocked by limiter', {
          ip: socket.handshake.address,
          socketId: socket.id,
          details: sessionLimitResult,
        });
        socket.emit("error", { message: sessionLimitResult.reason });
        return;
      }

      if (!data || typeof data !== 'object') {
        logger.log('warn', 'Invalid upload data format', { socketId: socket.id, ip: socket.handshake.address });
        socket.emit("error", { message: "Invalid data format" });
        return;
      }

      if (!data.fileName || typeof data.fileName !== 'string') {
        logger.log('warn', 'Missing or invalid fileName', { socketId: socket.id });
        socket.emit("error", { message: "File name is required" });
        return;
      }

      if (!data.fileSize || typeof data.fileSize !== 'number') {
        logger.log('warn', 'Missing or invalid fileSize', { socketId: socket.id });
        socket.emit("error", { message: "File size is required" });
        return;
      }

      if (!data.fileType || typeof data.fileType !== 'string') {
        logger.log('warn', 'Missing or invalid fileType', { socketId: socket.id });
        socket.emit("error", { message: "File type is required" });
        return;
      }

      const fileNameValidation = validateFileName(data.fileName);
      if (!fileNameValidation.valid) {
        logger.log('warn', 'Invalid file name', { socketId: socket.id, details: { fileName: data.fileName } });
        socket.emit("error", { message: fileNameValidation.error });
        return;
      }

      const fileSizeValidation = validateFileSize(data.fileSize);
      if (!fileSizeValidation.valid) {
        logger.log('warn', 'Invalid file size', { socketId: socket.id, details: { fileSize: data.fileSize } });
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

      if (dangerousCheck.isDangerous || fileTypeValidation.isDangerous) {
        logger.log('security', 'Dangerous file type uploaded', {
          socketId: socket.id,
          ip: socket.handshake.address,
          details: { 
            fileName: data.fileName, 
            fileType: data.fileType,
            extension: dangerousCheck.extension,
            mimeWarning: fileTypeWarning,
            extensionWarning: extensionWarning
          }
        });
      }

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

      logger.log('info', 'File session created', {
        fileId: session.id,
        socketId: socket.id,
        ip: socket.handshake.address,
        details: { 
          fileSize: session.fileSize.toString(), 
          hasPassword: !!passwordHash,
          isDangerous: dangerousCheck.isDangerous || fileTypeValidation.isDangerous
        }
      });
      
      sessionManager.register(session.id, socket.id);
      socket.join(session.id);

      const warnings = [extensionWarning, fileTypeWarning].filter(Boolean);
      socket.emit("upload-created", { 
        fileId: session.id,
        warnings: warnings.length > 0 ? warnings : undefined
      });
    } catch (error) {
      logger.log('error', 'Database error on upload-init', { socketId: socket.id, details: error });
      socket.emit("error", { message: "Failed to create file session" });
    }
  });
}

export function handleJoinRoom(socket: Socket, io: any) {
  socket.on("join-room", async ({ fileId, password }) => {
    try {
      if (!fileId || typeof fileId !== 'string') {
        logger.log('warn', 'Missing or invalid fileId', { socketId: socket.id });
        socket.emit("error", { message: "File ID is required" });
        return;
      }

      const rateLimitResult = joinRoomLimiter.check(socket.id);
      if (!rateLimitResult.allowed) {
        const waitTime = Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000);
        logger.trackSuspiciousActivity(socket.handshake.address, 'Join room rate limit exceeded');
        socket.emit("error", { message: `Too many join attempts. Please wait ${waitTime} seconds.` });
        return;
      }

      const uuidValidation = validateUUID(fileId);
      if (!uuidValidation.valid) {
        logger.trackSuspiciousActivity(socket.handshake.address, 'Invalid UUID format in join-room');
        socket.emit("error", { message: uuidValidation.error });
        return;
      }

      const session = await prisma.fileSession.findUnique({
        where: { id: fileId },
      });

      if (!session) {
        logger.log('warn', 'Attempted to join non-existent session', { fileId, socketId: socket.id, ip: socket.handshake.address });
        socket.emit("error", { message: "File not found or expired" });
        return;
      }

      if (session.passwordHash) {
        if (!password || typeof password !== 'string') {
          socket.emit("error", { message: "Password required", passwordRequired: true });
          return;
        }

        if (!verifyPassword(password, session.passwordHash)) {
          logger.trackSuspiciousActivity(socket.handshake.address, 'Incorrect password attempt');
          logger.log('security', 'Failed password attempt', { fileId, socketId: socket.id, ip: socket.handshake.address });
          socket.emit("error", { message: "Incorrect password", passwordRequired: true });
          return;
        }
      }

      if (session.status === "completed") {
        logger.log('warn', 'Attempted to download already completed file', { fileId, socketId: socket.id });
        socket.emit("error", { message: "This file has already been downloaded" });
        return;
      }

      await prisma.fileSession.update({
        where: { id: fileId },
        data: { status: "active" },
      });

      socket.join(fileId);

      // Decrypt metadata for processing
      const decryptedFileName = decrypt(session.fileName);
      const decryptedFileType = decrypt(session.fileType);

      const dangerousCheck = checkDangerousFileExtension(decryptedFileName);
      const fileTypeValidation = validateFileType(decryptedFileType);
      
      const warnings = [];
      if (dangerousCheck.isDangerous) {
        warnings.push(dangerousCheck.warningMessage);
        logger.log('security', 'Receiver warned about dangerous file', {
          fileId,
          socketId: socket.id,
          ip: socket.handshake.address,
          details: { 
            extension: dangerousCheck.extension 
          }
        });
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

      logger.log('info', 'Receiver joined', { 
        fileId, 
        socketId: socket.id, 
        ip: socket.handshake.address,
        details: { isDangerous: dangerousCheck.isDangerous || fileTypeValidation.isDangerous }
      });

    } catch (error) {
      logger.log('error', 'Error in join-room', { socketId: socket.id, details: error });
      socket.emit("error", { message: "Failed to join room" });
    }
  });
}

export function handleSignal(socket: Socket, io: any) {
  socket.on("signal", ({ target, data, fileId }) => {
    try {
      if (!target || typeof target !== 'string') {
        logger.log('warn', 'Invalid signal target', { socketId: socket.id });
        return;
      }

      if (!data || typeof data !== 'object') {
        logger.log('warn', 'Invalid signal data', { socketId: socket.id });
        return;
      }

      if (!fileId || typeof fileId !== 'string') {
        logger.log('warn', 'Missing fileId in signal', { socketId: socket.id });
        return;
      }

      const targetValidation = validateSocketId(target);
      if (!targetValidation.valid) {
        logger.log('warn', 'Invalid target socket ID', { socketId: socket.id, details: { target } });
        return;
      }

      const senderInRoom = Array.from(socket.rooms).includes(fileId);
      if (!senderInRoom) {
        logger.trackSuspiciousActivity(socket.handshake.address, 'Signal sent without being in room');
        logger.log('security', 'Attempted to signal without room membership', { 
          socketId: socket.id, 
          fileId,
          ip: socket.handshake.address 
        });
        return;
      }

      const targetSocket = io.sockets.sockets.get(target);
      if (!targetSocket) {
        logger.log('warn', 'Target socket not found', { socketId: socket.id, ip: socket.handshake.address });
        return;
      }

      const targetInRoom = Array.from(targetSocket.rooms).includes(fileId);
      if (!targetInRoom) {
        logger.log('security', 'Attempted to signal to socket outside room', { 
          socketId: socket.id,
          fileId,
          ip: socket.handshake.address
        });
        return;
      }

      socket.to(target).emit("signal", {
        from: socket.id,
        data,
      });
    } catch (error) {
      logger.log('error', 'Error in signal handler', { socketId: socket.id, details: error });
    }
  });
}

export function handleTransferStateChange(socket: Socket) {
  socket.on("transfer-state-change", ({ fileId, state, reason }) => {
    try {
      if (!fileId || typeof fileId !== 'string') {
        logger.log('warn', 'Invalid fileId in transfer-state-change', { socketId: socket.id });
        return;
      }
      if (!state || typeof state !== 'string') {
        logger.log('warn', 'Invalid state in transfer-state-change', { socketId: socket.id });
        return;
      }
      
      logger.log('info', 'Transfer state changed', { fileId, socketId: socket.id, details: { state, reason } });
      socket.to(fileId).emit("transfer-state-update", { state, reason, from: socket.id });
    } catch (error) {
      logger.log('error', 'Error in transfer-state-change', { socketId: socket.id, details: error });
    }
  });
}

export function handlePauseTransfer(socket: Socket) {
  socket.on("pause-transfer", ({ fileId }) => {
    try {
      if (!fileId || typeof fileId !== 'string') {
        logger.log('warn', 'Invalid fileId in pause-transfer', { socketId: socket.id });
        return;
      }
      
      if (!sessionManager.isSender(fileId, socket.id)) {
        logger.trackSuspiciousActivity(socket.handshake.address, 'Unauthorized pause attempt');
        logger.log('security', 'Unauthorized pause attempt', { fileId, socketId: socket.id });
        return;
      }
      
      logger.log('info', 'Transfer paused', { fileId, socketId: socket.id });
      socket.to(fileId).emit("transfer-paused", { from: socket.id });
    } catch (error) {
      logger.log('error', 'Error in pause-transfer', { socketId: socket.id, details: error });
    }
  });
}

export function handleCancelTransfer(socket: Socket) {
  socket.on("cancel-transfer", ({ fileId, reason }) => {
    try {
      if (!fileId || typeof fileId !== 'string') {
        logger.log('warn', 'Invalid fileId in cancel-transfer', { socketId: socket.id });
        return;
      }
      
      if (!sessionManager.isSender(fileId, socket.id)) {
        logger.trackSuspiciousActivity(socket.handshake.address, 'Unauthorized cancel attempt');
        logger.log('security', 'Unauthorized cancel attempt', { fileId, socketId: socket.id });
        return;
      }
      
      logger.log('info', 'Transfer cancelled', { fileId, socketId: socket.id, details: { reason } });
      socket.to(fileId).emit("transfer-cancelled", { reason, from: socket.id });
    } catch (error) {
      logger.log('error', 'Error in cancel-transfer', { socketId: socket.id, details: error });
    }
  });
}

export function handleResumeTransfer(socket: Socket) {
  socket.on("resume-transfer", ({ fileId }) => {
    try {
      if (!fileId || typeof fileId !== 'string') {
        logger.log('warn', 'Invalid fileId in resume-transfer', { socketId: socket.id });
        return;
      }
      
      if (!sessionManager.isSender(fileId, socket.id)) {
        logger.trackSuspiciousActivity(socket.handshake.address, 'Unauthorized resume attempt');
        logger.log('security', 'Unauthorized resume attempt', { fileId, socketId: socket.id });
        return;
      }
      
      logger.log('info', 'Transfer resumed', { fileId, socketId: socket.id });
      socket.to(fileId).emit("transfer-resumed", { from: socket.id });
    } catch (error) {
      logger.log('error', 'Error in resume-transfer', { socketId: socket.id, details: error });
    }
  });
}
