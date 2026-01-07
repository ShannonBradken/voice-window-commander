import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  // Server
  port: 3001,
  host: '0.0.0.0',

  // Paths
  rootDir: path.dirname(__dirname), // Parent of server/
  certPath: path.join(path.dirname(__dirname), 'cert.pem'),
  keyPath: path.join(path.dirname(__dirname), 'key.pem'),
  tempDir: path.dirname(__dirname),

  // Terminal
  shell: os.platform() === 'win32' ? 'powershell.exe' : 'bash',
  defaultCwd: os.homedir(),

  // Claude projects
  claudeProjectsDir: path.join(os.homedir(), '.claude', 'projects'),

  // Window filtering
  ignoreTitles: [
    'Program Manager',
    'Windows Input Experience',
    'Microsoft Text Input Application',
    'Settings',
    'MSCTFIME UI',
    'Default IME'
  ],

  ignorePaths: [
    'ApplicationFrameHost.exe',
    'TextInputHost.exe',
    'ShellExperienceHost.exe',
    'SearchHost.exe',
    'StartMenuExperienceHost.exe'
  ],

  // AI
  aiModel: 'gpt-4o-mini',
  whisperModel: 'whisper-1',
  aiMaxTokens: 500,
  aiSystemPrompt: 'You are Eddie, a helpful voice assistant. Keep your responses concise and conversational since they will be read aloud or displayed on a small screen. Be friendly but efficient.'
};
