/**
 * NEXUS AI Bridge v3.2
 * PORT 3000 (or custom) → Web App
 * PORT 7777 → WebSocket
 * PORT 7778 → HTTP API (Roblox plugin)
 * Usage: node bridge.js [webPort]
 * Terminal: /output  /status  /quit  /help
 */
const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
let WebSocketServer;
try {
  const ws = require('ws');
  WebSocketServer = ws.WebSocketServer || ws.Server;
} catch(e) {
  console.error('\n\x1b[31m❌  Module "ws" not found!\x1b[0m');
  console.error('   Run: npm install ws\n');
  process.exit(1);
}

const WEB_PORT    = parseInt(process.argv[2]) || 3000;
const WS_PORT     = 7777;
const PLUGIN_PORT = 7778;

const webClients    = new Set();
const cmdQueue      = [];
let pluginConnected = false;
let placeInfo       = {};
let cmdId           = 0;
const connectedUsers = new Map();

function log(m, color) {
  const C = {green:'\x1b[32m',cyan:'\x1b[36m',yellow:'\x1b[33m',red:'\x1b[31m',reset:'\x1b[0m'};
  const pre = '[' + new Date().toLocaleTimeString('id-ID') + '] ';
  console.log((color ? C[color]||'' : '') + pre + m + C.reset);
}

// ── WebSocket ──
const wss = new WebSocketServer({ port: WS_PORT });
wss.on('listening', () => log('WS  :' + WS_PORT + ' active','cyan'));
wss.on('connection', (ws) => {
  webClients.add(ws);
  log('✅  Web client connected (total: ' + webClients.size + ')','green');
  safeSendTo(ws, { action:'bridgeReady', pluginConnected, placeInfo });
  ws.on('message', (data) => {
    try {
      const m = JSON.parse(data.toString());
      if (m.action === 'userLogin' && m.user) {
        connectedUsers.set(m.user.id, {...m.user, loginTime: new Date()});
        log('👤  Login: ' + m.user.username + ' (ID:' + m.user.id + ')','green');
        return;
      }
      if (m.action === 'userLogout') {
        const u = connectedUsers.get(m.userId);
        if (u) log('👤  Logout: ' + u.username,'yellow');
        connectedUsers.delete(m.userId); return;
      }
      m.id = ++cmdId; cmdQueue.push(m); log('CMD: ' + m.action);
    } catch(e) {}
  });
  ws.on('close', () => { webClients.delete(ws); log('Web client disconnected (remaining: ' + webClients.size + ')','yellow'); });
  ws.on('error', (e) => log('WS error: ' + e.message,'red'));
});

function safeSend(data) {
  const json = JSON.stringify(data);
  for (const c of webClients) { if (c.readyState===1) try { c.send(json); } catch(e) {} }
}
function safeSendTo(ws, data) {
  if (ws && ws.readyState===1) try { ws.send(JSON.stringify(data)); } catch(e) {}
}

// ── HTTP Bridge :7778 ──
const httpBridge = http.createServer((req, res) => {
  cors(res);
  if (req.method==='OPTIONS') { res.writeHead(200); res.end(); return; }
  const url = req.url.split('?')[0];
  if (req.method==='GET'  && url==='/poll') { json(res, cmdQueue.shift()||null); return; }
  if (req.method==='POST' && url==='/workspace') { body(req,d=>{try{const t=JSON.parse(d);log('Workspace: '+t.length+' svc');safeSend({action:'workspace',data:t});}catch(e){}res.end('ok')}); return; }
  if (req.method==='POST' && url==='/script')    { body(req,d=>{try{const p=JSON.parse(d);safeSend({action:'scriptContent',path:p.path,content:p.content});}catch(e){}res.end('ok')}); return; }
  if (req.method==='POST' && url==='/result')    { body(req,d=>{try{safeSend(JSON.parse(d));}catch(e){}res.end('ok')}); return; }
  if (req.method==='POST' && url==='/pluginConnected') {
    body(req, d => {
      try {
        const p = JSON.parse(d); pluginConnected=p.connected; placeInfo={id:p.placeId,name:p.placeName};
        log((pluginConnected ? '\x1b[32m🔌 Plugin connected' : '⚠  Plugin disconnected') + ' — ' + (p.placeName||''),'green');
        safeSend({action:'pluginStatus',connected:pluginConnected,placeInfo});
      } catch(e) {} res.end('ok');
    }); return;
  }
  if (req.method==='GET' && url==='/status') {
    json(res,{bridge:'NEXUS AI Bridge v3.2',webPort:WEB_PORT,wsPort:WS_PORT,pluginPort:PLUGIN_PORT,webConnected:webClients.size>0,webClientCount:webClients.size,pluginConnected,placeInfo,pending:cmdQueue.length,activeUsers:connectedUsers.size});
    return;
  }
  res.writeHead(404); res.end('not found');
});
httpBridge.listen(PLUGIN_PORT, () => log('HTTP:' + PLUGIN_PORT + ' active','cyan'));

