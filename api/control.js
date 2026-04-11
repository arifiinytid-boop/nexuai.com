// api/control.js — NEXUS AI RELAY v5
// Hanya relay command. AI dipanggil langsung dari browser (index.html).

import { readFileSync, writeFileSync, existsSync } from 'fs';

const CMD_FILE  = '/tmp/nexus_cmd.json';
const POLL_FILE = '/tmp/nexus_poll.txt';
const LOG_FILE  = '/tmp/nexus_log.json';

function getCmd()   { try{ if(existsSync(CMD_FILE)) return JSON.parse(readFileSync(CMD_FILE,'utf8')); }catch(_){} return {action:'none'}; }
function setCmd(c)  { try{ writeFileSync(CMD_FILE, JSON.stringify(c)); }catch(_){} }
function bumpPoll() { try{ writeFileSync(POLL_FILE, String(Date.now())); }catch(_){} }
function lastPoll() { try{ return parseInt(readFileSync(POLL_FILE,'utf8')||'0'); }catch(_){ return 0; } }

function pushLog(entry) {
  try {
    let logs = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE,'utf8')) : [];
    logs.unshift({...entry, ts: Date.now()});
    if(logs.length > 100) logs = logs.slice(0,100);
    writeFileSync(LOG_FILE, JSON.stringify(logs));
  } catch(_) {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: Plugin polling ──────────────────────────────────────────
  if(req.method === 'GET') {
    bumpPoll();
    const cmd = getCmd();
    return res.status(200).json(cmd);
  }

  // ── POST ──────────────────────────────────────────────────────────
  if(req.method === 'POST') {
    const body = req.body || {};

    // Plugin: execution-done signal
    if(body.action === 'none' || body.type === 'reset') {
      setCmd({action:'none'});
      return res.status(200).json({status:'reset'});
    }

    // Web: check plugin status
    if(body.type === 'status') {
      const lp = lastPoll();
      return res.status(200).json({
        connected: (Date.now() - lp) < 8000,
        lastPoll:  lp
      });
    }

    // Web: get logs
    if(body.type === 'get_logs') {
      try {
        const logs = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE,'utf8')) : [];
        return res.status(200).json({logs});
      } catch(_) { return res.status(200).json({logs:[]}); }
    }

    // Web: direct command (inject_script, create_part, etc.)
    if(body.action) {
      setCmd(body);
      pushLog({action: body.action, user: body._user || 'web', name: body.name || ''});
      return res.status(200).json({status:'ok', command: body});
    }

    return res.status(400).json({error:'Unknown request type'});
  }

  return res.status(405).json({error:'Method not allowed'});
}
