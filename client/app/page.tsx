// client/src/app/page.tsx
"use client";

import { useEffect, useState, useRef } from "react";
import { socket } from "@/lib/socket";
import { getIceServers } from "@/lib/ice-servers";

let RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const CHUNK_SIZE = 16384; // 16KB chunks
const MAX_BUFFER_AMOUNT = 65535; // 64KB Buffer limit

export default function Home() {
  const [status, setStatus] = useState("Idle");
  const [fileId, setFileId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isTransferActive, setIsTransferActive] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);
  const [password, setPassword] = useState("");
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const isNegotiating = useRef(false);
  const currentFileIdRef = useRef<string | null>(null);

  useEffect(() => {
    getIceServers().then(servers => {
      RTC_CONFIG = { iceServers: servers };
      console.log('ICE servers configured:', servers.length, 'servers');
    });

    const handleReceiverJoined = ({ receiverId }: { receiverId: string }) => {
      if (isNegotiating.current || peerRef.current) return;
      
      console.log("Receiver found. Locking connection.");
      isNegotiating.current = true;
      setStatus("Receiver found! Initiating connection...");
      startP2PConnection(receiverId);
    };

    const handleSignal = async ({ data }: { data: any }) => {
      if (!peerRef.current) return;
      
      if (data.type === "answer") {
        await peerRef.current.setRemoteDescription(data);
      } else if (data.candidate) {
        await peerRef.current.addIceCandidate(data.candidate);
      }
    };

    const handleTransferCancelled = ({ reason }: { reason: string }) => {
      console.log("Transfer cancelled by receiver:", reason);
      setIsCancelled(true);
      setIsTransferActive(false);
      setStatus(`Transfer stopped: ${reason}`);
      if (dataChannelRef.current) {
        dataChannelRef.current.close();
      }
    };

    const handleTransferPaused = () => {
      console.log("Transfer paused by receiver");
      setIsTransferActive(false);
      setStatus("Transfer paused by receiver");
    };

    const handleTransferResumed = () => {
      console.log("Transfer resumed by receiver");
      setIsTransferActive(true);
      setStatus("Transfer resumed");
    };

    const handleError = ({ message }: { message: string }) => {
      console.error("Socket error:", message);
      setStatus(`Error: ${message}`);
      setIsTransferActive(false);
    };

    socket.on("receiver-joined", handleReceiverJoined);
    socket.on("signal", handleSignal);
    socket.on("transfer-cancelled", handleTransferCancelled);
    socket.on("transfer-paused", handleTransferPaused);
    socket.on("transfer-resumed", handleTransferResumed);
    socket.on("error", handleError);

    return () => {
      socket.off("receiver-joined", handleReceiverJoined);
      socket.off("signal", handleSignal);
      socket.off("transfer-cancelled", handleTransferCancelled);
      socket.off("transfer-paused", handleTransferPaused);
      socket.off("transfer-resumed", handleTransferResumed);
      socket.off("error", handleError);
      if (peerRef.current) peerRef.current.close();
      isNegotiating.current = false;
    };
  }, [selectedFile]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (peerRef.current) {
        peerRef.current.close();
        peerRef.current = null;
    }
    isNegotiating.current = false;
    setProgress(0);
    setIsCancelled(false);
    setIsTransferActive(false);
    setSelectedFile(file);
    setStatus("Registering file...");
    setShowPasswordInput(true);
  };

  const handleStartUpload = () => {
    if (!selectedFile) return;
    
    setShowPasswordInput(false);
    setStatus("Registering file...");
    
    socket.once("upload-created", ({ fileId, warnings }: { fileId: string; warnings?: string[] }) => {
      setFileId(fileId);
      currentFileIdRef.current = fileId;
      setStatus("Waiting for receiver...");
      
      if (warnings && warnings.length > 0) {
        alert(`⚠️ FILE SAFETY NOTICE ⚠️\n\n${warnings.join('\n\n')}\n\nThe receiver will be warned about this file type.`);
      }
    });

    socket.emit("upload-init", {
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      fileType: selectedFile.type,
      password: password || undefined, // Optional password
    });
  };

  const handleStopTransfer = () => {
    if (!currentFileIdRef.current) return;
    
    setIsCancelled(true);
    setIsTransferActive(false);
    setStatus("Transfer stopped by you");
    
    // Notify the receiver
    socket.emit("cancel-transfer", { 
      fileId: currentFileIdRef.current, 
      reason: "Sender stopped the transfer" 
    });
    
    // Close the data channel
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
    }
  };

  async function startP2PConnection(receiverId: string) {
    try {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      peerRef.current = pc;

      const channel = pc.createDataChannel("file-transfer");
      // CRITICAL: Set the threshold for Backpressure
      channel.bufferedAmountLowThreshold = MAX_BUFFER_AMOUNT; 
      dataChannelRef.current = channel;

      channel.onopen = () => setStatus("Connected. Waiting for Receiver to Accept...");
      
      channel.onmessage = (event) => {
          if (event.data === "START_TRANSFER") {
              console.log("Receiver accepted! Starting transfer...");
              setIsTransferActive(true);
              sendFile();
          }
      };

      channel.onclose = () => {
        if (!isCancelled) {
          setStatus("Connection closed");
          setIsTransferActive(false);
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && currentFileIdRef.current) {
          socket.emit("signal", { 
            target: receiverId, 
            data: { candidate: event.candidate },
            fileId: currentFileIdRef.current 
          });
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("signal", { 
        target: receiverId, 
        data: offer,
        fileId: currentFileIdRef.current 
      });
    } catch (err) {
      console.error("Connection failed", err);
      isNegotiating.current = false;
    }
  }

  // --- THE FIX: BACKPRESSURE ---
  const sendFile = async () => {
    if (!selectedFile || !dataChannelRef.current) return;
    
    setStatus("Sending File...");
    const channel = dataChannelRef.current;
    const reader = new FileReader();
    let offset = 0;

    reader.onload = () => {
      if (!reader.result) return;
      
      // Check if transfer was cancelled
      if (isCancelled) {
        setStatus("Transfer stopped");
        return;
      }
      
      // Check if channel is still open
      if (channel.readyState !== 'open') {
        console.error("Channel closed during transfer");
        setStatus("Connection lost");
        setIsTransferActive(false);
        return;
      }
      
      try {
        // 1. Send the chunk
        const chunkSize = (reader.result as ArrayBuffer).byteLength;
        channel.send(reader.result as ArrayBuffer);
        offset += chunkSize;
        
        // 2. Update UI
        const percent = Math.round((offset / selectedFile.size) * 100);
        setProgress(percent);
        
        console.log(`Sent: ${offset} / ${selectedFile.size} bytes (${percent}%)`);

        if (offset < selectedFile.size) {
            // 3. CHECK BUFFER (Backpressure)
            if (channel.bufferedAmount > channel.bufferedAmountLowThreshold) {
                // Buffer is full! Wait for it to drain.
                channel.onbufferedamountlow = () => {
                    channel.onbufferedamountlow = null; // Clear listener
                    if (!isCancelled && channel.readyState === 'open') {
                      readSlice(offset);
                    }
                };
            } else {
                // Buffer is empty, keep going fast
                readSlice(offset);
            }
        } else {
          console.log("All chunks sent!");
          setStatus("File Sent Successfully!");
          setProgress(100);
          setIsTransferActive(false);
        }
      } catch (error) {
        console.error("Send Error:", error);
        setStatus("Transfer Error");
        setIsTransferActive(false);
      }
    };

    const readSlice = (currentOffset: number) => {
      if (isCancelled) return;
      const slice = selectedFile.slice(currentOffset, currentOffset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    readSlice(0); 
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white p-8 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute w-96 h-96 bg-purple-500 rounded-full blur-3xl opacity-20 -top-48 -left-48 animate-pulse"></div>
        <div className="absolute w-96 h-96 bg-blue-500 rounded-full blur-3xl opacity-20 -bottom-48 -right-48 animate-pulse" style={{animationDelay: '1s'}}></div>
        <div className="absolute w-2 h-2 bg-white rounded-full top-1/4 left-1/4 animate-ping" style={{animationDuration: '3s'}}></div>
        <div className="absolute w-2 h-2 bg-purple-300 rounded-full top-1/3 right-1/4 animate-ping" style={{animationDuration: '4s', animationDelay: '0.5s'}}></div>
        <div className="absolute w-2 h-2 bg-blue-300 rounded-full bottom-1/4 left-1/3 animate-ping" style={{animationDuration: '3.5s', animationDelay: '1s'}}></div>
        <div className="absolute w-1 h-1 bg-pink-300 rounded-full top-1/2 right-1/3 animate-ping" style={{animationDuration: '5s', animationDelay: '1.5s'}}></div>
      </div>

      <div className="relative z-10 text-center mb-8 animate-fade-in">
        <h1 className="text-6xl font-black mb-2 bg-linear-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent drop-shadow-2xl hover:scale-105 transition-transform duration-300 cursor-default">
          Transferlvania
        </h1>
        <div className="flex items-center justify-center gap-2 animate-fade-in" style={{animationDelay: '0.2s'}}>
          <span className="text-yellow-400 animate-pulse">⚡</span>
          <p className="text-gray-300 text-sm font-medium">Lightning-fast P2P file sharing</p>
          <span className="text-yellow-400 animate-pulse" style={{animationDelay: '0.5s'}}>⚡</span>
        </div>
      </div>
      
      <div className="relative z-10 bg-white/10 backdrop-blur-xl p-8 rounded-2xl border border-white/20 shadow-2xl text-center w-full max-w-md animate-slide-up hover:shadow-purple-500/20 hover:shadow-3xl transition-all duration-300">
        <label className="mb-6 block cursor-pointer group">
          <div className="border-2 border-dashed border-purple-400/50 rounded-xl p-8 hover:border-purple-400 transition-all hover:bg-white/5 hover:scale-105 duration-300 relative overflow-hidden">
            <div className="absolute inset-0 bg-linear-to-r from-purple-500/0 via-purple-500/10 to-purple-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
            <div className="text-center relative z-10">
              <svg className="mx-auto h-12 w-12 text-purple-400 mb-3 group-hover:scale-110 group-hover:rotate-12 transition-all duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm text-gray-300 mb-1 font-semibold group-hover:text-purple-300 transition-colors">Click to upload or drag & drop</p>
              <p className="text-xs text-gray-500 group-hover:text-gray-400 transition-colors">Any file, any size 🚀</p>
            </div>
          </div>
          <input type="file" onChange={handleFileSelect} className="hidden"/>
        </label>
        
        {showPasswordInput && selectedFile && (
          <div className="mb-6 animate-fade-in">
            <label className="block text-sm text-purple-200 mb-2">🔒 Optional Password Protection</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave empty for no password"
              className="w-full bg-black/30 border border-purple-400/50 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-400 mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={handleStartUpload}
                className="flex-1 bg-linear-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-bold py-2 px-4 rounded-lg transition-all"
              >
                {password ? "🔒 Start with Password" : "Start Upload"}
              </button>
              <button
                onClick={() => {
                  setSelectedFile(null);
                  setShowPasswordInput(false);
                  setPassword("");
                }}
                className="bg-white/10 hover:bg-white/20 text-white py-2 px-4 rounded-lg transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        
        <div className="mb-6 p-4 bg-linear-to-r from-purple-500/20 to-blue-500/20 rounded-lg border border-purple-400/30">
          <p className="text-purple-200 font-medium text-sm">{status}</p>
        </div>

        {progress > 0 && (
          <div className="mb-6 animate-fade-in">
            <div className="flex justify-between mb-2">
              <span className="text-xs text-gray-300 animate-pulse">⬆️ Uploading...</span>
              <span className="text-xs font-bold text-purple-300 animate-bounce">{progress}%</span>
            </div>
            <div className="w-full bg-gray-700/50 rounded-full h-3 overflow-hidden shadow-inner">
              <div className="bg-linear-to-r from-purple-500 via-pink-500 to-blue-500 h-3 rounded-full transition-all duration-300 relative overflow-hidden" style={{ width: `${progress}%` }}>
                <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
              </div>
            </div>
          </div>
        )}

        {isTransferActive && !isCancelled && (
          <button 
            onClick={handleStopTransfer}
            className="bg-linear-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold py-3 px-8 rounded-full mb-4 transition-all transform hover:scale-105 shadow-lg"
          >
            🛑 Stop Transfer
          </button>
        )}

        {fileId && (
          <div className="bg-linear-to-br from-purple-500/20 to-blue-500/20 p-5 rounded-xl border border-purple-400/30 backdrop-blur-sm">
            <p className="text-purple-200 mb-3 font-semibold text-sm flex items-center gap-2">
              <span>🔗</span> Share this link:
            </p>
            <div className="bg-black/30 p-3 rounded-lg break-all mb-3">
              <a href={`http://localhost:3000/download/${fileId}`} target="_blank" className="text-blue-300 hover:text-blue-200 text-xs transition-colors">
                http://localhost:3000/download/{fileId}
              </a>
            </div>
            <button 
              onClick={() => navigator.clipboard.writeText(`http://localhost:3000/download/${fileId}`)}
              className="w-full bg-white/10 hover:bg-white/20 text-white py-2 px-4 rounded-lg text-xs font-medium transition-all"
            >
              📋 Copy Link
            </button>
          </div>
        )}
      </div>
    </div>
  );
}