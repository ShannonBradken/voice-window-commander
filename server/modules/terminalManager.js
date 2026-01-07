import os from 'os';
import * as pty from 'node-pty';
import { config } from '../config.js';

/**
 * Terminal Manager - handles PTY processes for a WebSocket client
 */
export class TerminalManager {
  constructor() {
    this.terminals = new Map();
    this.idCounter = 0;
  }

  /**
   * Create a new terminal
   */
  create(options = {}) {
    const termId = ++this.idCounter;
    const cols = options.cols || 80;
    const rows = options.rows || 24;
    const cwd = options.cwd || config.defaultCwd;

    const ptyProcess = pty.spawn(config.shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env
    });

    this.terminals.set(termId, ptyProcess);
    console.log(`Terminal ${termId} created (${cols}x${rows})`);

    return { termId, ptyProcess };
  }

  /**
   * Get a terminal by ID
   */
  get(termId) {
    return this.terminals.get(termId);
  }

  /**
   * Write data to a terminal
   */
  write(termId, data) {
    const term = this.terminals.get(termId);
    if (term) {
      term.write(data);
      return true;
    }
    return false;
  }

  /**
   * Resize a terminal
   */
  resize(termId, cols, rows) {
    const term = this.terminals.get(termId);
    if (term) {
      term.resize(cols, rows);
      console.log(`Terminal ${termId} resized to ${cols}x${rows}`);
      return true;
    }
    return false;
  }

  /**
   * Close a terminal
   */
  close(termId) {
    const term = this.terminals.get(termId);
    if (term) {
      term.kill();
      this.terminals.delete(termId);
      console.log(`Terminal ${termId} closed`);
      return true;
    }
    return false;
  }

  /**
   * Close all terminals (cleanup on disconnect)
   */
  closeAll() {
    for (const [termId, ptyProcess] of this.terminals) {
      console.log(`Cleaning up terminal ${termId}`);
      ptyProcess.kill();
    }
    this.terminals.clear();
  }

  /**
   * Remove a terminal from tracking (after exit)
   */
  remove(termId) {
    this.terminals.delete(termId);
  }
}
