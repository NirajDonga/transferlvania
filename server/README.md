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
- No external dependencies - custom in-memory rate limiter
- Automatic cleanup of expired entries

### ✅ Input Validation
- File name sanitization (removes path traversal, dangerous characters)
- File size validation (max 100GB)
- File type validation
- UUID format validation for file IDs
- Socket ID validation

### ✅ CORS Security
- Restricted to `http://localhost:3000` only
- No wildcard origins

### ✅ Session Cleanup
- Automatically deletes sessions older than 24 hours
- Runs every hour
- Prevents database bloat

### ✅ Code Organization
- Separated concerns into handlers, middleware, and utilities
- Reusable validation functions
- Clean, maintainable structure

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

### File Sizes
- Must be positive number
- Max: 100GB (configurable in `utils/validation.ts`)

### File IDs
- Must be valid UUIDv4 format

## Security Features

1. ✅ CORS restricted
2. ✅ Input validation on all endpoints
3. ✅ Rate limiting on connections and operations
4. ✅ SQL injection protection (Prisma ORM)
5. ✅ Session expiration
6. ✅ Path traversal protection
7. ✅ File size limits

## Still Needed (Optional Enhancements)

- [ ] Authentication/authorization
- [ ] Request logging
- [ ] Monitoring/metrics
- [ ] DDoS protection (use reverse proxy)
- [ ] File integrity checks (hashing)
