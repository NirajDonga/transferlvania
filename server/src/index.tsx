// server/index.ts
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { PrismaClient } from "@prisma/client"; // <--- Import Prisma

const app = express();
app.use(cors());


const server = http.createServer(app);
const prisma = new PrismaClient(); // <--- Initialize Database

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// server/index.ts (Update the io.on block)

io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  // 1. SENDER: Start a file session
  socket.on("upload-init", async (data) => {
    try {
      const session = await prisma.fileSession.create({
        data: {
          fileName: data.fileName,
          fileSize: data.fileSize,
          fileType: data.fileType,
          senderSocketId: socket.id,
          status: "waiting",
        },
      });

      console.log(`New File Session: ${session.id}`);
      
      // CRITICAL: Sender joins a "room" named after the file ID
      socket.join(session.id);

      socket.emit("upload-created", { fileId: session.id });
    } catch (error) {
      console.error("Database Error:", error);
    }
  });

  // 2. RECEIVER: Join the session
  socket.on("join-room", async ({ fileId }) => {
    try {
      // Find the file in DB
      const session = await prisma.fileSession.findUnique({
        where: { id: fileId },
      });

      if (!session) {
        socket.emit("error", { message: "File not found or expired" });
        return;
      }

      // Add Receiver to the room
      socket.join(fileId);
      
      // Notify the Receiver about the file details
      socket.emit("file-meta", {
        fileName: session.fileName,
        fileSize: session.fileSize,
        fileType: session.fileType,
      });

      // Notify the Sender that someone joined!
      // 'to(fileId)' sends to everyone in room EXCEPT the person sending
      socket.to(fileId).emit("receiver-joined", { receiverId: socket.id });

      console.log(`Receiver joined room: ${fileId}`);

    } catch (error) {
      console.error("Join Error:", error);
    }
  });

  // When User A sends a signal (Offer/Candidate), forward it to User B
  socket.on("signal", ({ target, data }) => {
    io.to(target).emit("signal", { 
      sender: socket.id, 
      data 
    });
  });

  // Transfer State Synchronization
  socket.on("transfer-state-change", ({ fileId, state, reason }) => {
    console.log(`Transfer state changed in room ${fileId}: ${state}`);
    // Broadcast to everyone in the room EXCEPT the sender
    socket.to(fileId).emit("transfer-state-update", { state, reason, from: socket.id });
  });

  // Pause transfer
  socket.on("pause-transfer", ({ fileId }) => {
    console.log(`Transfer paused in room ${fileId}`);
    socket.to(fileId).emit("transfer-paused", { from: socket.id });
  });

  // Cancel/Stop transfer
  socket.on("cancel-transfer", ({ fileId, reason }) => {
    console.log(`Transfer cancelled in room ${fileId}: ${reason}`);
    socket.to(fileId).emit("transfer-cancelled", { reason, from: socket.id });
  });

  // Resume transfer
  socket.on("resume-transfer", ({ fileId }) => {
    console.log(`Transfer resumed in room ${fileId}`);
    socket.to(fileId).emit("transfer-resumed", { from: socket.id });
  });

  socket.on("disconnect", () => {
    console.log("User Disconnected", socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});