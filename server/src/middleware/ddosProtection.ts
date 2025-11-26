import { Socket } from "socket.io";
import { logger } from "../utils/logger.js";

interface ConnectionTracker {
  count: number;
  firstConnection: number;
  blocked: boolean;
  blockExpiry: number;
}

class DDoSProtection {
  private connections: Map<string, ConnectionTracker> = new Map();
  private readonly MAX_CONNECTIONS_PER_IP = 10;
  private readonly TIME_WINDOW = 60 * 1000;
  private readonly BLOCK_DURATION = 15 * 60 * 1000;
  private readonly SUSPICIOUS_THRESHOLD = 50;

  check(ip: string): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const tracker = this.connections.get(ip);

    if (tracker?.blocked) {
      if (now < tracker.blockExpiry) {
        const remainingMinutes = Math.ceil((tracker.blockExpiry - now) / 60000);
        return { 
          allowed: false, 
          reason: `IP blocked for ${remainingMinutes} more minutes due to suspicious activity` 
        };
      } else {
        this.connections.delete(ip);
      }
    }

    if (!tracker) {
      this.connections.set(ip, {
        count: 1,
        firstConnection: now,
        blocked: false,
        blockExpiry: 0,
      });
      return { allowed: true };
    }

    if (now - tracker.firstConnection > this.TIME_WINDOW) {
      tracker.count = 1;
      tracker.firstConnection = now;
      return { allowed: true };
    }

    tracker.count++;

    if (tracker.count > this.SUSPICIOUS_THRESHOLD) {
      tracker.blocked = true;
      tracker.blockExpiry = now + this.BLOCK_DURATION;
      logger.log('security', 'IP blocked for DDoS attempt', {
        ip,
        details: { connections: tracker.count, windowSeconds: this.TIME_WINDOW / 1000 }
      });
      return { 
        allowed: false, 
        reason: `Too many connections. Blocked for ${this.BLOCK_DURATION / 60000} minutes` 
      };
    }

    if (tracker.count > this.MAX_CONNECTIONS_PER_IP) {
      logger.trackSuspiciousActivity(ip, 'Excessive connection attempts');
      return { 
        allowed: false, 
        reason: `Connection limit exceeded. Please wait before reconnecting` 
      };
    }

    return { allowed: true };
  }

  trackDisconnect(ip: string) {
    const tracker = this.connections.get(ip);
    if (tracker && !tracker.blocked) {
      tracker.count = Math.max(0, tracker.count - 1);
    }
  }

  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [ip, tracker] of this.connections.entries()) {
      if (tracker.blocked && now > tracker.blockExpiry) {
        this.connections.delete(ip);
        cleaned++;
      } else if (!tracker.blocked && now - tracker.firstConnection > this.TIME_WINDOW && tracker.count === 0) {
        this.connections.delete(ip);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.log('info', `DDoS protection cleanup: removed ${cleaned} stale entries`);
    }
  }

  getStats() {
    const stats = {
      totalTracked: this.connections.size,
      blocked: 0,
      active: 0,
    };

    for (const tracker of this.connections.values()) {
      if (tracker.blocked) {
        stats.blocked++;
      } else if (tracker.count > 0) {
        stats.active++;
      }
    }

    return stats;
  }

  isBlocked(ip: string): boolean {
    const tracker = this.connections.get(ip);
    return tracker?.blocked && Date.now() < tracker.blockExpiry || false;
  }
}

export const ddosProtection = new DDoSProtection();

setInterval(() => {
  ddosProtection.cleanup();
}, 5 * 60 * 1000);
