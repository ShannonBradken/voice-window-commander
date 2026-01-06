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
const terminals = new Map(); // termId -> { terminal, fitAddon, element }
let activeTerminalId = null;
let terminalCounter = 0;
let pendingTerminalCommand = null; // Command to run after terminal is created
let pendingTerminalReadOnly = false; // Whether the next terminal should be read-only
let terminalVoiceRecording = false; // Whether we're recording voice for terminal input
let terminalVoiceText = ''; // Accumulated voice text for terminal
let terminalVoiceTranscribing = false; // Whether terminal voice is transcribing

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
      // Voice transcription for terminal - accumulate text
      terminalVoiceRecording = false;
      terminalVoiceTranscribing = false;
      if (msg.text) {
        terminalVoiceText += (terminalVoiceText ? ' ' : '') + msg.text;
      }
      updateTerminalVoiceUI();
      break;

    case 'terminalTranscriptionError':
      terminalVoiceRecording = false;
      terminalVoiceTranscribing = false;
      updateTerminalVoiceUI();
      console.error('Terminal transcription error:', msg.error);
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
function showTerminalPanel() {
  const panel = document.getElementById('terminal-panel');
  panel.classList.add('visible');
  panel.classList.remove('minimized');
  // Create first terminal if none exist
  if (terminals.size === 0) {
    createTerminal();
  } else if (activeTerminalId) {
    // Fit the active terminal
    const term = terminals.get(activeTerminalId);
    if (term) {
      setTimeout(() => term.fitAddon.fit(), 100);
    }
  }
}

function hideTerminalPanel() {
  const panel = document.getElementById('terminal-panel');
  panel.classList.remove('visible');
  panel.classList.remove('minimized');
}

function minimizeTerminalPanel() {
  const panel = document.getElementById('terminal-panel');
  panel.classList.add('minimized');
}

function expandTerminalPanel() {
  const panel = document.getElementById('terminal-panel');
  if (panel.classList.contains('minimized')) {
    panel.classList.remove('minimized');
    // Fit the active terminal after expanding
    if (activeTerminalId) {
      const term = terminals.get(activeTerminalId);
      if (term) {
        setTimeout(() => term.fitAddon.fit(), 100);
      }
    }
  }
}

function launchClaude() {
  // Set the command to run after terminal is created
  pendingTerminalCommand = 'claude --dangerously-skip-permissions';
  pendingTerminalReadOnly = true; // Make Claude terminal read-only
  // Open terminal panel and create a new terminal
  const panel = document.getElementById('terminal-panel');
  panel.classList.add('visible');
  panel.classList.remove('minimized');
  createTerminal();
}

function launchGemini() {
  // Set the command to run after terminal is created
  pendingTerminalCommand = 'gemini';
  pendingTerminalReadOnly = true; // Make Gemini terminal read-only
  // Open terminal panel and create a new terminal
  const panel = document.getElementById('terminal-panel');
  panel.classList.add('visible');
  panel.classList.remove('minimized');
  createTerminal();
}

