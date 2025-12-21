import crypto from 'crypto';

interface TurnCredentials {
  username: string;
  credential: string;
}

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export function generateTurnCredentials(secret: string, ttlHours: number = 24): TurnCredentials {
  const timestamp = Math.floor(Date.now() / 1000) + (ttlHours * 3600);
  const username = `${timestamp}:transferlvania-user`;
  
  const hmac = crypto.createHmac('sha1', secret);
  hmac.update(username);
  const credential = hmac.digest('base64');
  
  return { username, credential };
}

export function getIceServers() {
  const turnSecret = process.env.TURN_SECRET;
  const turnServer = process.env.TURN_SERVER;
  
  const iceServers: IceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' }
  ];
  
  if (turnServer && turnSecret) {
    const credentials = generateTurnCredentials(turnSecret);
    
    iceServers.push(
      { urls: `stun:${turnServer}:3478` },
      {
        urls: [
          `turn:${turnServer}:3478?transport=udp`,
          `turn:${turnServer}:3478?transport=tcp`
        ],
        username: credentials.username,
        credential: credentials.credential
      }
    );
    
    if (process.env.TURNS_ENABLED === 'true') {
      iceServers.push({
        urls: `turns:${turnServer}:5349`,
        username: credentials.username,
        credential: credentials.credential
      });
    }
  } else {
    console.warn('TURN server not configured. Using public STUN only. Set TURN_SERVER and TURN_SECRET in .env for better connectivity.');
  }
  
  return iceServers;
}
