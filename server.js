import 'dotenv/config';
import { WebSocketServer } from 'ws';
import { windowManager } from 'node-window-manager';
import OpenAI, { toFile } from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import clipboardy from 'clipboardy';
import robot from 'robotjs';
import https from 'https';
import { execSync } from 'child_process';
import extractFileIcon from 'extract-file-icon';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openai = new OpenAI(); // Uses OPENAI_API_KEY from env

const PORT = 3001;
const iconCache = new Map(); // Cache icons by exe path

function getIconBase64(exePath) {
  if (!exePath) return null;

  // Check cache first
  if (iconCache.has(exePath)) {
    return iconCache.get(exePath);
  }

  try {
    const iconBuffer = extractFileIcon(exePath, 32);
    const base64 = `data:image/png;base64,${iconBuffer.toString('base64')}`;
    iconCache.set(exePath, base64);
    return base64;
  } catch (err) {
    console.error('Failed to extract icon for:', exePath, err.message);
    iconCache.set(exePath, null);
    return null;
  }
}

// Generate self-signed certificate if not exists
const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.log('Generating self-signed certificate...');
  execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost"`, { stdio: 'inherit' });
}

const server = https.createServer({
  cert: fs.readFileSync(certPath),
  key: fs.readFileSync(keyPath)
});

const wss = new WebSocketServer({ server });

function getWindows() {
  const windows = windowManager.getWindows();
  return windows
    .filter(w => {
      const title = w.getTitle();
      const bounds = w.getBounds();

      // Must have a title
      if (!title || title.length === 0) return false;

      // Must be visible with reasonable size
      if (!w.isVisible()) return false;
      if (bounds.width < 100 || bounds.height < 50) return false;

      // Filter out known system/background windows
      const ignoreTitles = [
        'Program Manager',
        'Windows Input Experience',
        'Microsoft Text Input Application',
        'Settings',
        'MSCTFIME UI',
        'Default IME'
      ];
      if (ignoreTitles.includes(title)) return false;

      // Filter out background system processes by path
      const ignorePaths = [
        'ApplicationFrameHost.exe',
        'TextInputHost.exe',
        'ShellExperienceHost.exe',
        'SearchHost.exe',
        'StartMenuExperienceHost.exe'
      ];
      const exeName = w.path ? w.path.split('\\').pop() : '';
      if (ignorePaths.includes(exeName)) return false;

      return true;
    })
    .map(w => ({
      id: w.id,
      title: w.getTitle(),
      path: w.path,
      processId: w.processId,
      bounds: w.getBounds(),
      icon: getIconBase64(w.path)
    }));
}

function focusWindow(windowId) {
  const windows = windowManager.getWindows();
  const target = windows.find(w => w.id === windowId);
  if (target) {
    target.bringToTop();
    target.show();
    return true;
  }
  return false;
}

async function pasteToWindow(windowId, text) {
  // Focus the window
  const focused = focusWindow(windowId);
  if (!focused) {
    throw new Error('Could not focus window');
  }

  // Wait for window to gain focus
  await new Promise(resolve => setTimeout(resolve, 200));

  // Copy text to clipboard
  await clipboardy.write(text);

  // Wait a moment
  await new Promise(resolve => setTimeout(resolve, 100));

  // Send Ctrl+V to paste
  robot.keyTap('v', 'control');

  // Wait a moment then press Enter
  await new Promise(resolve => setTimeout(resolve, 100));
  robot.keyTap('enter');

  return true;
}

async function transcribeAudio(audioBuffer) {
  // Save buffer to temp file (Whisper needs a file)
  const tempPath = path.join(__dirname, 'temp_audio.webm');
  fs.writeFileSync(tempPath, Buffer.from(audioBuffer));

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: 'whisper-1',
      language: 'en',
    });
    return transcription.text;
  } finally {
    // Clean up temp file
    fs.unlinkSync(tempPath);
  }
}

wss.on('connection', (ws) => {
  console.log('Client connected');
  let expectingAudio = false;
  let currentWindowId = null;

  // Send initial window list
  const windows = getWindows();
  ws.send(JSON.stringify({ type: 'windows', data: windows }));

  ws.on('message', async (message, isBinary) => {
    // Handle binary audio data
    if (isBinary || expectingAudio) {
      expectingAudio = false;
      const windowId = currentWindowId;
      currentWindowId = null;
      console.log('Received audio data:', message.length, 'bytes', 'for window:', windowId);

      try {
        const text = await transcribeAudio(message);
        console.log('Transcription:', text);
        ws.send(JSON.stringify({ type: 'transcription', text, windowId }));
      } catch (err) {
        console.error('Transcription error:', err);
        ws.send(JSON.stringify({ type: 'transcriptionError', error: err.message, windowId }));
      }
      return;
    }

    // Handle JSON messages
    try {
      const msg = JSON.parse(message.toString());

      switch (msg.type) {
        case 'getWindows':
          const windows = getWindows();
          ws.send(JSON.stringify({ type: 'windows', data: windows }));
          break;

        case 'focusWindow':
          const success = focusWindow(msg.windowId);
          ws.send(JSON.stringify({ type: 'focusResult', success, windowId: msg.windowId }));
          break;

        case 'audioStart':
          console.log('Expecting audio for window:', msg.windowId);
          expectingAudio = true;
          currentWindowId = msg.windowId;
          break;

        case 'command':
          console.log('Command for window', msg.windowId, ':', msg.text);
          try {
            await pasteToWindow(msg.windowId, msg.text);
            ws.send(JSON.stringify({ type: 'commandSuccess', windowId: msg.windowId, text: msg.text }));
          } catch (err) {
            console.error('Paste error:', err);
            ws.send(JSON.stringify({ type: 'commandError', windowId: msg.windowId, error: err.message }));
          }
          break;

        default:
          console.log('Unknown message type:', msg.type);
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Secure WebSocket server running on wss://localhost:${PORT}`);
});