// Terminal voice input
function updateTerminalVoiceUI() {
  const textEl = document.getElementById('terminal-voice-text');
  const clearBtn = document.getElementById('terminal-clear-btn');
  const addBtn = document.getElementById('terminal-add-btn');
  const micBtn = document.getElementById('terminal-mic-btn');

  if (!textEl || !clearBtn || !addBtn || !micBtn) return;

  const hasText = terminalVoiceText.length > 0;
  const micIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
  const checkIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;

  // Update text display
  textEl.textContent = terminalVoiceText;

  // Update transcribing state
  if (terminalVoiceTranscribing) {
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
  if (terminalVoiceRecording) {
    micBtn.classList.add('recording');
    micBtn.classList.remove('processing', 'submit-mode');
    micBtn.innerHTML = micIcon;
  } else if (terminalVoiceTranscribing) {
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
  if (terminalVoiceRecording && hasText) {
    addBtn.classList.add('recording');
  } else {
    addBtn.classList.remove('recording');
  }
}

function toggleTerminalVoiceRecording(btn) {
  if (!activeTerminalId) return; // No active terminal

  const hasText = terminalVoiceText.length > 0;
  const isMicBtn = btn && btn.id === 'terminal-mic-btn';

  // If has text and clicking main mic (not recording), submit
  if (hasText && isMicBtn && !terminalVoiceRecording) {
    submitTerminalVoice();
    return;
  }

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    // Stop recording
    terminalVoiceTranscribing = true;
    terminalVoiceRecording = false;
    mediaRecorder.stop();
    updateTerminalVoiceUI();
  } else if (mediaRecorder && mediaRecorder.state === 'inactive') {
    // Start recording for terminal
    activeWindowId = 'terminal-voice';
    activeMicBtn = btn;
    terminalVoiceRecording = true;
    audioChunks = [];
    mediaRecorder.start();
    updateTerminalVoiceUI();
  }
}

function clearTerminalVoice() {
  terminalVoiceText = '';
  updateTerminalVoiceUI();
}

function submitTerminalVoice() {
  if (!activeTerminalId || !terminalVoiceText) return;

  // Get terminal type to determine appropriate line ending
  const terminalData = terminals.get(activeTerminalId);
  const terminalType = terminalData?.terminalType || 'regular';

  // Claude uses \n, Gemini uses \r
  const lineEnding = terminalType === 'claude' ? '\n' : '\r';

  // Send text to terminal, then send Enter key separately
  if (ws && ws.readyState === WebSocket.OPEN) {
    // First send the text
    ws.send(JSON.stringify({
      type: 'terminalInput',
      termId: activeTerminalId,
      data: terminalVoiceText
    }));
    // Then send Enter key (appropriate for terminal type)
    ws.send(JSON.stringify({
      type: 'terminalInput',
      termId: activeTerminalId,
      data: lineEnding
    }));
  }

  // Clear text
  terminalVoiceText = '';
  updateTerminalVoiceUI();
}

function createTerminal() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const container = document.getElementById('terminal-container');
    const cols = Math.floor((container.clientWidth - 16) / 9); // Approximate char width
    const rows = Math.floor((container.clientHeight - 16) / 17); // Approximate char height
    ws.send(JSON.stringify({
      type: 'terminalCreate',
      cols: cols || 80,
      rows: rows || 24
    }));
  }
}

function onTerminalCreated(termId) {
  const container = document.getElementById('terminal-container');
  const isReadOnly = pendingTerminalReadOnly;
  const command = pendingTerminalCommand; // Capture before reset
  pendingTerminalReadOnly = false; // Reset flag

  // Create terminal element
  const termElement = document.createElement('div');
  termElement.className = 'terminal-instance';
  termElement.id = `terminal-${termId}`;
  container.appendChild(termElement);

  // Create xterm instance
  const terminal = new Terminal({
    cursorBlink: !isReadOnly,
    cursorStyle: isReadOnly ? 'bar' : 'block',
    disableStdin: isReadOnly,
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace',
    theme: {
      background: '#0d0d1a',
      foreground: '#e0e0e0',
      cursor: isReadOnly ? '#0d0d1a' : '#16a085', // Hide cursor if read-only
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

  // Determine terminal type for line ending handling
  let terminalType = 'regular';
  if (command && command.includes('claude')) terminalType = 'claude';
  else if (command && command.includes('gemini')) terminalType = 'gemini';

  // Store terminal
  terminals.set(termId, { terminal, fitAddon, element: termElement, readOnly: isReadOnly, terminalType });

  // Create tab
  const tabsContainer = document.getElementById('terminal-tabs');
  const tab = document.createElement('div');
  tab.className = 'terminal-tab';
  tab.dataset.termId = termId;
  let tabLabel = `Terminal ${termId}`;
  if (isReadOnly && command) {
    if (command.includes('claude')) tabLabel = 'Claude';
    else if (command.includes('gemini')) tabLabel = 'Gemini';
  }
  tab.innerHTML = `
    <span>${tabLabel}</span>
    <button class="terminal-tab-close" title="Close">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </button>
  `;
  tab.addEventListener('click', (e) => {
    if (!e.target.closest('.terminal-tab-close')) {
      switchToTerminal(termId);
    }
  });
  tab.querySelector('.terminal-tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    requestCloseTerminal(termId);
  });
  tabsContainer.appendChild(tab);

  // Switch to this terminal
  switchToTerminal(termId);

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

function switchToTerminal(termId) {
  // Update active state
  activeTerminalId = termId;

  // Update tabs
  document.querySelectorAll('.terminal-tab').forEach(tab => {
    tab.classList.toggle('active', parseInt(tab.dataset.termId) === termId);
  });

  // Update terminal visibility
  terminals.forEach((term, id) => {
    term.element.classList.toggle('active', id === termId);
    if (id === termId) {
      // Only focus if not read-only (prevents keyboard on mobile)
      if (!term.readOnly) {
        term.terminal.focus();
      }
      term.fitAddon.fit();
    }
  });
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
    term.element.remove();
    terminals.delete(termId);
  }

  // Remove tab
  const tab = document.querySelector(`.terminal-tab[data-term-id="${termId}"]`);
  if (tab) tab.remove();

  // Switch to another terminal or close panel
  if (terminals.size > 0) {
    const nextTermId = terminals.keys().next().value;
    switchToTerminal(nextTermId);
  } else {
    activeTerminalId = null;
    hideTerminalPanel();
  }
}

// Handle window resize for terminals
window.addEventListener('resize', () => {
  if (activeTerminalId) {
    const term = terminals.get(activeTerminalId);
    if (term) {
      term.fitAddon.fit();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'terminalResize',
          termId: activeTerminalId,
          cols: term.terminal.cols,
          rows: term.terminal.rows
        }));
      }
    }
  }
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

