import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { config } from '../config.js';

const openai = new OpenAI();

/**
 * Transcribe audio buffer using Whisper API
 */
export async function transcribeAudio(audioBuffer) {
  const tempPath = path.join(config.tempDir, 'temp_audio.webm');
  fs.writeFileSync(tempPath, Buffer.from(audioBuffer));

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: config.whisperModel,
      language: 'en',
    });
    return transcription.text;
  } finally {
    // Clean up temp file
    fs.unlinkSync(tempPath);
  }
}
