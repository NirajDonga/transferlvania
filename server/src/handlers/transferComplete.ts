// Handler to mark transfer as complete
import { Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export function handleTransferComplete(socket: Socket) {
  socket.on("transfer-complete", async ({ fileId }) => {
    if (!fileId || typeof fileId !== 'string') return;
    
    try {
      // Delete session immediately after successful transfer
      await prisma.fileSession.delete({
        where: { id: fileId },
      });
      
      console.log(`Transfer completed - session deleted: ${fileId}`);
    } catch (error) {
      console.error("Error deleting completed session:", error);
    }
  });
}
