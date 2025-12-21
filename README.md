# 🚀 Transferlvania

**High-Performance P2P File Sharing Platform**

Transferlvania enables secure, direct file transfers between browsers using WebRTC. It supports files of any size (100GB+) by streaming data directly to disk, bypassing server storage and browser memory limits.

[![License](https://img.shields.io/badge/License-MIT-yellow)]() [![WebRTC](https://img.shields.io/badge/WebRTC-P2P-blue)]()

## 🌟 Key Features

- **Peer-to-Peer Transfer**: Files move directly between users via WebRTC DataChannels. Zero latency, no intermediate server storage.
- **Unlimited File Sizes**: Uses [StreamSaver.js](https://github.com/jimmywarting/StreamSaver.js) to stream data directly to the hard drive, bypassing RAM limits.
- **End-to-End Encryption**: All file data is encrypted in transit by WebRTC (DTLS/SRTP).
- **Metadata Encryption**: Filenames and file types are encrypted at rest in the database using **AES-256-GCM**.
- **Secure Signaling**: Dynamic TURN credential generation for reliable connections through firewalls.
- **Password Protection**: Optional SHA-256 hashed password protection for transfers.
- **Resilience**: Automatic backpressure handling for slow networks and connection recovery.

## 🏗️ Architecture

```mermaid
graph LR
    A[Sender Browser] -- WebRTC DataChannel (Encrypted File Stream) --> B[Receiver Browser]
    A -- Socket.IO (Signaling) --> S[Node.js Server]
    B -- Socket.IO (Signaling) --> S
    S -- Prisma --> D[(PostgreSQL)]
```

- **Frontend**: Next.js 16, React 19, Tailwind CSS
- **Backend**: Node.js, Express, Socket.IO
- **Database**: PostgreSQL (via Prisma ORM)
- **Security**: AES-256-GCM (Metadata), SHA-256 (Passwords), Rate Limiting

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL Database

### 1. Server Setup
```bash
cd server
npm install

# Configure Environment
cp .env.example .env
# Edit .env with your database URL and other settings
# Generate a 32-byte hex key for encryption:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Initialize Database
npx prisma generate
npx prisma migrate dev

# Start Server
npm run dev  # Development
npm run build && npm start  # Production
```

### 2. Client Setup
```bash
cd client
npm install

# Configure Environment
cp .env.example .env
# Edit .env with your server URL

# Start Client
npm run dev  # Development
npm run build && npm start  # Production
```

Visit `http://localhost:3000` to start sharing.

## 📦 Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed production deployment instructions including:
- Hosting on Railway, Render, Vercel
- SSL/HTTPS configuration (required for WebRTC)
- TURN server setup
- Environment variable configuration
- Security best practices

## 🔐 Environment Variables

### Server (.env)

```env
# Database Connection (REQUIRED)
DATABASE_URL="postgresql://user:pass@localhost:5432/transferlvania"

# Client URL for CORS (REQUIRED)
CLIENT_URL="http://localhost:3000"

# Server Config
PORT=4000
NODE_ENV="development"

# Security (REQUIRED for production)
# 64-character hex string for AES-256 metadata encryption
METADATA_ENCRYPTION_KEY="your-generated-key-here"

# TURN Server (Optional - improves connectivity)
TURN_SERVER="turn.yourdomain.com"
TURN_SECRET="your-turn-secret"
TURNS_ENABLED="true"
```

### Client (.env.local)

```env
# Server URL (REQUIRED)
NEXT_PUBLIC_SERVER_URL="http://localhost:4000"
```

## 🛡️ Security Implementation

- **Metadata**: Filenames and MIME types are encrypted before storage using `AES-256-GCM`.
- **File Data**: Never touches the server. Streams directly P2P.
- **Validation**: Strict input validation (Zod/manual) for all socket events.
- **Rate Limiting**: Token bucket algorithms prevent DDoS and abuse.
- **Sanitization**: File extensions checked against a blocklist of dangerous types (e.g., .exe, .sh).

MIT License


