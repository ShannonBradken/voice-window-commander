import 'dotenv/config';
import { WebSocketServer } from 'ws';
import { windowManager } from 'node-window-manager';
import OpenAI, { toFile } from 'openai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import clipboardy from 'clipboardy';
import robot from 'robotjs';
import https from 'https';
import { execSync } from 'child_process';
import extractFileIcon from 'extract-file-icon';
import screenshot from 'screenshot-desktop';
import * as pty from 'node-pty';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openai = new OpenAI(); // Uses OPENAI_API_KEY from env

const PORT = 3001;
const iconCache = new Map(); // Cache icons by exe path

// Terminal configuration
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

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

function closeWindow(windowId) {
  const windows = windowManager.getWindows();
  const target = windows.find(w => w.id === windowId);
  if (target && target.processId) {
    try {
      // Use taskkill to gracefully close the process
      execSync(`taskkill /PID ${target.processId}`, { stdio: 'ignore' });
      return true;
    } catch (err) {
      console.error('Failed to close window:', err.message);
      return false;
    }
  }
  return false;
}

function maximizeWindow(windowId) {
  const windows = windowManager.getWindows();
  const target = windows.find(w => w.id === windowId);
  if (target) {
    target.bringToTop();
    target.maximize();
    return true;
  }
  return false;
}

function minimizeWindow(windowId) {
  const windows = windowManager.getWindows();
  const target = windows.find(w => w.id === windowId);
  if (target) {
    target.minimize();
    return true;
  }
  return false;
}

async function captureWindowScreenshot(windowId, screenWidth, screenHeight) {
  const windows = windowManager.getWindows();
  const target = windows.find(w => w.id === windowId);
  if (!target) return null;

  try {
    // Save original bounds
    const originalBounds = target.getBounds();

    // Focus the window first to bring it to front
    target.bringToTop();
    target.show();

    // If screen dimensions provided, resize window to fit
    if (screenWidth && screenHeight) {
      // Get desktop screen size
      const screenSize = robot.getScreenSize();
      const maxWidth = screenSize.width - 100; // Leave some margin
      const maxHeight = screenSize.height - 100;

      // Calculate aspect ratio from phone dimensions
      const phoneAspect = screenWidth / screenHeight;

      let newWidth, newHeight;

      // Fit window to desktop while maintaining phone's aspect ratio
      if (phoneAspect < 1) {
        // Portrait mode (taller than wide) - fit to height
        newHeight = Math.min(maxHeight, screenHeight);
        newWidth = Math.round(newHeight * phoneAspect);
        // Make sure width fits
        if (newWidth > maxWidth) {
          newWidth = maxWidth;
          newHeight = Math.round(newWidth / phoneAspect);
        }
      } else {
        // Landscape mode (wider than tall) - fit to width
        newWidth = Math.min(maxWidth, screenWidth);
        newHeight = Math.round(newWidth / phoneAspect);
        // Make sure height fits
        if (newHeight > maxHeight) {
          newHeight = maxHeight;
          newWidth = Math.round(newHeight * phoneAspect);
        }
      }

      console.log(`Resizing window to ${newWidth}x${newHeight} (aspect: ${phoneAspect.toFixed(2)})`);

      // Center on screen
      const newX = Math.max(0, Math.floor((screenSize.width - newWidth) / 2));
      const newY = Math.max(0, Math.floor((screenSize.height - newHeight) / 2));

      target.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight });

      // Wait for resize to complete
      await new Promise(resolve => setTimeout(resolve, 400));
    } else {
      // Just wait for window to be visible
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Get current window bounds for capture
    const captureBounds = target.getBounds();

    // Use robotjs to capture screen
    const bitmap = robot.screen.capture(captureBounds.x, captureBounds.y, captureBounds.width, captureBounds.height);

    // Convert to PNG using raw bitmap data
    // robotjs returns BGRA format, need to convert to RGBA for PNG
    const { width, height, image } = bitmap;
    const pixels = new Uint8Array(width * height * 4);

    for (let i = 0; i < width * height; i++) {
      const offset = i * 4;
      // BGRA to RGBA
      pixels[offset] = image[offset + 2];     // R
      pixels[offset + 1] = image[offset + 1]; // G
      pixels[offset + 2] = image[offset];     // B
      pixels[offset + 3] = 255;               // A (full opacity)
    }

    // Restore original bounds
    if (screenWidth && screenHeight) {
      target.setBounds(originalBounds);
    }

    // Create a simple BMP-like format that browsers can display
    // Using a data URL with raw pixel data via canvas on client side
    const base64 = `data:image/raw;width=${width};height=${height};base64,${Buffer.from(pixels).toString('base64')}`;

    return {
      screenshot: base64,
      bounds: captureBounds,
      width: width,
      height: height
    };
  } catch (err) {
    console.error('Screenshot error:', err);
    return null;
  }
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

async function queryAI(text) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are Eddie, a helpful voice assistant. Keep your responses concise and conversational since they will be read aloud or displayed on a small screen. Be friendly but efficient.'
      },
      {
        role: 'user',
        content: text
      }
    ],
    max_tokens: 500
  });
  return response.choices[0].message.content;
}

