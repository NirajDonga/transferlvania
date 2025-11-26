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

  remove(fileId: string) {
    this.activeSessions.delete(fileId);
  }

  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    for (const [fileId, session] of this.activeSessions.entries()) {
      if (now - session.createdAt > maxAgeMs) {
        this.activeSessions.delete(fileId);
      }
    }
  }

  getStats() {
    return {
      activeSessions: this.activeSessions.size,
    };
  }
}

export const sessionManager = new SessionManager();
