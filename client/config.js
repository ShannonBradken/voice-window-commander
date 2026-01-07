// Client configuration
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

export const config = {
  wsUrl: `${wsProtocol}//${window.location.hostname}:3001`,
  autoRefreshInterval: 2000,
  terminalDefaults: {
    cols: 80,
    rows: 12,
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace'
  },
  terminalTheme: {
    background: '#0d0d1a',
    foreground: '#e0e0e0',
    cursor: '#16a085',
    cursorAccent: '#0d0d1a',
    selection: 'rgba(22, 160, 133, 0.3)',
    black: '#1a1a2e',
    red: '#e74c3c',
    green: '#2ecc71',
    yellow: '#f1c40f',
    blue: '#3498db',
    magenta: '#9b59b6',
    cyan: '#1abc9c',
    white: '#ecf0f1',
    brightBlack: '#3a3a5c',
    brightRed: '#e74c3c',
    brightGreen: '#2ecc71',
    brightYellow: '#f1c40f',
    brightBlue: '#3498db',
    brightMagenta: '#9b59b6',
    brightCyan: '#1abc9c',
    brightWhite: '#ffffff'
  }
};
