import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${wsProtocol}//${window.location.hostname}:3001`;

let ws = null;
let windows = [];
let mediaRecorder = null;
let audioChunks = [];
let activeWindowId = null;
let activeMicBtn = null;
let cardTexts = {}; // Store accumulated text per windowId
let transcribingWindows = {}; // Track windows with transcription in progress
let recordingWindowId = null; // Track which window is currently recording
let autoRefreshEnabled = false;
let autoRefreshInterval = null;
let pendingCloseWindowId = null; // Window ID pending close confirmation
let currentDetailWindowId = null; // Window ID for detail page
let aiQueryText = ''; // Text for AI query
let aiProcessing = false; // Whether AI query is in progress

// Terminal state
const terminals = new Map(); // termId -> { terminal, fitAddon, element, type, readOnly }
const terminalVoiceStates = new Map(); // termId -> { text, recording, transcribing }
let pendingTerminalCommand = null; // Command to run after terminal is created
let pendingTerminalReadOnly = false; // Whether the next terminal should be read-only
let currentVoiceTerminalId = null; // Which terminal is currently recording voice

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('Connected to server');
    document.getElementById('status').title = 'Connected';
    document.getElementById('status').className = 'connected';
  };

  ws.onclose = () => {
    console.log('Disconnected from server');
    document.getElementById('status').title = 'Disconnected - Reconnecting...';
    document.getElementById('status').className = 'disconnected';
    setTimeout(connect, 2000);
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };
}

function mergeWindows(oldWindows, newWindows) {
  // Create a map of new windows by id
  const newMap = new Map(newWindows.map(w => [w.id, w]));

  // Keep existing windows in order, update their data
  const merged = [];
  const seenIds = new Set();

  for (const oldWin of oldWindows) {
    if (newMap.has(oldWin.id)) {
      // Window still exists, update its data but keep position
      merged.push(newMap.get(oldWin.id));
      seenIds.add(oldWin.id);
    }
    // If window no longer exists, it's dropped
  }

  // Add any new windows at the end
  for (const newWin of newWindows) {
    if (!seenIds.has(newWin.id)) {
      merged.push(newWin);
    }
  }

  return merged;
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'windows':
      windows = mergeWindows(windows, msg.data);
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
        transcribingWindows[msg.windowId] = false;
        appendCardText(msg.windowId, msg.text);
      } else {
        displayTranscription(msg.text);
      }
      break;

    case 'transcriptionError':
      if (msg.windowId) {
        transcribingWindows[msg.windowId] = false;
        updateCardButtons(msg.windowId);
      }
      displayTranscription(`Error: ${msg.error}`);
      break;

    case 'screenshot':
      if (msg.windowId === currentDetailWindowId) {
        displayScreenshot(msg.screenshot, msg.width, msg.height);
      }
      break;

    case 'screenshotError':
      if (msg.windowId === currentDetailWindowId) {
        document.getElementById('detail-screenshot').innerHTML =
          '<div class="screenshot-loading">Screenshot unavailable</div>';
      }
      break;

    case 'aiTranscription':
      // Show transcribed query text
      aiQueryText = msg.text;
      document.getElementById('ai-query-text').textContent = msg.text;
      // Now send to AI for response
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'aiQuery', text: msg.text }));
      }
      break;

    case 'aiResponse':
      aiProcessing = false;
      updateAiMicButton();
      const responseEl = document.getElementById('ai-response');
      const responseContainer = responseEl.parentElement;
      // Render markdown to HTML
      responseEl.innerHTML = marked.parse(msg.text);
      responseEl.classList.remove('loading');
      responseContainer.classList.add('visible');
      // Vibrate phone and play ding to notify response received
      if (navigator.vibrate) {
        navigator.vibrate(200);
      }
      playDing();
      break;

    case 'aiError':
      aiProcessing = false;
      updateAiMicButton();
      const errorEl = document.getElementById('ai-response');
      const errorContainer = errorEl.parentElement;
      errorEl.textContent = `Error: ${msg.error}`;
      errorEl.classList.remove('loading');
      errorContainer.classList.add('visible');
      break;

    // Terminal messages
    case 'terminalCreated':
      onTerminalCreated(msg.termId);
      break;

    case 'terminalOutput':
      const term = terminals.get(msg.termId);
      if (term) {
        term.terminal.write(msg.data);
      }
      break;

    case 'terminalExit':
      closeTerminal(msg.termId);
      break;

    case 'terminalError':
      console.error('Terminal error:', msg.error);
      break;

    case 'terminalTranscription':
      // Voice transcription for terminal - accumulate text for specific terminal
      if (currentVoiceTerminalId !== null) {
        const voiceState = terminalVoiceStates.get(currentVoiceTerminalId);
        if (voiceState) {
          voiceState.recording = false;
          voiceState.transcribing = false;
          if (msg.text) {
            voiceState.text += (voiceState.text ? ' ' : '') + msg.text;
          }
          updateTerminalCardVoiceUI(currentVoiceTerminalId);
        }
        currentVoiceTerminalId = null;
      }
      break;

    case 'terminalTranscriptionError':
      if (currentVoiceTerminalId !== null) {
        const voiceState = terminalVoiceStates.get(currentVoiceTerminalId);
        if (voiceState) {
          voiceState.recording = false;
          voiceState.transcribing = false;
          updateTerminalCardVoiceUI(currentVoiceTerminalId);
        }
        currentVoiceTerminalId = null;
      }
      console.error('Terminal transcription error:', msg.error);
      break;

    // Context folder messages
    case 'contextFolders':
      renderContextFolders(msg.data);
      break;

    case 'contextFoldersError':
      console.error('Context scan error:', msg.error);
      document.getElementById('context-loading').style.display = 'none';
      document.getElementById('context-empty').style.display = 'flex';
      document.getElementById('context-empty').querySelector('p').textContent = 'Error scanning folders';
      break;
  }
}

