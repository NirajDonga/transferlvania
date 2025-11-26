import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import prisma from "./utils/prisma.js";
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
import { sessionManager } from "./utils/sessionManager.js";
import { logger } from "./utils/logger.js";
import { ddosProtection } from "./middleware/ddosProtection.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { sessionLimiter } from "./middleware/sessionLimiter.js";
import { validateEnvironment } from "./utils/envValidation.js";

// Validate environment variables before starting server
const config = validateEnvironment();

const app = express();
app.use(securityHeaders);
app.use(cors({
  origin: "http://localhost:3000",
  credentials: true,
}));
app.use(express.json());

app.get('/api/ice-servers', (req, res) => {
  try {
    const { getIceServers } = require('./utils/turnCredentials.js');
    const iceServers = getIceServers();
    res.json({ iceServers });
  } catch (error) {
    logger.log('error', 'Failed to generate ICE servers', { details: error });
    res.json({ 
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] 
    });
  }
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
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
      },
    });
    
    sessionManager.cleanup(24 * 60 * 60 * 1000);
    logger.clearOldLogs(7 * 24 * 60 * 60 * 1000);
    
    const ddosStats = ddosProtection.getStats();
    const sessionStats = sessionLimiter.getStats();
    
    if (deleted.count > 0 || ddosStats.blocked > 0) {
      logger.log('info', 'Cleanup completed', { 
        details: { 
          deletedSessions: deleted.count,
          ddosBlocked: ddosStats.blocked,
          ddosTracked: ddosStats.totalTracked,
          sessionLimiterTracked: sessionStats.totalTracked
        } 
      });
    }
  } catch (error) {
    logger.log('error', 'Cleanup error', { details: error });
  }
}, 60 * 60 * 1000); // Run every hour

io.on("connection", (socket) => {
  const clientIp = socket.handshake.address;
  
  const ddosCheck = ddosProtection.check(clientIp);
  if (!ddosCheck.allowed) {
    logger.log('security', 'Connection blocked - DDoS protection', { 
      ip: clientIp, 
      details: { reason: ddosCheck.reason } 
    });
    socket.emit("error", { message: ddosCheck.reason || "Connection blocked" });
    socket.disconnect(true);
    return;
  }
  
  const rateLimitResult = socketConnectionLimiter.check(clientIp);
  if (!rateLimitResult.allowed) {
    logger.trackSuspiciousActivity(clientIp, 'Connection rate limit exceeded');
    logger.log('security', 'Connection blocked - rate limit', { ip: clientIp });
    socket.emit("error", { message: "Too many connections. Please try again later." });
    socket.disconnect(true);
    return;
  }

  logger.log('info', 'User connected', { socketId: socket.id, ip: clientIp, details: { remaining: rateLimitResult.remaining } });

  handleUploadInit(socket);
  handleJoinRoom(socket, io);
  handleSignal(socket, io);
  handleTransferStateChange(socket);
  handlePauseTransfer(socket);
  handleCancelTransfer(socket);
  handleResumeTransfer(socket);
  handleTransferComplete(socket);

  socket.on("disconnect", () => {
    ddosProtection.trackDisconnect(clientIp);
    logger.log('info', 'User disconnected', { socketId: socket.id });
  });
});

server.listen(config.PORT, () => {
  logger.log('info', 'Server started', { details: { port: config.PORT } });
  console.log(`SERVER RUNNING ON PORT ${config.PORT}`);
  console.log(`Logging enabled - Security events tracked`);
  console.log(`Security headers enabled - CSP, X-Frame-Options, HSTS active`);
});

async function gracefulShutdown(signal: string) {
  logger.log('info', `${signal} received - initiating graceful shutdown`);
  console.log(`\n${signal} received - shutting down gracefully...`);

  io.close(() => {
    logger.log('info', 'Socket.IO connections closed');
    console.log('Socket.IO connections closed');
  });

  server.close(async () => {
    logger.log('info', 'HTTP server closed');
    console.log('HTTP server closed');

    try {
      await prisma.$disconnect();
      logger.log('info', 'Prisma disconnected successfully');
      console.log('Prisma disconnected successfully');
      process.exit(0);
    } catch (error) {
      logger.log('error', 'Error during Prisma disconnect', { details: error });
      console.error('Error during Prisma disconnect:', error);
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.log('error', 'Forced shutdown - timeout exceeded');
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.log('error', 'Uncaught exception', { details: error });
  console.error('Uncaught exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.log('error', 'Unhandled rejection', { details: { reason, promise } });
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});