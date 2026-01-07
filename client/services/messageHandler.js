// WebSocket message handler
import * as store from '../state/store.js';
import { mergeWindows } from '../utils/helpers.js';
import { renderWindows, appendCardText, updateCardButtons } from '../components/windowCard.js';
import { displayScreenshot, updateDetailVoiceControls } from '../pages/detailPage.js';
import { renderContextFolders } from '../pages/contextPage.js';
import { handleAiTranscription, handleAiResponse, handleAiError } from './aiAssistant.js';
import {
  onTerminalCreated,
  closeTerminal,
  writeToTerminal,
  handleTerminalTranscription,
  handleTerminalTranscriptionError
} from '../components/terminal.js';

function displayTranscription(text) {
  document.getElementById('transcription-text').textContent = text;
  const copyBtn = document.getElementById('copy-btn');
  if (text && text !== 'Listening...' && text !== 'Processing...' && !text.startsWith('Error:')) {
    copyBtn.classList.add('visible');
  } else {
    copyBtn.classList.remove('visible');
  }
}

export function handleMessage(msg) {
  switch (msg.type) {
    case 'windows':
      store.setWindows(mergeWindows(store.windows, msg.data));
      renderWindows();
      break;

    case 'focusResult':
      if (msg.success) {
        console.log('Window focused:', msg.windowId);
      } else {
        console.error('Failed to focus window:', msg.windowId);
      }
      break;

    case 'transcription':
      if (msg.windowId) {
        store.transcribingWindows[msg.windowId] = false;
        appendCardText(msg.windowId, msg.text);
      } else {
        displayTranscription(msg.text);
      }
      break;

    case 'transcriptionError':
      if (msg.windowId) {
        store.transcribingWindows[msg.windowId] = false;
        updateCardButtons(msg.windowId);
      }
      displayTranscription(`Error: ${msg.error}`);
      break;

    case 'screenshot':
      if (msg.windowId === store.currentDetailWindowId) {
        displayScreenshot(msg.screenshot, msg.width, msg.height);
      }
      break;

    case 'screenshotError':
      if (msg.windowId === store.currentDetailWindowId) {
        document.getElementById('detail-screenshot').innerHTML =
          '<div class="screenshot-loading">Screenshot unavailable</div>';
      }
      break;

    case 'aiTranscription':
      handleAiTranscription(msg.text);
      break;

    case 'aiResponse':
      handleAiResponse(msg.text);
      break;

    case 'aiError':
      handleAiError(msg.error);
      break;

    case 'terminalCreated':
      onTerminalCreated(msg.termId);
      break;

    case 'terminalOutput':
      writeToTerminal(msg.termId, msg.data);
      break;

    case 'terminalExit':
      closeTerminal(msg.termId);
      break;

    case 'terminalError':
      console.error('Terminal error:', msg.error);
      break;

    case 'terminalTranscription':
      handleTerminalTranscription(msg.text);
      break;

    case 'terminalTranscriptionError':
      handleTerminalTranscriptionError();
      console.error('Terminal transcription error:', msg.error);
      break;

    case 'contextFolders':
      renderContextFolders(msg.data);
      break;

    case 'contextFoldersError':
      console.error('Context scan error:', msg.error);
      document.getElementById('context-loading').style.display = 'none';
      document.getElementById('context-empty').style.display = 'flex';
      document.getElementById('context-empty').querySelector('p').textContent = 'Error scanning folders';
      break;

    default:
      console.log('Unknown message type:', msg.type);
  }
}
