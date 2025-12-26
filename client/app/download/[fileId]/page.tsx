"use client";

import { useEffect, useState, useRef, use } from "react";
import { socket } from "@/lib/socket";
import { getIceServers } from "@/lib/ice-servers";

let RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export default function DownloadPage({ params }: { params: Promise<{ fileId: string }> }) {
  const resolvedParams = use(params);
  const { fileId } = resolvedParams;

  const [status, setStatus] = useState("Connecting...");
  const [fileMeta, setFileMeta] = useState<any>(null);
  const fileMetaRef = useRef<any>(null);
  
  const [progress, setProgress] = useState(0);
  const [isP2PReady, setIsP2PReady] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSelectingLocation, setIsSelectingLocation] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState("");
  
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter | null>(null);
  const streamSaverRef = useRef<any>(null);
  const receivedBytes = useRef(0);
  const isCancelledRef = useRef(false);
  const lastProgress = useRef(0);
  const fileStreamRef = useRef<any>(null);
  const receivedChunksRef = useRef<Uint8Array[]>([]);

  useEffect(() => {
    getIceServers().then(servers => {
      RTC_CONFIG = { iceServers: servers };
    });

    const initStreamSaver = async () => {
      try {
        const streamSaver = (await import("streamsaver")).default;
        streamSaver.mitm = 'https://jimmywarting.github.io/StreamSaver.js/mitm.html?version=2.0.0';
        streamSaverRef.current = streamSaver;
      } catch (err) { console.error("StreamSaver load error:", err); }
    };
    initStreamSaver();

    const tryJoinRoom = (pwd?: string) => {
      socket.emit("join-room", { fileId, password: pwd });
    };

    socket.on("error", (error) => {
      if (error.passwordRequired) {
        setPasswordRequired(true);
        setStatus("Password required");
      } else {
        setStatus(error.message || "Error occurred");
      }
    });

    socket.on("file-meta", (meta: {
      fileName: string;
      fileSize: number;
      fileType: string;
      fileHash?: string;
      isDangerous?: boolean;
      warnings?: string[];
    }) => {
      if (meta.isDangerous && meta.warnings) {
        const proceed = confirm(
          `SECURITY WARNING\n\n${meta.warnings.join('\n\n')}\n\nFile: ${meta.fileName}\n\nDo you want to proceed with downloading this potentially dangerous file?`
        );
        
        if (!proceed) {
          socket.disconnect();
          setStatus("Download cancelled for safety");
          return;
        }
      }
      
      setFileMeta(meta);
      fileMetaRef.current = meta;
      setPasswordRequired(false);
      setStatus("Waiting for Sender...");
    });

    tryJoinRoom();

    socket.on("signal", async ({ from, data }: { from: string; data: any }) => {
      if (data.type === "offer") {
        const pc = new RTCPeerConnection(RTC_CONFIG);
        
        pc.ondatachannel = (event) => {
          const channel = event.channel;
          
          channel.binaryType = "arraybuffer";

          dataChannelRef.current = channel;

          channel.onopen = () => {
             setStatus("Connection Established. Waiting for you to accept.");
             setIsP2PReady(true);
          };
          
          channel.onclose = () => {
             if (!isCancelledRef.current) {
                setStatus("Connection closed by Sender.");
                setIsDownloading(false);
             }
          };
          
          channel.onmessage = async (e) => {
            if (isCancelledRef.current || !writerRef.current) return;

            const chunk = e.data;

            try {
              const chunkArray = new Uint8Array(chunk);
              receivedChunksRef.current.push(chunkArray);
              
              await writerRef.current.write(chunkArray);
              
              receivedBytes.current += chunk.byteLength;
              const meta = fileMetaRef.current;
              
              if (meta?.fileSize) {
                 const total = parseInt(meta.fileSize);
                 const percent = Math.round((receivedBytes.current / total) * 100);
                 
                 if (percent - lastProgress.current >= 1 || percent === 100) {
                    lastProgress.current = percent;
                    setProgress(percent);
                 }

                 if (receivedBytes.current >= total) {
                    setStatus("Verifying file integrity...");
                    
                    if (writerRef.current) {
                        await writerRef.current.close();
                        writerRef.current = null;
                    }
                    
                    if (meta.fileHash) {
                      const receivedHash = await calculateHash(receivedChunksRef.current);
                      
                      if (receivedHash !== meta.fileHash) {
                        setStatus("Error: File integrity check failed!");
                        alert("File integrity verification failed. The downloaded file may be corrupted.");
                      } else {
                        setStatus("Download Complete! File verified.");
                      }
                    } else {
                      setStatus("Download Complete!");
                    }
                    
                    setIsDownloading(false);
                    socket.emit("transfer-complete", { fileId });
                 }
              }
            } catch (err) {
              console.error("Write error:", err);
              setStatus("Download error");
              setIsDownloading(false);
            }
          };
        };

        pc.onicecandidate = (event) => {
           if (event.candidate) socket.emit("signal", { target: from, data: { candidate: event.candidate }, fileId });
        };

        await pc.setRemoteDescription(data);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("signal", { target: from, data: answer, fileId });
      }
    });

    return () => {
      socket.off("file-meta");
      socket.off("signal");
      socket.off("error");
      if (writerRef.current) {
        writerRef.current.abort().catch(() => {});
      }
    };
  }, [fileId]);

  const handlePasswordSubmit = () => {
    if (!password) return;
    setStatus("Verifying password...");
    socket.emit("join-room", { fileId, password });
  };

  const calculateHash = async (chunks: Uint8Array[]): Promise<string> => {
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleAcceptDownload = async () => {
    if (!streamSaverRef.current || !dataChannelRef.current || !fileMetaRef.current) {
        alert("Not ready yet. Please wait.");
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
          size: parseInt(fileMetaRef.current.fileSize)
      });
      fileStreamRef.current = fileStream;
      const writer = fileStream.getWriter();
      writerRef.current = writer;
      
      await new Promise((resolve) => {
        const checkReady = () => {
          if (writer.ready) {
            resolve(true);
          } else {
            writer.ready.then(resolve);
          }
        };
        checkReady();
      });
      
      setStatus("Downloading...");
      dataChannelRef.current.send("START_TRANSFER");
      
      setIsSelectingLocation(false);
      setIsP2PReady(false);
      setIsDownloading(true);
    } catch (err) {
      console.error("Download start error or cancelled:", err);
      setStatus("Download cancelled");
      setIsSelectingLocation(false);
      setIsP2PReady(true); 
    }
  };  const handleCancel = () => {
    isCancelledRef.current = true;
    
    socket.emit("cancel-transfer", { 
      fileId, 
      reason: "Receiver cancelled the transfer" 
    });
    
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
        
        {passwordRequired && (
          <div className="mb-6 animate-fade-in">
            <p className="text-yellow-400 mb-3 text-sm">
              This file is password protected
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handlePasswordSubmit()}
              placeholder="Enter password"
              className="w-full bg-black/30 border border-purple-400/50 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-purple-400 mb-3"
              autoFocus
            />
            <button
              onClick={handlePasswordSubmit}
              disabled={!password}
              className="w-full bg-linear-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-all"
            >
              Unlock & Continue
            </button>
          </div>
        )}

        {fileMeta && !passwordRequired && (
          <div className="mb-6">
            <p className="text-xl text-blue-400 font-semibold">{fileMeta.fileName}</p>
            <p className="text-gray-400 text-sm">Size: {(parseInt(fileMeta.fileSize) / 1024 / 1024).toFixed(2)} MB</p>
          </div>
        )}

        {isP2PReady && !isDownloading && !passwordRequired && (
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