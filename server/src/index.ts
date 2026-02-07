import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import prisma from "./utils/prisma.js";
import {
  handleUploadInit,
  handleJoinRoom,
  handleSignal,
  handleCancelTransfer,
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

io.on("connection", (socket) => {
  console.log('User connected:', socket.id);

  handleUploadInit(socket);
  handleJoinRoom(socket, io);
  handleSignal(socket, io);
  handleCancelTransfer(socket);
  handleTransferComplete(socket);

  socket.on("disconnect", async () => {
    console.log('User disconnected:', socket.id);
    
    const fileIds = sessionManager.getSessionsBySocket(socket.id);
    
    for (const fileId of fileIds) {
      try {
        const session = await prisma.fileSession.findUnique({
          where: { id: fileId }
        });
        
        if (!session) continue;
        
        if (session.status === 'active') {
          await prisma.fileSession.update({
            where: { id: fileId },
            data: { status: 'waiting' }
          });
          console.log(`Reset zombie session ${fileId} to waiting`);
        }
        
        socket.to(fileId).emit("peer-disconnected", { 
          message: "The other user has disconnected" 
        });
      } catch (error) {
        console.error(`Error cleaning up session ${fileId}:`, error);
      }
    }
    
    sessionManager.removeSocket(socket.id);
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
