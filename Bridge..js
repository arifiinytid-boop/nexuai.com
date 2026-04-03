/**
 * NEXUS AI Bridge v3.1 — FIXED
 * PORT 3000 → Web App (static HTML)
 * PORT 7777 → WebSocket (real-time, multi-client)
 * PORT 7778 → HTTP API (Roblox plugin)
 * Jalankan: node bridge.js
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
let   WebSocketServer;

try {
  const ws = require('ws');
  WebSocketServer = ws.WebSocketServer || ws.Server;
} catch(e) {
  console.error('\n❌  Module "ws" tidak ditemukan!');
  console.error('    Jalankan: npm install ws\n');
  process.exit(1);
}

// FIX: Support multiple web clients (bukan hanya 1)
const webClients    = new Set();
const cmdQueue      = [];
let pluginConnected = false;
let placeInfo       = {};
let cmdId           = 0;

// ── WebSocket :7777 (multi-client) ──
const wss = new WebSocketServer({ port: 7777 });
wss.on('listening', () => log('WS  :7777 aktif'));
wss.on('connection', (ws) => {
  log('✅  Web client terhubung (total: ' + (webClients.size + 1) + ')');
  webClients.add(ws);
  // Kirim status saat connect
  safeSendTo(ws, { action: 'bridgeReady', pluginConnected, placeInfo });
  ws.on('message', (data) => {
    try {
      const m = JSON.parse(data.toString());
      m.id = ++cmdId;
      cmdQueue.push(m);
      log('CMD: ' + m.action);
    } catch(e) {}
  });
  ws.on('close',  () => {
    webClients.delete(ws);
    log('Web client terputus (sisa: ' + webClients.size + ')');
  });
  ws.on('error',  (e) => log('WS err: ' + e.message));
});

// Kirim ke semua web clients
function safeSend(data) {
  const json = JSON.stringify(data);
  for (const client of webClients) {
    if (client.readyState === 1) {
      try { client.send(json); } catch(e) {}
    }
  }
}
// Kirim ke satu client
function safeSendTo(ws, data) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(data)); } catch(e) {}
  }
}

// ── HTTP Bridge :7778 (Roblox Plugin) ──
const httpBridge = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/poll') {
    json(res, cmdQueue.shift() || null);
    return;
  }
  if (req.method === 'POST' && url === '/workspace') {
    body(req, d => {
      try {
        const t = JSON.parse(d);
        log('Workspace: ' + t.length + ' services');
        safeSend({ action: 'workspace', data: t });
      } catch(e) {}
      res.end('ok');
    });
    return;
  }
  if (req.method === 'POST' && url === '/script') {
    body(req, d => {
      try {
        const p = JSON.parse(d);
        safeSend({ action: 'scriptContent', path: p.path, content: p.content });
      } catch(e) {}
      res.end('ok');
    });
    return;
  }
  if (req.method === 'POST' && url === '/result') {
    body(req, d => {
      try { safeSend(JSON.parse(d)); } catch(e) {}
      res.end('ok');
    });
    return;
  }
  if (req.method === 'POST' && url === '/pluginConnected') {
    body(req, d => {
      try {
        const p = JSON.parse(d);
        pluginConnected = p.connected;
        placeInfo = { id: p.placeId, name: p.placeName };
        log((pluginConnected ? '🔌 Plugin terhubung' : '⚠ Plugin putus') + ' — ' + (p.placeName || ''));
        safeSend({ action: 'pluginStatus', connected: pluginConnected, placeInfo });
      } catch(e) {}
      res.end('ok');
    });
    return;
  }
  if (req.method === 'GET' && url === '/status') {
    json(res, {
      bridge: 'NEXUS AI Bridge v3.1',
      webConnected: webClients.size > 0,
      webClientCount: webClients.size,
      pluginConnected,
      placeInfo,
      pending: cmdQueue.length
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});
httpBridge.listen(7778, () => log('HTTP:7778 aktif'));

// ── Web Server :3000 (FIX: hapus duplikasi listen!) ──
const MIME = {
  '.html': 'text/html;charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon'
};
const webServer = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  const fp   = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const mime = MIME[path.extname(fp)] || 'text/plain';
  fs.readFile(fp, (err, data) => {
    if (err) {
      fs.readFile(path.join(__dirname, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
        res.end(d2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

// FIX: Hanya listen SEKALI (sebelumnya duplikat → error!)
webServer.listen(3000, () => {
  log('WEB :3000 aktif → http://localhost:3000');
});

// ── Helpers ──
function cors(r) {
  r.setHeader('Access-Control-Allow-Origin', '*');
  r.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  r.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(r, d) {
  r.setHeader('Content-Type', 'application/json');
  r.end(JSON.stringify(d));
}
function body(r, cb) {
  let s = '';
  r.on('data', c => s += c);
  r.on('end', () => cb(s));
}
function log(m) {
  console.log('[' + new Date().toLocaleTimeString('id-ID') + '] ' + m);
}

console.log('\x1b[36m╔══════════════════════════════════════╗');
console.log('║     NEXUS AI Bridge  v3.1 FIXED      ║');
console.log('║  WEB  : http://localhost:3000        ║');
console.log('║  WS   : ws://localhost:7777          ║');
console.log('║  HTTP : http://localhost:7778        ║');
console.log('║  Multi web-client: ✓                 ║');
console.log('╚══════════════════════════════════════╝\x1b[0m\n');

process.on('uncaughtException', e => log('Error: ' + e.message));
process.on('SIGINT', () => { log('Bridge berhenti.'); process.exit(0); });
