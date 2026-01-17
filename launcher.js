#!/usr/bin/env node

/**
 * Launcher script
 * - Installs dependencies if needed
 * - Opens the browser to overlay and admin pages
 * - Starts the server
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import open from 'open';
import os from 'os';

// Get local IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();
const PORT = process.env.PORT || 3000;
const overlayUrl = `http://${localIP}:${PORT}`;
const adminUrl = `http://${localIP}:${PORT}/admin`;

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║         SRA Leaderboard - Initializing                      ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log(`📍 Machine IP: ${localIP}`);
console.log(`🌐 Overlay URL: ${overlayUrl}`);
console.log(`🔧 Admin URL: ${adminUrl}\n`);

// Install dependencies if needed
if (!existsSync('node_modules')) {
  console.log('📦 Installing dependencies...\n');
  const install = spawn('npm', ['install'], { stdio: 'inherit' });
  install.on('close', (code) => {
    if (code === 0) startServer();
    else process.exit(code);
  });
} else {
  startServer();
}

function startServer() {
  console.log('🚀 Starting server...\n');
  
  // Wait a moment then open browser
  setTimeout(() => {
    console.log('🌍 Opening browser...\n');
    open(overlayUrl).catch(() => {});
    setTimeout(() => {
      open(adminUrl).catch(() => {});
    }, 800);
  }, 1000);

  // Start the server
  const server = spawn('node', ['server.js'], { stdio: 'inherit' });
  
  server.on('error', (err) => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down...');
    server.kill();
    process.exit(0);
  });
}
