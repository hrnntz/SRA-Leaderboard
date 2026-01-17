# Troubleshooting Checklist

## ❌ Drive Flags Not Showing

### Step 1: Verify .env File
```bash
cat .env
```

**Should show:**
```
LFS_CLIENT_ID=abc123...
LFS_CLIENT_SECRET=xyz789...
```

**If empty or missing:**
- Get credentials from https://lfs.net/api
- Edit `.env` file with your credentials
- Restart the server

### Step 2: Check Server Logs
When the server starts, look for:
```
✅ LFS API initialized with credentials
```

**If you see:** "LFS API credentials not set"
- Your `.env` file is not being read
- Make sure `.env` is in the project root directory
- Restart the server

### Step 3: Verify Vehicle Model ID is Captured
Watch the server logs while racing:
```
🔍 DEBUG - PLID 1: Available car properties: [...]
```

**If no debug output:**
- Check that cars are actually on track
- Verify InSim connection is active
- Check InSim port 29999 is accessible

### Step 4: Check LFS API Calls
Watch logs for:
```
🔗 Fetching LFS API for vehicle model: FXO
✅ Retrieved drive type for FXO: RWD
```

**If you see API errors:**
- Verify your credentials at https://lfs.net/api
- Check internet connection
- Check that LFS API is accessible

### Step 5: Check Browser Console
Open admin page: http://localhost:3000/admin

1. Press **F12** (or right-click → Inspect)
2. Go to **Console** tab
3. Look for error messages

**Common errors:**
- `CORS error` - Server not responding
- `driveType is undefined` - API not returning data
- Connection errors - Server not running

### Step 6: Check Payload Data
Visit admin page and look at "Latest Payload":
- Expand the leaderboard array
- Check if `driveType` field exists
- It should contain the drive type or `null` if not fetched yet

---

## ❌ Server Won't Start

### Check Port 3000 is Available
```bash
netstat -an | find "3000"
```

If port is in use:
```bash
set PORT=3001
npm start
```

### Check Dependencies
```bash
npm install
npm start
```

### Check for Errors
```bash
node server.js
```

Look for error messages about:
- Missing modules
- Invalid syntax
- Port already in use
- InSim connection

---

## ❌ Can't Connect from OBS

### Verify Server is Running
Open http://localhost:3000 in browser
- Should show the leaderboard overlay
- Check browser console for errors

### Use Correct IP Address
From admin page, copy the IP address:
- **NOT** localhost
- **NOT** 127.0.0.1
- Use the actual machine IP (like 192.168.x.x)

### Check Firewall
Windows Firewall might block port 3000:
1. Open Windows Defender Firewall → Advanced Settings
2. Inbound Rules → New Rule
3. Port → TCP → 3000 → Allow → Next → Finish

### Verify OBS Settings
In OBS Browser Source:
- URL: `http://{your-ip}:3000`
- Width: 1920 (or your resolution)
- Height: 1080 (or your resolution)
- ✅ **Enable Interact** checkbox

---

## ❌ No Data in Leaderboard

### Verify LFS is Running
Check server console for:
```
✅ ISP_VER: LFS [version]
📡 MCI | drivers known: 3
```

### Check InSim Connection
- LFS must be running
- InSim must be enabled in LFS
- InSim port 29999 must be accessible
- No firewall blocking 127.0.0.1:29999

### Verify Drivers on Track
- Put at least one car on track in LFS
- Data should appear within 1 second

---

## ❌ Intermittent Issues

### Restart Everything
1. Stop the server (Ctrl+C)
2. Stop LFS
3. Wait 5 seconds
4. Start LFS
5. Start the server
6. Refresh browser

### Check Connection Stability
- Watch server console for `MCI` updates
- Should see frequent updates (every 100ms)
- If sporadic, check:
  - Network connectivity
  - LFS InSim settings
  - Firewall rules

---

## 📋 Debug Checklist

Before asking for help:

- [ ] `.env` file exists with credentials
- [ ] Credentials are valid (from lfs.net)
- [ ] `npm install` completed successfully
- [ ] Server shows "LFS API initialized"
- [ ] LFS is running with cars on track
- [ ] Admin page opens (http://localhost:3000/admin)
- [ ] Browser console (F12) shows no errors
- [ ] Server console shows MCI updates
- [ ] Port 3000 is not blocked by firewall
- [ ] Using correct IP address (not localhost) for OBS

---

## 🆘 Getting Help

**Share these when asking for help:**

1. **What you see:** No badges, error messages, blank screen, etc.
2. **Server console output:** Screenshot or paste
3. **Browser console errors:** F12 → Console tab
4. **Admin page payload:** View Latest Payload section
5. **System info:** Windows version, network setup

---

## 📞 Support Resources

- **LFS API Docs:** https://lfs.net/api
- **LFS Forum:** https://forum.lfs.net
- **GitHub Issues:** (if applicable)
- **Discord:** (if applicable)

---

## 💡 Pro Tips

1. **Keep .env file safe** - Don't share credentials
2. **Monitor logs** - Errors are always logged
3. **Use admin page** - Most debugging info is there
4. **Restart is magic** - Often fixes intermittent issues
5. **One change at a time** - Makes it easier to debug

---

**Last Updated:** January 2026
