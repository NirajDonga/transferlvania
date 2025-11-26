interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'security';
  event: string;
  socketId?: string;
  fileId?: string;
  ip?: string;
  details?: any;
}

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs: number = 10000;
  private suspiciousActivity: Map<string, number> = new Map();

  log(level: LogEntry['level'], event: string, data?: Partial<LogEntry>) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      event,
      ...data,
    };

    this.logs.push(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    const logMessage = this.formatLog(entry);
    
    if (level === 'error' || level === 'security') {
      console.error(logMessage);
    } else if (level === 'warn') {
      console.warn(logMessage);
    } else {
      console.log(logMessage);
    }
  }

  private formatLog(entry: LogEntry): string {
    const date = new Date(entry.timestamp).toISOString();
    const details = entry.details ? ` | ${JSON.stringify(entry.details)}` : '';
    const ip = entry.ip ? ` [${entry.ip}]` : '';
    const fileId = entry.fileId ? ` file:${entry.fileId}` : '';
    const socketId = entry.socketId ? ` socket:${entry.socketId}` : '';
    
    return `[${date}] ${entry.level.toUpperCase()}${ip}${socketId}${fileId}: ${entry.event}${details}`;
  }

  trackSuspiciousActivity(identifier: string, reason: string) {
    const count = (this.suspiciousActivity.get(identifier) || 0) + 1;
    this.suspiciousActivity.set(identifier, count);

    this.log('security', 'Suspicious activity detected', {
      ip: identifier,
      details: { reason, count },
    });

    if (count >= 5) {
      this.log('security', 'ALERT: Multiple suspicious activities from same source', {
        ip: identifier,
        details: { count, reason },
      });
    }

    return count;
  }

  getRecentLogs(count: number = 100, level?: LogEntry['level']): LogEntry[] {
    let filtered = this.logs;
    
    if (level) {
      filtered = this.logs.filter(log => log.level === level);
    }
    
    return filtered.slice(-count);
  }

  getSecurityEvents(since?: number): LogEntry[] {
    const timestamp = since || Date.now() - 24 * 60 * 60 * 1000;
    return this.logs.filter(
      log => log.level === 'security' && log.timestamp >= timestamp
    );
  }

  getStats() {
    const last24h = Date.now() - 24 * 60 * 60 * 1000;
    const recent = this.logs.filter(log => log.timestamp >= last24h);
    
    return {
      totalLogs: this.logs.length,
      last24h: recent.length,
      errors: recent.filter(l => l.level === 'error').length,
      securityEvents: recent.filter(l => l.level === 'security').length,
      suspiciousIPs: this.suspiciousActivity.size,
    };
  }

  clearOldLogs(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    const originalLength = this.logs.length;
    this.logs = this.logs.filter(log => log.timestamp >= cutoff);
    
    const removed = originalLength - this.logs.length;
    if (removed > 0) {
      this.log('info', `Cleared ${removed} old log entries`);
    }
  }
}

export const logger = new Logger();
