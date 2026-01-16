# Distribution Package Complete

Your SRA Leaderboard app is ready to distribute!

## Package Contents

### In the `dist/` folder:
- **sra-leaderboard.exe** - Standalone application (no dependencies needed)
- **start.bat** - Double-click to launch (auto-detects IP)
- **README.md** - Instructions for users

## How to Share

### Option 1: Simple (Recommended)
Zip the entire `dist` folder and share with others:
```
sra-leaderboard/
  ├── sra-leaderboard.exe
  ├── start.bat
  └── README.md
```

Users simply:
1. Extract the zip
2. Double-click `start.bat`
3. Copy the IP shown and use it in OBS

### Option 2: Professional Installer
Create an installer with NSIS or Inno Setup (optional, more advanced)

### Option 3: Cloud
Upload to cloud storage (Google Drive, Dropbox, etc.) for easy sharing

## What's Included in the Build

✅ **Auto IP Detection** - Detects machine IP automatically  
✅ **Web UI** - Browser-based leaderboard overlay  
✅ **InSim Connection** - Connects to LFS for live data  
✅ **WebSocket Server** - Handles click events from OBS  
✅ **Standalone** - No Node.js needed, single .exe file  

## Key Features for Users

1. **Zero Configuration** - Just run and get the IP
2. **Network-Accessible** - Works across your local network
3. **OBS Ready** - Perfect for streaming with OBS
4. **Real-time Updates** - Live leaderboard with driver selection

## Testing Before Distribution

Before sending to others:

1. **Copy to a new folder** (simulate fresh install)
2. **Run start.bat** and verify:
   - IP address is shown
   - Server starts correctly
   - Browser opens to the right URL
3. **Test in OBS**:
   - Add Browser Source
   - Paste the IP URL
   - Enable "Interact"
   - Try clicking drivers

---

**Ready to distribute!** 🚀
