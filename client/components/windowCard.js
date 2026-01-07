// Window card component
import * as store from '../state/store.js';
import { send } from '../services/websocket.js';
import { scaleTextToFit } from '../utils/helpers.js';
import { showDetailPage } from '../pages/detailPage.js';
import { showCloseDialog } from './closeDialog.js';

export function renderWindows() {
  const grid = document.getElementById('windows-grid');
  grid.innerHTML = '';

  store.windows.forEach(win => {
    const card = createWindowCard(win);
    grid.appendChild(card);
  });
}

function createWindowCard(win) {
  const card = document.createElement('div');
  card.className = 'window-card';

  const cardContent = document.createElement('div');
  cardContent.className = 'card-content';
  cardContent.onclick = () => showDetailPage(win.id);

  // Icon
  if (win.icon) {
    const icon = document.createElement('img');
    icon.className = 'window-icon';
    icon.src = win.icon;
    icon.alt = '';
    cardContent.appendChild(icon);
  }

  const cardInfo = document.createElement('div');
  cardInfo.className = 'card-info';

  const title = document.createElement('div');
  title.className = 'window-title';
  title.textContent = win.title || 'Untitled';

  cardInfo.appendChild(title);
  cardContent.appendChild(cardInfo);

  requestAnimationFrame(() => scaleTextToFit(title));

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'card-close-btn';
  closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    showCloseDialog(win.id);
  };

  const hasText = store.cardTexts[win.id] && store.cardTexts[win.id].length > 0;
  const isRecording = store.recordingWindowId === win.id;

  // Clear button
  const clearBtn = document.createElement('button');
  clearBtn.className = 'card-clear-btn' + (hasText ? ' visible' : '');
  clearBtn.dataset.windowId = win.id;
  clearBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
  clearBtn.onclick = (e) => {
    e.stopPropagation();
    clearCardText(win.id);
  };

  // Add button
  const addBtn = document.createElement('button');
  addBtn.className = 'card-add-btn' + (hasText ? ' visible' : '') + (isRecording && hasText ? ' recording' : '');
  addBtn.dataset.windowId = win.id;
  addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
  addBtn.onclick = (e) => {
    e.stopPropagation();
    toggleCardRecording(win.id, addBtn);
  };

  // Mic/Submit button
  const micBtn = document.createElement('button');
  micBtn.className = 'card-mic-btn' + (hasText ? ' submit-mode' : '') + (isRecording && !hasText ? ' recording' : '');
  micBtn.dataset.windowId = win.id;
  if (hasText) {
    micBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
  } else {
    micBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
  }
  micBtn.onclick = (e) => {
    e.stopPropagation();
    if (store.cardTexts[win.id] && store.cardTexts[win.id].length > 0) {
      submitCardText(win.id);
    } else {
      toggleCardRecording(win.id, micBtn);
    }
  };

  // Update activeMicBtn reference if recording
  if (isRecording) {
    store.setActiveMicBtn(hasText ? addBtn : micBtn);
  }

  // Text display area
  const cardTextArea = document.createElement('div');
  cardTextArea.className = 'card-text-area';

  const cardText = document.createElement('div');
  cardText.className = 'card-text';
  cardText.dataset.windowId = win.id;
  cardText.textContent = store.cardTexts[win.id] || '';

  const cardButtons = document.createElement('div');
  cardButtons.className = 'card-buttons';
  cardButtons.appendChild(clearBtn);
  cardButtons.appendChild(addBtn);
  cardButtons.appendChild(micBtn);

  cardTextArea.appendChild(cardText);
  cardTextArea.appendChild(cardButtons);

  // Card layout
  const cardHeader = document.createElement('div');
  cardHeader.className = 'card-header';
  cardHeader.appendChild(cardContent);

  card.appendChild(closeBtn);
  card.appendChild(cardHeader);
  card.appendChild(cardTextArea);

  return card;
}

