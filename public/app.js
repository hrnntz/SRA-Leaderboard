  // =========================
  // public/app.js (fixed + car image + podium)
  // =========================

  /*
    - Computes live gap to P1 from the live leaderboard payload (lastPayloadData)
    - Shows focused driver's car image (driver.carImage)
    - Shows car abbreviation / modAttachmentId badge when available
    - Shows podium overlay on race finish using payload.podiumImages and payload.finalResults
    - Highlights the driver who has the fastest lap (purple pos + glow)
    - Keeps lap pill text from server (data.lapText)
    - Persists selected driver in localStorage
  */

  const board = document.getElementById('board');
  const lapPill = document.getElementById('lap-pill');
  const focusPos = document.getElementById('focus-pos');
  const focusName = document.getElementById('focus-name');
  const focusGapLabel = document.getElementById('focus-gap-label');
  const focusGapValue = document.getElementById('focus-gap-value');
  const focusCarNumber = document.getElementById('focus-car-number'); // may be null if not present
  const focusPanel = document.getElementById('focus-panel');
  const focusFlagContainer = document.getElementById('focus-flag-container'); // will be used for car image

  const wsUrl = `ws://${location.host}`;
  console.log(`📡 WebSocket URL: ${wsUrl}`);
  const ws = new WebSocket(wsUrl);

  const lastPositions = new Map();
  let lastPayloadData = null;
  let selectedPlid = null;
  let lastSelectedDriver = null;

  // Podium overlay DOM (created lazily)
  let podiumOverlay = null;

  try {
    const saved = localStorage.getItem('selectedDriver');
    if (saved) {
      const parsed = JSON.parse(saved);
      selectedPlid = parsed.plid;
      lastSelectedDriver = parsed;
      console.log(`♻️ Restored selected driver: ${parsed.name} (PLID ${parsed.plid})`);
    }
  } catch (e) {
    console.warn('Could not restore from localStorage:', e);
  }

  function escapeHtml(s) {
    return (s + '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function ensurePodiumOverlay() {
    if (podiumOverlay) return podiumOverlay;
    const ov = document.createElement('div');
    ov.id = 'podium-overlay';
    // minimal inline style so we don't change external CSS file
    Object.assign(ov.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '9999',
      pointerEvents: 'none',
      // a soft transparent dark backdrop to make images pop
      background: 'rgba(0,0,0,0.35)'
    });

    const inner = document.createElement('div');
    inner.id = 'podium-inner';
    Object.assign(inner.style, {
      display: 'flex',
      gap: '24px',
      alignItems: 'flex-end',
      justifyContent: 'center',
      pointerEvents: 'auto'
    });

    ov.appendChild(inner);
    document.body.appendChild(ov);
    podiumOverlay = ov;
    return ov;
  }

  function showPodium(images = [], finalResults = []) {
    const ov = ensurePodiumOverlay();
    const inner = document.getElementById('podium-inner');
    inner.innerHTML = ''; // clear

    // Build up to 3 cards (1st center, 2nd left, 3rd right)
    // We'll order: [2nd, 1st, 3rd] visually to match common podium layout
    const orderIdx = [1, 0, 2]; // indexes into finalResults/images
    for (let slot = 0; slot < 3; slot++) {
      const idx = orderIdx[slot];
      const result = (finalResults && finalResults[idx]) ? finalResults[idx] : null;
      const imgUrl = (images && images[idx]) ? images[idx] : (result ? result.carImage : null);

      // Card container
      const card = document.createElement('div');
      card.className = 'podium-card';
      Object.assign(card.style, {
        width: slot === 1 ? '360px' : '260px', // winner bigger
        height: slot === 1 ? '520px' : '420px',
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        borderRadius: '6px',
        boxShadow: '0 18px 40px rgba(0,0,0,0.6)',
        overflow: 'hidden',
        position: 'relative',
        paddingBottom: '20px'
      });

      // image container (top area)
      const imgWrap = document.createElement('div');
      Object.assign(imgWrap.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        right: '0',
        height: slot === 1 ? '68%' : '60%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundSize: 'cover',
        backgroundPosition: 'center center',
        backgroundRepeat: 'no-repeat'
      });

      if (imgUrl) {
  const resolvedUrl = imgUrl.startsWith('http')
    ? imgUrl
    : `${location.origin}${imgUrl.startsWith('/') ? '' : '/'}${imgUrl}`;

  imgWrap.style.backgroundImage = `url("${resolvedUrl}")`;
      } else {
        // empty placeholder
        imgWrap.style.background = 'linear-gradient(180deg, rgba(60,60,60,0.6), rgba(40,40,40,0.6))';
        const placeholder = document.createElement('div');
        placeholder.textContent = result ? (result.name || '') : 'NO IMAGE';
        Object.assign(placeholder.style, { color: '#fff', fontWeight: 800, fontSize: '14px' });
        imgWrap.appendChild(placeholder);
      }

      // caption area: position + name
      const caption = document.createElement('div');
      Object.assign(caption.style, {
        width: '100%',
        padding: '8px 12px',
        color: '#fff',
        textAlign: 'center',
        fontFamily: 'Montserrat,Segoe UI,Roboto,Arial,sans-serif'
      });

      const posLabel = document.createElement('div');
      posLabel.textContent = result ? (result.position ? `${result.position}${(result.position===1?'ST':result.position===2?'ND':result.position===3?'RD':'TH')}` : '') : '';
      Object.assign(posLabel.style, { fontWeight: 900, fontSize: slot===1 ? '28px' : '20px', letterSpacing: '1px' });

      const nameLabel = document.createElement('div');
      nameLabel.textContent = result ? (result.name || '') : '';
      Object.assign(nameLabel.style, { marginTop: '6px', fontWeight: 900, fontSize: slot===1 ? '22px' : '16px' });

      caption.appendChild(posLabel);
      caption.appendChild(nameLabel);

      card.appendChild(imgWrap);
      card.appendChild(caption);
      inner.appendChild(card);
    }

    // show overlay
    ov.style.display = 'flex';
  }

  function hidePodium() {
    if (!podiumOverlay) return;
    podiumOverlay.style.display = 'none';
    const inner = document.getElementById('podium-inner');
    if (inner) inner.innerHTML = '';
  }

  ws.addEventListener('open', () => {
    console.log('✅ WebSocket connected');
    if (focusPanel) focusPanel.style.opacity = '1';
  });
  ws.addEventListener('error', e => { console.error('❌ WS error', e); });
  ws.addEventListener('close', () => { console.log('🔌 WebSocket closed'); });

  ws.addEventListener('message', e => {
    try {
      const data = JSON.parse(e.data);
      // keep a copy of the last payload so the focus panel can compute live gaps
      lastPayloadData = data;
      if (data.info) return;

      // Lap pill: prefer descriptive lapText
      if (lapPill) lapPill.textContent = data.lapText || `LAP ${data.lap ?? 0} / ${data.totalLaps ?? 0}`;

      const list = Array.isArray(data.leaderboard) ? data.leaderboard : [];
      const finished = !!data.raceFinished;

      // determine fastest driver PLID (prefer server-provided fastest field)
      let fastestPlid = data.fastest?.plid ?? null;
      if (!fastestPlid) {
        // fallback: find smallest fastestLapMs
        let min = Infinity, pid = null;
        for (const it of list) {
          if (it.fastestLapMs != null && it.fastestLapMs < min) { min = it.fastestLapMs; pid = it.plid; }
        }
        if (pid !== null) fastestPlid = pid;
      }

      // Render board
      if (board) board.innerHTML = '';
      for (let idx = 0; idx < list.length; idx++) {
        const d = list[idx];
        const row = document.createElement('div');
        row.className = 'row';
        row.dataset.plid = d.plid;
        row.dataset.pos = d.position ?? (idx + 1);
        row.dataset.name = d.name ?? '';

        // selection
        if (selectedPlid !== null && Number(selectedPlid) === Number(d.plid)) row.classList.add('selected');

        // pos box
        const pos = document.createElement('div');
        pos.className = 'pos';
        pos.textContent = d.position ?? (idx + 1);

        // highlight fastest (pos purple + glow)
        const isFastest = fastestPlid != null && Number(d.plid) === Number(fastestPlid);
        if (isFastest) {
          pos.classList.add('pos-purple'); // uses your existing CSS color
          // subtle glow on the row
          row.style.boxShadow = '0 8px 20px rgba(156,39,176,0.18)';
        } else {
          // ensure no leftover style
          row.style.boxShadow = '';
        }

        // colorbar (hidden by CSS, but kept for compatibility)
        const colorbar = document.createElement('div');
        colorbar.className = 'colorbar';
        if (d.color) colorbar.style.background = d.color;
        else colorbar.style.background = 'transparent';

        // name
        const name = document.createElement('div');
        name.className = 'name';
        const nameText = document.createElement('span');
        nameText.innerHTML = escapeHtml(d.name || '');
        name.appendChild(nameText);

        // drive type badge
        if (d.driveType) {
          const driveBadge = document.createElement('span');
          driveBadge.className = 'drive-badge';
          driveBadge.textContent = d.driveType;
          driveBadge.title = `Drive Type: ${d.driveType}`;
          name.appendChild(driveBadge);
        }

        // lapped badge
        if (!finished && (d.lapsBehind ?? 0) > 0) {
          const badge = document.createElement('span');
          badge.className = 'lapped-badge';
          badge.textContent = `${d.lapsBehind}L`;
          name.appendChild(badge);
        }

        // right / gap
        const right = document.createElement('div');
        right.className = 'right';
        const gap = document.createElement('div');
        gap.className = 'gap';
        gap.textContent = d.gap || '';
        right.appendChild(gap);

        // build row
        row.appendChild(pos);
        row.appendChild(colorbar);
        row.appendChild(name);
        row.appendChild(right);

        // arrow for position change (visual)
        if (!finished) {
          const prev = lastPositions.get(d.plid);
          if (prev !== undefined && prev !== d.position) {
            const arrow = document.createElement('div');
            arrow.className = 'arrow';
            if (d.position < prev) arrow.classList.add('up');
            else if (d.position > prev) arrow.classList.add('down');
            row.appendChild(arrow);
          }
        }
        lastPositions.set(d.plid, d.position);

        // click to select/focus
        row.addEventListener('click', () => {
          selectedPlid = d.plid;
          lastSelectedDriver = d;
          try { localStorage.setItem('selectedDriver', JSON.stringify(d)); } catch (err) { console.warn('Could not save to localStorage:', err); }
          document.querySelectorAll('.row.selected').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
          updateFocusPanelFromData(d);
          if (focusPanel) focusPanel.style.opacity = '1';
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'focus', plid: d.plid }));
          } else {
            fetch('/camera', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plid: d.plid }) }).catch(err => console.error('HTTP fallback failed:', err));
          }
        });

        if (board) board.appendChild(row);
      }

      // keep focus panel updated using latest leaderboard data
      if (selectedPlid !== null) {
        const sel = list.find(x => Number(x.plid) === Number(selectedPlid));
        if (sel) { lastSelectedDriver = sel; updateFocusPanelFromData(sel); }
      } else if (lastSelectedDriver) {
        updateFocusPanelFromData(lastSelectedDriver);
      }

      // Podium overlay handling
      if (finished && Array.isArray(data.podiumImages) && data.podiumImages.length) {
        showPodium(data.podiumImages, data.finalResults || data.leaderboard || null);
      } else if (finished && Array.isArray(data.finalResults) && data.finalResults.length && data.podiumImages) {
        // fallback: if finalResults present, use their carImage fields
        const imgs = data.finalResults.slice(0,3).map(r => r.carImage || null);
        showPodium(imgs, data.finalResults);
      } else {
        hidePodium();
      }
    } catch (err) {
      console.error('❌ Parse error', err);
    }
  });

  function updateFocusPanelFromData(driver) {
    try {
      // console.log(`🎯 Updating focus panel for: ${driver.name} (PLID ${driver.plid})`);

      // Fill basic text fields
      if (focusPos) focusPos.textContent = driver.position ?? (driver.plid ?? '-');
      if (focusName) focusName.textContent = driver.name ?? 'NO DRIVER';
      if (focusCarNumber) focusCarNumber.textContent = driver.position ?? '-';

      // Car image (use focusFlagContainer for car image)
      if (focusFlagContainer) {
        focusFlagContainer.innerHTML = ''; // clear
        if (driver.carImage) {
          const img = document.createElement('img');
          img.src = driver.carImage;
          img.alt = driver.carAbbrev || `car-${driver.plid}` || '';
          img.style.maxWidth = '100%';
          img.style.maxHeight = '100%';
          img.style.objectFit = 'contain';
          img.className = 'focus-car-image';
          focusFlagContainer.appendChild(img);

          // if carAbbrev or modAttachmentId present, show small badge
          if (driver.carAbbrev || driver.modAttachmentId) {
            const badge = document.createElement('div');
            badge.className = 'drive-type-badge'; // reuse style
            badge.textContent = driver.carAbbrev ? driver.carAbbrev : (`mod:${driver.modAttachmentId}`);
            badge.style.position = 'absolute';
            badge.style.bottom = '6px';
            badge.style.right = '6px';
            badge.style.transform = 'translateZ(0)';
            badge.style.fontSize = '11px';
            badge.style.padding = '4px 8px';
            badge.style.borderRadius = '6px';
            badge.style.background = '#000';
            badge.style.color = '#fff';
            focusFlagContainer.style.position = 'relative';
            focusFlagContainer.appendChild(badge);
          }

          focusFlagContainer.style.display = 'flex';
        } else {
          // no image: hide or show drive-type if available (keep previous behavior)
          if (driver.driveType) {
            focusFlagContainer.innerHTML = '';
            const span = document.createElement('span');
            span.className = 'drive-type-badge';
            span.textContent = driver.driveType;
            focusFlagContainer.appendChild(span);
            focusFlagContainer.style.display = 'block';
          } else {
            focusFlagContainer.style.display = 'none';
          }
        }
      }

      // Compute live gap using the latest payload when available
      let gapDisplay = '-';
      if (lastPayloadData) {
        const lb = Array.isArray(lastPayloadData.leaderboard) ? lastPayloadData.leaderboard : [];
        const leaderPlid = lastPayloadData.leader?.plid ?? (lb[0]?.plid);
        const leaderEntry = lb.find(x => Number(x.plid) === Number(leaderPlid)) || lb[0] || null;
        const driverEntry = lb.find(x => Number(x.plid) === Number(driver.plid)) || driver;

        if (!leaderEntry) {
          gapDisplay = '-';
        } else if (Number(driver.plid) === Number(leaderPlid)) {
          gapDisplay = '-';
        } else if (lastPayloadData.sessionType === 'qualy') {
          if (driverEntry.fastestLapMs != null && leaderEntry.fastestLapMs != null) {
            const diff = (driverEntry.fastestLapMs - leaderEntry.fastestLapMs) / 1000;
            gapDisplay = diff >= 60 ? `+${Math.floor(diff/60)}:${String((diff%60).toFixed(3)).padStart(6,'0')}` : `+${diff.toFixed(3)}`;
          }
        } else {
          // race: prefer lapsBehind then totalTime diff then node-approx
          if ((driverEntry.lapsBehind ?? 0) > 0) {
            gapDisplay = `+${driverEntry.lapsBehind}L`;
          } else if (driverEntry.totalTime != null && leaderEntry.totalTime != null) {
            const diff = (driverEntry.totalTime - leaderEntry.totalTime) / 1000;
            if (Math.abs(diff) < 0.01) gapDisplay = '+0.000';
            else if (diff < 60) gapDisplay = `+${diff.toFixed(3)}`;
            else { const mins = Math.floor(diff/60); const secs = (diff % 60).toFixed(3); gapDisplay = `+${mins}:${secs.padStart(6,'0')}`; }
          } else if (driverEntry.node != null && leaderEntry.node != null) {
            const nodeDiff = (leaderEntry.node ?? 0) - (driverEntry.node ?? 0);
            if (nodeDiff > 0) {
              const approx = nodeDiff / 10;
              gapDisplay = approx < 60 ? `+${approx.toFixed(1)}` : `+${Math.floor(approx/60)}:${String(Math.round(approx%60)).padStart(2,'0')}`;
            }
          }
        }
      }

      if (focusGapLabel) focusGapLabel.textContent = 'GAP TO P1';
      if (focusGapValue) focusGapValue.textContent = gapDisplay;

      // Slight repaint nudge for OBS
      if (focusPanel) {
        focusPanel.style.opacity = '0.99';
        setTimeout(() => { focusPanel.style.opacity = '1'; }, 10);
      }
    } catch (err) {
      console.warn('updateFocusPanelFromData failed:', err);
    }
  }
