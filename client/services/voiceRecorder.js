// Voice recording service
import * as store from '../state/store.js';
import { send, sendBinary } from './websocket.js';

export async function initVoice() {
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

    const recorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        store.pushAudioChunk(e.data);
      }
    };

    recorder.onstop = async () => {
      const audioBlob = new Blob(store.audioChunks, { type: 'audio/webm' });
      store.clearAudioChunks();

      // Send to server
      const arrayBuffer = await audioBlob.arrayBuffer();
      send({ type: 'audioStart', windowId: store.activeWindowId });
      sendBinary(arrayBuffer);

      // Reset active state
      store.setRecordingWindowId(null);
      store.setActiveWindowId(null);
      store.setActiveMicBtn(null);
    };

    store.setMediaRecorder(recorder);
    console.log('Microphone ready');
  } catch (err) {
    console.error('Microphone access denied:', err);
    document.getElementById('transcription-text').textContent = 'Microphone access denied';
  }
}

export function startRecording(windowId, btn) {
  if (store.mediaRecorder && store.mediaRecorder.state === 'inactive') {
    store.setActiveWindowId(windowId);
    store.setRecordingWindowId(windowId);
    store.setActiveMicBtn(btn);
    store.clearAudioChunks();
    store.mediaRecorder.start();
    return true;
  }
  return false;
}

export function stopRecording() {
  if (store.mediaRecorder && store.mediaRecorder.state === 'recording') {
    store.mediaRecorder.stop();
    return true;
  }
  return false;
}

export function isRecording() {
  return store.mediaRecorder && store.mediaRecorder.state === 'recording';
}
