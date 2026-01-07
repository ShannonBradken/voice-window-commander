import 'dotenv/config';
import https from 'https';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { ensureCertificates } from './modules/sslCertificates.js';
import { createMessageHandler } from './handlers/messageHandlers.js';

// Ensure SSL certificates exist
const sslOptions = ensureCertificates();

// Create HTTPS server
const server = https.createServer(sslOptions);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log('Client connected');

  const { handleMessage, cleanup } = createMessageHandler(ws);

  ws.on('message', handleMessage);
  ws.on('close', cleanup);
});

// Start server
server.listen(config.port, config.host, () => {
  console.log(`Secure WebSocket server running on wss://localhost:${config.port}`);
});