// Terminal panel buttons
document.getElementById('terminal-fab').onclick = showTerminalPanel;
document.getElementById('close-terminal-panel').onclick = hideTerminalPanel;

// New terminal dropdown menu
document.getElementById('new-terminal-btn').onclick = (e) => {
  e.stopPropagation();
  document.getElementById('new-terminal-menu').classList.toggle('visible');
};

document.getElementById('new-terminal-claude').onclick = (e) => {
  e.stopPropagation();
  document.getElementById('new-terminal-menu').classList.remove('visible');
  pendingTerminalCommand = 'claude --dangerously-skip-permissions';
  pendingTerminalReadOnly = true;
  createTerminal();
};

document.getElementById('new-terminal-gemini').onclick = (e) => {
  e.stopPropagation();
  document.getElementById('new-terminal-menu').classList.remove('visible');
  pendingTerminalCommand = 'gemini';
  pendingTerminalReadOnly = true;
  createTerminal();
};

document.getElementById('new-terminal-regular').onclick = (e) => {
  e.stopPropagation();
  document.getElementById('new-terminal-menu').classList.remove('visible');
  createTerminal();
};

document.getElementById('terminal-mic-btn').onclick = () => toggleTerminalVoiceRecording(document.getElementById('terminal-mic-btn'));
document.getElementById('terminal-clear-btn').onclick = clearTerminalVoice;
document.getElementById('terminal-add-btn').onclick = () => toggleTerminalVoiceRecording(document.getElementById('terminal-add-btn'));
document.getElementById('claude-fab').onclick = launchClaude;
document.getElementById('gemini-fab').onclick = launchGemini;

// Terminal panel click handler
document.getElementById('terminal-panel').addEventListener('click', (e) => {
  const terminalPanel = document.getElementById('terminal-panel');

  // Close dropdown menu when clicking elsewhere
  if (!e.target.closest('.new-terminal-wrapper')) {
    document.getElementById('new-terminal-menu').classList.remove('visible');
  }

  // If minimized and clicking on header, expand the panel
  if (terminalPanel.classList.contains('minimized')) {
    const isOnHeader = e.target.closest('.terminal-panel-header');
    if (isOnHeader && !e.target.closest('.close-terminal-panel-btn')) {
      expandTerminalPanel();
    }
  }

  e.stopPropagation();
});

document.addEventListener('click', (e) => {
  const terminalPanel = document.getElementById('terminal-panel');
  if (!terminalPanel.classList.contains('visible')) return;
  if (terminalPanel.classList.contains('minimized')) return; // Already minimized

  // Check if click is on FAB buttons (which open the terminal)
  const isOnFab = e.target.closest('#terminal-fab, #claude-fab, #gemini-fab');

  if (!isOnFab) {
    minimizeTerminalPanel();
  }
});

connect();
initVoice();

// Start auto-refresh by default
autoRefreshEnabled = true;
autoRefreshInterval = setInterval(refreshWindows, 2000);
