// Detail page module
import * as store from '../state/store.js';
import { send } from '../services/websocket.js';
import { showCloseDialog } from '../components/closeDialog.js';
import { toggleCardRecording, submitCardText, clearCardText } from '../components/windowCard.js';

export function showDetailPage(windowId) {
  const win = store.windows.find(w => w.id === windowId);
  if (!win) return;

  store.setCurrentDetailWindowId(windowId);

  const detailPage = document.getElementById('detail-page');

  document.getElementById('detail-screenshot').innerHTML =
    '<div class="screenshot-loading">Capturing screenshot...</div>';

  document.getElementById('detail-header-title').textContent = win.title || 'Untitled';

  const iconEl = document.getElementById('detail-icon');
  if (win.icon) {
    iconEl.innerHTML = `<img src="${win.icon}" alt="">`;
  } else {
    iconEl.innerHTML = '';
  }

  document.getElementById('detail-title').textContent = win.title || 'Untitled';
  document.getElementById('detail-path').textContent = win.path || 'Unknown';
  document.getElementById('detail-pid').textContent = win.processId || 'Unknown';
  document.getElementById('detail-window-id').textContent = win.id || 'Unknown';

  if (win.bounds) {
    document.getElementById('detail-position').textContent = `X: ${win.bounds.x}, Y: ${win.bounds.y}`;
    document.getElementById('detail-size').textContent = `${win.bounds.width} × ${win.bounds.height}`;
  } else {
    document.getElementById('detail-position').textContent = 'Unknown';
    document.getElementById('detail-size').textContent = 'Unknown';
  }

  updateDetailVoiceControls(windowId);
  detailPage.classList.add('visible');

  setTimeout(() => requestScreenshot(windowId), 100);
}

export function hideDetailPage() {
  document.getElementById('detail-page').classList.remove('visible');
  store.setCurrentDetailWindowId(null);
}

export function updateDetailVoiceControls(windowId) {
  const hasText = store.cardTexts[windowId] && store.cardTexts[windowId].length > 0;
  const isTranscribing = store.transcribingWindows[windowId] === true;

  const detailCardText = document.getElementById('detail-card-text');
  detailCardText.textContent = store.cardTexts[windowId] || '';

  detailCardText.classList.toggle('transcribing', isTranscribing);

  const clearBtn = document.getElementById('detail-clear-btn');
  clearBtn.classList.toggle('visible', hasText);

  const addBtn = document.getElementById('detail-add-btn');
  addBtn.classList.toggle('visible', hasText);

  const micBtn = document.getElementById('detail-mic-btn');
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

function requestScreenshot(windowId) {
  const topBar = document.querySelector('.detail-top-bar');
  const topBarHeight = topBar ? topBar.offsetHeight : 0;
  const availableHeight = window.innerHeight - topBarHeight;

  const pixelRatio = window.devicePixelRatio || 1;
  const screenWidth = window.innerWidth * pixelRatio;
  const screenHeight = availableHeight * pixelRatio;

  send({
    type: 'getScreenshot',
    windowId,
    screenWidth: Math.round(screenWidth),
    screenHeight: Math.round(screenHeight)
  });
}

export function displayScreenshot(screenshotData, width, height) {
  const container = document.getElementById('detail-screenshot');

  if (screenshotData.startsWith('data:image/raw;')) {
    const match = screenshotData.match(/width=(\d+);height=(\d+);base64,(.+)/);
    if (match) {
      const w = parseInt(match[1]);
      const h = parseInt(match[2]);
      const base64Data = match[3];

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const imageData = ctx.createImageData(w, h);
      imageData.data.set(bytes);
      ctx.putImageData(imageData, 0, 0);

      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.alt = 'Window screenshot';
      container.innerHTML = '';
      container.appendChild(img);
    }
  } else {
    const img = document.createElement('img');
    img.src = screenshotData;
    img.alt = 'Window screenshot';
    container.innerHTML = '';
    container.appendChild(img);
  }
}

function focusWindow(windowId) {
  send({ type: 'focusWindow', windowId });
}

export function initDetailPage() {
  document.getElementById('detail-back').onclick = hideDetailPage;
  document.getElementById('detail-focus-btn').onclick = () => {
    if (store.currentDetailWindowId) focusWindow(store.currentDetailWindowId);
  };
  document.getElementById('detail-maximize-btn').onclick = () => {
    if (store.currentDetailWindowId) send({ type: 'maximizeWindow', windowId: store.currentDetailWindowId });
  };
  document.getElementById('detail-minimize-btn').onclick = () => {
    if (store.currentDetailWindowId) send({ type: 'minimizeWindow', windowId: store.currentDetailWindowId });
  };
  document.getElementById('detail-close-btn').onclick = () => {
    if (store.currentDetailWindowId) showCloseDialog(store.currentDetailWindowId);
  };

  document.getElementById('detail-mic-btn').onclick = () => {
    if (!store.currentDetailWindowId) return;
    const hasText = store.cardTexts[store.currentDetailWindowId] && store.cardTexts[store.currentDetailWindowId].length > 0;
    if (hasText) {
      submitCardText(store.currentDetailWindowId);
    } else {
      toggleCardRecording(store.currentDetailWindowId, document.getElementById('detail-mic-btn'));
    }
  };

  document.getElementById('detail-add-btn').onclick = () => {
    if (!store.currentDetailWindowId) return;
    toggleCardRecording(store.currentDetailWindowId, document.getElementById('detail-add-btn'));
  };

  document.getElementById('detail-clear-btn').onclick = () => {
    if (!store.currentDetailWindowId) return;
    clearCardText(store.currentDetailWindowId);
  };
}
