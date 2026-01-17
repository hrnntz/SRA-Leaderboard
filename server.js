/**
 * server.js
 * - Full server with:
 *   - lap counter + lapText
 *   - frozen race timer on finish (raceEndTime)
 *   - vehicle image & car abbreviation detection:
 *       * default cars -> /static/showroom/cars160/XXX.png   (XXX = 3-letter abbrev)
 *       * mods -> /attachment/{modId}/thumb
 *   - drives type lookup (via lfs-api if available)
 *   - exposes carImage, carAbbrev, modAttachmentId on leaderboard entries
 */

import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import nodeInsimPkg from 'node-insim';
import path from 'path';
import dotenv from 'dotenv';
import LFSAPIPkg from 'lfs-api';
import { fileURLToPath } from 'url';
const { InSim } = nodeInsimPkg;
const LFSAPI = LFSAPIPkg.default || LFSAPIPkg;

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

(async () => {
  const packets = await import('node-insim/packets');
  const { PacketType, InSimFlags, IS_TINY, TinyType, IS_SCC } = packets;

  /* CONFIG */
  const HTTP_PORT = Number(process.env.PORT || 3000);
  const HTTP_BIND_HOST = process.env.BIND_HOST || '0.0.0.0';
  const INSIM_HOST = process.env.INSIM_HOST || '127.0.0.1';
  const INSIM_PORT = Number(process.env.INSIM_PORT || 29999);
  const MCI_INTERVAL_MS = 100;
  const NAME_RESOLVE_INTERVAL_MS = 5000;
  const LOG_THROTTLE_MS = 10000;
  const STALE_DRIVER_MS = 30_000;
  const NAME_UPDATE_GRACE_MS = 2_000;
  const UI_UPDATE_MS = 250;

  /* EXPRESS */
  const app = express();
  app.use(express.json());
  app.use(express.static('public')); // serve static assets (including /car_images, if provided)

  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

  let lastPayload = null;
  app.get('/api/leaderboard', (req, res) => res.json(lastPayload || { info: 'no data yet' }));

  app.post('/camera', (req, res) => {
    const plid = Number(req.body?.plid || 0);
    if (!Number.isFinite(plid)) return res.status(400).json({ ok: false, error: 'invalid plid' });
    try {
      if (!inSim) throw new Error('InSim not initialized');
      inSim.send(new IS_SCC({ ViewPLID: plid }));
      console.log(`🎯 [HTTP] Sent IS_SCC -> ViewPLID ${plid}`);
      return res.json({ ok: true });
    } catch (err) {
      console.warn('Failed to send IS_SCC (HTTP):', err?.message ?? err);
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });

  const server = http.createServer(app);
  server.listen(HTTP_PORT, HTTP_BIND_HOST, () => {
    console.log(`🌐 Overlay: http://localhost:${HTTP_PORT}`);
  });

  /* InSim */
  const inSim = new InSim();
  console.log('🔎 Connecting to LFS InSim...');
  inSim.connect({
    Host: INSIM_HOST,
    Port: INSIM_PORT,
    IName: 'SRA Leaderboard',
    Flags: InSimFlags.ISF_MCI,
    Interval: MCI_INTERVAL_MS,
    InSimVer: 9,
  });

  /* WEBSOCKET */
  const wss = new WebSocketServer({ server });
  const clientFocus = new Map();

  wss.on('connection', ws => {
    if (lastPayload) ws.send(JSON.stringify(lastPayload));
    ws.send(JSON.stringify({ info: 'welcome' }));

    ws.on('message', msg => {
      try {
        const data = JSON.parse(msg.toString());
        if (data?.type === 'focus') {
          const plid = Number(data.plid) || 0;
          clientFocus.set(ws, plid);
          console.log(`👁️ Client focused on PLID ${plid}`);
          try {
            inSim.send(new IS_SCC({ ViewPLID: plid }));
            console.log(`🎯 Sent IS_SCC -> ViewPLID ${plid}`);
          } catch (err) {
            console.warn('Failed to send IS_SCC (WS):', err?.message ?? err);
          }
        }
      } catch (e) {
        console.warn('Invalid message from client:', e);
      }
    });

    ws.on('close', () => clientFocus.delete(ws));
  });

  function broadcast(obj) {
    lastPayload = obj;
    const json = JSON.stringify(obj);
    for (const c of wss.clients) {
      if (c.readyState === 1) {
        const focusedPLID = clientFocus.get(c);
        const payload = focusedPLID ? { ...obj, focusedPLID } : obj;
        try { c.send(JSON.stringify(payload)); } catch (_) {}
      }
    }
  }

  /* STATE */
  const drivers = new Map();
  let totalLaps = 0;
  let raceFinished = false;
  let finalResults = null;
  let lastBroadcast = 0;
  let lastLogTime = 0;
  let lastLeaderPlid = null;
  let raceStartTime = null;
  let raceEndTime = null; // freeze end timestamp
  let sessionType = 'race';

  /* LFS API (optional) */
  const CLIENT_ID = process.env.LFS_CLIENT_ID || '';
  const CLIENT_SECRET = process.env.LFS_CLIENT_SECRET || '';

  let api = null;
  const vehicleCache = new Map(); // modelId -> { drive, imageUrl, carAbbrev, modAttachmentId, imageTried }
  const driverInfoCache = new Map();

  if (CLIENT_ID && CLIENT_SECRET) {
    try {
      api = new LFSAPI(CLIENT_ID, CLIENT_SECRET);
      console.log('✅ LFS API initialized with credentials');
    } catch (err) {
      console.warn('⚠️ LFS API init failed:', err?.message ?? err);
      api = null;
    }
  } else {
    console.warn('⚠️  LFS API credentials not set. Vehicle images/drive types will be best-effort or fallback to local assets.');
  }

  /**
   * Determine if a modelId looks like a default LFS car abbreviation (3 letters).
   * Common LFS showroom images use: /static/showroom/cars160/XXX.png
   */
  function isDefaultCarAbbrev(m) {
    if (!m) return false;
    const s = String(m).trim();
    return /^[A-Za-z]{3}$/.test(s);
  }

  /**
   * Determine if a modelId looks like a mod/attachment id (numeric or numeric-ish)
   * We'll accept pure numeric strings or strings that look like an attachment ID.
   */
  function looksLikeModId(m) {
    if (!m) return false;
    const s = String(m).trim();
    // numeric or numeric with minor prefix/suffix
    return /^\d+$/.test(s) || /^m?_?\d+$/.test(s);
  }

  /**
   * Get best vehicle image + metadata:
   * - if modelId is 3 letters -> default showroom path (carAbbrev)
   * - if modelId looks numeric -> attachment thumb (/attachment/{id}/thumb) and set modAttachmentId
   * - else try LFS API fields defensively
   * Returns: { imageUrl, carAbbrev, modAttachmentId }
   */
  async function getVehicleImageInfo(modelId) {
    if (!modelId) return { imageUrl: null, carAbbrev: null, modAttachmentId: null };
    const key = String(modelId);
    if (vehicleCache.has(key) && vehicleCache.get(key).imageTried) {
      const cached = vehicleCache.get(key);
      return { imageUrl: cached.imageUrl || null, carAbbrev: cached.carAbbrev || null, modAttachmentId: cached.modAttachmentId || null };
    }

    let carAbbrev = null;
    let modAttachmentId = null;
    let imageUrl = null;

    // 1) fast path: default car abbreviation 3 letters
    if (isDefaultCarAbbrev(modelId)) {
      carAbbrev = String(modelId).toUpperCase();
      imageUrl = `/static/showroom/cars160/${carAbbrev}.png`;
    } else if (looksLikeModId(modelId)) {
      // treat as mod attachment id
      // prefer numeric digits only
      const s = String(modelId).replace(/^m_?/i, '').replace(/[^0-9]/g, '');
      if (s) {
        modAttachmentId = s;
        imageUrl = `https://www.lfs.net/attachment/{id}/thumb`;
      }
    }

    // 2) If not found yet, try LFS API (defensive)
    if (!imageUrl && api) {
      try {
        const res = await api.getVehicleMod(modelId);
        const vehicleData = res?.data || res;
        const v = vehicleData?.vehicle || vehicleData;
        // attempt to find image fields
        const candidates = [];

        // If LFS API gives a code/abbrev field, use it
        if (!carAbbrev) {
          const maybeCode = v?.code || v?.abbr || v?.shortName || v?.abbrev || v?.model;
          if (maybeCode && isDefaultCarAbbrev(maybeCode)) {
            carAbbrev = String(maybeCode).toUpperCase();
            imageUrl = `/static/showroom/cars160/${carAbbrev}.png`;
          }
        }

        // Search common image fields
        if (v) {
          if (v.thumb) candidates.push(v.thumb);
          if (v.thumbnail) candidates.push(v.thumbnail);
          if (v.image) candidates.push(v.image);
          if (v.imageUrl) candidates.push(v.imageUrl);
          if (v.images && Array.isArray(v.images)) candidates.push(...v.images.filter(Boolean));
          if (v.media && Array.isArray(v.media)) for (const m of v.media) { if (m.url) candidates.push(m.url); if (m.image) candidates.push(m.image); }
          // some APIs provide attachments or mod id
          if (v.attachment_id || v.attachmentId || v.attach) candidates.push(`/attachment/${v.attachment_id || v.attachmentId || v.attach}/thumb`);
          if (v.modid || v.modId) {
            const s = String(v.modid || v.modId).replace(/^m_?/i, '').replace(/[^0-9]/g, '');
            if (s) { modAttachmentId = s; candidates.push(`https://www.lfs.net/attachment/${id}/thumb`); }
          }
        }

        for (const c of candidates) {
          if (!c) continue;
          const s = String(c);
          if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('/')) {
            imageUrl = s;
            break;
          }
        }
      } catch (err) {
        // ignore, fallback below
      }
    }

    // 3) Fallback: local public/car_images/{modelId}.png or public/car_images/{key}.png
    if (!imageUrl) {
      // if we have carAbbrev use showroom path; if modAttachmentId use attachment path, else try local car_images
      if (carAbbrev) {
        imageUrl = `/static/showroom/cars160/${carAbbrev}.png`;
      } else if (modAttachmentId) {
        imageUrl = `https://www.lfs.net/attachment/${modAttachmentId}/thumb`;
      } else {
        // try a local fallback folder (optional)
        imageUrl = `/car_images/${key}.png`;
      }
    }

    vehicleCache.set(key, { imageUrl, carAbbrev, modAttachmentId, imageTried: true, drive: vehicleCache.get(key)?.drive ?? null });
    return { imageUrl, carAbbrev, modAttachmentId };
  }

  async function getVehicleDriveType(modelId) {
    if (!api || !modelId) return null;
    const key = String(modelId);
    if (vehicleCache.has(key) && vehicleCache.get(key).drive !== undefined) return vehicleCache.get(key).drive || null;
    try {
      const { data: vehicleData } = await api.getVehicleMod(modelId);
      const v = vehicleData?.vehicle || vehicleData;
      if (v && typeof api.lookupVehicleDriveType === 'function') {
        const driveType = api.lookupVehicleDriveType(v.drive ?? v.driveType ?? null);
        const current = vehicleCache.get(key) || {};
        current.drive = driveType;
        vehicleCache.set(key, current);
        return driveType;
      }
    } catch (err) {
      // ignore
    }
    const current = vehicleCache.get(key) || {};
    current.drive = null;
    vehicleCache.set(key, current);
    return null;
  }

  /* HELPERS */
  const safeStr = v => (v === undefined || v === null ? '' : String(v));
  const CARET_COLOR_MAP = { '0': '#000000','1': '#ff3333','2': '#33ff66','3': '#ffd633','4': '#3399ff','5': '#ff66cc','6': '#33ffff','7': '#ffffff' };
  function stripCaretCodes(s) { if (!s) return ''; return String(s).replace(/\^[0-9A-Fa-f]/g, '').replace(/\u0000/g, '').trim(); }
  function extractLastCaretColor(s) { if (!s) return null; const matches = [...String(s).matchAll(/\^([0-9A-Fa-f])/g)]; if (!matches.length) return null; const last = matches[matches.length - 1][1]; return CARET_COLOR_MAP[last] ?? null; }
  function extractNameFromPacket(obj) { if (!obj) return ''; const cands = ['PName','PNameLong','PNameShort','UName','PlayerName','Name','UserName','HName']; for (const k of cands) if (k in obj && obj[k]) return safeStr(obj[k]); return ''; }
  function isPlaceholderName(name) { if (!name) return true; const s = name.trim(); return /^PLID\s*\d+$/i.test(s) || /^Player\s*\d+$/i.test(s) || /^Car\s*\d+$/i.test(s); }
  function isPLIDShadow(name) { if (!name) return false; return /^PLID\s*\d+$/i.test(String(name).trim()); }
  function isAIName(name) { if (!name) return false; return /^AI\s*\d+/i.test(String(name).trim()); }
  function normalizeKey(name) { return (name || '').trim().toLowerCase(); }
  function chooseBetterEntry(a,b) {
    const aPlace = isPlaceholderName(a.name), bPlace = isPlaceholderName(b.name);
    if (aPlace && !bPlace) return b;
    if (bPlace && !aPlace) return a;
    const aPosValid = typeof a.position === 'number' && a.position>0 && a.position<200;
    const bPosValid = typeof b.position === 'number' && b.position>0 && b.position<200;
    if (aPosValid && bPosValid) return a.position <= b.position ? a : b;
    if (aPosValid) return a; if (bPosValid) return b;
    if ((a.totalTime ?? null) !== null && (b.totalTime ?? null) === null) return a;
    if ((b.totalTime ?? null) !== null && (a.totalTime ?? null) === null) return b;
    return a;
  }

  function resetRaceState(reason = '') {
    raceFinished = false;
    finalResults = null;
    raceStartTime = null;
    raceEndTime = null;
    for (const d of drivers.values()) {
      d.laps = 0; d.node = 0; d.prevNode = 0; d.position = 99; d.totalTime = null; d.fastestLapMs = null; d.finishTime = null; d.lastSeen = Date.now();
    }
    console.log(`🔁 Race state reset ${reason ? `(${reason})` : ''}`);
  }

  inSim.on(PacketType.ISP_VER, pkt => console.log(`✅ ISP_VER: ${pkt.Product} ${pkt.Version}`));

  inSim.on(PacketType.ISP_RACE, pkt => {
    totalLaps = pkt.RaceLaps ?? pkt.TotalLaps ?? totalLaps;
    sessionType = totalLaps > 0 ? 'race' : 'qualy';
    if (totalLaps) console.log(`🏁 Race configured: totalLaps = ${totalLaps}`);
  });

  inSim.on(PacketType.ISP_STA, pkt => {
    totalLaps = pkt.RaceLaps ?? pkt.TotalLaps ?? totalLaps;
    sessionType = totalLaps > 0 ? 'race' : 'qualy';
    resetRaceState('ISP_STA');
  });

  inSim.on(PacketType.ISP_LAP, pkt => {
    const plid = pkt.PLID;
    const lapsDone = pkt.LapsDone ?? 0;
    if (drivers.has(plid)) {
      const d = drivers.get(plid);
      d.laps = lapsDone;
      if (lapsDone === 1 && !raceStartTime) raceStartTime = Date.now();
      if (totalLaps > 0 && lapsDone >= totalLaps) {
        if (!d.finishTime) {
          d.finishTime = d.totalTime ?? pkt.ETime ?? 0;
          console.log(`🏁 FINISH: ${d.name} completed race at position ${d.position} - Final Time: ${(d.finishTime / 1000).toFixed(2)}s`);
        }
      }
      if (pkt.LTime && pkt.LTime > 0) {
        if (d.fastestLapMs === null || pkt.LTime < d.fastestLapMs) d.fastestLapMs = pkt.LTime;
      }
      d.lastSeen = Date.now();
    }
  });

  inSim.on(PacketType.ISP_NPL, pkt => {
    const plid = pkt.PLID;
    const raw = extractNameFromPacket(pkt) || `PLID ${plid}`;
    const color = extractLastCaretColor(raw);
    const name = stripCaretCodes(raw) || `PLID ${plid}`;
    const modelId = pkt.Model || pkt.CarModel || pkt.CarType || null;

    const entry = drivers.get(plid) ?? {
      plid,
      name,
      rawName: raw,
      color,
      position: 99,
      laps: 0,
      node: 0,
      prevNode: 0,
      totalTime: null,
      fastestLapMs: null,
      lastSeen: Date.now(),
      nameTs: Date.now(),
      finishTime: null,
      modelId: modelId,
      driveType: null,
      driveTypeFetched: false,
      driverInfoFetched: false,
      countryCode: null,
      flagUrl: null,
      carImage: null,
      carImageFetched: false,
      carAbbrev: null,
      modAttachmentId: null
    };
    entry.rawName = raw; entry.color = color; entry.name = name; entry.nameTs = Date.now();
    if (modelId) entry.modelId = modelId;
    drivers.set(plid, entry);
    if (modelId) console.log(`👤 NPL: ${name} (PLID ${plid}) - Vehicle: ${modelId}`);
  });

  inSim.on(PacketType.ISP_PLL, pkt => {
    const plid = pkt.PLID;
    if (drivers.has(plid)) drivers.delete(plid);
  });

  inSim.on(PacketType.ISP_RST, pkt => {
    totalLaps = pkt.RaceLaps ?? pkt.TotalLaps ?? 0;
    resetRaceState('ISP_RST');
  });

  // ISP_REO: try to snapshot final results + carImages if available
  inSim.on(PacketType.ISP_REO, pkt => {
    raceFinished = true;
    raceEndTime = Date.now();
    finalResults = pkt.PLID.map((plid,index) => {
      const d = drivers.get(plid);
      return d ? { position: index+1, plid: d.plid, name: d.name, timeMs: d.finishTime ?? d.totalTime ?? null, fastestLapMs: d.fastestLapMs ?? null, carImage: d.carImage || null, carAbbrev: d.carAbbrev || null, modAttachmentId: d.modAttachmentId || null } : null;
    }).filter(Boolean);
    finalResults.sort((a,b)=> (a.position||9999)-(b.position||9999));
    console.log('🏁 ISP_REO received — race officially finished (REO)');
  });

  /* MCI handler (main) */
  inSim.on(PacketType.ISP_MCI, async packet => {
    if (!packet.Info?.length) return;

    // Update drivers from MCI info
    for (const car of packet.Info) {
      const plid = car.PLID;
      const rawFromCar = extractNameFromPacket(car);
      const colorFromCar = extractLastCaretColor(rawFromCar);
      const currentLap = typeof car.Lap === 'number' ? car.Lap : 0;
      const node = typeof car.Node === 'number' ? car.Node : 0;
      const position = typeof car.Position === 'number' ? car.Position : 99;
      const totalTime = typeof car.TotalTime === 'number' ? car.TotalTime : null;

      if (!drivers.has(plid)) {
        const raw = rawFromCar || `PLID ${plid}`;
        drivers.set(plid, {
          plid,
          rawName: raw,
          name: stripCaretCodes(raw) || `PLID ${plid}`,
          color: colorFromCar,
          position,
          laps: currentLap,
          node,
          prevNode: node,
          totalTime,
          fastestLapMs: null,
          lastSeen: Date.now(),
          nameTs: rawFromCar ? Date.now() : 0,
          finishTime: null,
          modelId: null,
          driveType: null,
          driveTypeFetched: false,
          driverInfoFetched: false,
          countryCode: null,
          flagUrl: null,
          carImage: null,
          carImageFetched: false,
          carAbbrev: null,
          modAttachmentId: null
        });
        continue;
      }

      const d = drivers.get(plid);

      if (rawFromCar && !isPlaceholderName(rawFromCar)) {
        if (isPlaceholderName(d.name) || Date.now() - d.nameTs > NAME_UPDATE_GRACE_MS) {
          d.rawName = rawFromCar;
          d.name = stripCaretCodes(rawFromCar) || d.name;
          d.color = colorFromCar || d.color;
          d.nameTs = Date.now();
        }
      }

      if (currentLap > d.laps) d.laps = currentLap;
      d.node = node;
      d.position = position;
      if (d.finishTime === null) {
        if (totalTime !== null && (d.totalTime === null || totalTime >= d.totalTime)) d.totalTime = totalTime;
      }
      d.prevNode = car.Node;
      d.lastSeen = Date.now();

      // If MCI packet contains a model id (some versions put Model in MCI), capture it
      const modelIdFromMci = car.Model || car.CarModel || car.CarType || null;
      if (modelIdFromMci) d.modelId = modelIdFromMci;
    }

    totalLaps = packet.TotalLaps ?? packet.RaceLaps ?? totalLaps;

    // cleanup stale
    const now = Date.now();
    for (const [plid,d] of drivers) {
      if (now - d.lastSeen > STALE_DRIVER_MS) drivers.delete(plid);
    }

    // sort + dedupe (session aware) - intermediate
    const tempList = Array.from(drivers.values()).sort((a,b) => {
      if (sessionType === 'qualy') {
        const aTime = a.fastestLapMs == null ? Infinity : a.fastestLapMs;
        const bTime = b.fastestLapMs == null ? Infinity : b.fastestLapMs;
        return aTime - bTime;
      }
      if ((a.laps ?? 0) !== (b.laps ?? 0)) return (b.laps ?? 0) - (a.laps ?? 0);
      if ((a.node ?? 0) !== (b.node ?? 0)) return (b.node ?? 0) - (a.node ?? 0);
      const ap = typeof a.position === 'number' ? a.position : 9999;
      const bp = typeof b.position === 'number' ? b.position : 9999;
      return ap - bp;
    });

    // dedupe by pos+node
    const groupedByPosNode = new Map();
    for (const d of tempList) {
      const pos = typeof d.position === 'number' ? d.position : 9999;
      const node = typeof d.node === 'number' ? d.node : -1;
      const key = `${pos}:${node}`;
      if (!groupedByPosNode.has(key)) groupedByPosNode.set(key, d);
      else {
        const existing = groupedByPosNode.get(key);
        if (isAIName(existing.name) && isPLIDShadow(d.name)) continue;
        if (isAIName(d.name) && isPLIDShadow(existing.name)) { groupedByPosNode.set(key, d); continue; }
        groupedByPosNode.set(key, chooseBetterEntry(existing, d));
      }
    }

    const cleanedList = Array.from(groupedByPosNode.values()).sort((a,b) => {
      const ap = typeof a.position === 'number' ? a.position : 9999;
      const bp = typeof b.position === 'number' ? b.position : 9999;
      if (ap !== bp) return ap - bp;
      return (a.name || '').localeCompare(b.name || '');
    });

    // dedupe by normalized name
    const nameMap = new Map();
    for (const d of cleanedList) {
      const k = normalizeKey(d.name);
      if (!k) nameMap.set(`plid:${d.plid}`, d);
      else {
        if (!nameMap.has(k)) nameMap.set(k, d);
        else nameMap.set(k, chooseBetterEntry(nameMap.get(k), d));
      }
    }

    const finalList = Array.from(nameMap.values()).sort((a,b) => {
      if (sessionType === 'qualy') {
        const aTime = a.fastestLapMs == null ? Infinity : a.fastestLapMs;
        const bTime = b.fastestLapMs == null ? Infinity : b.fastestLapMs;
        if (aTime !== bTime) return aTime - bTime;
      } else {
        if ((a.laps ?? 0) !== (b.laps ?? 0)) return (b.laps ?? 0) - (a.laps ?? 0);
        if ((a.node ?? 0) !== (b.node ?? 0)) return (b.node ?? 0) - (a.node ?? 0);
      }
      const ap = typeof a.position === 'number' ? a.position : 9999;
      const bp = typeof b.position === 'number' ? b.position : 9999;
      if (ap !== bp) return ap - bp;
      return (a.name || '').localeCompare(b.name || '');
    });

    if (finalList.length === 0) return;

    // Concurrently fetch drive types and car images (bounded)
    await Promise.all(finalList.map(async (d) => {
      if (d.modelId && !d.driveTypeFetched) {
        try { d.driveType = await getVehicleDriveType(d.modelId); } catch (err) { d.driveType = null; }
        d.driveTypeFetched = true;
        if (d.driveType) console.log(`🚗 Fetched drive type for ${d.name} (${d.modelId}): ${d.driveType}`);
      }
      if (d.modelId && !d.carImageFetched) {
        try {
          const info = await getVehicleImageInfo(d.modelId);
          d.carImage = info.imageUrl || null;
          d.carAbbrev = info.carAbbrev || null;
          d.modAttachmentId = info.modAttachmentId || null;
        } catch (err) {
          d.carImage = `/car_images/${String(d.modelId)}`; // last resort
        }
        d.carImageFetched = true;
      }
    }));

    // leader selection
    const leader = sessionType === 'qualy'
      ? (finalList.find(d => d.fastestLapMs != null) || finalList[0])
      : (finalList.find(d => { const hasValidPos = typeof d.position === 'number' && d.position > 0 && d.position < 200; const isMoving = (d.node ?? 0) > 0 || (d.laps ?? 0) > 0; return hasValidPos && isMoving; }) || finalList[0]);

    const leaderLaps = sessionType === 'race' ? (leader.laps ?? 0) : 0;

    for (const d of finalList) d.lapsBehind = (leader.laps ?? 0) - (d.laps ?? 0);



    // fastest holder
    let fastestHolder = null;
    for (const d of finalList) {
      if (d.fastestLapMs != null) {
        if (!fastestHolder || d.fastestLapMs < fastestHolder.fastestLapMs) fastestHolder = d;
      }
    }

    // build leaderboard (include carImage, carAbbrev, modAttachmentId)
    const leaderboard = finalList.map((d, idx) => {
      let gapStr = '';
      if (sessionType === 'qualy') {
        if (d.plid === leader.plid) gapStr = 'P1';
        else if (leader.fastestLapMs != null && d.fastestLapMs != null) {
          const diff = (d.fastestLapMs - leader.fastestLapMs) / 1000;
          gapStr = diff >= 60 ? `+${Math.floor(diff/60)}:${String((diff%60).toFixed(3)).padStart(6,'0')}` : `+${diff.toFixed(3)}`;
        } else gapStr = '';
      } else {
        const displayTime = d.finishTime ?? d.totalTime;
        if (d.plid === leader.plid) gapStr = 'LEADER';
        else if (d.lapsBehind > 0) gapStr = `+${d.lapsBehind}L`;
        else {
          const carAhead = idx > 0 ? finalList[idx - 1] : leader;
          const carAheadTime = carAhead.finishTime ?? carAhead.totalTime;
          if (carAheadTime != null && displayTime != null) {
            const diffSec = (displayTime - carAheadTime) / 1000;
            if (diffSec < 0.01) gapStr = '+0.000';
            else if (diffSec < 60) gapStr = `+${diffSec.toFixed(3)}`;
            else { const mins = Math.floor(diffSec/60); const secs = (diffSec%60).toFixed(3); gapStr = `+${mins}:${secs.padStart(6,'0')}`; }
          } else if (carAhead && carAhead.node != null && d.node != null) {
            const nodeDiff = carAhead.node - d.node;
            if (nodeDiff > 0) { const approxSec = nodeDiff / 10; gapStr = approxSec < 60 ? `+${approxSec.toFixed(1)}` : `+${Math.floor(approxSec/60)}:${String(Math.round(approxSec%60)).padStart(2,'0')}`; }
          }
        }
      }

      return {
        plid: d.plid,
        name: d.name,
        rawName: d.rawName || d.name,
        color: d.color || null,
        position: d.position ?? (idx+1),
        laps: d.laps,
        lapsBehind: d.lapsBehind,
        node: d.node,
        totalTime: d.finishTime ?? d.totalTime ?? null,
        gap: gapStr,
        fastestLapMs: d.fastestLapMs ?? null,
        driveType: d.driveType || null,
        countryCode: d.countryCode || null,
        flagUrl: d.flagUrl || null,
        carImage: d.carImage || null,
        carAbbrev: d.carAbbrev || null,
        modAttachmentId: d.modAttachmentId || null
      };
    });

    const raceElapsedMs = raceStartTime
      ? (raceFinished && raceEndTime ? (raceEndTime - raceStartTime) : (Date.now() - raceStartTime))
      : 0;

    const lapText = totalLaps > 0 ? `LAP ${leaderLaps} / ${totalLaps}` : (sessionType === 'qualy' ? 'QUALIFYING' : `LAP ${leaderLaps}`);

    // podium images from finalResults (top 3) when finished
    const podiumImages = raceFinished && finalResults ? finalResults.slice(0,3).map(r => r.carImage || null) : null;

    const payload = {
      timestamp: Date.now(),
      sessionType,
      lap: leaderLaps,
      totalLaps: totalLaps || 0,
      lapText,
      leader: leader ? { plid: leader.plid, name: leader.name, carImage: leader.carImage || null, carAbbrev: leader.carAbbrev || null, modAttachmentId: leader.modAttachmentId || null } : null,
      leaderboard,
      fastest: fastestHolder ? { plid: fastestHolder.plid, timeMs: fastestHolder.fastestLapMs } : null,
      raceFinished,
      finalResults: raceFinished ? finalResults : null,
      becameFinished,
      raceElapsedMs,
      podiumImages
    };

    const nowUI = Date.now();
    if (nowUI - lastBroadcast > UI_UPDATE_MS || becameFinished) {
      lastBroadcast = nowUI;
      broadcast(payload);
    }

    const now2 = Date.now();
    if (leader.plid !== lastLeaderPlid || now2 - lastLogTime > LOG_THROTTLE_MS || becameFinished) {
      lastLeaderPlid = leader.plid;
      lastLogTime = now2;
      console.log(`📡 MCI | drivers known: ${drivers.size} | leader: ${leader.name} (#${leader.position}) lap ${leaderLaps}/${totalLaps} | raceFinished: ${raceFinished}`);
    }
  });

  /* Active name-resolve */
  let tinyReqCounter = 1;
  setInterval(() => {
    try {
      const hasPlaceholders = Array.from(drivers.values()).some(d => isPlaceholderName(d.name));
      if (!hasPlaceholders) return;
      inSim.send(new IS_TINY({ ReqI: tinyReqCounter++ % 255 || 1, SubT: TinyType.TINY_NPL }));
    } catch (err) { /* ignore */ }
  }, NAME_RESOLVE_INTERVAL_MS);

  /* Shutdown handling */
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    try { inSim.disconnect(); } catch (e) {}
    server.close(() => process.exit(0));
  });

  console.log('✅ Server ready (HTTP + WebSocket + InSim)');
})();