function displayTranscription(text) {
  document.getElementById('transcription-text').textContent = text;
  // Show copy button if we have actual transcription text
  const copyBtn = document.getElementById('copy-btn');
  if (text && text !== 'Listening...' && text !== 'Processing...' && !text.startsWith('Error:')) {
    copyBtn.classList.add('visible');
  } else {
    copyBtn.classList.remove('visible');
  }
}

function scaleTextToFit(element) {
  const maxFontSize = 0.95; // rem
  const minFontSize = 0.55; // rem
  let fontSize = maxFontSize;

  element.style.fontSize = fontSize + 'rem';

  // Reduce font size until text fits or we hit minimum
  while (element.scrollWidth > element.clientWidth && fontSize > minFontSize) {
    fontSize -= 0.05;
    element.style.fontSize = fontSize + 'rem';
  }
}

function showCloseDialog(windowId) {
  const win = windows.find(w => w.id === windowId);
  if (!win) return;

  pendingCloseWindowId = windowId;

  const dialog = document.getElementById('close-dialog');
  const iconEl = dialog.querySelector('.dialog-icon');
  const titleEl = dialog.querySelector('.dialog-title');
  const pathEl = dialog.querySelector('.dialog-path');

  // Set window info
  if (win.icon) {
    iconEl.innerHTML = `<img src="${win.icon}" alt="">`;
  } else {
    iconEl.innerHTML = '';
  }
  titleEl.textContent = win.title || 'Untitled';
  pathEl.textContent = win.path || 'Unknown';

  dialog.classList.add('visible');
}

function hideCloseDialog() {
  const dialog = document.getElementById('close-dialog');
  dialog.classList.remove('visible');
  pendingCloseWindowId = null;
}

function confirmCloseWindow() {
  if (pendingCloseWindowId && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'closeWindow', windowId: pendingCloseWindowId }));
  }
  hideCloseDialog();
  hideDetailPage();
}

function displayScreenshot(screenshotData, width, height) {
  const container = document.getElementById('detail-screenshot');

  // Check if it's raw pixel data
  if (screenshotData.startsWith('data:image/raw;')) {
    // Parse width and height from data URL
    const match = screenshotData.match(/width=(\d+);height=(\d+);base64,(.+)/);
    if (match) {
      const w = parseInt(match[1]);
      const h = parseInt(match[2]);
      const base64Data = match[3];

      // Create canvas and draw pixels
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      // Decode base64 to pixels
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Create ImageData and put pixels
      const imageData = ctx.createImageData(w, h);
      imageData.data.set(bytes);
      ctx.putImageData(imageData, 0, 0);

      // Convert canvas to image
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.alt = 'Window screenshot';
      container.innerHTML = '';
      container.appendChild(img);
    }
  } else {
    // Regular image data URL
    const img = document.createElement('img');
    img.src = screenshotData;
    img.alt = 'Window screenshot';
    container.innerHTML = '';
    container.appendChild(img);
  }
}

function requestScreenshot(windowId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Measure available space below the top bar
    const topBar = document.querySelector('.detail-top-bar');
    const topBarHeight = topBar ? topBar.offsetHeight : 0;
    const availableHeight = window.innerHeight - topBarHeight;

    // Account for device pixel ratio
    const pixelRatio = window.devicePixelRatio || 1;
    const screenWidth = window.innerWidth * pixelRatio;
    const screenHeight = availableHeight * pixelRatio;

    console.log(`Screenshot request: ${Math.round(screenWidth)}x${Math.round(screenHeight)} (available: ${availableHeight}px, topBar: ${topBarHeight}px)`);

    ws.send(JSON.stringify({
      type: 'getScreenshot',
      windowId,
      screenWidth: Math.round(screenWidth),
      screenHeight: Math.round(screenHeight)
    }));
  }
}

function showDetailPage(windowId) {
  const win = windows.find(w => w.id === windowId);
  if (!win) return;

  currentDetailWindowId = windowId;

  const detailPage = document.getElementById('detail-page');

  // Reset screenshot to loading state
  document.getElementById('detail-screenshot').innerHTML =
    '<div class="screenshot-loading">Capturing screenshot...</div>';

  // Set header title
  document.getElementById('detail-header-title').textContent = win.title || 'Untitled';

  // Set icon
  const iconEl = document.getElementById('detail-icon');
  if (win.icon) {
    iconEl.innerHTML = `<img src="${win.icon}" alt="">`;
  } else {
    iconEl.innerHTML = '';
  }

  // Set details
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

  // Update voice controls
  updateDetailVoiceControls(windowId);

  detailPage.classList.add('visible');

  // Request screenshot after a short delay to allow page transition
  setTimeout(() => requestScreenshot(windowId), 100);
}