export function toggleCardRecording(windowId, btn) {
  if (store.mediaRecorder && store.mediaRecorder.state === 'recording') {
    store.setRecordingWindowId(null);
    store.transcribingWindows[windowId] = true;
    updateCardButtons(windowId);
    store.mediaRecorder.stop();
    btn.classList.remove('recording');
    document.getElementById('transcription-text').textContent = 'Processing...';
  } else if (store.mediaRecorder && store.mediaRecorder.state === 'inactive') {
    store.setActiveWindowId(windowId);
    store.setRecordingWindowId(windowId);
    store.setActiveMicBtn(btn);
    store.clearAudioChunks();
    store.mediaRecorder.start();
    btn.classList.add('recording');
    document.getElementById('transcription-text').textContent = 'Listening...';
  }
}

export function appendCardText(windowId, text) {
  if (!store.cardTexts[windowId]) {
    store.cardTexts[windowId] = '';
  }
  store.cardTexts[windowId] += (store.cardTexts[windowId] ? ' ' : '') + text;

  const textEl = document.querySelector(`.card-text[data-window-id="${windowId}"]`);
  if (textEl) {
    textEl.textContent = store.cardTexts[windowId];
  }
  updateCardButtons(windowId);

  // Import dynamically to avoid circular dependency
  import('../pages/detailPage.js').then(({ updateDetailVoiceControls }) => {
    if (store.currentDetailWindowId === windowId) {
      updateDetailVoiceControls(windowId);
    }
  });
}

export function submitCardText(windowId) {
  const text = store.cardTexts[windowId];
  if (text) {
    send({ type: 'command', windowId, text });
    store.cardTexts[windowId] = '';
    const textEl = document.querySelector(`.card-text[data-window-id="${windowId}"]`);
    if (textEl) {
      textEl.textContent = '';
    }
    updateCardButtons(windowId);

    import('../pages/detailPage.js').then(({ updateDetailVoiceControls }) => {
      if (store.currentDetailWindowId === windowId) {
        updateDetailVoiceControls(windowId);
      }
    });
  }
}

export function clearCardText(windowId) {
  store.cardTexts[windowId] = '';
  const textEl = document.querySelector(`.card-text[data-window-id="${windowId}"]`);
  if (textEl) {
    textEl.textContent = '';
  }
  updateCardButtons(windowId);

  import('../pages/detailPage.js').then(({ updateDetailVoiceControls }) => {
    if (store.currentDetailWindowId === windowId) {
      updateDetailVoiceControls(windowId);
    }
  });
}

export function updateCardButtons(windowId) {
  const hasText = store.cardTexts[windowId] && store.cardTexts[windowId].length > 0;
  const isTranscribing = store.transcribingWindows[windowId] === true;
  const clearBtn = document.querySelector(`.card-clear-btn[data-window-id="${windowId}"]`);
  const micBtn = document.querySelector(`.card-mic-btn[data-window-id="${windowId}"]`);
  const addBtn = document.querySelector(`.card-add-btn[data-window-id="${windowId}"]`);
  const cardText = document.querySelector(`.card-text[data-window-id="${windowId}"]`);

  if (cardText) {
    cardText.classList.toggle('transcribing', isTranscribing);
  }

  if (clearBtn) {
    clearBtn.classList.toggle('visible', hasText);
  }

  if (addBtn) {
    addBtn.classList.toggle('visible', hasText);
  }

  if (micBtn) {
    const micIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
    const checkIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;

    if (hasText || isTranscribing) {
      micBtn.classList.add('submit-mode');
      if (isTranscribing) {
        micBtn.classList.add('processing');
        micBtn.innerHTML = micIcon;
        micBtn.disabled = true;
      } else {
        micBtn.classList.remove('processing');
        micBtn.innerHTML = checkIcon;
        micBtn.disabled = false;
      }
    } else {
      micBtn.classList.remove('submit-mode', 'processing');
      micBtn.innerHTML = micIcon;
      micBtn.disabled = false;
    }
  }

  import('../pages/detailPage.js').then(({ updateDetailVoiceControls }) => {
    if (store.currentDetailWindowId === windowId) {
      updateDetailVoiceControls(windowId);
    }
  });
}
