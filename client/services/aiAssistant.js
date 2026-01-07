// AI Assistant service
import * as store from '../state/store.js';
import { send } from './websocket.js';
import { playDing } from '../utils/helpers.js';

export function updateAiMicButton() {
  const micBtn = document.getElementById('ai-mic-btn');
  if (store.aiProcessing) {
    micBtn.classList.add('processing');
    micBtn.classList.remove('recording');
  } else {
    micBtn.classList.remove('processing');
  }
}

export function toggleAiRecording() {
  const micBtn = document.getElementById('ai-mic-btn');

  if (store.aiProcessing) return;

  if (store.mediaRecorder && store.mediaRecorder.state === 'recording') {
    store.setAiProcessing(true);
    updateAiMicButton();
    store.mediaRecorder.stop();
    micBtn.classList.remove('recording');

    const responseEl = document.getElementById('ai-response');
    const responseContainer = responseEl.parentElement;
    responseEl.textContent = 'Thinking...';
    responseEl.classList.add('loading');
    responseContainer.classList.add('visible');
  } else if (store.mediaRecorder && store.mediaRecorder.state === 'inactive') {
    store.setActiveWindowId('ai-query');
    store.setActiveMicBtn(micBtn);
    store.clearAudioChunks();
    store.mediaRecorder.start();
    micBtn.classList.add('recording');

    document.getElementById('ai-query-text').textContent = '';
    document.getElementById('ai-response').parentElement.classList.remove('visible');
  }
}

export function handleAiTranscription(text) {
  store.setAiQueryText(text);
  document.getElementById('ai-query-text').textContent = text;
  send({ type: 'aiQuery', text });
}

export function handleAiResponse(text) {
  store.setAiProcessing(false);
  updateAiMicButton();

  const responseEl = document.getElementById('ai-response');
  const responseContainer = responseEl.parentElement;
  responseEl.innerHTML = marked.parse(text);
  responseEl.classList.remove('loading');
  responseContainer.classList.add('visible');

  if (navigator.vibrate) {
    navigator.vibrate(200);
  }
  playDing();
}

export function handleAiError(error) {
  store.setAiProcessing(false);
  updateAiMicButton();

  const errorEl = document.getElementById('ai-response');
  const errorContainer = errorEl.parentElement;
  errorEl.textContent = `Error: ${error}`;
  errorEl.classList.remove('loading');
  errorContainer.classList.add('visible');
}

export function copyAiResponse() {
  const responseEl = document.getElementById('ai-response');
  const text = responseEl.textContent;
  if (text && text !== 'Thinking...' && !text.startsWith('Error:')) {
    navigator.clipboard.writeText(text).then(() => {
      const copyBtn = document.getElementById('ai-copy-btn');
      copyBtn.classList.add('copied');
      setTimeout(() => copyBtn.classList.remove('copied'), 1500);
    });
  }
}

export function initAiAssistant() {
  document.getElementById('ai-mic-btn').addEventListener('click', toggleAiRecording);
  document.getElementById('ai-copy-btn').addEventListener('click', copyAiResponse);
}