function updateDetailVoiceControls(windowId) {
  const hasText = cardTexts[windowId] && cardTexts[windowId].length > 0;
  const isTranscribing = transcribingWindows[windowId] === true;

  // Update text display
  const detailCardText = document.getElementById('detail-card-text');
  detailCardText.textContent = cardTexts[windowId] || '';

  // Update transcribing state
  if (isTranscribing) {
    detailCardText.classList.add('transcribing');
  } else {
    detailCardText.classList.remove('transcribing');
  }

  // Update clear button visibility
  const clearBtn = document.getElementById('detail-clear-btn');
  if (hasText) {
    clearBtn.classList.add('visible');
  } else {
    clearBtn.classList.remove('visible');
  }

  // Update add button visibility
  const addBtn = document.getElementById('detail-add-btn');
  if (hasText) {
    addBtn.classList.add('visible');
  } else {
    addBtn.classList.remove('visible');
  }

  // Update mic/submit button
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
    micBtn.classList.remove('submit-mode');
    micBtn.classList.remove('processing');
    micBtn.innerHTML = micIcon;
    micBtn.disabled = false;
  }
}

function hideDetailPage() {
  document.getElementById('detail-page').classList.remove('visible');
  currentDetailWindowId = null;
}

function detailFocusWindow() {
  if (currentDetailWindowId) {
    focusWindow(currentDetailWindowId);
  }
}

function detailCloseWindow() {
  if (currentDetailWindowId) {
    showCloseDialog(currentDetailWindowId);
  }
}

function detailMaximizeWindow() {
  if (currentDetailWindowId && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'maximizeWindow', windowId: currentDetailWindowId }));
  }
}

function detailMinimizeWindow() {
  if (currentDetailWindowId && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'minimizeWindow', windowId: currentDetailWindowId }));
  }
}

function appendCardText(windowId, text) {
  if (!cardTexts[windowId]) {
    cardTexts[windowId] = '';
  }
  cardTexts[windowId] += (cardTexts[windowId] ? ' ' : '') + text;

  // Update the card's text display
  const textEl = document.querySelector(`.card-text[data-window-id="${windowId}"]`);
  if (textEl) {
    textEl.textContent = cardTexts[windowId];
  }
  updateCardButtons(windowId);

  // Update detail page if showing this window
  if (currentDetailWindowId === windowId) {
    updateDetailVoiceControls(windowId);
  }
}

function submitCardText(windowId) {
  const text = cardTexts[windowId];
  if (text && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'command', windowId, text }));
    // Clear the text
    cardTexts[windowId] = '';
    const textEl = document.querySelector(`.card-text[data-window-id="${windowId}"]`);
    if (textEl) {
      textEl.textContent = '';
    }
    updateCardButtons(windowId);

    // Update detail page if showing this window
    if (currentDetailWindowId === windowId) {
      updateDetailVoiceControls(windowId);
    }
  }
}

function clearCardText(windowId) {
  cardTexts[windowId] = '';
  const textEl = document.querySelector(`.card-text[data-window-id="${windowId}"]`);
  if (textEl) {
    textEl.textContent = '';
  }
  updateCardButtons(windowId);

  // Update detail page if showing this window
  if (currentDetailWindowId === windowId) {
    updateDetailVoiceControls(windowId);
  }
}

function updateCardButtons(windowId) {
  const hasText = cardTexts[windowId] && cardTexts[windowId].length > 0;
  const isTranscribing = transcribingWindows[windowId] === true;
  const clearBtn = document.querySelector(`.card-clear-btn[data-window-id="${windowId}"]`);
  const micBtn = document.querySelector(`.card-mic-btn[data-window-id="${windowId}"]`);
  const addBtn = document.querySelector(`.card-add-btn[data-window-id="${windowId}"]`);
  const cardText = document.querySelector(`.card-text[data-window-id="${windowId}"]`);

  // Update card text transcribing state
  if (cardText) {
    if (isTranscribing) {
      cardText.classList.add('transcribing');
    } else {
      cardText.classList.remove('transcribing');
    }
  }

  if (clearBtn) {
    if (hasText) {
      clearBtn.classList.add('visible');
    } else {
      clearBtn.classList.remove('visible');
    }
  }

  if (addBtn) {
    if (hasText) {
      addBtn.classList.add('visible');
    } else {
      addBtn.classList.remove('visible');
    }
  }

  if (micBtn) {
    const micIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
    const checkIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;

    if (hasText || isTranscribing) {
      // Change to submit button (or processing state)
      micBtn.classList.add('submit-mode');
      if (isTranscribing) {
        // Show spinning mic indicator
        micBtn.classList.add('processing');
        micBtn.innerHTML = micIcon;
        micBtn.disabled = true;
      } else {
        // Show submit tick
        micBtn.classList.remove('processing');
        micBtn.innerHTML = checkIcon;
        micBtn.disabled = false;
      }
    } else {
      // Change to mic button
      micBtn.classList.remove('submit-mode');
      micBtn.classList.remove('processing');
      micBtn.innerHTML = micIcon;
      micBtn.disabled = false;
    }
  }

  // Update detail page if showing this window
  if (currentDetailWindowId === windowId) {
    updateDetailVoiceControls(windowId);
  }
}

