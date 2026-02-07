"use client";

import { useEffect, useState, useRef, use, useCallback } from "react";
import { useSignaling } from "@/hooks/useSignaling";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useFileHash } from "@/hooks/useFileHash";
import type { FileMetaData, SignalPayload, ErrorPayload, TransferCancelledPayload } from "@/types/socket-events";

export default function DownloadPage({ params }: { params: Promise<{ fileId: string }> }) {
  const resolvedParams = use(params);
  const { fileId } = resolvedParams;

  // UI State
  const [status, setStatus] = useState("Enter the connection code to start");
  const [fileMeta, setFileMeta] = useState<FileMetaData | null>(null);
  const [progress, setProgress] = useState(0);
  const [isP2PReady, setIsP2PReady] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSelectingLocation, setIsSelectingLocation] = useState(false);
  const [codeRequired, setCodeRequired] = useState(true);
  const [code, setCode] = useState("");

  // Refs
  const fileMetaRef = useRef<FileMetaData | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter | null>(null);
  const streamSaverRef = useRef<any>(null);
  const receivedBytes = useRef(0);
  const isCancelledRef = useRef(false);
  const lastProgress = useRef(0);
  const receivedChunksRef = useRef<Uint8Array[]>([]);
  const senderIdRef = useRef<string | null>(null);

  // Hash verification hook
  const { verifyHash } = useFileHash();

  // WebRTC setup
  const {
    handleOffer,
    addIceCandidate,
    closePeerConnection,
    getDataChannel,
  } = useWebRTC({
    onIceCandidate: (candidate) => {
      if (senderIdRef.current) {
        sendSignal({
          target: senderIdRef.current,
          data: { candidate },
          fileId,
        });
      }
    },
    onDataChannelOpen: () => {
      setStatus("Connection Established. Waiting for you to accept.");
      setIsP2PReady(true);
    },
    onDataChannelClose: () => {
      if (!isCancelledRef.current) {
        setStatus("Connection closed by Sender.");
        setIsDownloading(false);
      }
    },
    onDataChannelMessage: async (data) => {
      if (isCancelledRef.current || !writerRef.current) return;

      try {
        const chunkArray = new Uint8Array(data as ArrayBuffer);
        receivedChunksRef.current.push(chunkArray);
        
        await writerRef.current.write(chunkArray);
        
        receivedBytes.current += (data as ArrayBuffer).byteLength;
        const meta = fileMetaRef.current;
        
        if (meta?.fileSize) {
          const total = meta.fileSize;
          const percent = Math.round((receivedBytes.current / total) * 100);
          
          if (percent - lastProgress.current >= 1 || percent === 100) {
            lastProgress.current = percent;
            setProgress(percent);
          }

          if (receivedBytes.current >= total) {
            await handleTransferComplete();
          }
        }
      } catch (err) {
        console.error("Write error:", err);
        setStatus("Download error");
        setIsDownloading(false);
      }
    },
  });

  // Handle transfer completion with hash verification
  const handleTransferComplete = useCallback(async () => {
    setStatus("Verifying file integrity...");
    
    if (writerRef.current) {
      await writerRef.current.close();
      writerRef.current = null;
    }
    
    const meta = fileMetaRef.current;
    if (meta?.fileHash) {
      const isValid = await verifyHash(receivedChunksRef.current, meta.fileHash);
      
      if (!isValid) {
        setStatus("Error: File integrity check failed!");
        alert("File integrity verification failed. The downloaded file may be corrupted.");
      } else {
        setStatus("Download Complete! File verified.");
      }
    } else {
      setStatus("Download Complete!");
    }
    
    setIsDownloading(false);
    emitTransferComplete(fileId);
  }, [fileId, verifyHash]);

  // Signaling setup
  const { sendSignal, joinRoom, cancelTransfer, emitTransferComplete } = useSignaling({
    onFileMeta: useCallback((meta: FileMetaData) => {
      if (meta.isDangerous && meta.warnings) {
        const proceed = confirm(
          `SECURITY WARNING\n\n${meta.warnings.join('\n\n')}\n\nFile: ${meta.fileName}\n\nDo you want to proceed with downloading this potentially dangerous file?`
        );
        
        if (!proceed) {
          setStatus("Download cancelled for safety");
          return;
        }
      }
      
      setFileMeta(meta);
      fileMetaRef.current = meta;
      setCodeRequired(false);
      setStatus("Waiting for Sender...");
    }, []),

    onSignal: useCallback(async (data: SignalPayload) => {
      if ('type' in data.data && data.data.type === "offer") {
        senderIdRef.current = data.from || null;
        const answer = await handleOffer(data.data as RTCSessionDescriptionInit);
        
        if (data.from) {
          sendSignal({
            target: data.from,
            data: answer,
            fileId,
          });
        }
      } else if ('candidate' in data.data) {
        await addIceCandidate(data.data.candidate as RTCIceCandidate);
      }
    }, [handleOffer, addIceCandidate, fileId]),

    onError: useCallback((error: ErrorPayload) => {
      if (error.invalidCode) {
        setStatus("Invalid or expired code. Please check and try again.");
        setCodeRequired(true);
      } else {
        setStatus(error.message || "Error occurred");
      }
    }, []),

    onTransferCancelled: useCallback(({ reason }: TransferCancelledPayload) => {
      isCancelledRef.current = true;
      setStatus(`Transfer stopped: ${reason}`);
      setIsDownloading(false);
      closePeerConnection();
    }, [closePeerConnection]),
  });

  // Initialize StreamSaver
  useEffect(() => {
    const initStreamSaver = async () => {
      try {
        const streamSaver = (await import("streamsaver")).default;
        streamSaver.mitm = 'https://jimmywarting.github.io/StreamSaver.js/mitm.html?version=2.0.0';
        streamSaverRef.current = streamSaver;
      } catch (err) {
        console.error("StreamSaver load error:", err);
      }
    };
    initStreamSaver();

    return () => {
      if (writerRef.current) {
        writerRef.current.abort().catch(() => {});
      }
      closePeerConnection();
    };
  }, [closePeerConnection]);

  const handleCodeSubmit = () => {
    if (!code) return;
    setStatus("Verifying code...");
    joinRoom(fileId, code);
  };

  const handleAcceptDownload = async () => {
    if (!streamSaverRef.current || !fileMetaRef.current) {
      alert("Not ready yet. Please wait.");
      return;
    }

    const channel = getDataChannel();
    if (!channel || channel.readyState !== 'open') {
      alert("Connection not ready. Please wait.");
      return;
    }

    setIsSelectingLocation(true);
    isCancelledRef.current = false;
    receivedBytes.current = 0;
    receivedChunksRef.current = [];
    setProgress(0);
    setStatus("Please select where to save the file...");
    
    try {
      const fileStream = streamSaverRef.current.createWriteStream(fileMetaRef.current.fileName, {
        size: fileMetaRef.current.fileSize
      });
      const writer = fileStream.getWriter();
      writerRef.current = writer;
      
      await writer.ready;
      
      setStatus("Downloading...");
      channel.send("START_TRANSFER");
      
      setIsSelectingLocation(false);
      setIsP2PReady(false);
      setIsDownloading(true);
    } catch (err) {
      console.error("Download start error or cancelled:", err);
      setStatus("Download cancelled");
      setIsSelectingLocation(false);
      setIsP2PReady(true);
    }
  };

  const handleCancel = () => {
    isCancelledRef.current = true;
    
    cancelTransfer(fileId, "Receiver cancelled the transfer");
    
    if (writerRef.current) {
      writerRef.current.abort().catch(() => {});
      writerRef.current = null;
    }
    
    receivedChunksRef.current = [];
    setProgress(0);
    receivedBytes.current = 0;
    setIsDownloading(false);
    setIsP2PReady(true);
    setStatus("Transfer stopped.");
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-linear-to-br from-indigo-900 via-purple-900 to-pink-900 text-white p-4 relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute w-96 h-96 bg-pink-500 rounded-full blur-3xl opacity-20 top-0 right-0 animate-pulse"></div>
        <div className="absolute w-96 h-96 bg-indigo-500 rounded-full blur-3xl opacity-20 bottom-0 left-0 animate-pulse" style={{animationDelay: '1.5s'}}></div>
        <div className="absolute w-2 h-2 bg-white rounded-full top-1/4 right-1/4 animate-ping" style={{animationDuration: '3s'}}></div>
        <div className="absolute w-2 h-2 bg-pink-300 rounded-full top-2/3 left-1/4 animate-ping" style={{animationDuration: '4s', animationDelay: '0.7s'}}></div>
        <div className="absolute w-1 h-1 bg-indigo-300 rounded-full bottom-1/3 right-1/3 animate-ping" style={{animationDuration: '3.5s', animationDelay: '1.2s'}}></div>
      </div>

      <div className="relative z-10 bg-white/10 backdrop-blur-xl p-10 rounded-2xl border border-white/20 shadow-2xl max-w-md w-full text-center animate-slide-up hover:shadow-pink-500/20 hover:shadow-3xl transition-all duration-300">
        <div className="mb-6 animate-fade-in">
          <div className="w-20 h-20 bg-linear-to-br from-purple-400 to-pink-400 rounded-full mx-auto mb-4 flex items-center justify-center animate-bounce shadow-lg shadow-purple-500/50 hover:shadow-pink-500/50 transition-shadow duration-500 cursor-pointer hover:scale-110">
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
          </div>
          <h2 className="text-3xl font-bold mb-2 bg-linear-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent hover:scale-105 transition-transform duration-300 cursor-default drop-shadow-lg">Incoming File</h2>
        </div>
        
        {codeRequired && (
          <div className="mb-6 animate-fade-in">
            <p className="text-purple-200 mb-3 text-sm">
              Enter the one-time code from the sender
            </p>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyPress={(e) => e.key === 'Enter' && handleCodeSubmit()}
              placeholder="Enter code (e.g., ABC123)"
              className="w-full bg-black/30 border border-purple-400/50 rounded-lg px-4 py-3 text-white text-center text-2xl font-mono tracking-widest placeholder-gray-500 focus:outline-none focus:border-purple-400 mb-3 uppercase"
              autoFocus
              maxLength={8}
            />
            <button
              onClick={handleCodeSubmit}
              disabled={!code || code.length < 4}
              className="w-full bg-linear-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-all"
            >
              Connect
            </button>
          </div>
        )}

        {fileMeta && !codeRequired && (
          <div className="mb-6">
            <p className="text-xl text-blue-400 font-semibold">{fileMeta.fileName}</p>
            <p className="text-gray-400 text-sm">Size: {(fileMeta.fileSize / 1024 / 1024).toFixed(2)} MB</p>
          </div>
        )}

        {isP2PReady && !isDownloading && !codeRequired && (
          <div className="flex flex-col items-center gap-2 mb-6">
            <button 
              onClick={handleAcceptDownload}
              disabled={isSelectingLocation}
              className={`bg-linear-to-r from-purple-500 via-pink-500 to-purple-600 hover:from-purple-600 hover:via-pink-600 hover:to-purple-700 text-white font-bold py-4 px-10 rounded-full transition-all transform hover:scale-105 shadow-2xl text-lg ${isSelectingLocation ? 'opacity-75 cursor-wait' : 'animate-pulse'}`}
            >
              {isSelectingLocation ? 'Selecting Location...' : 'Download File'}
            </button>
            {!isSelectingLocation && (
                <p className="text-xs text-purple-300/70">
                    You will be asked to choose a save location
                </p>
            )}
          </div>
        )}

        {isDownloading && (
           <div className="w-full mb-6">
             <div className="w-full bg-gray-700 rounded-full h-4 mb-2 overflow-hidden">
                <div className="bg-green-500 h-4 transition-all duration-200" style={{ width: `${progress}%` }}></div>
             </div>
             <div className="flex justify-between text-xs text-gray-400">
                <span>{progress}%</span>
                <button onClick={handleCancel} className="text-red-400 hover:text-red-300 hover:underline">
                    Cancel
                </button>
             </div>
           </div>
        )}

        <div className="p-5 bg-linear-to-r from-purple-500/20 to-pink-500/20 rounded-xl border border-purple-400/30 backdrop-blur-sm">
          <p className="text-purple-200 font-medium">{status}</p>
        </div>
      </div>
    </div>
  );
}