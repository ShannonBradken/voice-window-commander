// Terminal component
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { config } from '../config.js';
import * as store from '../state/store.js';
import { send } from '../services/websocket.js';

export function createTerminal(type = 'regular') {
  send({
    type: 'terminalCreate',
    cols: config.terminalDefaults.cols,
    rows: config.terminalDefaults.rows,
    terminalType: type
  });
}

export function onTerminalCreated(termId) {
  const isReadOnly = store.pendingTerminalReadOnly;
  const command = store.pendingTerminalCommand;
  store.setPendingTerminalReadOnly(false);

  let terminalType = 'regular';
  if (command && command.includes('claude')) terminalType = 'claude';
  else if (command && command.includes('gemini')) terminalType = 'gemini';

  let typeLabel = 'Terminal';
  if (terminalType === 'claude') typeLabel = 'Claude';
  else if (terminalType === 'gemini') typeLabel = 'Gemini';

  // Hide empty state
  document.getElementById('terminals-empty').style.display = 'none';

  // Create terminal card
  const terminalsList = document.getElementById('terminals-list');
  const card = document.createElement('div');
  card.className = 'terminal-card';
  card.dataset.termId = termId;

  card.innerHTML = `
    <div class="terminal-card-header">
      <button class="terminal-card-back-btn" title="Back">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
      </button>
      <span class="terminal-card-type">${typeLabel}</span>
      <button class="terminal-card-close-btn" title="Close">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>
    <div class="terminal-card-display"></div>
    <div class="terminal-card-voice">
      <div class="terminal-card-text"></div>
      <div class="terminal-card-buttons">
        <button class="terminal-card-clear-btn" title="Clear">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
        <button class="terminal-card-add-btn" title="Add more">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
        </button>
        <button class="terminal-card-mic-btn" title="Voice input">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
        </button>
      </div>
    </div>
  `;

  // Wire up buttons
  card.querySelector('.terminal-card-close-btn').onclick = () => requestCloseTerminal(termId);
  card.querySelector('.terminal-card-back-btn').onclick = (e) => {
    e.stopPropagation();
    collapseTerminal(termId);
  };
  card.querySelector('.terminal-card-clear-btn').onclick = () => clearTerminalCardVoice(termId);
  card.querySelector('.terminal-card-add-btn').onclick = (e) => toggleTerminalCardVoice(termId, e.currentTarget);
  card.querySelector('.terminal-card-mic-btn').onclick = (e) => toggleTerminalCardVoice(termId, e.currentTarget);

  card.querySelector('.terminal-card-display').onclick = () => {
    if (!card.classList.contains('expanded')) {
      expandTerminal(termId);
    }
  };

  terminalsList.appendChild(card);

  // Create xterm instance
  const termElement = card.querySelector('.terminal-card-display');
  const theme = { ...config.terminalTheme };
  if (isReadOnly) {
    theme.cursor = theme.background;
  }

  const terminal = new Terminal({
    cursorBlink: !isReadOnly,
    cursorStyle: isReadOnly ? 'bar' : 'block',
    disableStdin: isReadOnly,
    fontSize: config.terminalDefaults.fontSize,
    fontFamily: config.terminalDefaults.fontFamily,
    theme
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(termElement);

  if (!isReadOnly) {
    terminal.onData((data) => {
      send({ type: 'terminalInput', termId, data });
    });
  }

  store.terminals.set(termId, { terminal, fitAddon, element: termElement, card, readOnly: isReadOnly, terminalType });
  store.terminalVoiceStates.set(termId, { text: '', recording: false, transcribing: false });

  setTimeout(() => {
    fitAddon.fit();
    send({
      type: 'terminalResize',
      termId,
      cols: terminal.cols,
      rows: terminal.rows
    });

    if (store.pendingTerminalCommand) {
      setTimeout(() => {
        send({
          type: 'terminalInput',
          termId,
          data: store.pendingTerminalCommand + '\r'
        });
        store.setPendingTerminalCommand(null);
      }, 500);
    }
  }, 100);
}

export function expandTerminal(termId) {
  const term = store.terminals.get(termId);
  if (!term || !term.card) return;

  term.card.classList.add('expanded');

  setTimeout(() => {
    term.fitAddon.fit();
    send({
      type: 'terminalResize',
      termId,
      cols: term.terminal.cols,
      rows: term.terminal.rows
    });
  }, 350);
}

export function collapseTerminal(termId) {
  const term = store.terminals.get(termId);
  if (!term || !term.card) return;

  term.card.classList.remove('expanded');

  setTimeout(() => {
    term.fitAddon.fit();
    send({
      type: 'terminalResize',
      termId,
      cols: term.terminal.cols,
      rows: term.terminal.rows
    });
  }, 350);
}

export function requestCloseTerminal(termId) {
  send({ type: 'terminalClose', termId });
}

export function closeTerminal(termId) {
  const term = store.terminals.get(termId);
  if (term) {
    term.terminal.dispose();
    if (term.card) term.card.remove();
    store.terminals.delete(termId);
  }

  store.terminalVoiceStates.delete(termId);

  if (store.terminals.size === 0) {
    document.getElementById('terminals-empty').style.display = '';
  }
}

export function writeToTerminal(termId, data) {
  const term = store.terminals.get(termId);
  if (term) {
    term.terminal.write(data);
  }
}

// Terminal voice input functions
export function updateTerminalCardVoiceUI(termId) {
  const voiceState = store.terminalVoiceStates.get(termId);
  if (!voiceState) return;

  const card = document.querySelector(`.terminal-card[data-term-id="${termId}"]`);
  if (!card) return;

  const textEl = card.querySelector('.terminal-card-text');
  const clearBtn = card.querySelector('.terminal-card-clear-btn');
  const addBtn = card.querySelector('.terminal-card-add-btn');
  const micBtn = card.querySelector('.terminal-card-mic-btn');

  if (!textEl || !clearBtn || !addBtn || !micBtn) return;

  const hasText = voiceState.text.length > 0;
  const micIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
  const checkIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;

  textEl.textContent = voiceState.text;
  textEl.classList.toggle('transcribing', voiceState.transcribing);

  clearBtn.classList.toggle('visible', hasText);
  addBtn.classList.toggle('visible', hasText);

  if (voiceState.recording) {
    micBtn.classList.add('recording');
    micBtn.classList.remove('processing', 'submit-mode');
    micBtn.innerHTML = micIcon;
  } else if (voiceState.transcribing) {
    micBtn.classList.add('processing');
    micBtn.classList.remove('recording', 'submit-mode');
    micBtn.innerHTML = micIcon;
  } else if (hasText) {
    micBtn.classList.add('submit-mode');
    micBtn.classList.remove('recording', 'processing');
    micBtn.innerHTML = checkIcon;
  } else {
    micBtn.classList.remove('recording', 'processing', 'submit-mode');
    micBtn.innerHTML = micIcon;
  }

  addBtn.classList.toggle('recording', voiceState.recording && hasText);
}

export function toggleTerminalCardVoice(termId, btn) {
  const voiceState = store.terminalVoiceStates.get(termId);
  if (!voiceState) return;

  const hasText = voiceState.text.length > 0;
  const isMicBtn = btn && btn.classList.contains('terminal-card-mic-btn');

  if (hasText && isMicBtn && !voiceState.recording) {
    submitTerminalCardVoice(termId);
    return;
  }

  if (store.mediaRecorder && store.mediaRecorder.state === 'recording') {
    voiceState.transcribing = true;
    voiceState.recording = false;
    store.setCurrentVoiceTerminalId(termId);
    store.mediaRecorder.stop();
    updateTerminalCardVoiceUI(termId);
  } else if (store.mediaRecorder && store.mediaRecorder.state === 'inactive') {
    store.setActiveWindowId('terminal-voice');
    store.setActiveMicBtn(btn);
    voiceState.recording = true;
    store.setCurrentVoiceTerminalId(termId);
    store.clearAudioChunks();
    store.mediaRecorder.start();
    updateTerminalCardVoiceUI(termId);
  }
}

export function clearTerminalCardVoice(termId) {
  const voiceState = store.terminalVoiceStates.get(termId);
  if (voiceState) {
    voiceState.text = '';
    updateTerminalCardVoiceUI(termId);
  }
}

export function submitTerminalCardVoice(termId) {
  const voiceState = store.terminalVoiceStates.get(termId);
  if (!voiceState || !voiceState.text) return;

  const terminalData = store.terminals.get(termId);
  const terminalType = terminalData?.terminalType || 'regular';
  const lineEnding = terminalType === 'claude' ? '\n' : '\r';

  send({ type: 'terminalInput', termId, data: voiceState.text });
  send({ type: 'terminalInput', termId, data: lineEnding });

  voiceState.text = '';
  updateTerminalCardVoiceUI(termId);
}

export function handleTerminalTranscription(text) {
  if (store.currentVoiceTerminalId !== null) {
    const voiceState = store.terminalVoiceStates.get(store.currentVoiceTerminalId);
    if (voiceState) {
      voiceState.recording = false;
      voiceState.transcribing = false;
      if (text) {
        voiceState.text += (voiceState.text ? ' ' : '') + text;
      }
      updateTerminalCardVoiceUI(store.currentVoiceTerminalId);
    }
    store.setCurrentVoiceTerminalId(null);
  }
}

export function handleTerminalTranscriptionError() {
  if (store.currentVoiceTerminalId !== null) {
    const voiceState = store.terminalVoiceStates.get(store.currentVoiceTerminalId);
    if (voiceState) {
      voiceState.recording = false;
      voiceState.transcribing = false;
      updateTerminalCardVoiceUI(store.currentVoiceTerminalId);
    }
    store.setCurrentVoiceTerminalId(null);
  }
}

// Handle window resize
export function handleWindowResize() {
  store.terminals.forEach((term, termId) => {
    term.fitAddon.fit();
    send({
      type: 'terminalResize',
      termId,
      cols: term.terminal.cols,
      rows: term.terminal.rows
    });
  });
}