function renderWindows() {
  const grid = document.getElementById('windows-grid');
  grid.innerHTML = '';

  windows.forEach(win => {
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

    // Scale title to fit on one line after render
    requestAnimationFrame(() => scaleTextToFit(title));

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'card-close-btn';
    closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      showCloseDialog(win.id);
    };

    const hasText = cardTexts[win.id] && cardTexts[win.id].length > 0;

    // Clear button (round red X) - hidden by default
    const clearBtn = document.createElement('button');
    clearBtn.className = 'card-clear-btn' + (hasText ? ' visible' : '');
    clearBtn.dataset.windowId = win.id;
    clearBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
    clearBtn.onclick = (e) => {
      e.stopPropagation();
      clearCardText(win.id);
    };

    // Check if this window is currently recording
    const isRecording = recordingWindowId === win.id;

    // Add button (round blue mic) - for appending more, hidden by default
    const addBtn = document.createElement('button');
    addBtn.className = 'card-add-btn' + (hasText ? ' visible' : '') + (isRecording && hasText ? ' recording' : '');
    addBtn.dataset.windowId = win.id;
    addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
    addBtn.onclick = (e) => {
      e.stopPropagation();
      toggleCardRecording(win.id, addBtn);
    };

    // Mic/Submit button - mic when no text, submit when has text
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
      if (cardTexts[win.id] && cardTexts[win.id].length > 0) {
        submitCardText(win.id);
      } else {
        toggleCardRecording(win.id, micBtn);
      }
    };

    // Update activeMicBtn reference if this is the recording window
    if (isRecording) {
      activeMicBtn = hasText ? addBtn : micBtn;
    }

    // Text display area with buttons
    const cardTextArea = document.createElement('div');
    cardTextArea.className = 'card-text-area';

    const cardText = document.createElement('div');
    cardText.className = 'card-text';
    cardText.dataset.windowId = win.id;
    cardText.textContent = cardTexts[win.id] || '';

    const cardButtons = document.createElement('div');
    cardButtons.className = 'card-buttons';
    cardButtons.appendChild(clearBtn);
    cardButtons.appendChild(addBtn);
    cardButtons.appendChild(micBtn);

    cardTextArea.appendChild(cardText);
    cardTextArea.appendChild(cardButtons);

    // Card layout: header row + text area
    const cardHeader = document.createElement('div');
    cardHeader.className = 'card-header';
    cardHeader.appendChild(cardContent);

    card.appendChild(closeBtn);
    card.appendChild(cardHeader);
    card.appendChild(cardTextArea);
    grid.appendChild(card);
  });
}

function focusWindow(windowId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'focusWindow', windowId }));
  }
}

function refreshWindows() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'getWindows' }));
  }
}

// Card mic recording - toggle mode
function toggleCardRecording(windowId, btn) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    // Stop recording - mark as transcribing
    recordingWindowId = null;
    transcribingWindows[windowId] = true;
    updateCardButtons(windowId);
    mediaRecorder.stop();
    btn.classList.remove('recording');
    document.getElementById('transcription-text').textContent = 'Processing...';
  } else if (mediaRecorder && mediaRecorder.state === 'inactive') {
    // Start recording
    activeWindowId = windowId;
    recordingWindowId = windowId; // Track which window is recording
    activeMicBtn = btn;
    audioChunks = [];
    mediaRecorder.start();
    btn.classList.add('recording');
    document.getElementById('transcription-text').textContent = 'Listening...';
  }
}

function stopCardRecording(btn) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    if (activeMicBtn) {
      activeMicBtn.classList.remove('recording');
    }
    document.getElementById('transcription-text').textContent = 'Processing...';
  }
}

// Voice Recording
async function initVoice() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 48000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      audioChunks = [];

      // Send to server
      if (ws && ws.readyState === WebSocket.OPEN) {
        const arrayBuffer = await audioBlob.arrayBuffer();
        ws.send(JSON.stringify({ type: 'audioStart', windowId: activeWindowId }));
        ws.send(arrayBuffer);
      }

      // Reset active state
      recordingWindowId = null; // Clear recording state
      activeWindowId = null;
      activeMicBtn = null;
    };

    console.log('Microphone ready');
  } catch (err) {
    console.error('Microphone access denied:', err);
    document.getElementById('transcription-text').textContent = 'Microphone access denied';
  }
}

function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    // Stop recording
    mediaRecorder.stop();
    document.getElementById('record-btn').textContent = 'Press to Talk';
    document.getElementById('record-btn').classList.remove('recording');
    document.getElementById('recording-indicator').classList.remove('active');
    document.getElementById('transcription-text').textContent = 'Processing...';
    document.getElementById('copy-btn').classList.remove('visible');
  } else if (mediaRecorder && mediaRecorder.state === 'inactive') {
    // Start recording
    audioChunks = [];
    mediaRecorder.start();
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

// Shared audio context for notifications
let audioContext = null;

// Play a short ding notification sound
function playDing() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Resume if suspended (required on mobile after user gesture)
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 880; // A5 note
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (e) {
    // Audio not supported or blocked
  }
}

