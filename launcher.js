/**
 * launcher.js
 * - Auto-detects IP
 * - Starts server
 * - Auto-opens browser to correct URL
 */

import { spawn } from 'child_process';
import { createServer } from 'http';
import os from 'os';
import open from 'open';

// Get local IP (non-localhost)
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    for (const addr of iface) {
      // Skip internal and non-IPv4 addresses
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();
const port = 3000;
const url = `http://${localIP}:${port}`;

console.log('\n');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║         SRA Leaderboard - Initializing                      ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log(`\n📍 Your IP: ${localIP}`);
console.log(`🌐 Overlay URL: ${url}`);
console.log(`\nℹ️  Use this URL in OBS Browser Source\n`);

// Start the actual server
console.log('🚀 Starting server...\n');

// Run server.js as a child process
const serverProcess = spawn('node', ['server.js'], {
  stdio: 'inherit',
  shell: true,
});

serverProcess.on('error', (err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

// Wait a bit for server to start, then open browser
setTimeout(() => {
  console.log(`\n🌍 Opening browser to ${url}\n`);
  open(url).catch(err => {
    console.warn('⚠️  Could not auto-open browser:', err.message);
    console.log(`   Manually open: ${url}`);
  });
}, 1500);

// Handle exit
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  serverProcess.kill();
  process.exit(0);
});
