interface IceServer {
  urls: string | string[];
}

export function getIceServers() {
  const iceServers: IceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' }
  ];
  
  return iceServers;
}