// Copy AI response
function copyAiResponse() {
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

// AI Query functions
function updateAiMicButton() {
  const micBtn = document.getElementById('ai-mic-btn');
  if (aiProcessing) {
    micBtn.classList.add('processing');
    micBtn.classList.remove('recording');
  } else {
    micBtn.classList.remove('processing');
  }
}

function toggleAiRecording() {
  const micBtn = document.getElementById('ai-mic-btn');

  if (aiProcessing) return; // Don't allow while processing

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    // Stop recording
    aiProcessing = true;
    updateAiMicButton();
    mediaRecorder.stop();
    micBtn.classList.remove('recording');

    // Show loading state
    const responseEl = document.getElementById('ai-response');
    const responseContainer = responseEl.parentElement;
    responseEl.textContent = 'Thinking...';
    responseEl.classList.add('loading');
    responseContainer.classList.add('visible');
  } else if (mediaRecorder && mediaRecorder.state === 'inactive') {
    // Start recording for AI query
    activeWindowId = 'ai-query'; // Special marker for AI queries
    activeMicBtn = micBtn;
    audioChunks = [];
    mediaRecorder.start();
    micBtn.classList.add('recording');

    // Clear previous response
    document.getElementById('ai-query-text').textContent = '';
    document.getElementById('ai-response').parentElement.classList.remove('visible');
  }
}

// Auto-refresh toggle
function toggleAutoRefresh() {
  const toggle = document.getElementById('auto-refresh-toggle');
  autoRefreshEnabled = toggle.checked;

  if (autoRefreshEnabled) {
    // Refresh immediately, then every 2 seconds
    refreshWindows();
    autoRefreshInterval = setInterval(refreshWindows, 2000);
  } else {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }
}

// Terminal Functions
function showTerminalsPage() {
  const page = document.getElementById('terminals-page');
  page.classList.add('visible');
  // Fit all visible terminals
  terminals.forEach((term) => {
    setTimeout(() => term.fitAddon.fit(), 100);
  });
}

function hideTerminalsPage() {
  const page = document.getElementById('terminals-page');
  page.classList.remove('visible');
}

function launchTerminal(type) {
  // Set the command to run based on type
  if (type === 'claude') {
    pendingTerminalCommand = 'claude --dangerously-skip-permissions';
    pendingTerminalReadOnly = true;
  } else if (type === 'gemini') {
    pendingTerminalCommand = 'gemini';
    pendingTerminalReadOnly = true;
  } else {
    pendingTerminalCommand = null;
    pendingTerminalReadOnly = false;
  }
  createTerminal(type);
}

// Per-terminal voice input functions
function updateTerminalCardVoiceUI(termId) {
  const voiceState = terminalVoiceStates.get(termId);
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

  // Update text display
  textEl.textContent = voiceState.text;

  // Update transcribing state
  if (voiceState.transcribing) {
    textEl.classList.add('transcribing');
  } else {
    textEl.classList.remove('transcribing');
  }

  // Update clear/add button visibility
  if (hasText) {
    clearBtn.classList.add('visible');
    addBtn.classList.add('visible');
  } else {
    clearBtn.classList.remove('visible');
    addBtn.classList.remove('visible');
  }

  // Update mic button state
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

  // Update add button recording state
  if (voiceState.recording && hasText) {
    addBtn.classList.add('recording');
  } else {
    addBtn.classList.remove('recording');
  }
}

function toggleTerminalCardVoice(termId, btn) {
  const voiceState = terminalVoiceStates.get(termId);
  if (!voiceState) return;

  const hasText = voiceState.text.length > 0;
  const isMicBtn = btn && btn.classList.contains('terminal-card-mic-btn');

  // If has text and clicking main mic (not recording), submit
  if (hasText && isMicBtn && !voiceState.recording) {
    submitTerminalCardVoice(termId);
    return;
  }

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    // Stop recording
    voiceState.transcribing = true;
    voiceState.recording = false;
    currentVoiceTerminalId = termId;
    mediaRecorder.stop();
    updateTerminalCardVoiceUI(termId);
  } else if (mediaRecorder && mediaRecorder.state === 'inactive') {
    // Start recording for this terminal
    activeWindowId = 'terminal-voice';
    activeMicBtn = btn;
    voiceState.recording = true;
    currentVoiceTerminalId = termId;
    audioChunks = [];
    mediaRecorder.start();
    updateTerminalCardVoiceUI(termId);
  }
}

function clearTerminalCardVoice(termId) {
  const voiceState = terminalVoiceStates.get(termId);
  if (voiceState) {
    voiceState.text = '';
    updateTerminalCardVoiceUI(termId);
  }
}

function submitTerminalCardVoice(termId) {
  const voiceState = terminalVoiceStates.get(termId);
  if (!voiceState || !voiceState.text) return;

  // Get terminal type to determine appropriate line ending
  const terminalData = terminals.get(termId);
  const terminalType = terminalData?.terminalType || 'regular';

  // Claude uses \n, Gemini uses \r
  const lineEnding = terminalType === 'claude' ? '\n' : '\r';

  // Send text to terminal, then send Enter key separately
  if (ws && ws.readyState === WebSocket.OPEN) {
    // First send the text
    ws.send(JSON.stringify({
      type: 'terminalInput',
      termId: termId,
      data: voiceState.text
    }));
    // Then send Enter key (appropriate for terminal type)
    ws.send(JSON.stringify({
      type: 'terminalInput',
      termId: termId,
      data: lineEnding
    }));
  }

  // Clear text
  voiceState.text = '';
  updateTerminalCardVoiceUI(termId);
}

function createTerminal(type = 'regular') {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Use reasonable defaults for card-based terminals
    ws.send(JSON.stringify({
      type: 'terminalCreate',
      cols: 80,
      rows: 12,
      terminalType: type
    }));
  }
}

