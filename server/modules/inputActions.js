import clipboardy from 'clipboardy';
import robot from 'robotjs';
import { focusWindow } from './windowManager.js';

/**
 * Paste text to a window by focusing it and using clipboard
 */
export async function pasteToWindow(windowId, text) {
  const focused = focusWindow(windowId);
  if (!focused) {
    throw new Error('Could not focus window');
  }

  // Wait for window to gain focus
  await new Promise(resolve => setTimeout(resolve, 200));

  // Copy text to clipboard
  await clipboardy.write(text);

  // Wait a moment
  await new Promise(resolve => setTimeout(resolve, 100));

  // Send Ctrl+V to paste
  robot.keyTap('v', 'control');

  // Wait a moment then press Enter
  await new Promise(resolve => setTimeout(resolve, 100));
  robot.keyTap('enter');

  return true;
}