wss.on('connection', (ws) => {
  console.log('Client connected');
  let expectingAudio = false;
  let currentWindowId = null;
  const terminals = new Map(); // Store terminals for this client
  let terminalIdCounter = 0;

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

        // Check if this is an AI query or terminal voice
        if (windowId === 'ai-query') {
          ws.send(JSON.stringify({ type: 'aiTranscription', text }));
        } else if (windowId === 'terminal-voice') {
          ws.send(JSON.stringify({ type: 'terminalTranscription', text }));
        } else {
          ws.send(JSON.stringify({ type: 'transcription', text, windowId }));
        }
      } catch (err) {
        console.error('Transcription error:', err);
        if (windowId === 'ai-query') {
          ws.send(JSON.stringify({ type: 'aiError', error: err.message }));
        } else if (windowId === 'terminal-voice') {
          ws.send(JSON.stringify({ type: 'terminalTranscriptionError', error: err.message }));
        } else {
          ws.send(JSON.stringify({ type: 'transcriptionError', error: err.message, windowId }));
        }
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

        case 'closeWindow':
          console.log('Closing window:', msg.windowId);
          const closed = closeWindow(msg.windowId);
          ws.send(JSON.stringify({ type: 'closeResult', success: closed, windowId: msg.windowId }));
          // Send updated window list after a short delay
          setTimeout(() => {
            const updatedWindows = getWindows();
            ws.send(JSON.stringify({ type: 'windows', data: updatedWindows }));
          }, 500);
          break;

        case 'maximizeWindow':
          console.log('Maximizing window:', msg.windowId);
          const maximized = maximizeWindow(msg.windowId);
          ws.send(JSON.stringify({ type: 'maximizeResult', success: maximized, windowId: msg.windowId }));
          break;

        case 'minimizeWindow':
          console.log('Minimizing window:', msg.windowId);
          const minimized = minimizeWindow(msg.windowId);
          ws.send(JSON.stringify({ type: 'minimizeResult', success: minimized, windowId: msg.windowId }));
          break;

        case 'getScreenshot':
          console.log('Getting screenshot for window:', msg.windowId, 'screen:', msg.screenWidth, 'x', msg.screenHeight);
          const screenshotResult = await captureWindowScreenshot(msg.windowId, msg.screenWidth, msg.screenHeight);
          if (screenshotResult) {
            ws.send(JSON.stringify({
              type: 'screenshot',
              windowId: msg.windowId,
              screenshot: screenshotResult.screenshot,
              bounds: screenshotResult.bounds,
              width: screenshotResult.width,
              height: screenshotResult.height
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'screenshotError',
              windowId: msg.windowId,
              error: 'Failed to capture screenshot'
            }));
          }
          break;

        case 'aiQuery':
          console.log('AI Query:', msg.text);
          try {
            const aiResponse = await queryAI(msg.text);
            console.log('AI Response:', aiResponse);
            ws.send(JSON.stringify({ type: 'aiResponse', text: aiResponse }));
          } catch (err) {
            console.error('AI query error:', err);
            ws.send(JSON.stringify({ type: 'aiError', error: err.message }));
          }
          break;

        // Terminal management
        case 'terminalCreate':
          try {
            const termId = ++terminalIdCounter;
            const cols = msg.cols || 80;
            const rows = msg.rows || 24;

            const ptyProcess = pty.spawn(shell, [], {
              name: 'xterm-256color',
              cols: cols,
              rows: rows,
              cwd: msg.cwd || os.homedir(),
              env: process.env
            });

            // Handle terminal output
            ptyProcess.onData((data) => {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'terminalOutput', termId, data }));
              }
            });

            // Handle terminal exit
            ptyProcess.onExit(({ exitCode }) => {
              console.log(`Terminal ${termId} exited with code ${exitCode}`);
              terminals.delete(termId);
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'terminalExit', termId, exitCode }));
              }
            });

            terminals.set(termId, ptyProcess);
            console.log(`Terminal ${termId} created (${cols}x${rows})`);
            ws.send(JSON.stringify({ type: 'terminalCreated', termId }));
          } catch (err) {
            console.error('Terminal creation error:', err);
            ws.send(JSON.stringify({ type: 'terminalError', error: err.message }));
          }
          break;

        case 'terminalInput':
          const inputTerm = terminals.get(msg.termId);
          if (inputTerm) {
            inputTerm.write(msg.data);
          }
          break;

        case 'terminalResize':
          const resizeTerm = terminals.get(msg.termId);
          if (resizeTerm) {
            resizeTerm.resize(msg.cols, msg.rows);
            console.log(`Terminal ${msg.termId} resized to ${msg.cols}x${msg.rows}`);
          }
          break;

        case 'terminalClose':
          const closeTerm = terminals.get(msg.termId);
          if (closeTerm) {
            closeTerm.kill();
            terminals.delete(msg.termId);
            console.log(`Terminal ${msg.termId} closed`);
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
    // Clean up all terminals for this client
    for (const [termId, ptyProcess] of terminals) {
      console.log(`Cleaning up terminal ${termId}`);
      ptyProcess.kill();
    }
    terminals.clear();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Secure WebSocket server running on wss://localhost:${PORT}`);
});
