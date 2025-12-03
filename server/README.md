# Server Structure

## Directory Layout

```
server/
├── src/
│   ├── index.tsx              # Main server entry point
│   ├── handlers/
│   │   └── socketHandlers.ts  # Socket.IO event handlers
│   ├── middleware/
│   │   └── rateLimiter.ts     # Custom rate limiting
│   └── utils/
│       └── validation.ts      # Input validation utilities
├── prisma/
│   └── schema.prisma
└── package.json
```

## Features Implemented

### ✅ Rate Limiting (Custom Implementation)
- **Connection Rate Limit**: 10 connections per minute per IP
- **Upload Init Rate Limit**: 5 uploads per 5 minutes per socket
- **Join Room Rate Limit**: 20 room joins per minute per socket
- **Session Limit**: Per-IP session creation limits
- No external dependencies - custom in-memory rate limiter
- Automatic cleanup of expired entries

### ✅ Input Validation
- File name sanitization (removes path traversal, dangerous characters)
- File size validation (max 100GB, BigInt support)
- File type validation with dangerous file detection
- UUID format validation for file IDs
- Socket ID validation
- Dangerous file extension warnings (executables, scripts)

### ✅ Security Features
- CORS restricted to `http://localhost:3000` only
- Password protection for file transfers (bcrypt hashing)
- DDoS protection middleware
- Security headers middleware
- SQL injection protection (Prisma ORM)
- Path traversal protection
- Suspicious activity tracking

### ✅ Session Management
- Automatically deletes sessions older than 24 hours
- Session cleanup runs every hour
- Per-IP session limits
- Prevents database bloat
- Transfer state tracking (waiting, active, completed)

### ✅ Code Organization
- Separated concerns into handlers, middleware, and utilities
- Reusable validation functions
- Comprehensive logging system
- Clean, maintainable structure
- No unnecessary encryption overhead

## Rate Limiter Configuration

You can adjust rate limits in `middleware/rateLimiter.ts`:

```typescript
export const socketConnectionLimiter = new RateLimiter(60000, 10);  // windowMs, maxRequests
export const uploadInitLimiter = new RateLimiter(300000, 5);
export const joinRoomLimiter = new RateLimiter(60000, 20);
```

## Validation Rules

### File Names
- Max 255 characters
- Removes: `..`, `/`, `\`, `<`, `>`, `:`, `"`, `|`, `?`, `*`, control characters
- Stored as plain text in database

### File Sizes
- Must be positive number
- Max: 100GB (configurable in `utils/validation.ts`)
- Stored as BigInt in database for precision

### File Types
- Validated and sanitized
- Dangerous MIME types detected and warned
- Max 100 characters

### File IDs
- Must be valid UUIDv4 format

## Security Features

1. ✅ CORS restricted to localhost
2. ✅ Input validation on all socket events
3. ✅ Rate limiting on connections and operations
4. ✅ SQL injection protection (Prisma ORM)
5. ✅ Session expiration (24 hour TTL)
6. ✅ Path traversal protection
7. ✅ File size limits (100GB max)
8. ✅ Password protection (bcrypt hashing)
9. ✅ DDoS protection middleware
10. ✅ Security headers middleware
11. ✅ Dangerous file type warnings
12. ✅ Suspicious activity tracking
13. ✅ Per-IP session limits

## Architecture Decisions

### Why No Encryption for File Metadata?
- File names and types are transferred over WebRTC (peer-to-peer)
- Database only stores metadata temporarily (24h max)
- Encryption adds unnecessary complexity for temporary data
- Password protection secures access control
- Focus on secure transfer channel (WebRTC) rather than at-rest encryption

## Optional Enhancements

- [ ] End-to-end file content encryption
- [ ] File integrity checks (SHA-256 hashing)
- [ ] Monitoring/metrics dashboard
- [ ] TURN server integration (included but optional)
- [ ] User accounts and transfer history
