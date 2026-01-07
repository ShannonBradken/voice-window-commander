// Centralized state management

// WebSocket connection
export let ws = null;
export function setWs(socket) { ws = socket; }

// Window state
export let windows = [];
export function setWindows(list) { windows = list; }

// Voice recording state
export let mediaRecorder = null;
export let audioChunks = [];
export let activeWindowId = null;
export let activeMicBtn = null;
export let recordingWindowId = null;

export function setMediaRecorder(recorder) { mediaRecorder = recorder; }
export function clearAudioChunks() { audioChunks = []; }
export function pushAudioChunk(chunk) { audioChunks.push(chunk); }
export function setActiveWindowId(id) { activeWindowId = id; }
export function setActiveMicBtn(btn) { activeMicBtn = btn; }
export function setRecordingWindowId(id) { recordingWindowId = id; }

// Card text state (accumulated transcriptions per window)
export const cardTexts = {};
export const transcribingWindows = {};

// Auto-refresh state
export let autoRefreshEnabled = false;
export let autoRefreshInterval = null;
export function setAutoRefreshEnabled(enabled) { autoRefreshEnabled = enabled; }
export function setAutoRefreshInterval(interval) { autoRefreshInterval = interval; }

// Dialog state
export let pendingCloseWindowId = null;
export function setPendingCloseWindowId(id) { pendingCloseWindowId = id; }

// Detail page state
export let currentDetailWindowId = null;
export function setCurrentDetailWindowId(id) { currentDetailWindowId = id; }

// AI assistant state
export let aiQueryText = '';
export let aiProcessing = false;
export function setAiQueryText(text) { aiQueryText = text; }
export function setAiProcessing(processing) { aiProcessing = processing; }

// Terminal state
export const terminals = new Map();
export const terminalVoiceStates = new Map();
export let pendingTerminalCommand = null;
export let pendingTerminalReadOnly = false;
export let currentVoiceTerminalId = null;

export function setPendingTerminalCommand(cmd) { pendingTerminalCommand = cmd; }
export function setPendingTerminalReadOnly(readOnly) { pendingTerminalReadOnly = readOnly; }
export function setCurrentVoiceTerminalId(id) { currentVoiceTerminalId = id; }

// Audio context for notifications
export let audioContext = null;
export function setAudioContext(ctx) { audioContext = ctx; }
