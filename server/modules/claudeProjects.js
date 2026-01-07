import fs from 'fs';
import path from 'path';
import os from 'os';
import { config } from '../config.js';

/**
 * Decode Claude's encoded path back to actual path
 * D--projects-voice-app -> D:\projects\voice_app
 */
export function decodeClaudePath(encodedName) {
  const parts = encodedName.split('-');

  if (parts.length === 0) return encodedName;

  let result = '';
  let i = 0;

  // First part is drive letter
  if (parts[0].length === 1 && parts[0].match(/[A-Z]/i)) {
    result = parts[0].toUpperCase() + ':\\';
    i = 1;
    // Skip empty parts from --
    while (i < parts.length && parts[i] === '') i++;
  }

  // Remaining parts are path segments
  const pathParts = [];
  while (i < parts.length) {
    if (parts[i] !== '') {
      pathParts.push(parts[i]);
    }
    i++;
  }

  result += pathParts.join('\\');
  return result;
}

/**
 * Get sessions for a Claude project folder
 */
export function getSessionsForProject(projectDir) {
  const sessions = [];

  try {
    const files = fs.readdirSync(projectDir);

    for (const file of files) {
      if (file.endsWith('.jsonl') && !file.startsWith('agent-')) {
        const filePath = path.join(projectDir, file);
        const stats = fs.statSync(filePath);
        const sessionId = file.replace('.jsonl', '');

        // Skip empty files
        if (stats.size === 0) continue;

        let summary = null;
        let firstMessage = null;
        let messageCount = 0;

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.trim().split('\n').filter(l => l.trim());
          messageCount = lines.length;

          // Look for summary or first user message
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === 'summary') {
                summary = parsed.summary;
                break;
              }
              if (!firstMessage && parsed.type === 'user' && parsed.message?.content) {
                firstMessage = parsed.message.content.substring(0, 100);
              }
            } catch (e) {}
          }
        } catch (e) {}

        sessions.push({
          id: sessionId,
          file: file,
          size: stats.size,
          modified: stats.mtime,
          messageCount,
          summary: summary || firstMessage || 'No summary'
        });
      }
    }

    // Sort by modified date descending
    sessions.sort((a, b) => new Date(b.modified) - new Date(a.modified));

  } catch (err) {
    console.log(`Error reading sessions from ${projectDir}:`, err.message);
  }

  return sessions;
}

/**
 * Scan Claude projects folder to get all projects with conversations
 */
export async function scanForContextFolders() {
  const homeDir = os.homedir();
  const results = [];

  try {
    if (!fs.existsSync(config.claudeProjectsDir)) {
      console.log('Claude projects directory not found');
      return results;
    }

    const projectFolders = fs.readdirSync(config.claudeProjectsDir, { withFileTypes: true });

    for (const folder of projectFolders) {
      if (!folder.isDirectory()) continue;

      const encodedName = folder.name;
      const actualPath = decodeClaudePath(encodedName);
      const projectDir = path.join(config.claudeProjectsDir, encodedName);

      // Get sessions for this project
      const sessions = getSessionsForProject(projectDir);

      // Skip projects with no sessions
      if (sessions.length === 0) continue;

      // Get folder stats
      const stats = fs.statSync(projectDir);

      // Check if actual path still exists and has .claude/.gemini
      let pathExists = false;
      let hasClaude = false;
      let hasGemini = false;

      try {
        pathExists = fs.existsSync(actualPath);
        if (pathExists) {
          hasClaude = fs.existsSync(path.join(actualPath, '.claude'));
          hasGemini = fs.existsSync(path.join(actualPath, '.gemini'));
        }
      } catch (e) {}

      // Generate display name
      let displayName = path.basename(actualPath);
      if (!displayName || displayName.match(/^[A-Z]:$/i)) {
        displayName = actualPath;
      }

      // Check if it's the home directory
      const isHome = path.resolve(actualPath) === path.resolve(homeDir);
      if (isHome) {
        displayName = '~ (Home)';
      }

      console.log(`Found project: ${encodedName} -> ${actualPath} (${sessions.length} sessions)`);

      results.push({
        encodedName,
        path: actualPath,
        name: displayName,
        pathExists,
        hasClaude,
        hasGemini,
        isHome,
        claudeSessions: sessions,
        totalSessions: sessions.length,
        lastModified: stats.mtime
      });
    }

    // Sort by last modified (most recent first)
    results.sort((a, b) => {
      const aLatest = a.claudeSessions[0]?.modified || a.lastModified;
      const bLatest = b.claudeSessions[0]?.modified || b.lastModified;
      return new Date(bLatest) - new Date(aLatest);
    });

  } catch (err) {
    console.error('Error scanning Claude projects:', err);
  }

  return results;
}
