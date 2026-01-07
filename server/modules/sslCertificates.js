import fs from 'fs';
import { execSync } from 'child_process';
import { config } from '../config.js';

/**
 * Ensure SSL certificates exist, generating them if needed
 */
export function ensureCertificates() {
  const { certPath, keyPath } = config;

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.log('Generating self-signed certificate...');
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost"`,
      { stdio: 'inherit' }
    );
  }

  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath)
  };
}