function onTerminalCreated(termId) {
  const isReadOnly = pendingTerminalReadOnly;
  const command = pendingTerminalCommand; // Capture before reset
  pendingTerminalReadOnly = false; // Reset flag

  // Determine terminal type for line ending handling
  let terminalType = 'regular';
  if (command && command.includes('claude')) terminalType = 'claude';
  else if (command && command.includes('gemini')) terminalType = 'gemini';

  // Get label based on type
  let typeLabel = 'Terminal';
  if (terminalType === 'claude') typeLabel = 'Claude';
  else if (terminalType === 'gemini') typeLabel = 'Gemini';

  // Hide empty state message
  const emptyState = document.getElementById('terminals-empty');
  emptyState.style.display = 'none';

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

  // Wire up card buttons
  card.querySelector('.terminal-card-close-btn').onclick = () => requestCloseTerminal(termId);
  card.querySelector('.terminal-card-back-btn').onclick = (e) => {
    e.stopPropagation();
    collapseTerminal(termId);
  };
  card.querySelector('.terminal-card-clear-btn').onclick = () => clearTerminalCardVoice(termId);
  card.querySelector('.terminal-card-add-btn').onclick = (e) => toggleTerminalCardVoice(termId, e.currentTarget);
  card.querySelector('.terminal-card-mic-btn').onclick = (e) => toggleTerminalCardVoice(termId, e.currentTarget);

  // Click on display area to expand
  card.querySelector('.terminal-card-display').onclick = () => {
    if (!card.classList.contains('expanded')) {
      expandTerminal(termId);
    }
  };

  terminalsList.appendChild(card);

  // Create xterm instance in the card's display area
  const termElement = card.querySelector('.terminal-card-display');

  const terminal = new Terminal({
    cursorBlink: !isReadOnly,
    cursorStyle: isReadOnly ? 'bar' : 'block',
    disableStdin: isReadOnly,
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace',
    theme: {
      background: '#0d0d1a',
      foreground: '#e0e0e0',
      cursor: isReadOnly ? '#0d0d1a' : '#16a085',
      cursorAccent: '#0d0d1a',
      selection: 'rgba(22, 160, 133, 0.3)',
      black: '#1a1a2e',
      red: '#e74c3c',
      green: '#2ecc71',
      yellow: '#f1c40f',
      blue: '#3498db',
      magenta: '#9b59b6',
      cyan: '#1abc9c',
      white: '#ecf0f1',
      brightBlack: '#3a3a5c',
      brightRed: '#e74c3c',
      brightGreen: '#2ecc71',
      brightYellow: '#f1c40f',
      brightBlue: '#3498db',
      brightMagenta: '#9b59b6',
      brightCyan: '#1abc9c',
      brightWhite: '#ffffff'
    }
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(termElement);

  // Handle input (only for non-read-only terminals)
  if (!isReadOnly) {
    terminal.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'terminalInput', termId, data }));
      }
    });
  }

  // Store terminal
  terminals.set(termId, { terminal, fitAddon, element: termElement, card, readOnly: isReadOnly, terminalType });

  // Initialize voice state for this terminal
  terminalVoiceStates.set(termId, { text: '', recording: false, transcribing: false });

  // Fit after a short delay
  setTimeout(() => {
    fitAddon.fit();
    // Send resize to server
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'terminalResize',
        termId,
        cols: terminal.cols,
        rows: terminal.rows
      }));
    }

    // Execute pending command if any
    if (pendingTerminalCommand) {
      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'terminalInput',
            termId,
            data: pendingTerminalCommand + '\r'
          }));
        }
        pendingTerminalCommand = null;
      }, 500); // Wait for shell to initialize
    }
  }, 100);
}

function expandTerminal(termId) {
  const term = terminals.get(termId);
  if (!term || !term.card) return;

  term.card.classList.add('expanded');

  // Refit terminal after expansion animation
  setTimeout(() => {
    term.fitAddon.fit();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'terminalResize',
        termId,
        cols: term.terminal.cols,
        rows: term.terminal.rows
      }));
    }
  }, 350);
}

function collapseTerminal(termId) {
  const term = terminals.get(termId);
  if (!term || !term.card) return;

  term.card.classList.remove('expanded');

  // Refit terminal after collapse
  setTimeout(() => {
    term.fitAddon.fit();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'terminalResize',
        termId,
        cols: term.terminal.cols,
        rows: term.terminal.rows
      }));
    }
  }, 350);
}

function requestCloseTerminal(termId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'terminalClose', termId }));
  }
}

function closeTerminal(termId) {
  const term = terminals.get(termId);
  if (term) {
    term.terminal.dispose();
    if (term.card) term.card.remove();
    terminals.delete(termId);
  }

  // Remove voice state
  terminalVoiceStates.delete(termId);

  // Show empty state if no terminals left
  if (terminals.size === 0) {
    const emptyState = document.getElementById('terminals-empty');
    emptyState.style.display = '';
  }
}

// Context Listing Page Functions
function showContextPage() {
  const page = document.getElementById('context-page');
  page.classList.add('visible');
  // Start scanning
  scanContextFolders();
}

function hideContextPage() {
  const page = document.getElementById('context-page');
  page.classList.remove('visible');
}

