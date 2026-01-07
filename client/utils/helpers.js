// Utility functions

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function scaleTextToFit(element) {
  const maxFontSize = 0.95; // rem
  const minFontSize = 0.55; // rem
  let fontSize = maxFontSize;

  element.style.fontSize = fontSize + 'rem';

  while (element.scrollWidth > element.clientWidth && fontSize > minFontSize) {
    fontSize -= 0.05;
    element.style.fontSize = fontSize + 'rem';
  }
}

// Shared audio context for notifications
let audioContext = null;

export function playDing() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

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

export function mergeWindows(oldWindows, newWindows) {
  const newMap = new Map(newWindows.map(w => [w.id, w]));
  const merged = [];
  const seenIds = new Set();

  for (const oldWin of oldWindows) {
    if (newMap.has(oldWin.id)) {
      merged.push(newMap.get(oldWin.id));
      seenIds.add(oldWin.id);
    }
  }

  for (const newWin of newWindows) {
    if (!seenIds.has(newWin.id)) {
      merged.push(newWin);
    }
  }

  return merged;
}
