import { Socket } from "socket.io";
import prisma from "../utils/prisma.js";
import { sessionManager } from "../utils/sessionManager.js";

export function handleTransferComplete(socket: Socket) {
  socket.on("transfer-complete", async ({ fileId }) => {
    if (!fileId || typeof fileId !== 'string') return;
    
    try {
      await prisma.fileSession.update({
        where: { id: fileId },
        data: { status: "completed" },
      });
      
      sessionManager.remove(fileId);
      
      socket.to(fileId).emit("transfer-complete-ack");
    } catch (error) {
      console.error('Error updating completed session:', error);
    }
  });
}
