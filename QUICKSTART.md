# Quick Start

## 1️⃣ Get LFS API Credentials

Go to https://lfs.net/api and create an application to get:
- **Client ID**
- **Client Secret**

## 2️⃣ Edit `.env` File

Open `.env` in the project root and paste your credentials:

```env
LFS_CLIENT_ID=paste_your_id_here
LFS_CLIENT_SECRET=paste_your_secret_here
```

## 3️⃣ Run the Launcher

### Windows:
```bash
start.bat
```

### All Platforms:
```bash
npm launch
```

This will:
✅ Install dependencies (if needed)
✅ Open the leaderboard overlay in your browser
✅ Open the admin page
✅ Start the server

## 4️⃣ Set Up OBS

1. Open the **admin page** (should open automatically)
2. **Copy the IP address** shown
3. In OBS: Add **Browser Source**
4. Paste the IP: `http://{copied-ip}:3000`
5. Set **Width**: 1920, **Height**: 1080 (or your stream resolution)
6. Enable **Interact** checkbox
7. Click OK

## 5️⃣ Verify Drive Flags

Once LFS is running with drivers:
- You should see **blue drive badges** next to driver names (FWD, RWD, AWD, etc.)
- If not appearing, check the **admin page console** for errors

## Troubleshooting

**Flags not showing?**
- Verify `.env` file has your credentials
- Check admin page console (F12 → Console)
- Restart the server

**Can't connect from OBS?**
- Use the IP from the admin page
- Make sure firewall allows port 3000

**Server won't start?**
- Run `npm install` first
- Check that port 3000 is available

---

👉 **Full documentation:** See [SETUP.md](SETUP.md)
