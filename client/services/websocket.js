// WebSocket service
import { config } from '../config.js';
import * as store from '../state/store.js';

let messageHandler = null;

export function setMessageHandler(handler) {
  messageHandler = handler;
}

export function connect() {
  const socket = new WebSocket(config.wsUrl);

  socket.onopen = () => {
    console.log('Connected to server');
    document.getElementById('status').title = 'Connected';
    document.getElementById('status').className = 'connected';
  };

  socket.onclose = () => {
    console.log('Disconnected from server');
    document.getElementById('status').title = 'Disconnected - Reconnecting...';
    document.getElementById('status').className = 'disconnected';
    setTimeout(connect, 2000);
  };

  socket.onerror = (err) => {
    console.error('WebSocket error:', err);
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (messageHandler) {
      messageHandler(msg);
    }
  };

  store.setWs(socket);
}

export function send(message) {
  if (store.ws && store.ws.readyState === WebSocket.OPEN) {
    if (typeof message === 'object') {
      store.ws.send(JSON.stringify(message));
    } else {
      store.ws.send(message);
    }
    return true;
  }
  return false;
}

export function sendBinary(data) {
  if (store.ws && store.ws.readyState === WebSocket.OPEN) {
    store.ws.send(data);
    return true;
  }
  return false;
}
