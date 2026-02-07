"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSignaling } from "@/hooks/useSignaling";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useFileStream } from "@/hooks/useFileStream";
import { useFileHash } from "@/hooks/useFileHash";
import type { ReceiverJoinedPayload, SignalPayload } from "@/types/socket-events";

export default function Home() {
  // UI State
  const [status, setStatus] = useState("Idle");
  const [fileId, setFileId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isTransferActive, setIsTransferActive] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);
  const [oneTimeCode, setOneTimeCode] = useState<string | null>(null);

  // Refs for stable values across callbacks
  const isNegotiating = useRef(false);
  const currentFileIdRef = useRef<string | null>(null);
  const currentReceiverRef = useRef<string | null>(null);
  const selectedFileRef = useRef<File | null>(null);

  const CLIENT_URL = process.env.NEXT_PUBLIC_CLIENT_URL || 'http://localhost:3000';

  // Keep file ref in sync
  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

  // Initialize hooks
  const { isHashing, calculateHash } = useFileHash({
    onProgress: (percent) => setStatus(`Calculating hash... ${percent}%`),
  });

  const { streamFile, cancelStream } = useFileStream({
    onProgress: setProgress,
    onComplete: () => {
      setStatus("File Sent Successfully!");
      setProgress(100);
      setIsTransferActive(false);
    },
    onError: (error) => {
      console.error("Transfer Error:", error);
      setStatus("Transfer Error");
      setIsTransferActive(false);
    },
  });

  // WebRTC setup with callbacks
  const {
    createOffer,
    handleAnswer,
    addIceCandidate,
    sendData,
    canSendMore,
    onBufferLow,
    closePeerConnection,
  } = useWebRTC({
    onIceCandidate: (candidate) => {
      if (currentFileIdRef.current && currentReceiverRef.current) {
        sendSignal({
          target: currentReceiverRef.current,
          data: { candidate },
          fileId: currentFileIdRef.current,
        });
      }
    },
    onDataChannelOpen: () => setStatus("Connected. Waiting for Receiver to Accept..."),
    onDataChannelClose: () => {
      setStatus("Connection closed");
      setIsTransferActive(false);
    },
    onDataChannelMessage: (data) => {
      if (data === "START_TRANSFER" && selectedFileRef.current) {
        setIsTransferActive(true);
        sendFile();
      }
    },
  });

  // Send file using the streaming hook
  const sendFile = useCallback(async () => {
    const file = selectedFileRef.current;
    if (!file) return;

    setStatus("Sending File...");
    
    try {
      await streamFile(
        file,
        (chunk) => sendData(chunk),
        canSendMore,
        onBufferLow
      );
    } catch (error) {
      console.error("File send error:", error);
      setStatus("Transfer Error");
    }
  }, [streamFile, sendData, canSendMore, onBufferLow]);

  // Start P2P connection (called when receiver joins)
  const startP2PConnection = useCallback(async (receiverId: string) => {
    try {
      const offer = await createOffer();
      
      sendSignal({
        target: receiverId,
        data: offer,
        fileId: currentFileIdRef.current!,
      });
    } catch (err) {
      console.error("Connection failed", err);
      isNegotiating.current = false;
      setStatus("Connection failed");
    }
  }, [createOffer]);

  // Signaling setup
  const { sendSignal, emitUploadInit, cancelTransfer } = useSignaling({
    onReceiverJoined: useCallback((data: ReceiverJoinedPayload) => {
      if (isNegotiating.current) return;
      
      isNegotiating.current = true;
      currentReceiverRef.current = data.receiverId;
      setStatus("Receiver found! Initiating connection...");
      startP2PConnection(data.receiverId);
    }, [startP2PConnection]),

    onSignal: useCallback(async (data: SignalPayload) => {
      if ('type' in data.data && data.data.type === "answer") {
        await handleAnswer(data.data as RTCSessionDescriptionInit);
      } else if ('candidate' in data.data) {
        await addIceCandidate(data.data.candidate as RTCIceCandidate);
      }
    }, [handleAnswer, addIceCandidate]),

    onTransferCancelled: useCallback(({ reason }) => {
      setIsCancelled(true);
      setIsTransferActive(false);
      setStatus(`Transfer stopped: ${reason}`);
      closePeerConnection();
    }, [closePeerConnection]),

    onUploadCreated: useCallback(({ fileId, oneTimeCode, warnings }) => {
      setFileId(fileId);
      setOneTimeCode(oneTimeCode);
      currentFileIdRef.current = fileId;
      setStatus("Waiting for receiver...");
      
      if (warnings && warnings.length > 0) {
        alert(`FILE SAFETY NOTICE\n\n${warnings.join('\n\n')}\n\nThe receiver will be warned about this file type.`);
      }
    }, []),

    onError: useCallback(({ message }) => {
      console.error("Socket error:", message);
      setStatus(`Error: ${message}`);
      setIsTransferActive(false);
    }, []),
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      closePeerConnection();
      isNegotiating.current = false;
    };
  }, [closePeerConnection]);

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    closePeerConnection();
    isNegotiating.current = false;
    setProgress(0);
    setIsCancelled(false);
    setIsTransferActive(false);
    setSelectedFile(file);
    setOneTimeCode(null);
    setStatus("File selected. Click 'Start Upload' to begin.");
  };

  // Start upload process
  const handleStartUpload = async () => {
    if (!selectedFile) return;

    setStatus("Calculating file hash...");

    try {
      const fileHash = await calculateHash(selectedFile);
      setStatus("Registering file...");

      emitUploadInit({
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        fileType: selectedFile.type,
        fileHash,
      });
    } catch (error) {
      console.error("Hash calculation error:", error);
      setStatus("Error calculating file hash");
    }
  };

  // Stop transfer
  const handleStopTransfer = () => {
    if (!currentFileIdRef.current) return;

    setIsCancelled(true);
    setIsTransferActive(false);
    setStatus("Transfer stopped by you");
    cancelStream();
    cancelTransfer(currentFileIdRef.current, "Sender stopped the transfer");
    closePeerConnection();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-linear-to-br from-purple-900 via-blue-900 to-indigo-900 text-white p-8 relative overflow-hidden">
    
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
          <p className="text-gray-300 text-sm font-medium">Lightning-fast P2P file sharing</p>
        </div>
      </div>
      
      <div className="relative z-10 bg-white/10 backdrop-blur-xl p-8 rounded-2xl border border-white/20 shadow-2xl text-center w-full max-w-md animate-slide-up hover:shadow-purple-500/20 hover:shadow-3xl transition-all duration-300">
        <label className="mb-6 block cursor-pointer group">
          <div className="border-2 border-dashed border-purple-400/50 rounded-xl p-8 hover:border-purple-400 transition-all hover:bg-white/5 hover:scale-105 duration-300 relative overflow-hidden">
            <div className="absolute inset-0 bg-linear-to-r from-purple-500/0 via-purple-500/10 to-purple-500/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
            <div className="text-center relative z-10">
              <svg className="mx-auto h-12 w-12 text-purple-400 mb-3 group-hover:scale-110 group-hover:rotate-12 transition-all duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm text-gray-300 mb-1 font-semibold group-hover:text-purple-300 transition-colors">Click to upload or drag & drop</p>
              <p className="text-xs text-gray-500 group-hover:text-gray-400 transition-colors">Any file, any size</p>
            </div>
          </div>
          <input type="file" onChange={handleFileSelect} className="hidden"/>
        </label>

        {/* Start Upload Button */}
        {selectedFile && !fileId && (
          <div className="mb-6 animate-fade-in">
            <p className="text-sm text-purple-200 mb-3">
              Selected: <span className="font-semibold">{selectedFile.name}</span>
              <span className="text-gray-400 ml-2">({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)</span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleStartUpload}
                disabled={isHashing}
                className="flex-1 bg-linear-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-lg transition-all"
              >
                {isHashing ? "Hashing..." : "Start Upload"}
              </button>
              <button
                onClick={() => {
                  setSelectedFile(null);
                  setStatus("Idle");
                }}
                className="bg-white/10 hover:bg-white/20 text-white py-3 px-4 rounded-lg transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Status Display */}
        <div className="mb-6 p-4 bg-linear-to-r from-purple-500/20 to-blue-500/20 rounded-lg border border-purple-400/30">
          <p className="text-purple-200 font-medium text-sm">{status}</p>
        </div>

        {progress > 0 && (
          <div className="mb-6 animate-fade-in">
            <div className="flex justify-between mb-2">
              <span className="text-xs text-gray-300 animate-pulse">Uploading...</span>
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
            Stop Transfer
          </button>
        )}

        {fileId && (
          <div className="bg-linear-to-br from-purple-500/20 to-blue-500/20 p-5 rounded-xl border border-purple-400/30 backdrop-blur-sm">
            {/* One-Time Code Display */}
            {oneTimeCode && (
              <div className="mb-4">
                <p className="text-purple-200 mb-2 font-semibold text-sm">
                  One-Time Connection Code:
                </p>
                <div className="bg-black/40 p-4 rounded-lg mb-2">
                  <p className="text-3xl font-mono font-bold text-green-400 tracking-widest text-center select-all">
                    {oneTimeCode}
                  </p>
                </div>
                <button 
                  onClick={() => navigator.clipboard.writeText(oneTimeCode)}
                  className="w-full bg-green-500/20 hover:bg-green-500/30 text-green-300 py-2 px-4 rounded-lg text-xs font-medium transition-all border border-green-500/30"
                >
                  Copy Code
                </button>
              </div>
            )}

            <div className="border-t border-purple-400/20 pt-4">
              <p className="text-purple-200 mb-3 font-semibold text-sm">
                Or share this link:
              </p>
              <div className="bg-black/30 p-3 rounded-lg break-all mb-3">
                <a href={`${CLIENT_URL}/download/${fileId}`} target="_blank" className="text-blue-300 hover:text-blue-200 text-xs transition-colors">
                  {CLIENT_URL}/download/{fileId}
                </a>
              </div>
              <button 
                onClick={() => navigator.clipboard.writeText(`${CLIENT_URL}/download/${fileId}`)}
                className="w-full bg-white/10 hover:bg-white/20 text-white py-2 px-4 rounded-lg text-xs font-medium transition-all"
              >
                Copy Link
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}