# SRA Leaderboard with LFS API Integration

A real-time leaderboard overlay for LFS races with driver information including vehicle drive types from the LFS API.

## Features

✅ **Real-time leaderboard** from LFS InSim  
✅ **Vehicle drive type flags** (FWD, RWD, AWD, etc.) using LFS API  
✅ **Driver selection** with focus panel  
✅ **Admin page** for debugging and OBS setup  
✅ **WebSocket updates** for live changes  
✅ **OBS-friendly** transparent overlay  

## Setup

### 1. Get LFS API Credentials

1. Go to [https://lfs.net/api](https://lfs.net/api)
2. Log in or create an account
3. Create a new application
4. Copy your **Client ID** and **Client Secret**

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```env
LFS_CLIENT_ID=your_client_id_here
LFS_CLIENT_SECRET=your_client_secret_here
```

**Important:** Keep the `.env` file private and don't commit it to version control!

### 3. Install Dependencies

```bash
npm install
```

### 4. Run the Server

```bash
npm start
```

The server will start on `http://localhost:3000`

## Usage

### Leaderboard Overlay

1. Open **http://localhost:3000** in your browser (or your machine IP)
2. Click on drivers to focus on them
3. Add the URL to OBS as a **Browser Source**

### Admin Page

1. Open **http://localhost:3000/admin**
2. View the leaderboard payload
3. Copy IP address for OBS
4. Debug WebSocket connection

### Drive Type Badges

Drive types from the LFS API appear as small blue badges next to driver names:

- **FWD** - Front-wheel drive
- **RWD** - Rear-wheel drive
- **AWD** - All-wheel drive
- **MR** - Mid-engine rear-wheel drive

Badges are cached for performance.

## Environment Variables

```env
LFS_CLIENT_ID        # Your LFS API Client ID
LFS_CLIENT_SECRET    # Your LFS API Client Secret
PORT                 # Server port (default: 3000)
```

## Development

Start in development mode:

```bash
npm run dev
```

## Building for Distribution

Create a standalone executable:

```bash
npm run build
```

This creates an `.exe` file in the `dist/` folder.

## Troubleshooting

### Drive types not showing
- Verify `.env` file exists with correct credentials
- Check admin page console for API errors
- Ensure LFS.net API is accessible
- Vehicle cache will store successful lookups

### No connection to LFS
- Ensure LFS is running with InSim enabled
- Check that InSim port 29999 is accessible
- Look at server console for connection messages

### OBS Browser Source not updating
- Enable "Interact" in OBS source settings
- Check that server IP is correct
- Verify firewall allows port 3000

## Architecture

- **server.js** - Express server with InSim connection and LFS API integration
- **public/app.js** - Leaderboard UI with WebSocket updates
- **public/admin.js** - Admin dashboard for debugging
- **node-insim** - LFS InSim connection
- **lfs-api** - Official LFS REST API client

## License

MIT
