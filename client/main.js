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
let autoRefreshEnabled = false;
let autoRefreshInterval = null;

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
  }
}

function displayTranscription(text) {
  document.getElementById('transcription-text').textContent = text;
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
  }
}

function clearCardText(windowId) {
  cardTexts[windowId] = '';
  const textEl = document.querySelector(`.card-text[data-window-id="${windowId}"]`);
  if (textEl) {
    textEl.textContent = '';
  }
  updateCardButtons(windowId);
}

function updateCardButtons(windowId) {
  const hasText = cardTexts[windowId] && cardTexts[windowId].length > 0;
  const isTranscribing = transcribingWindows[windowId] === true;
  const clearBtn = document.querySelector(`.card-clear-btn[data-window-id="${windowId}"]`);
  const micBtn = document.querySelector(`.card-mic-btn[data-window-id="${windowId}"]`);
  const addBtn = document.querySelector(`.card-add-btn[data-window-id="${windowId}"]`);

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
    if (hasText || isTranscribing) {
      // Change to submit button (or processing state)
      micBtn.classList.add('submit-mode');
      if (isTranscribing) {
        // Show processing indicator
        micBtn.classList.add('processing');
        micBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/></svg>`;
        micBtn.disabled = true;
      } else {
        // Show submit tick
        micBtn.classList.remove('processing');
        micBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
        micBtn.disabled = false;
      }
    } else {
      // Change to mic button
      micBtn.classList.remove('submit-mode');
      micBtn.classList.remove('processing');
      micBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
      micBtn.disabled = false;
    }
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
    cardContent.onclick = () => focusWindow(win.id);

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

    const path = document.createElement('div');
    path.className = 'window-path';
    // Extract just the executable name from path
    const exeName = win.path ? win.path.split('\\').pop() : 'Unknown';
    path.textContent = exeName;

    cardInfo.appendChild(title);
    cardInfo.appendChild(path);
    cardContent.appendChild(cardInfo);

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

    // Add button (round blue mic) - for appending more, hidden by default
    const addBtn = document.createElement('button');
    addBtn.className = 'card-add-btn' + (hasText ? ' visible' : '');
    addBtn.dataset.windowId = win.id;
    addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
    addBtn.onclick = (e) => {
      e.stopPropagation();
      toggleCardRecording(win.id, addBtn);
    };

    // Mic/Submit button - mic when no text, submit when has text
    const micBtn = document.createElement('button');
    micBtn.className = 'card-mic-btn' + (hasText ? ' submit-mode' : '');
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

    // Text display area
    const cardTextArea = document.createElement('div');
    cardTextArea.className = 'card-text-area';

    const cardText = document.createElement('div');
    cardText.className = 'card-text';
    cardText.dataset.windowId = win.id;
    cardText.textContent = cardTexts[win.id] || '';

    cardTextArea.appendChild(cardText);

    // Card layout: header row + text area
    const cardHeader = document.createElement('div');
    cardHeader.className = 'card-header';
    cardHeader.appendChild(cardContent);
    cardHeader.appendChild(clearBtn);
    cardHeader.appendChild(addBtn);
    cardHeader.appendChild(micBtn);

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
    transcribingWindows[windowId] = true;
    updateCardButtons(windowId);
    mediaRecorder.stop();
    btn.classList.remove('recording');
    document.getElementById('transcription-text').textContent = 'Processing...';
  } else if (mediaRecorder && mediaRecorder.state === 'inactive') {
    // Start recording
    activeWindowId = windowId;
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
      activeWindowId = null;
      activeMicBtn = null;
    };

    console.log('Microphone ready');
  } catch (err) {
    console.error('Microphone access denied:', err);
    document.getElementById('transcription-text').textContent = 'Microphone access denied';
  }
}

function startRecording() {
  if (mediaRecorder && mediaRecorder.state === 'inactive') {
    audioChunks = [];
    mediaRecorder.start();
    document.getElementById('record-btn').textContent = 'Recording...';
    document.getElementById('record-btn').classList.add('recording');
    document.getElementById('recording-indicator').classList.add('active');
    document.getElementById('transcription-text').textContent = 'Listening...';
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    document.getElementById('record-btn').textContent = 'Hold to Talk';
    document.getElementById('record-btn').classList.remove('recording');
    document.getElementById('recording-indicator').classList.remove('active');
    document.getElementById('transcription-text').textContent = 'Processing...';
  }
}

// Auto-refresh toggle
function toggleAutoRefresh() {
  autoRefreshEnabled = !autoRefreshEnabled;
  const btn = document.getElementById('auto-refresh-btn');

  if (autoRefreshEnabled) {
    btn.textContent = 'Auto-Refresh: On';
    btn.classList.add('active');
    // Refresh immediately, then every 2 seconds
    refreshWindows();
    autoRefreshInterval = setInterval(refreshWindows, 2000);
  } else {
    btn.textContent = 'Auto-Refresh: Off';
    btn.classList.remove('active');
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }
}

// Initialize
document.getElementById('auto-refresh-btn').onclick = toggleAutoRefresh;

const recordBtn = document.getElementById('record-btn');
recordBtn.addEventListener('mousedown', startRecording);
recordBtn.addEventListener('mouseup', stopRecording);
recordBtn.addEventListener('mouseleave', stopRecording);
// Touch support
recordBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
recordBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); });

connect();
initVoice();
