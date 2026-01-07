import { windowManager } from 'node-window-manager';
import { execSync } from 'child_process';
import extractFileIcon from 'extract-file-icon';
import { config } from '../config.js';

// Cache icons by exe path
const iconCache = new Map();

/**
 * Get base64-encoded icon for an executable
 */
export function getIconBase64(exePath) {
  if (!exePath) return null;

  if (iconCache.has(exePath)) {
    return iconCache.get(exePath);
  }

  try {
    const iconBuffer = extractFileIcon(exePath, 32);
    const base64 = `data:image/png;base64,${iconBuffer.toString('base64')}`;
    iconCache.set(exePath, base64);
    return base64;
  } catch (err) {
    console.error('Failed to extract icon for:', exePath, err.message);
    iconCache.set(exePath, null);
    return null;
  }
}

/**
 * Get filtered list of visible windows
 */
export function getWindows() {
  const windows = windowManager.getWindows();

  return windows
    .filter(w => {
      const title = w.getTitle();
      const bounds = w.getBounds();

      // Must have a title
      if (!title || title.length === 0) return false;

      // Must be visible with reasonable size
      if (!w.isVisible()) return false;
      if (bounds.width < 100 || bounds.height < 50) return false;

      // Filter out known system/background windows
      if (config.ignoreTitles.includes(title)) return false;

      // Filter out background system processes by path
      const exeName = w.path ? w.path.split('\\').pop() : '';
      if (config.ignorePaths.includes(exeName)) return false;

      return true;
    })
    .map(w => ({
      id: w.id,
      title: w.getTitle(),
      path: w.path,
      processId: w.processId,
      bounds: w.getBounds(),
      icon: getIconBase64(w.path)
    }));
}

/**
 * Find a window by ID
 */
function findWindow(windowId) {
  const windows = windowManager.getWindows();
  return windows.find(w => w.id === windowId);
}

/**
 * Focus a window by ID
 */
export function focusWindow(windowId) {
  const target = findWindow(windowId);
  if (target) {
    target.bringToTop();
    target.show();
    return true;
  }
  return false;
}

/**
 * Close a window by ID
 */
export function closeWindow(windowId) {
  const target = findWindow(windowId);
  if (target && target.processId) {
    try {
      execSync(`taskkill /PID ${target.processId}`, { stdio: 'ignore' });
      return true;
    } catch (err) {
      console.error('Failed to close window:', err.message);
      return false;
    }
  }
  return false;
}

/**
 * Maximize a window by ID
 */
export function maximizeWindow(windowId) {
  const target = findWindow(windowId);
  if (target) {
    target.bringToTop();
    target.maximize();
    return true;
  }
  return false;
}

/**
 * Minimize a window by ID
 */
export function minimizeWindow(windowId) {
  const target = findWindow(windowId);
  if (target) {
    target.minimize();
    return true;
  }
  return false;
}

/**
 * Get window bounds by ID
 */
export function getWindowBounds(windowId) {
  const target = findWindow(windowId);
  return target ? target.getBounds() : null;
}

/**
 * Set window bounds by ID
 */
export function setWindowBounds(windowId, bounds) {
  const target = findWindow(windowId);
  if (target) {
    target.setBounds(bounds);
    return true;
  }
  return false;
}

/**
 * Bring window to top and show
 */
export function bringToTop(windowId) {
  const target = findWindow(windowId);
  if (target) {
    target.bringToTop();
    target.show();
    return true;
  }
  return false;
}
