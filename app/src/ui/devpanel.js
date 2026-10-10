// Developer panel: connection details, live hex log of every frame, and demo-device simulations.

const MAX_ROWS = 250;
const time = (t) => new Date(t).toTimeString().slice(0, 8);
const ARROW = { tx: '→', rx: '←', err: '!', info: '·' };

export function createDevPanel({ controller, getMock }) {
  const panel = document.getElementById('devpanel');
  const log = document.getElementById('log');
  const details = document.getElementById('dev-details');
  const demoActions = document.getElementById('demo-actions');

  // Hidden from normal users: Ctrl+Shift+D (Cmd+Shift+D on Mac) toggles it.
  window.addEventListener('keydown', (e) => {
    if (!((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd')) return;
    e.preventDefault();
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { renderAll(); log.scrollTop = log.scrollHeight; }
  });

  const row = (e) => {
    const li = document.createElement('li');
    const t = document.createElement('span'); t.className = 't'; t.textContent = time(e.t);
    const d = document.createElement('span'); d.className = `d-${e.dir}`; d.textContent = ARROW[e.dir] ?? '';
    const name = document.createElement('span'); name.className = `name d-${e.dir}`; name.textContent = e.label;
    li.append(t, d, name);
    if (e.hex) { const hex = document.createElement('span'); hex.className = 'hex'; hex.textContent = e.hex; li.append(hex); }
    return li;
  };

  function renderAll() {
    log.replaceChildren(...controller.log.slice(-MAX_ROWS).map(row));
  }

  controller.onLog((e) => {
    if (panel.hidden) return;
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    log.append(row(e));
    while (log.children.length > MAX_ROWS) log.firstChild.remove();
    if (stick) log.scrollTop = log.scrollHeight;
  });

  document.getElementById('log-clear').addEventListener('click', () => { controller.log.length = 0; log.replaceChildren(); });
  document.getElementById('log-copy').addEventListener('click', async () => {
    const text = controller.log.map((e) => `${time(e.t)} ${ARROW[e.dir]} ${e.label}${e.hex ? '  ' + e.hex : ''}`).join('\n');
    try { await navigator.clipboard.writeText(text); panel.dispatchEvent(new CustomEvent('toast', { bubbles: true, detail: 'Log copied' })); } catch {}
  });

  demoActions.addEventListener('click', (e) => {
    const sim = e.target.closest('[data-sim]')?.dataset.sim;
    const mock = getMock();
    if (!sim || !mock) return;
    if (sim === 'button') mock.pressNoiseButton();
    if (sim === 'low') mock.setBattery(12, false);
    if (sim === 'charge') mock.setBattery(mock.state.battery, !mock.state.charging);
    if (sim === 'drop') mock.dropConnection();
  });

  controller.subscribe((s) => {
    demoActions.hidden = s.kind !== 'demo' || s.status !== 'connected';
    const rows = [
      ['Status', s.status],
      ['Transport', s.kind ?? '—'],
      ['Model', s.model ?? '—'],
      ['Firmware', s.firmware ?? '—'],
      ['Writable', Object.entries(s.features).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'],
    ];
    details.replaceChildren(...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      return [dt, dd];
    }));
  });
}
