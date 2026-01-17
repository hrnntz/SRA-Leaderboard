(function(){
  const status = document.getElementById('status');
  const overlayUrl = document.getElementById('overlayUrl');
  const copyBtn = document.getElementById('copyBtn');
  const openOverlay = document.getElementById('openOverlay');
  const payloadEl = document.getElementById('payload');
  const wsConnect = document.getElementById('wsConnect');
  const wsState = document.getElementById('wsState');
  const testFocus = document.getElementById('testFocus');
  const wsLast = document.getElementById('wsLast');

  // derive base URL
  const base = `${location.protocol}//${location.host}`;
  overlayUrl.value = `${base}`;

  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(overlayUrl.value).then(()=>{
      copyBtn.textContent = 'Copied';
      setTimeout(()=>copyBtn.textContent='Copy',800);
    });
  });
  openOverlay.addEventListener('click', ()=> window.open(overlayUrl.value,'_blank'));

  let ws = null;
  wsConnect.addEventListener('click', ()=>{
    if (ws && ws.readyState===WebSocket.OPEN) { ws.close(); return; }
    ws = new WebSocket((location.protocol==='https:'?'wss:':'ws:')+ '//' + location.host);
    wsState.textContent = 'Connecting...';
    ws.onopen = ()=> { wsState.textContent = 'Connected'; };
    ws.onclose = ()=> { wsState.textContent = 'Disconnected'; };
    ws.onerror = (e)=> { wsState.textContent = 'Error'; console.error(e); };
    ws.onmessage = (m)=> { wsLast.textContent = 'Msg @ ' + new Date().toLocaleTimeString(); console.log('WS', m.data); };
  });

  testFocus.addEventListener('click', ()=>{
    if (!ws || ws.readyState!==WebSocket.OPEN) { alert('Open WebSocket first'); return; }
    ws.send(JSON.stringify({ type:'focus', plid: 1 }));
    wsLast.textContent = 'Sent focus=1';
  });

  async function refreshPayload(){
    try{
      const r = await fetch('/api/leaderboard');
      const j = await r.json();
      payloadEl.textContent = JSON.stringify(j, null, 2);
      status.textContent = 'Server: OK';
    }catch(err){
      payloadEl.textContent = 'Error fetching payload: ' + (err && err.message);
      status.textContent = 'Server: Unreachable';
    }
  }

  // auto-refresh
  setInterval(refreshPayload, 1000);
  refreshPayload();
})();
