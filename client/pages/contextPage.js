// Context page module
import { send } from '../services/websocket.js';
import * as store from '../state/store.js';
import { escapeHtml } from '../utils/helpers.js';
import { showTerminalsPage } from './terminalsPage.js';
import { createTerminal } from '../components/terminal.js';

export function showContextPage() {
  const page = document.getElementById('context-page');
  page.classList.add('visible');
  scanContextFolders();
}

export function hideContextPage() {
  const page = document.getElementById('context-page');
  page.classList.remove('visible');
}

export function scanContextFolders() {
  const loading = document.getElementById('context-loading');
  const empty = document.getElementById('context-empty');
  const refreshBtn = document.getElementById('context-refresh-btn');

  loading.style.display = 'flex';
  empty.style.display = 'none';
  refreshBtn.classList.add('spinning');

  const list = document.getElementById('context-list');
  list.querySelectorAll('.context-card').forEach(card => card.remove());

  send({ type: 'scanContextFolders', rootPath: 'D:\\' });
}

export function renderContextFolders(folders) {
  const loading = document.getElementById('context-loading');
  const empty = document.getElementById('context-empty');
  const list = document.getElementById('context-list');
  const refreshBtn = document.getElementById('context-refresh-btn');

  loading.style.display = 'none';
  refreshBtn.classList.remove('spinning');

  list.querySelectorAll('.context-card, .context-section').forEach(el => el.remove());

  if (folders.length === 0) {
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';

  const existingFolders = folders.filter(f => f.pathExists);
  const missingFolders = folders.filter(f => !f.pathExists);

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

    existingSection.querySelector('.context-section-header').onclick = () => toggleSection(existingSection);
  }

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

    missingSection.querySelector('.context-section-header').onclick = () => toggleSection(missingSection);
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

  let badgesHtml = '';
  if (folder.hasClaude) {
    badgesHtml += '<span class="context-badge claude">Claude</span>';
  }
  if (folder.hasGemini) {
    badgesHtml += '<span class="context-badge gemini">Gemini</span>';
  }

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

  card.querySelectorAll('.context-action-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const path = btn.dataset.path;
      const type = btn.dataset.type;
      launchContextTerminal(path, type);
    };
  });

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

function launchContextTerminal(folderPath, type) {
  hideContextPage();
  showTerminalsPage();

  if (type === 'claude') {
    store.setPendingTerminalCommand(`cd "${folderPath}" && claude --dangerously-skip-permissions`);
    store.setPendingTerminalReadOnly(true);
  } else if (type === 'gemini') {
    store.setPendingTerminalCommand(`cd "${folderPath}" && gemini`);
    store.setPendingTerminalReadOnly(true);
  } else {
    store.setPendingTerminalCommand(`cd "${folderPath}"`);
    store.setPendingTerminalReadOnly(false);
  }

  createTerminal(type);
}

export function initContextPage() {
  document.getElementById('context-fab').onclick = showContextPage;
  document.getElementById('context-back').onclick = hideContextPage;
  document.getElementById('context-refresh-btn').onclick = scanContextFolders;
}