// ── Web Server ──
const MIME = {'.html':'text/html;charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.svg':'image/svg+xml'};
const webServer = http.createServer((req, res) => {
  cors(res);
  if (req.method==='OPTIONS') { res.writeHead(200); res.end(); return; }
  const fp = path.join(__dirname, req.url==='/' ? 'index.html' : req.url);
  fs.readFile(fp, (err, data) => {
    if (err) { fs.readFile(path.join(__dirname,'index.html'),(e2,d2)=>{ if(e2){res.writeHead(404);res.end('Not found');return;} res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(d2);}); return; }
    res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'text/plain'}); res.end(data);
  });
});
webServer.listen(WEB_PORT, () => log('WEB :' + WEB_PORT + ' → http://localhost:' + WEB_PORT,'cyan'));

// ── Helpers ──
function cors(r){r.setHeader('Access-Control-Allow-Origin','*');r.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');r.setHeader('Access-Control-Allow-Headers','Content-Type');}
function json(r,d){r.setHeader('Content-Type','application/json');r.end(JSON.stringify(d));}
function body(r,cb){let s='';r.on('data',c=>s+=c);r.on('end',()=>cb(s));}

// ── Terminal Commands ──
function showStatus() {
  console.log('\n\x1b[36m══════════ NEXUS AI Bridge Status ══════════\x1b[0m');
  console.log('  Web    : http://localhost:' + WEB_PORT);
  console.log('  WS     : ws://localhost:' + WS_PORT);
  console.log('  Plugin : http://localhost:' + PLUGIN_PORT);
  console.log('  Web Clients : ' + webClients.size);
  console.log('  Plugin : ' + (pluginConnected ? '\x1b[32m● Connected\x1b[0m' : '\x1b[31m● Disconnected\x1b[0m'));
  if (placeInfo.name) console.log('  Place  : ' + placeInfo.name + ' (ID: ' + placeInfo.id + ')');
  console.log('  Pending CMDs: ' + cmdQueue.length);
  if (connectedUsers.size > 0) {
    console.log('  Active Users (' + connectedUsers.size + '):');
    for (const [id,u] of connectedUsers) console.log('    → ' + u.username + ' (ID:' + id + ') since ' + u.loginTime.toLocaleTimeString('id-ID'));
  } else console.log('  Active Users: 0');
  console.log('\x1b[36m════════════════════════════════════════════\x1b[0m\n');
}

const rl = readline.createInterface({input:process.stdin,output:process.stdout,terminal:false});
rl.on('line', line => {
  const cmd = line.trim().toLowerCase();
  if (cmd==='/output'||cmd==='/status') showStatus();
  else if (cmd==='/quit'||cmd==='/exit') { log('Bridge stopped.','yellow'); process.exit(0); }
  else if (cmd==='/help') console.log('\nCommands: /output  /status  /quit\n');
  else if (cmd) console.log('Unknown command. Type /help');
});

console.log('\x1b[36m╔══════════════════════════════════════╗');
console.log('║     NEXUS AI Bridge  v3.2            ║');
console.log('║  WEB  : http://localhost:' + WEB_PORT + '       ║');
console.log('║  WS   : ws://localhost:' + WS_PORT + '         ║');
console.log('║  HTTP : http://localhost:' + PLUGIN_PORT + '        ║');
console.log('║  Terminal: /output /status /quit     ║');
console.log('╚══════════════════════════════════════╝\x1b[0m\n');
process.on('uncaughtException', e=>log('Error: '+e.message,'red'));
process.on('SIGINT', ()=>{log('Bridge stopped.','yellow');process.exit(0);});
