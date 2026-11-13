'use strict';
const $app = document.getElementById('app');
const state = { user: null, host: null, fixedHost: null, timer: null };

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bytes = (n) => { if (!n && n !== 0) return '–'; const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; };
const pct = (n) => (n * 100).toFixed(1) + '%';
const uptime = (s) => { if (!s) return '–'; const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm'; };
const bar = (v) => `<div class="bar"><i class="${v > .9 ? 'crit' : v > .75 ? 'hi' : ''}" style="width:${Math.min(100, v * 100).toFixed(1)}%"></i></div>`;

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 5000);
}

async function api(method, path, body) {
  const r = await fetch(path, {
    method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'pvedash' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await r.json(); } catch { /* empty */ }
  if (r.status === 401 && state.user) { state.user = null; render(); }
  if (!r.ok) {
    const e = data.error || (data.errors && Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`).join('; ')) || r.statusText;
    throw new Error(e);
  }
  return data;
}
const pve = async (method, path, body) => (await api(method, '/api/pve' + path, body)).data;
const qs = (o) => new URLSearchParams(o).toString();

// Run a Proxmox task (UPID) to completion, reporting the result as a toast.
async function runTask(node, upid, label) {
  toast(label + '…');
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const st = await pve('GET', `/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`).catch(() => null);
    if (st && st.status === 'stopped') {
      if (st.exitstatus === 'OK') toast(label + ' – done', 'ok'); else toast(`${label} – failed: ${st.exitstatus}`, 'bad');
      return st.exitstatus === 'OK';
    }
  }
  return false;
}
async function act(node, path, label, body) {
  try {
    const upid = await pve('POST', `/nodes/${node}${path}`, body);
    const ok = typeof upid === 'string' && upid.startsWith('UPID') ? await runTask(node, upid, label) : true;
    return ok;
  } catch (e) { toast(`${label}: ${e.message}`, 'bad'); return false; }
}

// ---------- layout ----------
const NAV = [['', 'Overview'], ['instances', 'Instances'], ['create', 'Create'], ['storage', 'Storage'], ['nodes', 'Nodes'], ['tasks', 'Activity']];

function shell(active, content) {
  return `<div class="layout"><nav><div class="brand">☁ PVEDash</div>
    ${NAV.map(([k, l]) => `<a href="#/${k}" class="${k === active ? 'active' : ''}">${l}</a>`).join('')}
    <div class="foot muted">${esc(state.user)}<br>${esc(state.host)}<br><a href="#" id="logout">Sign out</a></div></nav>
    <main>${content}</main></div>`;
}

// ---------- login ----------
function loginView(err = '') {
  clearInterval(state.timer);
  $app.innerHTML = `<div class="login"><div class="card"><h1>☁ PVEDash</h1><p class="muted">Sign in to your Proxmox VE cluster.</p>
    <form id="lf">
      ${state.fixedHost ? '' : '<label>Proxmox host<input name="host" placeholder="pve.example.com:8006" required></label>'}
      <div class="seg" id="mode"><a class="sel" data-m="pw">Password</a><a data-m="tok">API token</a></div>
      <div id="pw"><label>Username<input name="username" value="root" autocomplete="username"></label>
        <label>Realm<select name="realm"><option value="pam">Linux PAM</option><option value="pve">Proxmox VE</option></select></label>
        <label>Password<input name="password" type="password" autocomplete="current-password"></label></div>
      <div id="tok" hidden><label>Token ID<input name="tokenId" placeholder="user@realm!tokenname"></label>
        <label>Secret<input name="tokenSecret" type="password"></label></div>
      <div class="err">${esc(err)}</div><button class="primary" style="width:100%">Sign in</button></form></div></div>`;
  const f = document.getElementById('lf');
  document.querySelectorAll('#mode a').forEach((a) => a.onclick = () => {
    document.querySelectorAll('#mode a').forEach((x) => x.classList.toggle('sel', x === a));
    document.getElementById('pw').hidden = a.dataset.m !== 'pw'; document.getElementById('tok').hidden = a.dataset.m === 'pw';
  });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    if (!document.getElementById('tok').hidden) { delete d.username; delete d.password; } else { delete d.tokenId; delete d.tokenSecret; }
    try {
      const r = await api('POST', '/api/login', d);
      state.user = r.user; state.host = r.host; render();
    } catch (ex) { loginView(ex.message); }
  };
}

// ---------- pages ----------
async function overview(el) {
  const res = await pve('GET', '/cluster/resources');
  const nodes = res.filter((r) => r.type === 'node');
  const guests = res.filter((r) => ['qemu', 'lxc'].includes(r.type) && !r.template);
  const running = guests.filter((g) => g.status === 'running');
  const sum = (a, k) => a.reduce((t, x) => t + (x[k] || 0), 0);
  const on = nodes.filter((n) => n.status === 'online');
  const cpuU = sum(on, 'cpu') / (on.length || 1);
  const memU = sum(on, 'mem') / (sum(on, 'maxmem') || 1);
  const sto = res.filter((r) => r.type === 'storage' && r.status === 'available');
  const dskU = sum(sto, 'disk') / (sum(sto, 'maxdisk') || 1);
  el.innerHTML = `<div class="head"><div><h1>Overview</h1><div class="muted">${nodes.length} node(s) · ${guests.length} instances</div></div>
    <a class="btn primary right" href="#/create">+ Create instance</a></div>
    <div class="grid g4">
      <div class="card"><div class="muted">Running instances</div><div class="stat">${running.length} / ${guests.length}</div></div>
      <div class="card"><div class="muted">CPU</div><div class="stat">${pct(cpuU)}</div>${bar(cpuU)}</div>
      <div class="card"><div class="muted">Memory</div><div class="stat">${pct(memU)}</div>${bar(memU)}<div class="muted">${bytes(sum(on, 'mem'))} / ${bytes(sum(on, 'maxmem'))}</div></div>
      <div class="card"><div class="muted">Storage</div><div class="stat">${pct(dskU)}</div>${bar(dskU)}<div class="muted">${bytes(sum(sto, 'disk'))} / ${bytes(sum(sto, 'maxdisk'))}</div></div>
    </div><br><div class="card"><h2>Recently active instances</h2>${guestTable(running.sort((a, b) => b.cpu - a.cpu).slice(0, 8))}</div>`;
  bindRows(el);
}

function guestTable(list) {
  if (!list.length) return '<div class="muted">No instances.</div>';
  return `<table><thead><tr><th>Name</th><th>ID</th><th>Type</th><th>Status</th><th>Node</th><th>CPU</th><th>Memory</th><th>Uptime</th><th></th></tr></thead><tbody>
  ${list.map((g) => `<tr class="row" data-href="#/instances/${g.type}/${esc(g.node)}/${g.vmid}">
    <td><b>${esc(g.name || g.vmid)}</b> ${(g.tags ? g.tags.split(';').filter(Boolean) : []).map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</td>
    <td>${g.vmid}</td><td>${g.type === 'qemu' ? 'VM' : 'Container'}</td><td><span class="badge ${esc(g.status)}">${esc(g.status)}</span></td>
    <td>${esc(g.node)}</td><td>${g.status === 'running' ? pct(g.cpu) + ' of ' + g.maxcpu + ' vCPU' : '–'}</td>
    <td>${g.status === 'running' ? bytes(g.mem) + ' / ' : ''}${bytes(g.maxmem)}</td><td>${uptime(g.uptime)}</td>
    <td class="actions" data-stop>${quickActions(g)}</td></tr>`).join('')}</tbody></table>`;
}
function quickActions(g) {
  const a = (op, l, cls = '') => `<button class="sm ${cls}" data-op="${op}" data-type="${g.type}" data-node="${esc(g.node)}" data-vmid="${g.vmid}">${l}</button>`;
  return g.status === 'running' ? a('shutdown', 'Shutdown') + a('reboot', 'Reboot') : a('start', 'Start');
}
function bindRows(el) {
  el.querySelectorAll('tr.row').forEach((r) => r.onclick = (e) => { if (!e.target.closest('[data-stop]')) location.hash = r.dataset.href; });
  el.querySelectorAll('button[data-op]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    const { op, type, node, vmid } = b.dataset;
    await act(node, `/${type}/${vmid}/status/${op}`, `${op} ${vmid}`);
    render(true);
  });
}

async function instances(el) {
  const res = await pve('GET', '/cluster/resources?type=vm');
  const all = res.filter((r) => !r.template).sort((a, b) => a.vmid - b.vmid);
  const f = state.filter || (state.filter = { q: '', type: '', status: '' });
  el.innerHTML = `<div class="head"><div><h1>Instances</h1><div class="muted">Virtual machines and containers</div></div><a class="btn primary right" href="#/create">+ Create instance</a></div>
    <div class="toolbar"><input id="q" placeholder="Search name, ID or tag…" value="${esc(f.q)}">
      <select id="t"><option value="">All types</option><option value="qemu">Virtual machines</option><option value="lxc">Containers</option></select>
      <select id="s"><option value="">Any status</option><option value="running">Running</option><option value="stopped">Stopped</option></select></div>
    <div class="card" id="list"></div>`;
  el.querySelector('#t').value = f.type; el.querySelector('#s').value = f.status;
  const list = el.querySelector('#list'); // keep a reference: el is emptied once the page is mounted
  const draw = () => {
    const q = f.q.toLowerCase();
    const l = all.filter((g) => (!f.type || g.type === f.type) && (!f.status || g.status === f.status) &&
      (!q || `${g.name} ${g.vmid} ${g.tags || ''}`.toLowerCase().includes(q)));
    list.innerHTML = guestTable(l); bindRows(list);
  };
  el.querySelector('#q').oninput = (e) => { f.q = e.target.value; draw(); };
  el.querySelector('#t').onchange = (e) => { f.type = e.target.value; draw(); };
  el.querySelector('#s').onchange = (e) => { f.status = e.target.value; draw(); };
  draw();
}

function chart(rows, key, max, color) {
  const pts = rows.map((r, i) => [i, r[key]]).filter((p) => p[1] != null);
  if (pts.length < 2) return '<div class="muted">No data</div>';
  const top = max || Math.max(...pts.map((p) => p[1]), 1);
  const x = (i) => (i / (rows.length - 1)) * 300, y = (v) => 58 - Math.min(v / top, 1) * 54;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  return `<svg class="chart" viewBox="0 0 300 60" preserveAspectRatio="none"><path d="${d}L300,60L0,60Z" fill="${color}" opacity=".15"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

async function instance(el, type, node, vmid, tab = 'overview') {
  if (!['qemu', 'lxc'].includes(type) || !/^\d+$/.test(vmid) || !/^[A-Za-z0-9.\-]+$/.test(node)) throw new Error('Invalid instance address');
  if (!['overview', 'snapshots', 'configuration'].includes(tab)) tab = 'overview';
  const base = `/nodes/${node}/${type}/${vmid}`;
  const [cur, cfg] = await Promise.all([pve('GET', base + '/status/current'), pve('GET', base + '/config')]);
  const running = cur.status === 'running';
  const b = (op, l, cls = '', en = true) => en ? `<button class="${cls}" data-act="${op}">${l}</button>` : '';
  const tabs = ['overview', 'snapshots', 'configuration'];
  let body = '';
  if (tab === 'overview') {
    const rrd = await pve('GET', `${base}/rrddata?timeframe=hour`).catch(() => []);
    const net = rrd.map((r) => ({ ...r, net: (r.netin || 0) + (r.netout || 0) }));
    body = `<div class="grid g2"><div class="card"><h2>CPU</h2>${chart(rrd, 'cpu', 1, '#4f8cff')}</div>
      <div class="card"><h2>Memory</h2>${chart(rrd, 'mem', cur.maxmem, '#2ecc71')}</div>
      <div class="card"><h2>Network</h2>${chart(net, 'net', 0, '#f5a623')}</div>
      <div class="card"><h2>Disk I/O</h2>${chart(rrd.map((r) => ({ io: (r.diskread || 0) + (r.diskwrite || 0) })), 'io', 0, '#ef5350')}</div></div><br>
      <div class="card"><h2>Details</h2><dl class="kv"><dt>Status</dt><dd><span class="badge ${esc(cur.status)}">${esc(cur.status)}</span></dd>
      <dt>CPU</dt><dd>${running ? pct(cur.cpu) : '–'} (${cur.cpus || cfg.cores || 1} vCPU)</dd>
      <dt>Memory</dt><dd>${bytes(cur.mem)} / ${bytes(cur.maxmem)}</dd><dt>Disk</dt><dd>${bytes(cur.maxdisk)}</dd>
      <dt>Uptime</dt><dd>${uptime(cur.uptime)}</dd><dt>Node</dt><dd>${esc(node)}</dd>
      ${Object.keys(cfg).filter((k) => /^net\d+$/.test(k)).map((k) => `<dt>${k}</dt><dd>${esc(cfg[k])}</dd>`).join('')}</dl></div>`;
  } else if (tab === 'snapshots') {
    const snaps = (await pve('GET', base + '/snapshot')).filter((s) => s.name !== 'current');
    body = `<div class="card"><div class="toolbar"><input id="sn" placeholder="snapshot-name"><button class="primary" id="mk">Take snapshot</button></div>
      ${snaps.length ? `<table><thead><tr><th>Name</th><th>Description</th><th>Created</th><th></th></tr></thead><tbody>${snaps.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.description)}</td>
      <td>${s.snaptime ? new Date(s.snaptime * 1000).toLocaleString() : ''}</td><td class="actions"><button class="sm" data-rb="${esc(s.name)}">Rollback</button><button class="sm danger" data-del="${esc(s.name)}">Delete</button></td></tr>`).join('')}</tbody></table>` : '<div class="muted">No snapshots yet.</div>'}</div>`;
  } else {
    body = `<div class="card"><pre>${esc(Object.entries(cfg).map(([k, v]) => `${k}: ${v}`).join('\n'))}</pre></div>`;
  }
  el.innerHTML = `<div class="head"><div><a href="#/instances">← Instances</a><h1>${esc(cur.name || cfg.hostname || vmid)} <span class="muted">#${vmid}</span></h1>
    <div class="muted">${type === 'qemu' ? 'Virtual machine' : 'Container'} on ${esc(node)}</div></div>
    <div class="actions right">${b('start', 'Start', 'primary', !running)}${b('shutdown', 'Shutdown', '', running)}${b('reboot', 'Reboot', '', running)}
    ${b('stop', 'Force stop', 'danger', running)}<a class="btn" target="_blank" rel="noopener" href="https://${esc(state.host)}/?console=${type === 'qemu' ? 'kvm' : 'lxc'}&novnc=1&vmid=${vmid}&node=${esc(node)}">Console ↗</a>
    ${b('delete', 'Delete', 'danger', !running)}</div></div>
    <div class="tabs">${tabs.map((t) => `<a href="#/instances/${type}/${esc(node)}/${vmid}/${t}" class="${t === tab ? 'active' : ''}">${t[0].toUpperCase() + t.slice(1)}</a>`).join('')}</div>${body}`;

  el.querySelectorAll('[data-act]').forEach((btn) => btn.onclick = async () => {
    const op = btn.dataset.act;
    if (op === 'stop' && !confirm('Force stop is like pulling the power cord. Continue?')) return;
    btn.disabled = true;
    if (op === 'delete') {
      if (prompt(`Type ${vmid} to permanently delete this instance and its disks`) !== String(vmid)) { btn.disabled = false; return; }
      try {
        const upid = await pve('DELETE', `${base}?purge=1&destroy-unreferenced-disks=1`);
        await runTask(node, upid, `Delete ${vmid}`); location.hash = '#/instances'; return;
      } catch (e) { toast(e.message, 'bad'); }
    } else await act(node, `/${type}/${vmid}/status/${op}`, `${op} ${vmid}`);
    render(true);
  });
  const mk = el.querySelector('#mk');
  if (mk) mk.onclick = async () => {
    const name = el.querySelector('#sn').value.trim();
    if (!/^[A-Za-z][\w-]{1,39}$/.test(name)) return toast('Name must start with a letter (letters, digits, - _)', 'bad');
    await act(node, `/${type}/${vmid}/snapshot`, 'Snapshot', { snapname: name }); render(true);
  };
  el.querySelectorAll('[data-rb]').forEach((x) => x.onclick = async () => {
    if (confirm(`Roll back to "${x.dataset.rb}"? Current state is lost.`)) { await act(node, `/${type}/${vmid}/snapshot/${encodeURIComponent(x.dataset.rb)}/rollback`, 'Rollback'); render(true); }
  });
  el.querySelectorAll('[data-del]').forEach((x) => x.onclick = async () => {
    if (!confirm(`Delete snapshot "${x.dataset.del}"?`)) return;
    try { const u = await pve('DELETE', `${base}/snapshot/${encodeURIComponent(x.dataset.del)}`); await runTask(node, u, 'Delete snapshot'); } catch (e) { toast(e.message, 'bad'); }
    render(true);
  });
}

const SIZES = [['Nano', 1, 512, 8], ['Small', 1, 2048, 20], ['Medium', 2, 4096, 40], ['Large', 4, 8192, 80], ['XLarge', 8, 16384, 160]];

async function create(el) {
  const nodes = (await pve('GET', '/nodes')).filter((n) => n.status === 'online');
  const c = state.create || (state.create = { kind: 'lxc', size: 1, node: nodes[0] && nodes[0].node });
  if (!nodes.some((n) => n.node === c.node)) c.node = nodes[0] && nodes[0].node;
  const [nextid, stores] = await Promise.all([pve('GET', '/cluster/nextid'), pve('GET', `/nodes/${c.node}/storage`)]);
  const content = c.kind === 'lxc' ? 'vztmpl' : 'iso';
  const diskStores = stores.filter((s) => (s.content || '').split(',').includes(c.kind === 'lxc' ? 'rootdir' : 'images') && s.active);
  const srcStores = stores.filter((s) => (s.content || '').split(',').includes(content) && s.active);
  const media = (await Promise.all(srcStores.map((s) => pve('GET', `/nodes/${c.node}/storage/${s.storage}/content?content=${content}`).catch(() => [])))).flat();
  const sz = SIZES[c.size];
  el.innerHTML = `<div class="head"><div><h1>Create instance</h1><div class="muted">Launch a container or virtual machine from a size preset</div></div></div>
  <div class="card" style="max-width:760px"><div class="seg" id="kind"><a data-k="lxc" class="${c.kind === 'lxc' ? 'sel' : ''}">Container (LXC)</a><a data-k="qemu" class="${c.kind === 'qemu' ? 'sel' : ''}">Virtual machine</a></div>
  <form id="cf"><div class="grid g2" style="grid-template-columns:1fr 1fr">
    <label>Name<input name="name" required pattern="[A-Za-z0-9][A-Za-z0-9.\\-]*" placeholder="web-01"></label>
    <label>ID<input name="vmid" type="number" min="100" value="${esc(nextid)}" required></label>
    <label>Node<select name="node">${nodes.map((n) => `<option ${n.node === c.node ? 'selected' : ''}>${esc(n.node)}</option>`).join('')}</select></label>
    <label>${c.kind === 'lxc' ? 'Template' : 'Boot ISO'}<select name="media" ${c.kind === 'lxc' ? 'required' : ''}>${c.kind === 'qemu' ? '<option value="">None</option>' : ''}${media.map((m) => `<option value="${esc(m.volid)}">${esc(m.volid.split('/').pop())}</option>`).join('')}</select></label></div>
  <div class="muted" style="margin-bottom:6px">Size</div><div class="sizes">${SIZES.map((s, i) => `<div class="size ${i === c.size ? 'sel' : ''}" data-i="${i}"><b>${s[0]}</b><span class="muted">${s[1]} vCPU · ${s[2] >= 1024 ? s[2] / 1024 + ' GiB' : s[2] + ' MiB'}<br>${s[3]} GiB disk</span></div>`).join('')}</div>
  <div class="grid" style="grid-template-columns:1fr 1fr 1fr"><label>vCPUs<input name="cores" type="number" min="1" value="${sz[1]}"></label>
    <label>Memory (MiB)<input name="memory" type="number" min="128" value="${sz[2]}"></label><label>Disk (GiB)<input name="disk" type="number" min="1" value="${sz[3]}"></label></div>
  <div class="grid g2" style="grid-template-columns:1fr 1fr"><label>Disk storage<select name="storage">${diskStores.map((s) => `<option>${esc(s.storage)}</option>`).join('')}</select></label>
    <label>Network bridge<input name="bridge" value="vmbr0"></label>
    ${c.kind === 'lxc' ? '<label>Root password<input name="password" type="password" minlength="5" required></label><label>IPv4<select name="ip"><option value="dhcp">DHCP</option></select></label>' : ''}</div>
  <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="start" style="width:auto" checked> Start after creation</label>
  <button class="primary">Create</button></form></div>`;
  el.querySelectorAll('#kind a').forEach((a) => a.onclick = () => { c.kind = a.dataset.k; render(true); });
  const form = el.querySelector('#cf');
  el.querySelectorAll('.size').forEach((s) => s.onclick = () => {
    c.size = +s.dataset.i; const z = SIZES[c.size];
    form.cores.value = z[1]; form.memory.value = z[2]; form.disk.value = z[3];
    el.querySelectorAll('.size').forEach((x) => x.classList.toggle('sel', x === s));
  });
  el.querySelector('[name=node]').onchange = (e) => { c.node = e.target.value; render(true); };
  el.querySelector('#cf').onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const start = !!d.start;
    let body, label = `Create ${d.name}`;
    if (c.kind === 'lxc') {
      body = { vmid: +d.vmid, hostname: d.name, ostemplate: d.media, cores: +d.cores, memory: +d.memory, swap: 512, password: d.password,
        rootfs: `${d.storage}:${d.disk}`, net0: `name=eth0,bridge=${d.bridge},ip=dhcp`, unprivileged: 1, start: start ? 1 : 0, features: 'nesting=1' };
    } else {
      body = { vmid: +d.vmid, name: d.name, cores: +d.cores, memory: +d.memory, scsihw: 'virtio-scsi-pci', scsi0: `${d.storage}:${d.disk}`,
        net0: `virtio,bridge=${d.bridge}`, ostype: 'l26', agent: 1, start: start ? 1 : 0 };
      if (d.media) { body.ide2 = `${d.media},media=cdrom`; body.boot = 'order=ide2;scsi0'; }
    }
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const upid = await pve('POST', `/nodes/${d.node}/${c.kind}`, body);
      if (await runTask(d.node, upid, label)) location.hash = `#/instances/${c.kind}/${d.node}/${d.vmid}`;
    } catch (ex) { toast(ex.message, 'bad'); }
    btn.disabled = false;
  };
}

async function storage(el) {
  const res = (await pve('GET', '/cluster/resources?type=storage')).sort((a, b) => a.storage.localeCompare(b.storage));
  el.innerHTML = `<div class="head"><div><h1>Storage</h1></div></div><div class="card"><table><thead><tr><th>Name</th><th>Node</th><th>Type</th><th>Content</th><th>Usage</th></tr></thead><tbody>
  ${res.map((s) => { const u = s.maxdisk ? s.disk / s.maxdisk : 0; return `<tr><td><b>${esc(s.storage)}</b></td><td>${esc(s.node)}</td><td>${esc(s.plugintype)}</td><td>${esc(s.content)}</td>
  <td style="min-width:220px">${bytes(s.disk)} / ${bytes(s.maxdisk)}${bar(u)}</td></tr>`; }).join('')}</tbody></table></div>`;
}

async function nodesPage(el) {
  const ns = await pve('GET', '/nodes');
  el.innerHTML = `<div class="head"><div><h1>Nodes</h1></div></div><div class="grid g2">${ns.map((n) => `<div class="card"><h2>${esc(n.node)} <span class="badge ${n.status === 'online' ? 'running' : 'stopped'}">${esc(n.status)}</span></h2>
  <div class="muted">CPU (${n.maxcpu || '?'} cores)</div>${bar(n.cpu || 0)}<div>${pct(n.cpu || 0)}</div><br>
  <div class="muted">Memory</div>${bar(n.maxmem ? n.mem / n.maxmem : 0)}<div>${bytes(n.mem)} / ${bytes(n.maxmem)}</div><br><div class="muted">Uptime: ${uptime(n.uptime)}</div></div>`).join('')}</div>`;
}

async function tasks(el) {
  const t = (await pve('GET', '/cluster/tasks')).slice(0, 60);
  el.innerHTML = `<div class="head"><div><h1>Activity</h1><div class="muted">Recent cluster tasks</div></div></div><div class="card"><table><thead><tr><th>Time</th><th>Node</th><th>User</th><th>Task</th><th>ID</th><th>Result</th></tr></thead><tbody>
  ${t.map((x) => `<tr><td>${new Date(x.starttime * 1000).toLocaleString()}</td><td>${esc(x.node)}</td><td>${esc(x.user)}</td><td>${esc(x.type)}</td><td>${esc(x.id)}</td>
  <td>${x.status ? (x.status === 'OK' ? '<span class="badge running">OK</span>' : `<span class="badge stopped">${esc(x.status)}</span>`) : '<span class="badge paused">running</span>'}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------- router ----------
let renderSeq = 0;
async function render(soft) {
  const seq = ++renderSeq;
  clearInterval(state.timer);
  if (!state.user) return loginView();
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
  const page = parts[0];
  const main = document.querySelector('main');
  const scroll = main ? window.scrollY : 0;
  if (!main || !soft) $app.innerHTML = shell(page, '<div class="muted">Loading…</div>');
  document.getElementById('logout').onclick = async (e) => { e.preventDefault(); await api('POST', '/api/logout'); state.user = null; render(); };
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#/' + page));
  // Render into a detached node so a stale or failed fetch never wipes the visible page.
  const tmp = document.createElement('div');
  try {
    if (page === 'instances' && parts[1]) await instance(tmp, parts[1], decodeURIComponent(parts[2]), parts[3], parts[4]);
    else await ({ '': overview, instances, create, storage, nodes: nodesPage, tasks }[page] || overview)(tmp);
  } catch (e) {
    tmp.innerHTML = `<div class="card err">${esc(e.message)}</div>`;
  }
  if (seq !== renderSeq) return;
  const target = document.querySelector('main');
  const focusId = document.activeElement && document.activeElement.id;
  target.replaceChildren(...tmp.childNodes);
  if (focusId) { const f = document.getElementById(focusId); if (f) f.focus(); }
  window.scrollTo(0, scroll);
  if (['', 'instances'].includes(page) && !parts[1]) state.timer = setInterval(() => document.hidden || document.activeElement.tagName === 'INPUT' || render(true), 10000);
}
window.addEventListener('hashchange', () => render());

(async () => {
  try { state.fixedHost = (await api('GET', '/api/config')).host; } catch { /* ignore */ }
  try { const s = await api('GET', '/api/session'); state.user = s.user; state.host = s.host; } catch { /* not logged in */ }
  render();
})();
