// Terminals page module
import * as store from '../state/store.js';
import { createTerminal } from '../components/terminal.js';

export function showTerminalsPage() {
  const page = document.getElementById('terminals-page');
  page.classList.add('visible');

  store.terminals.forEach((term) => {
    setTimeout(() => term.fitAddon.fit(), 100);
  });
}

export function hideTerminalsPage() {
  const page = document.getElementById('terminals-page');
  page.classList.remove('visible');
}

export function launchTerminal(type) {
  if (type === 'claude') {
    store.setPendingTerminalCommand('claude --dangerously-skip-permissions');
    store.setPendingTerminalReadOnly(true);
  } else if (type === 'gemini') {
    store.setPendingTerminalCommand('gemini');
    store.setPendingTerminalReadOnly(true);
  } else {
    store.setPendingTerminalCommand(null);
    store.setPendingTerminalReadOnly(false);
  }
  createTerminal(type);
}

export function initTerminalsPage() {
  document.getElementById('terminals-fab').onclick = showTerminalsPage;
  document.getElementById('terminals-back').onclick = hideTerminalsPage;

  document.getElementById('terminals-add-btn').onclick = (e) => {
    e.stopPropagation();
    document.getElementById('terminals-add-menu').classList.toggle('visible');
  };

  document.getElementById('add-terminal-claude').onclick = (e) => {
    e.stopPropagation();
    document.getElementById('terminals-add-menu').classList.remove('visible');
    launchTerminal('claude');
  };

  document.getElementById('add-terminal-gemini').onclick = (e) => {
    e.stopPropagation();
    document.getElementById('terminals-add-menu').classList.remove('visible');
    launchTerminal('gemini');
  };

  document.getElementById('add-terminal-regular').onclick = (e) => {
    e.stopPropagation();
    document.getElementById('terminals-add-menu').classList.remove('visible');
    launchTerminal('regular');
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.terminals-add-wrapper')) {
      document.getElementById('terminals-add-menu').classList.remove('visible');
    }
  });
}
