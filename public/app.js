/* ============================================ */
/* public/app.js */
/* ============================================ */

const board = document.getElementById('board');
const lapPill = document.getElementById('lap-pill');
const focusPos = document.getElementById('focus-pos');
const focusName = document.getElementById('focus-name');
const focusGap = document.getElementById('focus-gap');
const focusPanel = document.getElementById('focus-panel');

// Use the same host the page was loaded from
const wsUrl = `ws://${location.host}`;
console.log(`📡 WebSocket URL: ${wsUrl}`);
const ws = new WebSocket(wsUrl);

// store previous positions to compute arrows
const lastPositions = new Map();
// currently selected PLID (persist selection across updates)
let selectedPlid = null;
// store the last selected driver data for persistence
let lastSelectedDriver = null;

// Try to restore last selected driver from localStorage
try {
  const saved = localStorage.getItem('selectedDriver');
  if (saved) {
    const parsed = JSON.parse(saved);
    selectedPlid = parsed.plid;
    lastSelectedDriver = parsed;
    console.log(`♻️ Restored selected driver from localStorage: ${parsed.name} (PLID ${parsed.plid})`);
  }
} catch (e) {
  console.warn('Could not restore from localStorage:', e);
}

function msToLapStr(ms) {
  if (ms == null) return '';
  const totalMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = Math.floor((totalMs % 1000) / 10); // two digits
  return `${minutes}:${String(seconds).padStart(2,'0')}.${String(millis).padStart(2,'0')}`;
}
function msToTimeStr(ms) {
  if (ms == null) return '';
  const totalMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = Math.floor((totalMs % 1000) / 10);
  return `${minutes}:${String(seconds).padStart(2,'0')}.${String(millis).padStart(2,'0')}`;
}
function escapeHtml(s) {
  return (s + '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

ws.addEventListener('open', () => {
  console.log('✅ WebSocket connected');
  focusPanel.style.opacity = '1'; // make sure panel is visible
});
ws.addEventListener('error', e => {
  console.error('❌ WS error', e);
  console.error('Using localhost, which may fail in OBS. Ensure server is running.');
});
ws.addEventListener('close', () => {
  console.log('🔌 WebSocket closed');
});

ws.addEventListener('message', e => {
  try {
    const data = JSON.parse(e.data);
    if (data.info) return;

    // Update lap pill
    lapPill.textContent = data.lapText || `LAP ${data.lap ?? 0} / ${data.totalLaps ?? 0}`;

    const list = data.leaderboard ?? [];
    const finished = !!data.raceFinished;

    // prefer finalResults ordering if finished
    let displayList = list;
    if (finished && Array.isArray(data.finalResults) && data.finalResults.length) {
      displayList = data.finalResults.map(fr => {
        const match = list.find(x => x.plid === fr.plid) || {};
        return {
          plid: fr.plid,
          name: fr.name || (match.name || `PLID ${fr.plid}`),
          color: match.color || null,
          position: fr.position,
          laps: match.laps ?? 0,
          lapsBehind: match.lapsBehind ?? 0,
          gap: match.gap || '',
          fastestLapMs: match.fastestLapMs ?? null,
          totalTime: fr.timeMs ?? match.totalTime ?? null
        };
      });
    }

    // Build left leaderboard DOM
    board.innerHTML = '';
    displayList.forEach((d, idx) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.plid = d.plid;
      row.dataset.pos = d.position ?? (idx + 1);
      row.dataset.name = d.name ?? '';
      row.dataset.gap = d.gap ?? '';

      // mark selected
      if (selectedPlid !== null && Number(selectedPlid) === Number(d.plid)) {
        row.classList.add('selected');
      }

      // pos
      const pos = document.createElement('div');
      pos.className = 'pos';
      pos.textContent = d.position ?? (idx + 1);

      // colorbar
      const colorbar = document.createElement('div');
      colorbar.className = 'colorbar';
      if (d.color) colorbar.style.background = d.color;
      else colorbar.style.background = 'transparent';

      // name
      const name = document.createElement('div');
      name.className = 'name';
      name.innerHTML = escapeHtml(d.name || '');

      // lapped badge
      if (!finished && d.lapsBehind > 0) {
        const badge = document.createElement('span');
        badge.className = 'lapped-badge';
        badge.textContent = `${d.lapsBehind}L`;
        name.appendChild(badge);
      }

      // right (gap)
      const right = document.createElement('div');
      right.className = 'right';
      const gap = document.createElement('div');
      gap.className = 'gap';
      gap.textContent = d.gap || '';
      right.appendChild(gap);

      // append
      row.appendChild(pos);
      row.appendChild(colorbar);
      row.appendChild(name);
      row.appendChild(right);

      // arrow (position change)
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

      // click to select driver (also sends focus to server)
      row.addEventListener('click', () => {
        console.log(`🖱️ Clicked driver PLID ${d.plid}: ${d.name}`);
        selectedPlid = d.plid;
        lastSelectedDriver = d; // persist the driver data
        // Save to localStorage
        try {
          localStorage.setItem('selectedDriver', JSON.stringify(d));
        } catch (e) {
          console.warn('Could not save to localStorage:', e);
        }
        // visual selection
        document.querySelectorAll('.row.selected').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        // set focus panel immediately using the live values we just rendered
        updateFocusPanelFromData(d);
        focusPanel.style.opacity = '1'; // ensure panel is visible
        // notify server (will send IS_SCC)
        if (ws.readyState === WebSocket.OPEN) {
          console.log(`📡 Sending focus via WebSocket to PLID ${d.plid}`);
          ws.send(JSON.stringify({ type: 'focus', plid: d.plid }));
        } else {
          console.log(`🔗 WebSocket not ready, trying HTTP fallback`);
          fetch('/camera', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plid: d.plid })
          }).catch((err) => {
            console.error('HTTP fallback failed:', err);
          });
        }
      });

      board.appendChild(row);
    });

    // keep the focus panel updated live using the latest leaderboard data:
    if (selectedPlid !== null) {
      const sel = displayList.find(x => Number(x.plid) === Number(selectedPlid));
      if (sel) {
        lastSelectedDriver = sel; // keep data fresh
        updateFocusPanelFromData(sel);
      }
    } else if (lastSelectedDriver) {
      // if no selection but we had one before, keep showing it
      updateFocusPanelFromData(lastSelectedDriver);
    }
  } catch (err) {
    console.error('❌ Parse error', err);
  }
});

/* helper to update the focus panel using a driver object */
function updateFocusPanelFromData(driver) {
  console.log(`🎯 Updating focus panel for: ${driver.name} (PLID ${driver.plid})`);
  focusPos.textContent = driver.position ?? (driver.plid ?? '-');
  focusName.textContent = driver.name ?? 'NO DRIVER';
  if (driver.gap && String(driver.gap).trim() !== '') {
    focusGap.textContent = driver.gap;
  } else {
    focusGap.textContent = (driver.position === 1) ? 'P1' : 'GAP TO P1 -';
  }
  // Force repaint in OBS
  focusPanel.style.opacity = '0.99';
  setTimeout(() => { focusPanel.style.opacity = '1'; }, 10);
}
