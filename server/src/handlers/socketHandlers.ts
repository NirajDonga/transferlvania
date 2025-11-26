// Socket event handlers
import { Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { validateFileName, validateFileSize, validateFileType, validateUUID, validateSocketId } from "../utils/validation.js";
import { uploadInitLimiter, joinRoomLimiter } from "../middleware/rateLimiter.js";
import { hashPassword, verifyPassword, validatePassword } from "../utils/password.js";

const prisma = new PrismaClient();

export function handleUploadInit(socket: Socket) {
  socket.on("upload-init", async (data) => {
    try {
      // Rate limiting check
      const rateLimitResult = uploadInitLimiter.check(socket.id);
      if (!rateLimitResult.allowed) {
        const waitTime = Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000);
        socket.emit("error", { message: `Too many upload attempts. Please wait ${waitTime} seconds.` });
        return;
      }

      // Input Validation
      if (!data || typeof data !== 'object') {
        socket.emit("error", { message: "Invalid data format" });
        return;
      }

      // Validate fileName
      const fileNameValidation = validateFileName(data.fileName);
      if (!fileNameValidation.valid) {
        socket.emit("error", { message: fileNameValidation.error });
        return;
      }

      // Validate fileSize
      const fileSizeValidation = validateFileSize(data.fileSize);
      if (!fileSizeValidation.valid) {
        socket.emit("error", { message: fileSizeValidation.error });
        return;
      }

      // Validate fileType
      const fileTypeValidation = validateFileType(data.fileType);
      if (!fileTypeValidation.valid) {
        socket.emit("error", { message: fileTypeValidation.error });
        return;
      }

      // Validate optional password
      let passwordHash: string | null = null;
      if (data.password) {
        const passwordValidation = validatePassword(data.password);
        if (!passwordValidation.valid) {
          socket.emit("error", { message: passwordValidation.error });
          return;
        }
        passwordHash = hashPassword(data.password);
      }

      const session = await prisma.fileSession.create({
        data: {
          fileName: fileNameValidation.sanitized!,
          fileSize: data.fileSize,
          fileType: fileTypeValidation.sanitized!,
          senderSocketId: socket.id,
          passwordHash: passwordHash,
          status: "waiting",
        },
      });

      console.log(`New File Session: ${session.id}`);
      
      // CRITICAL: Sender joins a "room" named after the file ID
      socket.join(session.id);

      socket.emit("upload-created", { fileId: session.id });
    } catch (error) {
      console.error("Database Error:", error);
      socket.emit("error", { message: "Failed to create file session" });
    }
  });
}

export function handleJoinRoom(socket: Socket, io: any) {
  socket.on("join-room", async ({ fileId, password }) => {
    try {
      // Rate limiting check
      const rateLimitResult = joinRoomLimiter.check(socket.id);
      if (!rateLimitResult.allowed) {
        const waitTime = Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000);
        socket.emit("error", { message: `Too many join attempts. Please wait ${waitTime} seconds.` });
        return;
      }

      // Validate fileId
      const uuidValidation = validateUUID(fileId);
      if (!uuidValidation.valid) {
        socket.emit("error", { message: uuidValidation.error });
        return;
      }

      // Find the file in DB
      const session = await prisma.fileSession.findUnique({
        where: { id: fileId },
      });

      if (!session) {
        socket.emit("error", { message: "File not found or expired" });
        return;
      }

      // Check if password is required and verify it
      if (session.passwordHash) {
        if (!password) {
          socket.emit("error", { message: "Password required", passwordRequired: true });
          return;
        }

        if (!verifyPassword(password, session.passwordHash)) {
          socket.emit("error", { message: "Incorrect password", passwordRequired: true });
          return;
        }
      }

      // Check if already downloaded
      if (session.status === "completed") {
        socket.emit("error", { message: "This file has already been downloaded" });
        return;
      }

      // Mark as active (download in progress)
      await prisma.fileSession.update({
        where: { id: fileId },
        data: { status: "active" },
      });

      // Add Receiver to the room
      socket.join(fileId);
      
      // Notify the Receiver about the file details
      socket.emit("file-meta", {
        fileName: session.fileName,
        fileSize: session.fileSize,
        fileType: session.fileType,
      });

      // Notify the Sender that someone joined!
      socket.to(fileId).emit("receiver-joined", { receiverId: socket.id });

      console.log(`Receiver joined room: ${fileId}`);

    } catch (error) {
      console.error("Join Error:", error);
      socket.emit("error", { message: "Failed to join room" });
    }
  });
}

export function handleSignal(socket: Socket, io: any) {
  socket.on("signal", ({ target, data }) => {
    // Validate target socket ID
    const targetValidation = validateSocketId(target);
    if (!targetValidation.valid) {
      return;
    }

    // Validate data exists
    if (!data) {
      return;
    }

    io.to(target).emit("signal", { 
      sender: socket.id, 
      data 
    });
  });
}

export function handleTransferStateChange(socket: Socket) {
  socket.on("transfer-state-change", ({ fileId, state, reason }) => {
    // Validate inputs
    if (!fileId || typeof fileId !== 'string') return;
    if (!state || typeof state !== 'string') return;
    
    console.log(`Transfer state changed in room ${fileId}: ${state}`);
    socket.to(fileId).emit("transfer-state-update", { state, reason, from: socket.id });
  });
}

export function handlePauseTransfer(socket: Socket) {
  socket.on("pause-transfer", ({ fileId }) => {
    if (!fileId || typeof fileId !== 'string') return;
    
    console.log(`Transfer paused in room ${fileId}`);
    socket.to(fileId).emit("transfer-paused", { from: socket.id });
  });
}

export function handleCancelTransfer(socket: Socket) {
  socket.on("cancel-transfer", ({ fileId, reason }) => {
    if (!fileId || typeof fileId !== 'string') return;
    
    console.log(`Transfer cancelled in room ${fileId}: ${reason}`);
    socket.to(fileId).emit("transfer-cancelled", { reason, from: socket.id });
  });
}

export function handleResumeTransfer(socket: Socket) {
  socket.on("resume-transfer", ({ fileId }) => {
    if (!fileId || typeof fileId !== 'string') return;
    
    console.log(`Transfer resumed in room ${fileId}`);
    socket.to(fileId).emit("transfer-resumed", { from: socket.id });
  });
}
