# SRA Leaderboard - Setup Guide

## Quick Start

### Option 1: Windows Batch File (Easiest)
```bash
start.bat
```
This will automatically:
- Install dependencies (if needed)
- Open the overlay
- Open the admin page
- Start the server

### Option 2: NPM Script
```bash
npm launch
```

### Option 3: Manual Start
```bash
npm start
```

## Configuration

### 1. Get LFS API Credentials

**Required for vehicle drive type flags to appear**

1. Go to https://lfs.net/api
2. Log in or create an account
3. Create a new application
4. Copy your **Client ID** and **Client Secret**

### 2. Set Environment Variables

Edit the `.env` file in the project root:

```env
LFS_CLIENT_ID=your_client_id_here
LFS_CLIENT_SECRET=your_client_secret_here
```

**⚠️ IMPORTANT:** Keep `.env` private - don't share it or commit to git!

### 3. Install Dependencies

```bash
npm install
```

## Usage

### Leaderboard Overlay
Open in your browser:
- **Local:** http://localhost:3000
- **Network:** http://{your-ip}:3000 (use IP from admin page)

### Admin Page
Open in your browser:
- **Local:** http://localhost:3000/admin
- **Network:** http://{your-ip}:3000/admin

**Features:**
- Copy IP address for OBS
- View leaderboard data in real-time
- Test WebSocket connection
- Debug API responses

### OBS Setup

1. Open admin page: http://localhost:3000/admin
2. Copy the IP address shown
3. In OBS: Add **Browser Source**
4. Paste the URL: `http://{ip}:3000`
5. Set size to screen resolution
6. Enable **Interact** checkbox
7. Click OK

## Drive Type Flags

Vehicle drive types appear as blue badges next to driver names:
- **FWD** - Front-wheel drive
- **RWD** - Rear-wheel drive  
- **AWD** - All-wheel drive
- **MR** - Mid-engine rear-wheel drive

### Troubleshooting Drive Flags

If drive types don't appear:

1. **Check .env file exists** with credentials:
   ```bash
   cat .env
   ```

2. **Check admin page console** for API errors:
   - Open http://localhost:3000/admin
   - Check browser DevTools (F12) → Console tab
   - Look for LFS API messages

3. **Verify credentials are correct** at https://lfs.net/api

4. **Check server logs** for messages like:
   ```
   ✅ LFS API initialized with credentials
   🔗 Fetching LFS API for vehicle model: XXXX
   ✅ Retrieved drive type for XXXX: RWD
   ```

## Environment Variables Reference

```env
LFS_CLIENT_ID       # Required: LFS API Client ID
LFS_CLIENT_SECRET   # Required: LFS API Client Secret
PORT                # Optional: Server port (default: 3000)
```

## Building for Distribution

Create a standalone executable:

```bash
npm run build
```

This creates `dist/sra-leaderboard.exe`

## Project Structure

```
sra-leaderboard/
├── server.js              # Main server with InSim + LFS API
├── launcher.js            # Auto-launcher script
├── start.bat              # Windows batch launcher
├── package.json           # Dependencies
├── .env                   # Your credentials (don't commit!)
├── .env.example           # Template (safe to commit)
├── README.md              # Documentation
├── SETUP.md               # This file
└── public/
    ├── index.html         # Overlay page
    ├── admin.html         # Admin dashboard
    ├── app.js             # Overlay logic
    ├── admin.js           # Admin logic
    ├── style.css          # Overlay styles
    └── admin.css          # Admin styles
```

## Troubleshooting

### Server won't start
- Check port 3000 is available
- Run `npm install` to install dependencies
- Check for errors in console

### No data in leaderboard
- Ensure LFS is running with InSim enabled
- Check InSim port 29999 is accessible
- Check server console for connection messages

### Browser can't connect
- Use your machine's IP address (from admin page)
- Check firewall allows port 3000
- Ensure server is running

### Drive flags not appearing
See "Troubleshooting Drive Flags" section above

## Support

For issues:
1. Check the admin page at http://localhost:3000/admin
2. Open browser DevTools (F12) and check Console tab
3. Look at server console output for error messages
4. Verify `.env` file has correct credentials

## Default Credentials Warning

⚠️ **NEVER share your `.env` file or credentials publicly!**

The `.env` file contains sensitive API credentials. Always:
- Add `.env` to `.gitignore`
- Keep it private
- Don't commit to repositories
- Don't share in messages/emails
