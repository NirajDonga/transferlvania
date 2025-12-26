interface ActiveSession {
  senderSocketId: string;
  createdAt: number;
}

class SessionManager {
  private activeSessions: Map<string, ActiveSession> = new Map();

  register(fileId: string, senderSocketId: string) {
    this.activeSessions.set(fileId, {
      senderSocketId,
      createdAt: Date.now(),
    });
  }

  getSender(fileId: string): string | null {
    const session = this.activeSessions.get(fileId);
    return session ? session.senderSocketId : null;
  }

  isSender(fileId: string, socketId: string): boolean {
    const session = this.activeSessions.get(fileId);
    return session?.senderSocketId === socketId;
  }

  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    for (const [fileId, session] of this.activeSessions.entries()) {
      if (now - session.createdAt > maxAgeMs) {
        this.activeSessions.delete(fileId);
      }
    }
  }

  getSessionsBySocket(socketId: string): string[] {
    const fileIds: string[] = [];
    for (const [fileId, session] of this.activeSessions.entries()) {
      if (session.senderSocketId === socketId) {
        fileIds.push(fileId);
      }
    }
    return fileIds;
  }

  removeSocket(socketId: string) {
    const fileIds = this.getSessionsBySocket(socketId);
    for (const fileId of fileIds) {
      this.activeSessions.delete(fileId);
    }
  }
}

export const sessionManager = new SessionManager();
