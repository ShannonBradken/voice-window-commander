import { getWindows, focusWindow, closeWindow, maximizeWindow, minimizeWindow } from '../modules/windowManager.js';
import { captureWindowScreenshot } from '../modules/screenshotCapture.js';
import { transcribeAudio } from '../modules/audioProcessing.js';
import { queryAI } from '../modules/aiAssistant.js';
import { scanForContextFolders } from '../modules/claudeProjects.js';
import { pasteToWindow } from '../modules/inputActions.js';
import { TerminalManager } from '../modules/terminalManager.js';

/**
 * Create a WebSocket message handler for a client connection
 */
export function createMessageHandler(ws) {
  let expectingAudio = false;
  let currentWindowId = null;
  const terminalManager = new TerminalManager();

  // Send initial window list
  const windows = getWindows();
  ws.send(JSON.stringify({ type: 'windows', data: windows }));

  /**
   * Handle incoming messages
   */
  async function handleMessage(message, isBinary) {
    // Handle binary audio data
    if (isBinary || expectingAudio) {
      await handleAudioMessage(message);
      return;
    }

    // Handle JSON messages
    try {
      const msg = JSON.parse(message.toString());
      await handleJsonMessage(msg);
    } catch (err) {
      console.error('Error processing message:', err);
    }
  }

  /**
   * Handle binary audio message
   */
  async function handleAudioMessage(message) {
    expectingAudio = false;
    const windowId = currentWindowId;
    currentWindowId = null;
    console.log('Received audio data:', message.length, 'bytes', 'for window:', windowId);

    try {
      const text = await transcribeAudio(message);
      console.log('Transcription:', text);

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
  }

  /**
   * Handle JSON message by type
   */
  async function handleJsonMessage(msg) {
    switch (msg.type) {
      case 'getWindows':
        handleGetWindows();
        break;

      case 'focusWindow':
        handleFocusWindow(msg.windowId);
        break;

      case 'audioStart':
        handleAudioStart(msg.windowId);
        break;

      case 'command':
        await handleCommand(msg.windowId, msg.text);
        break;

      case 'closeWindow':
        handleCloseWindow(msg.windowId);
        break;

      case 'maximizeWindow':
        handleMaximizeWindow(msg.windowId);
        break;

      case 'minimizeWindow':
        handleMinimizeWindow(msg.windowId);
        break;

      case 'getScreenshot':
        await handleGetScreenshot(msg.windowId, msg.screenWidth, msg.screenHeight);
        break;

      case 'aiQuery':
        await handleAiQuery(msg.text);
        break;

      case 'terminalCreate':
        handleTerminalCreate(msg);
        break;

      case 'terminalInput':
        handleTerminalInput(msg.termId, msg.data);
        break;

      case 'terminalResize':
        handleTerminalResize(msg.termId, msg.cols, msg.rows);
        break;

      case 'terminalClose':
        handleTerminalClose(msg.termId);
        break;

      case 'scanContextFolders':
        await handleScanContextFolders();
        break;

      default:
        console.log('Unknown message type:', msg.type);
    }
  }

  // Individual message handlers
  function handleGetWindows() {
    const windows = getWindows();
    ws.send(JSON.stringify({ type: 'windows', data: windows }));
  }

  function handleFocusWindow(windowId) {
    const success = focusWindow(windowId);
    ws.send(JSON.stringify({ type: 'focusResult', success, windowId }));
  }

  function handleAudioStart(windowId) {
    console.log('Expecting audio for window:', windowId);
    expectingAudio = true;
    currentWindowId = windowId;
  }

  async function handleCommand(windowId, text) {
    console.log('Command for window', windowId, ':', text);
    try {
      await pasteToWindow(windowId, text);
      ws.send(JSON.stringify({ type: 'commandSuccess', windowId, text }));
    } catch (err) {
      console.error('Paste error:', err);
      ws.send(JSON.stringify({ type: 'commandError', windowId, error: err.message }));
    }
  }

  function handleCloseWindow(windowId) {
    console.log('Closing window:', windowId);
    const closed = closeWindow(windowId);
    ws.send(JSON.stringify({ type: 'closeResult', success: closed, windowId }));
    // Send updated window list after a short delay
    setTimeout(() => {
      const updatedWindows = getWindows();
      ws.send(JSON.stringify({ type: 'windows', data: updatedWindows }));
    }, 500);
  }

  function handleMaximizeWindow(windowId) {
    console.log('Maximizing window:', windowId);
    const maximized = maximizeWindow(windowId);
    ws.send(JSON.stringify({ type: 'maximizeResult', success: maximized, windowId }));
  }

  function handleMinimizeWindow(windowId) {
    console.log('Minimizing window:', windowId);
    const minimized = minimizeWindow(windowId);
    ws.send(JSON.stringify({ type: 'minimizeResult', success: minimized, windowId }));
  }

  async function handleGetScreenshot(windowId, screenWidth, screenHeight) {
    console.log('Getting screenshot for window:', windowId, 'screen:', screenWidth, 'x', screenHeight);
    const result = await captureWindowScreenshot(windowId, screenWidth, screenHeight);
    if (result) {
      ws.send(JSON.stringify({
        type: 'screenshot',
        windowId,
        screenshot: result.screenshot,
        bounds: result.bounds,
        width: result.width,
        height: result.height
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'screenshotError',
        windowId,
        error: 'Failed to capture screenshot'
      }));
    }
  }

  async function handleAiQuery(text) {
    console.log('AI Query:', text);
    try {
      const aiResponse = await queryAI(text);
      console.log('AI Response:', aiResponse);
      ws.send(JSON.stringify({ type: 'aiResponse', text: aiResponse }));
    } catch (err) {
      console.error('AI query error:', err);
      ws.send(JSON.stringify({ type: 'aiError', error: err.message }));
    }
  }

  function handleTerminalCreate(msg) {
    try {
      const { termId, ptyProcess } = terminalManager.create({
        cols: msg.cols,
        rows: msg.rows,
        cwd: msg.cwd
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
        terminalManager.remove(termId);
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'terminalExit', termId, exitCode }));
        }
      });

      ws.send(JSON.stringify({ type: 'terminalCreated', termId }));
    } catch (err) {
      console.error('Terminal creation error:', err);
      ws.send(JSON.stringify({ type: 'terminalError', error: err.message }));
    }
  }

  function handleTerminalInput(termId, data) {
    terminalManager.write(termId, data);
  }

  function handleTerminalResize(termId, cols, rows) {
    terminalManager.resize(termId, cols, rows);
  }

  function handleTerminalClose(termId) {
    terminalManager.close(termId);
  }

  async function handleScanContextFolders() {
    console.log('Scanning for context folders...');
    try {
      const contextFolders = await scanForContextFolders();
      console.log(`Found ${contextFolders.length} context folders`);
      ws.send(JSON.stringify({ type: 'contextFolders', data: contextFolders }));
    } catch (err) {
      console.error('Scan error:', err);
      ws.send(JSON.stringify({ type: 'contextFoldersError', error: err.message }));
    }
  }

  /**
   * Cleanup on disconnect
   */
  function cleanup() {
    console.log('Client disconnected');
    terminalManager.closeAll();
  }

  return { handleMessage, cleanup };
}
