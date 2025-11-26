// client/src/lib/socket.ts
import { io } from "socket.io-client";

// Connect to your Backend URL (Port 4000)
export const socket = io("http://localhost:4000");