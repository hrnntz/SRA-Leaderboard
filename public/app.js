/* ============================================ */
/* app.js */
/* ============================================ */

const board = document.getElementById('board');
const lapText = document.getElementById('lap');
const ws = new WebSocket(`ws://${location.host}`);

// store previous positions to compute arrows
const lastPositions = new Map();

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

ws.addEventListener('open', () => console.log('✅ WebSocket connected'));
ws.addEventListener('error', e => console.error('❌ WS error', e));
ws.addEventListener('close', () => console.log('🔌 WebSocket closed'));

ws.addEventListener('message', e => {
  try {
    const data = JSON.parse(e.data);
    if (data.info) return;

    const lap = data.lap ?? 0;
    const total = data.totalLaps ?? 0;
    lapText.textContent = `LAP ${lap} / ${total}`;

    const list = data.leaderboard ?? [];

    // if race finished show final results
    const finished = !!data.raceFinished;

    // build list (if finished prefer finalResults ordering)
    let displayList = list;
    if (finished && Array.isArray(data.finalResults) && data.finalResults.length) {
      // map finalResults to rows consistent with list where possible
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

    // build DOM
    board.innerHTML = '';

    displayList.forEach((d, idx) => {
      const row = document.createElement('div');
      row.className = 'row';

      // podium classes only when finished
      if (finished) {
        if (d.position === 1) row.classList.add('podium-gold');
        else if (d.position === 2) row.classList.add('podium-silver');
        else if (d.position === 3) row.classList.add('podium-bronze');
      }

      // pos box
      const pos = document.createElement('div');
      pos.className = 'pos';
      pos.textContent = d.position ?? '';

      // arrow (only while live)
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

      // colorbar
      const colorbar = document.createElement('div');
      colorbar.className = 'colorbar';
      if (d.color) colorbar.style.background = d.color;
      else colorbar.style.background = 'transparent';

      // name
      const name = document.createElement('div');
      name.className = 'name';
      name.innerHTML = escapeHtml(d.name || '');
      
      // lapped badge (if car is lapped)
      if (!finished && d.lapsBehind > 0) {
        const badge = document.createElement('span');
        badge.className = 'lapped-badge';
        badge.textContent = `${d.lapsBehind}L`;
        name.appendChild(badge);
      }

      // right (gap / lap or final time)
      const right = document.createElement('div');
      right.className = 'right';

      const gap = document.createElement('div');
      gap.className = 'gap';
      if (finished) {
        // show final time instead of gap
        gap.textContent = d.totalTime ? msToTimeStr(d.totalTime) : d.gap || '';
      } else {
        gap.textContent = d.gap || '';
      }

      const laptime = document.createElement('div');
      laptime.className = 'laptime';
      if (!finished) {
        laptime.textContent = d.fastestLapMs ? msToLapStr(d.fastestLapMs) : '';
      } else {
        // optionally show fastest lap under final time
        laptime.textContent = d.fastestLapMs ? `Fastest: ${msToLapStr(d.fastestLapMs)}` : '';
      }

      right.appendChild(gap);
      right.appendChild(laptime);

      // append elements
      row.appendChild(pos);
      row.appendChild(colorbar);
      row.appendChild(name);
      row.appendChild(right);

      board.appendChild(row);
    });
  } catch (err) {
    console.error('❌ Parse error', err);
  }
})