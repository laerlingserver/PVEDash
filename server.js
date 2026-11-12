'use strict';
// Zero-dependency server: serves the UI and proxies authenticated calls to the Proxmox VE API.
// Proxmox credentials never reach the browser; they live in an in-memory server session.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const BIND = process.env.BIND || '127.0.0.1';
const PVE_HOST = process.env.PVE_HOST || ''; // e.g. pve.example.com:8006 (locks the target if set)
const INSECURE = process.env.PVE_INSECURE_TLS !== 'false'; // Proxmox commonly uses self-signed certs
const PUBLIC = path.join(__dirname, 'public');
const TRUST_PROXY = process.env.TRUST_PROXY === 'true'; // honour X-Forwarded-Proto from a reverse proxy
const SESSION_TTL = 2 * 60 * 60 * 1000; // PVE tickets expire after 2h

const sessions = new Map();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function normalizeHost(h) {
  h = String(h || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[A-Za-z0-9.\-]+(:\d{1,5})?$|^\[[0-9a-fA-F:]+\](:\d{1,5})?$/.test(h)) throw new Error('Invalid host');
  return /:\d+$/.test(h) ? h : h + ':8006';
}

function pveRequest(host, method, apiPath, { headers = {}, body } = {}) {
  const [hostname, port] = host.startsWith('[')
    ? [host.slice(1, host.indexOf(']')), host.split(']:')[1]]
    : host.split(':');
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = https.request({
      hostname, port: Number(port || 8006), method, path: '/api2/json' + apiPath,
      rejectUnauthorized: !INSECURE, timeout: 30000,
      headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('timeout', () => req.destroy(new Error('Proxmox request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function send(res, status, obj, extra = {}) {
  const data = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve(undefined);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function getSession(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  const s = m && sessions.get(m[1]);
  if (!s) return null;
  if (Date.now() - s.created > SESSION_TTL) { sessions.delete(m[1]); return null; }
  s.id = m[1];
  return s;
}

function authHeaders(s, method) {
  if (s.token) return { Authorization: `PVEAPIToken=${s.token}` };
  const h = { Cookie: `PVEAuthCookie=${encodeURIComponent(s.ticket)}` };
  if (method !== 'GET') h.CSRFPreventionToken = s.csrf;
  return h;
}

async function handleLogin(req, res) {
  const b = (await readBody(req)) || {};
  const host = normalizeHost(PVE_HOST || b.host);
  let session;
  if (b.tokenId && b.tokenSecret) {
    session = { host, token: `${b.tokenId}=${b.tokenSecret}`, user: b.tokenId };
    const r = await pveRequest(host, 'GET', '/version', { headers: authHeaders(session, 'GET') });
    if (r.status !== 200) return send(res, 401, { error: 'API token rejected by Proxmox' });
  } else {
    const username = String(b.username || '');
    const realm = String(b.realm || 'pam');
    if (!username || !b.password) return send(res, 400, { error: 'Username and password required' });
    const r = await pveRequest(host, 'POST', '/access/ticket', {
      body: { username: username.includes('@') ? username : `${username}@${realm}`, password: b.password },
    });
    if (r.status !== 200) return send(res, 401, { error: 'Login failed: check username, password and realm' });
    const d = JSON.parse(r.body).data;
    if (!d || !d.ticket) return send(res, 401, { error: 'Login failed (two-factor authentication is not supported yet; use an API token)' });
    session = { host, ticket: d.ticket, csrf: d.CSRFPreventionToken, user: d.username };
  }
  session.created = Date.now();
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, session);
  send(res, 200, { user: session.user, host }, {
    'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`,
  });
}

async function handleApi(req, res, url) {
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'pvedash') return send(res, 403, { error: 'Forbidden' });
  if (url.pathname === '/api/config') return send(res, 200, { host: PVE_HOST || null });
  if (url.pathname === '/api/login' && req.method === 'POST') return handleLogin(req, res);
  const s = getSession(req);
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    if (s) sessions.delete(s.id);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (url.pathname === '/api/session') return s ? send(res, 200, { user: s.user, host: s.host }) : send(res, 401, { error: 'Not logged in' });
  if (!s) return send(res, 401, { error: 'Not logged in' });

  if (url.pathname.startsWith('/api/pve/')) {
    const target = url.pathname.slice('/api/pve'.length);
    if (target.includes('..')) return send(res, 400, { error: 'Bad path' });
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : undefined;
    const r = await pveRequest(s.host, req.method, target + url.search, { headers: authHeaders(s, req.method), body: body || (req.method === 'POST' || req.method === 'PUT' ? {} : undefined) });
    return send(res, r.status, r.body || '{}');
  }
  send(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, url) {
  let p = path.normalize(decodeURIComponent(url.pathname));
  if (p === '/' || p === path.sep) p = '/index.html';
  const file = path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, 502, { error: e.message || 'Proxy error' });
  }
});

if (require.main === module) {
  server.listen(PORT, BIND, () => console.log(`PVEDash listening on http://${BIND}:${PORT}${PVE_HOST ? ` -> ${PVE_HOST}` : ''}`));
}
module.exports = { server, normalizeHost };