function scanContextFolders() {
  const loading = document.getElementById('context-loading');
  const empty = document.getElementById('context-empty');
  const refreshBtn = document.getElementById('context-refresh-btn');

  // Show loading, hide empty
  loading.style.display = 'flex';
  empty.style.display = 'none';
  refreshBtn.classList.add('spinning');

  // Clear existing cards
  const list = document.getElementById('context-list');
  list.querySelectorAll('.context-card').forEach(card => card.remove());

  // Request scan from server
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'scanContextFolders', rootPath: 'D:\\' }));
  }
}

function renderContextFolders(folders) {
  const loading = document.getElementById('context-loading');
  const empty = document.getElementById('context-empty');
  const list = document.getElementById('context-list');
  const refreshBtn = document.getElementById('context-refresh-btn');

  loading.style.display = 'none';
  refreshBtn.classList.remove('spinning');

  // Clear existing content
  list.querySelectorAll('.context-card, .context-section').forEach(el => el.remove());

  if (folders.length === 0) {
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';

  // Group folders by path existence
  const existingFolders = folders.filter(f => f.pathExists);
  const missingFolders = folders.filter(f => !f.pathExists);

  // Render existing projects section
  if (existingFolders.length > 0) {
    const existingSection = document.createElement('div');
    existingSection.className = 'context-section';
    existingSection.innerHTML = `
      <div class="context-section-header" data-expanded="true">
        <svg class="expand-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
        <span class="section-title">Active Projects</span>
        <span class="section-count">${existingFolders.length}</span>
      </div>
      <div class="context-section-content"></div>
    `;
    list.appendChild(existingSection);

    const existingContent = existingSection.querySelector('.context-section-content');
    existingFolders.forEach(folder => {
      existingContent.appendChild(createContextCard(folder));
    });

    // Wire up section expand/collapse
    const header = existingSection.querySelector('.context-section-header');
    header.onclick = () => toggleSection(existingSection);
  }

  // Render missing projects section
  if (missingFolders.length > 0) {
    const missingSection = document.createElement('div');
    missingSection.className = 'context-section missing';
    missingSection.innerHTML = `
      <div class="context-section-header" data-expanded="false">
        <svg class="expand-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
        <span class="section-title">Archived / Deleted Projects</span>
        <span class="section-count">${missingFolders.length}</span>
      </div>
      <div class="context-section-content" style="display: none;"></div>
    `;
    list.appendChild(missingSection);

    const missingContent = missingSection.querySelector('.context-section-content');
    missingFolders.forEach(folder => {
      missingContent.appendChild(createContextCard(folder));
    });

    // Wire up section expand/collapse
    const header = missingSection.querySelector('.context-section-header');
    header.onclick = () => toggleSection(missingSection);
  }
}

function toggleSection(section) {
  const header = section.querySelector('.context-section-header');
  const content = section.querySelector('.context-section-content');
  const isExpanded = header.dataset.expanded === 'true';

  if (isExpanded) {
    header.dataset.expanded = 'false';
    content.style.display = 'none';
  } else {
    header.dataset.expanded = 'true';
    content.style.display = 'flex';
  }
}

function createContextCard(folder) {
  const card = document.createElement('div');
  card.className = 'context-card' + (folder.pathExists ? '' : ' missing');

  // Build badges HTML
  let badgesHtml = '';
  if (folder.hasClaude) {
    badgesHtml += '<span class="context-badge claude">Claude</span>';
  }
  if (folder.hasGemini) {
    badgesHtml += '<span class="context-badge gemini">Gemini</span>';
  }

  // Build action buttons based on available contexts (only if path exists)
  let actionsHtml = '';
  if (folder.pathExists) {
    actionsHtml += `
      <button class="context-action-btn claude-btn" data-path="${folder.path}" data-type="claude">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
        Claude
      </button>`;
    if (folder.hasGemini) {
      actionsHtml += `
        <button class="context-action-btn gemini-btn" data-path="${folder.path}" data-type="gemini">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L9.19 8.63L2 9.24l5.46 4.73L5.82 21L12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z"/></svg>
          Gemini
        </button>`;
    }
    actionsHtml += `
      <button class="context-action-btn terminal-btn" data-path="${folder.path}" data-type="terminal">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 19V7H4v12h16m0-16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16m-7 14v-2h5v2h-5m-3.42-4L5.57 9H8.4l3.3 3.3c.39.39.39 1.03 0 1.42L8.42 17H5.59l4-4z"/></svg>
        Terminal
      </button>`;
  }

  // Build sessions HTML if available
  let sessionsHtml = '';
  if (folder.claudeSessions && folder.claudeSessions.length > 0) {
    const sessionsListHtml = folder.claudeSessions.slice(0, 10).map(session => {
      const date = new Date(session.modified);
      const dateStr = date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
      const timeStr = date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
      const sizeKb = (session.size / 1024).toFixed(1);
      return `
        <div class="session-item" data-session-id="${session.id}">
          <div class="session-info">
            <div class="session-summary">${escapeHtml(session.summary)}</div>
            <div class="session-meta">
              <span class="session-date">${dateStr} ${timeStr}</span>
              <span class="session-stats">${session.messageCount} msgs • ${sizeKb}KB</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    const moreCount = folder.claudeSessions.length > 10 ? folder.claudeSessions.length - 10 : 0;
    const moreHtml = moreCount > 0 ? `<div class="session-more">+${moreCount} more sessions</div>` : '';

    sessionsHtml = `
      <div class="context-sessions">
        <div class="sessions-header" data-expanded="false">
          <svg class="expand-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
          <span>${folder.claudeSessions.length} Conversation${folder.claudeSessions.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="sessions-list" style="display: none;">
          ${sessionsListHtml}
          ${moreHtml}
        </div>
      </div>
    `;
  }

  card.innerHTML = `
    <div class="context-card-header">
      <div class="context-card-name">${folder.name}</div>
      <div class="context-card-badges">${badgesHtml}</div>
    </div>
    <div class="context-card-path">${folder.path}</div>
    ${sessionsHtml}
    ${actionsHtml ? `<div class="context-card-actions">${actionsHtml}</div>` : ''}
  `;

  // Wire up action buttons
  card.querySelectorAll('.context-action-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const path = btn.dataset.path;
      const type = btn.dataset.type;
      launchContextTerminal(path, type);
    };
  });

  // Wire up sessions expand/collapse
  const sessionsHeader = card.querySelector('.sessions-header');
  if (sessionsHeader) {
    sessionsHeader.onclick = (e) => {
      e.stopPropagation();
      const isExpanded = sessionsHeader.dataset.expanded === 'true';
      const sessionsList = card.querySelector('.sessions-list');
      if (isExpanded) {
        sessionsHeader.dataset.expanded = 'false';
        sessionsList.style.display = 'none';
      } else {
        sessionsHeader.dataset.expanded = 'true';
        sessionsList.style.display = 'block';
      }
    };
  }

  return card;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function launchContextTerminal(folderPath, type) {
  // Hide context page and show terminals page
  hideContextPage();
  showTerminalsPage();

  // Set up the terminal command based on type
  if (type === 'claude') {
    pendingTerminalCommand = `cd "${folderPath}" && claude --dangerously-skip-permissions`;
    pendingTerminalReadOnly = true;
  } else if (type === 'gemini') {
    pendingTerminalCommand = `cd "${folderPath}" && gemini`;
    pendingTerminalReadOnly = true;
  } else {
    pendingTerminalCommand = `cd "${folderPath}"`;
    pendingTerminalReadOnly = false;
  }

  createTerminal(type);
}

// Handle window resize for terminals - fit all visible terminals
window.addEventListener('resize', () => {
  terminals.forEach((term, termId) => {
    term.fitAddon.fit();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'terminalResize',
        termId,
        cols: term.terminal.cols,
        rows: term.terminal.rows
      }));
    }
  });
});

// Initialize
document.getElementById('auto-refresh-toggle').onchange = toggleAutoRefresh;

const recordBtn = document.getElementById('record-btn');
recordBtn.addEventListener('click', toggleRecording);

// Copy button
document.getElementById('copy-btn').addEventListener('click', copyTranscription);

// AI mic button
document.getElementById('ai-mic-btn').addEventListener('click', toggleAiRecording);

// AI copy button
document.getElementById('ai-copy-btn').addEventListener('click', copyAiResponse);

// Close dialog buttons
document.querySelector('.dialog-cancel').onclick = hideCloseDialog;
document.querySelector('.dialog-confirm').onclick = confirmCloseWindow;
document.getElementById('close-dialog').onclick = (e) => {
  if (e.target.id === 'close-dialog') hideCloseDialog();
};

// Detail page buttons
document.getElementById('detail-back').onclick = hideDetailPage;
document.getElementById('detail-focus-btn').onclick = detailFocusWindow;
document.getElementById('detail-maximize-btn').onclick = detailMaximizeWindow;
document.getElementById('detail-minimize-btn').onclick = detailMinimizeWindow;
document.getElementById('detail-close-btn').onclick = detailCloseWindow;

// Detail page voice controls
document.getElementById('detail-mic-btn').onclick = () => {
  if (!currentDetailWindowId) return;
  const hasText = cardTexts[currentDetailWindowId] && cardTexts[currentDetailWindowId].length > 0;
  if (hasText) {
    submitCardText(currentDetailWindowId);
  } else {
    toggleCardRecording(currentDetailWindowId, document.getElementById('detail-mic-btn'));
  }
};

document.getElementById('detail-add-btn').onclick = () => {
  if (!currentDetailWindowId) return;
  toggleCardRecording(currentDetailWindowId, document.getElementById('detail-add-btn'));
};

document.getElementById('detail-clear-btn').onclick = () => {
  if (!currentDetailWindowId) return;
  clearCardText(currentDetailWindowId);
};

// Context page buttons
document.getElementById('context-fab').onclick = showContextPage;
document.getElementById('context-back').onclick = hideContextPage;
document.getElementById('context-refresh-btn').onclick = scanContextFolders;

// Terminals page buttons
document.getElementById('terminals-fab').onclick = showTerminalsPage;
document.getElementById('terminals-back').onclick = hideTerminalsPage;

// Terminals add menu
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

// Close add menu when clicking elsewhere on page
document.addEventListener('click', (e) => {
  if (!e.target.closest('.terminals-add-wrapper')) {
    document.getElementById('terminals-add-menu').classList.remove('visible');
  }
});

connect();
initVoice();

// Start auto-refresh by default
autoRefreshEnabled = true;
autoRefreshInterval = setInterval(refreshWindows, 2000);
