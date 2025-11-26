import { Socket } from "socket.io";
import prisma from "../utils/prisma.js";
import { sessionManager } from "../utils/sessionManager.js";
import { logger } from "../utils/logger.js";
import { validateUUID } from "../utils/validation.js";
import { sessionLimiter } from "../middleware/sessionLimiter.js";

export function handleTransferComplete(socket: Socket) {
  socket.on("transfer-complete", async ({ fileId }) => {
    if (!fileId || typeof fileId !== 'string') return;
    
    try {
      await prisma.fileSession.delete({
        where: { id: fileId },
      });
      
      sessionManager.remove(fileId);
      
      // Decrement session count for this IP
      sessionLimiter.decrementSession(socket.handshake.address);
      
      logger.log('info', 'Transfer completed - session deleted', { fileId, socketId: socket.id });
    } catch (error) {
      logger.log('error', 'Error deleting completed session', { fileId, details: error });
    }
  });
}
