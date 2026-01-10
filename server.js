/**
 * server.js
 * - Safe MCI-only InSim connection (no NLP flag)
 * - Active, throttled name-resolve (IS_TINY TINY_NPL) only when placeholders exist
 * - Dedupe AI/PLID shadows
 * - Detect race finish by lap count and snapshot final results
 * - Broadcasts payload including: leaderboard, totalLaps, lap, fastest, raceFinished, finalResults
 */

import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import nodeInsimPkg from 'node-insim';
const { InSim } = nodeInsimPkg;

(async () => {
  const packets = await import('node-insim/packets');
  const { PacketType, InSimFlags, IS_TINY, TinyType } = packets;

  /* CONFIG */
  const HTTP_PORT = 3000;
  const INSIM_HOST = '127.0.0.1';
  const INSIM_PORT = 29999;
  const MCI_INTERVAL_MS = 100;
  const NAME_RESOLVE_INTERVAL_MS = 5000;
  const LOG_THROTTLE_MS = 10000;
  const STALE_DRIVER_MS = 30_000;
  const NAME_UPDATE_GRACE_MS = 2_000;

  /* HTTP + static */
  const app = express();
  app.use(express.static('public'));
  let lastPayload = null;
  app.get('/api/leaderboard', (req, res) => res.json(lastPayload || { info: 'no data yet' }));

  const server = http.createServer(app);
  server.listen(HTTP_PORT, () => console.log(`🌐 Overlay: http://localhost:${HTTP_PORT}`));

  /* WebSocket */
  const wss = new WebSocketServer({ server });
  const clientFocus = new Map(); // Track which PLID each client is focused on
  
  wss.on('connection', ws => {
    if (lastPayload) ws.send(JSON.stringify(lastPayload));
    ws.send(JSON.stringify({ info: 'welcome' }));
    
    // Handle focus selection from client
    ws.on('message', msg => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === 'focus') {
          clientFocus.set(ws, data.plid);
          console.log(`👁️ Client focused on PLID ${data.plid}`);
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
        c.send(JSON.stringify(payload));
      }
    }
  }

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

  /* State */
  const drivers = new Map();
  let totalLaps = 0;
  let raceFinished = false;
  let finalResults = null;
  let lastBroadcast = 0;
  const UI_UPDATE_MS = 250;
  let raceStartTime = null;

  /* Helpers */
  const safeStr = v => (v === undefined || v === null ? '' : String(v));
  const CARET_COLOR_MAP = {
    '0': '#000000','1': '#ff3333','2': '#33ff66','3': '#ffd633',
    '4': '#3399ff','5': '#ff66cc','6': '#33ffff','7': '#ffffff'
  };

  function stripCaretCodes(s) {
    if (!s) return '';
    return String(s).replace(/\^[0-9A-Fa-f]/g, '').replace(/\u0000/g, '').trim();
  }
  function extractLastCaretColor(s) {
    if (!s) return null;
    const matches = [...String(s).matchAll(/\^([0-9A-Fa-f])/g)];
    if (!matches.length) return null;
    const last = matches[matches.length - 1][1];
    return CARET_COLOR_MAP[last] ?? null;
  }
  function extractNameFromPacket(obj) {
    if (!obj) return '';
    const cands = ['PName','PNameLong','PNameShort','UName','PlayerName','Name','UserName','HName'];
    for (const k of cands) if (k in obj && obj[k]) return safeStr(obj[k]);
    return '';
  }
  function isPlaceholderName(name) {
    if (!name) return true;
    const s = name.trim();
    return /^PLID\s*\d+$/i.test(s) || /^Player\s*\d+$/i.test(s) || /^Car\s*\d+$/i.test(s);
  }
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

    for (const d of drivers.values()) {
      d.laps = 0;
      d.node = 0;
      d.prevNode = 0;
      d.position = 99;
      d.totalTime = null;
      d.fastestLapMs = null;
      d.finishTime = null;
    }

    console.log(`🔁 Race state reset ${reason ? `(${reason})` : ''}`);
  }
  

  /* Packet handlers */
  inSim.on(PacketType.ISP_VER, pkt => console.log(`✅ ISP_VER: ${pkt.Product} ${pkt.Version}`));

  inSim.on(PacketType.ISP_RACE, pkt => {
    totalLaps = pkt.RaceLaps ?? pkt.TotalLaps ?? totalLaps;
    if (totalLaps) console.log(`🏁 Race configured: totalLaps = ${totalLaps}`);
  });
  inSim.on(PacketType.ISP_STA, pkt => totalLaps = pkt.RaceLaps ?? pkt.TotalLaps ?? totalLaps);

  // IS_LAP - LAP time packet (authoritative lap completion event)
  inSim.on(PacketType.ISP_LAP, pkt => {
    const plid = pkt.PLID;
    const lapsDone = pkt.LapsDone ?? 0;
    if (drivers.has(plid)) {
      const d = drivers.get(plid);
      d.laps = lapsDone;
      
      // Start race timer on first lap
      if (lapsDone === 1 && !raceStartTime) {
        raceStartTime = Date.now();
      }
      
      // 🏁 FREEZE TIME on race finish (when driver completes all laps)
      if (totalLaps > 0 && lapsDone >= totalLaps) {
        if (!d.finishTime) {
          d.finishTime = d.totalTime ?? pkt.ETime ?? 0;
          console.log(`🏁 FINISH: ${d.name} completed race at position ${d.position} - Final Time: ${(d.finishTime / 1000).toFixed(2)}s`);
        }
      } else {
        console.log(`🏁 LAP: ${d.name} completed lap ${lapsDone} - LTime: ${(pkt.LTime / 1000).toFixed(2)}s`);
      }
      
      // Update fastest lap
      if (pkt.LTime && pkt.LTime > 0) {
        if (d.fastestLapMs === null || pkt.LTime < d.fastestLapMs) {
          d.fastestLapMs = pkt.LTime;
        }
      }
    }
  });

  // NPL authoritative name mapping
  inSim.on(PacketType.ISP_NPL, pkt => {
    const plid = pkt.PLID;
    const raw = extractNameFromPacket(pkt) || `PLID ${plid}`;
    const color = extractLastCaretColor(raw);
    const name = stripCaretCodes(raw) || `PLID ${plid}`;
    const entry = drivers.get(plid) ?? {
      plid, name, rawName: raw, color, position: 99, laps: 0, node: 0, prevNode: 0,
      totalTime: null, fastestLapMs: null, lastSeen: Date.now(), nameTs: Date.now(), finishTime: null
    };
    entry.rawName = raw; entry.color = color; entry.name = name; entry.nameTs = Date.now();
    drivers.set(plid, entry);
    console.log(`👤 NPL: ${name} (PLID ${plid})`);
  });

  inSim.on(PacketType.ISP_PLL, pkt => {
    const plid = pkt.PLID;
    if (drivers.has(plid)) {
      console.log(`👋 PLL: ${drivers.get(plid).name} (PLID ${plid})`);
      drivers.delete(plid);
    }
  });

  inSim.on(PacketType.ISP_RST, pkt => {
    totalLaps = pkt.RaceLaps ?? pkt.TotalLaps ?? 0;
    resetRaceState('ISP_RST');
  });

  inSim.on(PacketType.ISP_REO, pkt => {
    raceFinished = true;
    finalResults = pkt.PLID.map((plid, index) => {
      const d = drivers.get(plid);
      return d ? {
        position: index + 1,
        plid: d.plid,
        name: d.name,
        timeMs: d.finishTime ?? d.totalTime ?? null,
        fastestLapMs: d.fastestLapMs ?? null
      } : null;
    }).filter(Boolean);
    console.log('🏁 ISP_REO received — race officially finished');
  });

  /* MCI updates */
  let lastLogTime = 0, lastLeaderPlid = null;
  inSim.on(PacketType.ISP_MCI, packet => {
    if (!packet.Info || !Array.isArray(packet.Info) || packet.Info.length === 0) return;

    // update / create (STABLE MCI HANDLING)
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
          finishTime: null
        });
        continue;
      }
      
      const d = drivers.get(plid);
      
      // ✅ NAME UPDATE (authoritative only if real)
      if (rawFromCar && !isPlaceholderName(rawFromCar)) {
        if (isPlaceholderName(d.name) || Date.now() - d.nameTs > NAME_UPDATE_GRACE_MS) {
          d.rawName = rawFromCar;
          d.name = stripCaretCodes(rawFromCar) || d.name;
          d.color = colorFromCar || d.color;
          d.nameTs = Date.now();
        }
      }
      
      // ✅ LAP TRACKING: Use MCI Lap field as fallback
      if (currentLap > d.laps) {
        d.laps = currentLap;
      }
      
      // ✅ NODE UPDATE
      d.node = node;
      
      // ✅ POSITION IS ONLY A HINT
      d.position = position;
      
      // ✅ TOTAL TIME: Stop updating if driver has finished
      if (d.finishTime === null) {
        if (totalTime !== null && (d.totalTime === null || totalTime >= d.totalTime)) {
          d.totalTime = totalTime;
        }
      }
      
      d.prevNode = car.Node;
      d.lastSeen = Date.now();
    }

    totalLaps = packet.TotalLaps ?? packet.RaceLaps ?? totalLaps;

    // remove stale drivers
    const now = Date.now();
    for (const [plid,d] of drivers) {
      if (now - d.lastSeen > STALE_DRIVER_MS) drivers.delete(plid);
    }

    // build sorted list
    const tempList = Array.from(drivers.values()).sort((a, b) => {
      if ((a.laps ?? 0) !== (b.laps ?? 0)) return (b.laps ?? 0) - (a.laps ?? 0);
      if ((a.node ?? 0) !== (b.node ?? 0)) return (b.node ?? 0) - (a.node ?? 0);
      const ap = typeof a.position === 'number' ? a.position : 9999;
      const bp = typeof b.position === 'number' ? b.position : 9999;
      return ap - bp;
    });

    // dedupe by position+node
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

    const cleanedList = Array.from(groupedByPosNode.values()).sort((a,b)=>{
      const ap = typeof a.position === 'number' ? a.position : 9999;
      const bp = typeof b.position === 'number' ? b.position : 9999;
      if (ap !== bp) return ap-bp;
      return (a.name||'').localeCompare(b.name||'');
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

    const finalList = Array.from(nameMap.values()).sort((a,b)=>{
      const ap = typeof a.position === 'number' ? a.position : 9999;
      const bp = typeof b.position === 'number' ? b.position : 9999;
      if (ap !== bp) return ap-bp;
      return (a.name||'').localeCompare(b.name||'');
    });

    if (finalList.length === 0) return;

    const leader = finalList.find(d=>typeof d.position==='number' && d.position>0 && d.position<200) || finalList[0];
    const leaderLaps = leader.laps ?? 0;

    // Mark lapped cars
    for (const d of finalList) {
      d.lapsBehind = leader.laps - d.laps;
    }

    // RACE FINISH DETECTION
    let becameFinished = false;
    if (totalLaps > 0 && !raceFinished && leaderLaps >= totalLaps) {
      raceFinished = true;
      becameFinished = true;
      finalResults = finalList.map(d => ({
        position: d.position,
        plid: d.plid,
        name: d.name,
        timeMs: d.finishTime ?? d.totalTime ?? null,
        fastestLapMs: d.fastestLapMs ?? null
      }));
      finalResults.sort((a,b)=> (a.position||9999)-(b.position||9999));
      console.log('🏁 Race finished — snapshot final results with frozen times');
    } else if (raceFinished && (totalLaps === 0 || leaderLaps < totalLaps)) {
      raceFinished = false;
      finalResults = null;
      console.log('🔁 Race restarted/reset — live mode');
    }

    // compute session fastest
    let fastestHolder = null;
    for (const d of finalList) {
      if (d.fastestLapMs != null) {
        if (!fastestHolder || d.fastestLapMs < fastestHolder.fastestLapMs) fastestHolder = d;
      }
    }

    // build leaderboard rows
    const leaderboard = finalList.map((d, idx) => {
      let gapStr = '';
      const displayTime = d.finishTime ?? d.totalTime;
      
      if (d.plid === leader.plid) {
        gapStr = 'LEADER';
      } else if (d.lapsBehind > 0) {
        gapStr = `+${d.lapsBehind}L`;
      } else {
        const carAhead = idx > 0 ? finalList[idx - 1] : leader;
        const carAheadTime = carAhead.finishTime ?? carAhead.totalTime;
        
        if (carAheadTime != null && displayTime != null) {
          const diffSec = (displayTime - carAheadTime) / 1000;
          if (diffSec < 0.01) {
            gapStr = '+0.000';
          } else if (diffSec < 60) {
            gapStr = `+${diffSec.toFixed(3)}`;
          } else {
            const mins = Math.floor(diffSec / 60);
            const secs = (diffSec % 60).toFixed(3);
            gapStr = `+${mins}:${secs.padStart(6,'0')}`;
          }
        } else if (carAhead && carAhead.node != null && d.node != null) {
          const nodeDiff = carAhead.node - d.node;
          if (nodeDiff > 0) {
            const approxSec = nodeDiff / 10;
            gapStr = approxSec < 60 ? `+${approxSec.toFixed(1)}` : `+${Math.floor(approxSec/60)}:${String(Math.round(approxSec%60)).padStart(2,'0')}`;
          }
        }
      }
      
      return {
        plid: d.plid,
        name: d.name,
        rawName: d.rawName || d.name,
        color: d.color || null,
        position: d.position,
        laps: d.laps,
        lapsBehind: d.lapsBehind,
        node: d.node,
        totalTime: displayTime ?? null,
        gap: gapStr,
        fastestLapMs: d.fastestLapMs ?? null
      };
    });

    // Calculate race elapsed time
    const raceElapsedMs = raceStartTime ? (Date.now() - raceStartTime) : 0;

    // final payload
    const payload = {
      timestamp: Date.now(),
      lap: leaderLaps,
      totalLaps: totalLaps || 0,
      leaderboard,
      fastest: fastestHolder ? { plid: fastestHolder.plid, timeMs: fastestHolder.fastestLapMs } : null,
      raceFinished: raceFinished,
      finalResults: raceFinished ? finalResults : null,
      becameFinished: becameFinished,
      raceElapsedMs: raceElapsedMs
    };

    // throttled broadcast
    const nowUI = Date.now();
    if (nowUI - lastBroadcast > UI_UPDATE_MS || becameFinished) {
      lastBroadcast = nowUI;
      broadcast(payload);
    }

    // throttled logging
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
    } catch (err) {
      console.warn('Tiny send error (ignored):', err?.message ?? err);
    }
  }, NAME_RESOLVE_INTERVAL_MS);

  /* Shutdown */
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    try { inSim.disconnect(); } catch (e) {}
    server.close(() => process.exit(0));
  });

  console.log('✅ Server ready (HTTP + WebSocket + InSim)');
})();