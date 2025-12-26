import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import prisma from "./utils/prisma.js";
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
import { sessionManager } from "./utils/sessionManager.js";
import { validateEnvironment } from "./utils/envValidation.js";
import { getIceServers } from "./utils/turnCredentials.js";

const config = validateEnvironment();

const app = express();
app.use(cors({
  origin: config.CLIENT_URL,
  credentials: true,
}));
app.use(express.json());

app.get('/api/ice-servers', (req, res) => {
  try {
    const iceServers = getIceServers();
    res.json({ iceServers });
  } catch (error) {
    console.error('Failed to generate ICE servers:', error);
    res.json({ 
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] 
    });
  }
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: config.CLIENT_URL,
    methods: ["GET", "POST"],
  },
});

setInterval(async () => {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const deleted = await prisma.fileSession.deleteMany({
      where: {
        createdAt: {
          lt: oneDayAgo,
        },
        status: {
          in: ["waiting", "completed"]
        }
      },
    });
    
    sessionManager.cleanup(24 * 60 * 60 * 1000);
    
    if (deleted.count > 0) {
      console.log(`Cleanup: Deleted ${deleted.count} old sessions`);
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}, 60 * 60 * 1000);

io.on("connection", (socket) => {
  console.log('User connected:', socket.id);

  handleUploadInit(socket);
  handleJoinRoom(socket, io);
  handleSignal(socket, io);
  handleTransferStateChange(socket);
  handlePauseTransfer(socket);
  handleCancelTransfer(socket);
  handleResumeTransfer(socket);
  handleTransferComplete(socket);

  socket.on("disconnect", () => {
    console.log('User disconnected:', socket.id);
  });
});

server.listen(config.PORT, () => {
  console.log(` Server running on port ${config.PORT}`);
  console.log(` Client URL: ${config.CLIENT_URL}`);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  io.close();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  io.close();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});
