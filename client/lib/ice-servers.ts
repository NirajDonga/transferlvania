const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:4000';

export async function getIceServers(): Promise<RTCIceServer[]> {
  try {
    const response = await fetch(`${SERVER_URL}/api/ice-servers`);
    const data = await response.json();
    return data.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
  } catch (error) {
    console.error('Failed to fetch ICE servers, using fallback', error);
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
}
