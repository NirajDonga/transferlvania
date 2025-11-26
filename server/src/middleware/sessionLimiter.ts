import { logger } from '../utils/logger.js';

interface SessionTracker {
  count: number;
  firstSessionTime: number;
  lastSessionTime: number;
}

class SessionLimiter {
  private ipSessions: Map<string, SessionTracker> = new Map();
  private readonly MAX_SESSIONS_PER_IP = 10;
  private readonly TIME_WINDOW_MS = 60 * 60 * 1000; // 1 hour
  private readonly MAX_SESSIONS_PER_HOUR = 20;
  private readonly CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

  constructor() {
    // Periodic cleanup of old entries
    setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL_MS);
  }

  check(ip: string): { allowed: boolean; reason?: string; currentCount?: number; limit?: number } {
    const now = Date.now();
    let tracker = this.ipSessions.get(ip);

    if (!tracker) {
      // First session from this IP
      this.ipSessions.set(ip, {
        count: 1,
        firstSessionTime: now,
        lastSessionTime: now,
      });
      return { allowed: true };
    }

    // Check if time window has expired (reset counter)
    if (now - tracker.firstSessionTime > this.TIME_WINDOW_MS) {
      this.ipSessions.set(ip, {
        count: 1,
        firstSessionTime: now,
        lastSessionTime: now,
      });
      return { allowed: true };
    }

    // Check hourly limit
    if (tracker.count >= this.MAX_SESSIONS_PER_HOUR) {
      const timeRemaining = Math.ceil((tracker.firstSessionTime + this.TIME_WINDOW_MS - now) / 1000 / 60);
      logger.trackSuspiciousActivity(ip, `Session creation limit exceeded: ${tracker.count} sessions in 1 hour`);
      logger.log('security', 'Session creation limit exceeded', {
        ip,
        details: {
          sessionsCreated: tracker.count,
          limit: this.MAX_SESSIONS_PER_HOUR,
          timeWindow: '1 hour',
          resetInMinutes: timeRemaining,
        },
      });
      return {
        allowed: false,
        reason: `Maximum ${this.MAX_SESSIONS_PER_HOUR} sessions per hour exceeded. Try again in ${timeRemaining} minutes.`,
        currentCount: tracker.count,
        limit: this.MAX_SESSIONS_PER_HOUR,
      };
    }

    // Check concurrent session limit
    if (tracker.count >= this.MAX_SESSIONS_PER_IP) {
      logger.trackSuspiciousActivity(ip, `Too many concurrent sessions: ${tracker.count}`);
      logger.log('security', 'Concurrent session limit exceeded', {
        ip,
        details: {
          currentSessions: tracker.count,
          limit: this.MAX_SESSIONS_PER_IP,
        },
      });
      return {
        allowed: false,
        reason: `Maximum ${this.MAX_SESSIONS_PER_IP} concurrent sessions allowed per IP.`,
        currentCount: tracker.count,
        limit: this.MAX_SESSIONS_PER_IP,
      };
    }

    // Increment counter
    tracker.count++;
    tracker.lastSessionTime = now;
    this.ipSessions.set(ip, tracker);

    return { allowed: true };
  }

  decrementSession(ip: string): void {
    const tracker = this.ipSessions.get(ip);
    if (tracker && tracker.count > 0) {
      tracker.count--;
      if (tracker.count === 0) {
        this.ipSessions.delete(ip);
      } else {
        this.ipSessions.set(ip, tracker);
      }
    }
  }

  cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [ip, tracker] of this.ipSessions.entries()) {
      // Remove entries older than time window with no active sessions
      if (tracker.count === 0 && now - tracker.lastSessionTime > this.TIME_WINDOW_MS) {
        this.ipSessions.delete(ip);
        removed++;
      }
      // Reset counter for entries outside time window but still active
      else if (now - tracker.firstSessionTime > this.TIME_WINDOW_MS) {
        tracker.count = 0;
        tracker.firstSessionTime = now;
        this.ipSessions.set(ip, tracker);
      }
    }

    if (removed > 0) {
      logger.log('info', 'Session limiter cleanup completed', {
        details: { entriesRemoved: removed, remainingEntries: this.ipSessions.size },
      });
    }
  }

  getStats(): { totalTracked: number; details: Array<{ ip: string; sessions: number; age: string }> } {
    const now = Date.now();
    const details: Array<{ ip: string; sessions: number; age: string }> = [];

    for (const [ip, tracker] of this.ipSessions.entries()) {
      const ageMinutes = Math.floor((now - tracker.firstSessionTime) / 1000 / 60);
      details.push({
        ip,
        sessions: tracker.count,
        age: `${ageMinutes}m`,
      });
    }

    return {
      totalTracked: this.ipSessions.size,
      details: details.sort((a, b) => b.sessions - a.sessions).slice(0, 10), // Top 10
    };
  }
}

export const sessionLimiter = new SessionLimiter();
