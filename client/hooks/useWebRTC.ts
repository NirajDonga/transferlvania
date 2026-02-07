/**
 * useWebRTC Hook
 * Encapsulates WebRTC peer connection logic
 * Handles connection lifecycle, data channels, and ICE candidates
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { getIceServers } from '@/lib/ice-servers';
import { DEFAULT_ICE_SERVERS, MAX_BUFFER_AMOUNT } from '@/types/socket-events';

export type ConnectionStatus = 
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'waiting-acceptance'
  | 'transferring'
  | 'completed'
  | 'error'
  | 'closed';

interface UseWebRTCOptions {
  onIceCandidate?: (candidate: RTCIceCandidate) => void;
  onDataChannelOpen?: () => void;
  onDataChannelClose?: () => void;
  onDataChannelMessage?: (data: ArrayBuffer | string) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}

export const useWebRTC = (options: UseWebRTCOptions = {}) => {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [rtcConfig, setRtcConfig] = useState<RTCConfiguration>({
    iceServers: DEFAULT_ICE_SERVERS,
  });
  
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const optionsRef = useRef(options);

  // Keep options ref updated
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Initialize ICE servers on mount
  useEffect(() => {
    const initIceServers = async () => {
      try {
        const servers = await getIceServers();
        setRtcConfig({ iceServers: servers });
      } catch (error) {
        console.error('Failed to fetch ICE servers, using defaults:', error);
      }
    };
    initIceServers();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      closePeerConnection();
    };
  }, []);

  const closePeerConnection = useCallback(() => {
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    setStatus('closed');
  }, []);

  const setupDataChannelHandlers = useCallback((channel: RTCDataChannel) => {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = MAX_BUFFER_AMOUNT;
    dataChannelRef.current = channel;

    channel.onopen = () => {
      setStatus('waiting-acceptance');
      optionsRef.current.onDataChannelOpen?.();
    };

    channel.onclose = () => {
      setStatus('closed');
      optionsRef.current.onDataChannelClose?.();
    };

    channel.onmessage = (event) => {
      optionsRef.current.onDataChannelMessage?.(event.data);
    };
  }, []);

  const createPeerConnection = useCallback((): RTCPeerConnection => {
    const pc = new RTCPeerConnection(rtcConfig);
    peerRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        optionsRef.current.onIceCandidate?.(event.candidate);
      }
    };

    pc.onconnectionstatechange = () => {
      optionsRef.current.onConnectionStateChange?.(pc.connectionState);
      
      if (pc.connectionState === 'connected') {
        setStatus('connected');
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setStatus('error');
      }
    };

    return pc;
  }, [rtcConfig]);

  // For sender: create offer and data channel
  const createOffer = useCallback(async (): Promise<RTCSessionDescriptionInit> => {
    setStatus('connecting');
    
    const pc = createPeerConnection();
    const channel = pc.createDataChannel('file-transfer');
    setupDataChannelHandlers(channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    return offer;
  }, [createPeerConnection, setupDataChannelHandlers]);

  // For receiver: handle incoming offer
  const handleOffer = useCallback(async (
    offer: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit> => {
    setStatus('connecting');
    
    const pc = createPeerConnection();
    
    pc.ondatachannel = (event) => {
      setupDataChannelHandlers(event.channel);
    };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    return answer;
  }, [createPeerConnection, setupDataChannelHandlers]);

  // Handle incoming answer (for sender)
  const handleAnswer = useCallback(async (answer: RTCSessionDescriptionInit) => {
    if (!peerRef.current) return;
    await peerRef.current.setRemoteDescription(answer);
  }, []);

  // Handle ICE candidate
  const addIceCandidate = useCallback(async (candidate: RTCIceCandidate) => {
    if (!peerRef.current) return;
    await peerRef.current.addIceCandidate(candidate);
  }, []);

  // Send data through data channel
  const sendData = useCallback((data: ArrayBuffer | string) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }
    if (typeof data === 'string') {
      dataChannelRef.current.send(data);
    } else {
      dataChannelRef.current.send(data);
    }
  }, []);

  // Check if we can send more data (for flow control)
  const canSendMore = useCallback((): boolean => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== 'open') return false;
    return channel.bufferedAmount <= channel.bufferedAmountLowThreshold;
  }, []);

  // Set callback for when buffer is ready for more data
  const onBufferLow = useCallback((callback: () => void) => {
    const channel = dataChannelRef.current;
    if (channel) {
      channel.onbufferedamountlow = callback;
    }
  }, []);

  const getDataChannel = useCallback(() => dataChannelRef.current, []);
  const getPeerConnection = useCallback(() => peerRef.current, []);

  return {
    status,
    setStatus,
    createOffer,
    handleOffer,
    handleAnswer,
    addIceCandidate,
    sendData,
    canSendMore,
    onBufferLow,
    closePeerConnection,
    getDataChannel,
    getPeerConnection,
  };
};
