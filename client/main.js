// Main entry point - Voice App Client
import '@xterm/xterm/css/xterm.css';
import { config } from './config.js';
import * as store from './state/store.js';
import { connect, setMessageHandler, send } from './services/websocket.js';
import { initVoice } from './services/voiceRecorder.js';
import { handleMessage } from './services/messageHandler.js';
import { initCloseDialog } from './components/closeDialog.js';
import { handleWindowResize } from './components/terminal.js';
import { initDetailPage } from './pages/detailPage.js';
import { initTerminalsPage } from './pages/terminalsPage.js';
import { initContextPage } from './pages/contextPage.js';
import { initAiAssistant } from './services/aiAssistant.js';

// Toggle recording for main transcription
function toggleRecording() {
  if (store.mediaRecorder && store.mediaRecorder.state === 'recording') {
    store.mediaRecorder.stop();
    document.getElementById('record-btn').textContent = 'Press to Talk';
    document.getElementById('record-btn').classList.remove('recording');
    document.getElementById('recording-indicator').classList.remove('active');
    document.getElementById('transcription-text').textContent = 'Processing...';
    document.getElementById('copy-btn').classList.remove('visible');
  } else if (store.mediaRecorder && store.mediaRecorder.state === 'inactive') {
    store.clearAudioChunks();
    store.mediaRecorder.start();
    document.getElementById('record-btn').textContent = 'Recording...';
    document.getElementById('record-btn').classList.add('recording');
    document.getElementById('recording-indicator').classList.add('active');
    document.getElementById('transcription-text').textContent = 'Listening...';
    document.getElementById('copy-btn').classList.remove('visible');
  }
}

function copyTranscription() {
  const text = document.getElementById('transcription-text').textContent;
  if (text && text !== 'Listening...' && text !== 'Processing...' && !text.startsWith('Error:')) {
    navigator.clipboard.writeText(text).then(() => {
      const copyBtn = document.getElementById('copy-btn');
      copyBtn.classList.add('copied');
      setTimeout(() => copyBtn.classList.remove('copied'), 1500);
    });
  }
}

function refreshWindows() {
  send({ type: 'getWindows' });
}

function toggleAutoRefresh() {
  const toggle = document.getElementById('auto-refresh-toggle');
  store.setAutoRefreshEnabled(toggle.checked);

  if (store.autoRefreshEnabled) {
    refreshWindows();
    store.setAutoRefreshInterval(setInterval(refreshWindows, config.autoRefreshInterval));
  } else {
    if (store.autoRefreshInterval) {
      clearInterval(store.autoRefreshInterval);
      store.setAutoRefreshInterval(null);
    }
  }
}

// Initialize all components
function init() {
  // Set up message handler
  setMessageHandler(handleMessage);

  // Initialize components
  initCloseDialog();
  initDetailPage();
  initTerminalsPage();
  initContextPage();
  initAiAssistant();

  // Wire up main UI elements
  document.getElementById('auto-refresh-toggle').onchange = toggleAutoRefresh;
  document.getElementById('record-btn').addEventListener('click', toggleRecording);
  document.getElementById('copy-btn').addEventListener('click', copyTranscription);

  // Handle window resize for terminals
  window.addEventListener('resize', handleWindowResize);

  // Connect to server
  connect();
  initVoice();

  // Start auto-refresh by default
  store.setAutoRefreshEnabled(true);
  store.setAutoRefreshInterval(setInterval(refreshWindows, config.autoRefreshInterval));
}

// Start the app
init();
