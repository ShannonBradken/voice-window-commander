// Close dialog component
import * as store from '../state/store.js';
import { send } from '../services/websocket.js';
import { hideDetailPage } from '../pages/detailPage.js';

export function showCloseDialog(windowId) {
  const win = store.windows.find(w => w.id === windowId);
  if (!win) return;

  store.setPendingCloseWindowId(windowId);

  const dialog = document.getElementById('close-dialog');
  const iconEl = dialog.querySelector('.dialog-icon');
  const titleEl = dialog.querySelector('.dialog-title');
  const pathEl = dialog.querySelector('.dialog-path');

  if (win.icon) {
    iconEl.innerHTML = `<img src="${win.icon}" alt="">`;
  } else {
    iconEl.innerHTML = '';
  }
  titleEl.textContent = win.title || 'Untitled';
  pathEl.textContent = win.path || 'Unknown';

  dialog.classList.add('visible');
}

export function hideCloseDialog() {
  const dialog = document.getElementById('close-dialog');
  dialog.classList.remove('visible');
  store.setPendingCloseWindowId(null);
}

export function confirmCloseWindow() {
  if (store.pendingCloseWindowId) {
    send({ type: 'closeWindow', windowId: store.pendingCloseWindowId });
  }
  hideCloseDialog();
  hideDetailPage();
}

export function initCloseDialog() {
  document.querySelector('.dialog-cancel').onclick = hideCloseDialog;
  document.querySelector('.dialog-confirm').onclick = confirmCloseWindow;
  document.getElementById('close-dialog').onclick = (e) => {
    if (e.target.id === 'close-dialog') hideCloseDialog();
  };
}
