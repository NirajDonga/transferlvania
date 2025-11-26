// server/index.ts
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { socketConnectionLimiter } from "./middleware/rateLimiter.js";
import {
  handleUploadInit,
  handleJoinRoom,
  handleSignal,
  handleTransferStateChange,
  handlePauseTransfer,
  handleCancelTransfer,
  handleResumeTransfer,
} from "./handlers/socketHandlers.js";
import { handleTransferComplete } from "./handlers/transferComplete.js";

const app = express();
app.use(cors());

const server = http.createServer(app);
const prisma = new PrismaClient();

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

// Cleanup old/abandoned sessions every hour
// (Successful transfers are deleted immediately via transfer-complete event)
setInterval(async () => {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const deleted = await prisma.fileSession.deleteMany({
      where: {
        createdAt: {
          lt: oneDayAgo,
        },
      },
    });
    if (deleted.count > 0) {
      console.log(`Cleaned up ${deleted.count} abandoned sessions (24hr+ old)`);
    }
  } catch (error) {
    console.error("Cleanup error:", error);
  }
}, 60 * 60 * 1000); // Run every hour

io.on("connection", (socket) => {
  // Rate limit connections per IP
  const clientIp = socket.handshake.address;
  const rateLimitResult = socketConnectionLimiter.check(clientIp);
  
  if (!rateLimitResult.allowed) {
    console.log(`Connection rate limit exceeded for ${clientIp}`);
    socket.emit("error", { message: "Too many connections. Please try again later." });
    socket.disconnect(true);
    return;
  }

  console.log(`User Connected: ${socket.id} (${rateLimitResult.remaining} connections remaining)`);

  // Register all socket event handlers
  handleUploadInit(socket);
  handleJoinRoom(socket, io);
  handleSignal(socket, io);
  handleTransferStateChange(socket);
  handlePauseTransfer(socket);
  handleCancelTransfer(socket);
  handleResumeTransfer(socket);
  handleTransferComplete(socket);

  socket.on("disconnect", () => {
    console.log("User Disconnected", socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});