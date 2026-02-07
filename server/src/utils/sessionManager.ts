interface ActiveSession {
  senderSocketId: string;
  createdAt: number;
  oneTimeCode: string;
  codeUsed: boolean;
}

// Generate a random 6-character alphanumeric code
function generateOneTimeCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

class SessionManager {
  private activeSessions: Map<string, ActiveSession> = new Map();

  register(fileId: string, senderSocketId: string): string {
    const oneTimeCode = generateOneTimeCode();
    this.activeSessions.set(fileId, {
      senderSocketId,
      createdAt: Date.now(),
      oneTimeCode,
      codeUsed: false,
    });
    return oneTimeCode;
  }

  getSender(fileId: string): string | null {
    const session = this.activeSessions.get(fileId);
    return session ? session.senderSocketId : null;
  }

  isSender(fileId: string, socketId: string): boolean {
    const session = this.activeSessions.get(fileId);
    return session?.senderSocketId === socketId;
  }

  validateCode(fileId: string, code: string): { valid: boolean; error?: string } {
    const session = this.activeSessions.get(fileId);
    
    if (!session) {
      return { valid: false, error: "Session not found" };
    }
    
    if (session.codeUsed) {
      return { valid: false, error: "Code already used" };
    }
    
    if (session.oneTimeCode !== code.toUpperCase()) {
      return { valid: false, error: "Invalid code" };
    }
    
    // Mark code as used
    session.codeUsed = true;
    return { valid: true };
  }

  getOneTimeCode(fileId: string): string | null {
    const session = this.activeSessions.get(fileId);
    return session ? session.oneTimeCode : null;
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
