// api/control.js — NEXUS AI RELAY v8
// ═══════════════════════════════════════════════════════════════════
// FIX V8 — QUEUE SYSTEM:
//   Versi lama: simpan 1 command per user (file tunggal).
//   Masalah: kalau AI kirim 2 script, yang ke-2 OVERWRITE yang ke-1
//            sebelum plugin sempat baca → script pertama hilang!
//   Solusi: simpan ARRAY queue per user, plugin proses semuanya
//           sekaligus, lalu kirim reset untuk clear queue.
//
// ENDPOINT:
//   GET  ?user=xxx           → ambil seluruh queue (plugin polling)
//   GET  ?userinfo=1&userId= → proxy lookup Roblox username
//   GET  ?check=1&user=xxx   → cek apakah plugin online
//   GET  ?get_output&user=   → ambil captured console output
//   GET  ?get_workspace&user → ambil workspace scan terakhir
//   POST { type:"reset" }    → clear queue setelah plugin execute
//   POST { action: "..." }   → tambah command ke queue
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from 'fs';

const TMP = '/tmp';

// ── helpers file ──────────────────────────────────────────────────
function san(user) {
  return (user || 'default')
    .replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase().substring(0, 40);
}
function queueFile(u)  { return `${TMP}/nq_${san(u)}.json`; }
function pollFile(u)   { return `${TMP}/np_${san(u)}.txt`; }
function outFile(u)    { return `${TMP}/no_${san(u)}.json`; }
function wsFile(u)     { return `${TMP}/nw_${san(u)}.json`; }
const LOG_FILE  = `${TMP}/nexus_log.json`;
const HIST_FILE = `${TMP}/nexus_hist.json`;

// ── queue operations (ARRAY) ──────────────────────────────────────
function getQueue(u) {
  try { if (existsSync(queueFile(u))) return JSON.parse(readFileSync(queueFile(u), 'utf8')); }
  catch(_) {}
  return [];
}
function saveQueue(u, arr) {
  try { writeFileSync(queueFile(u), JSON.stringify(arr)); } catch(_) {}
}
function pushQueue(u, cmd) {
  const q = getQueue(u);
  q.push({ ...cmd, _ts: Date.now() });
  saveQueue(u, q);
}
function clearQueue(u) {
  saveQueue(u, []);
}

// ── poll tracking ─────────────────────────────────────────────────
function bumpPoll(u)  { try { writeFileSync(pollFile(u), String(Date.now())); } catch(_) {} }
function lastPoll(u)  { try { return parseInt(readFileSync(pollFile(u),'utf8')||'0'); } catch(_) { return 0; } }
function isOnline(u)  { return (Date.now()-lastPoll(u)) < 7000; }

// ── output / workspace ────────────────────────────────────────────
function saveOutput(u, arr) { try { writeFileSync(outFile(u), JSON.stringify({outputs:arr,ts:Date.now()})); } catch(_) {} }
function getOutputData(u)   { try { if(existsSync(outFile(u))) return JSON.parse(readFileSync(outFile(u),'utf8')); } catch(_) {} return {outputs:[]}; }

// ── logs ──────────────────────────────────────────────────────────
function pushLog(e) {
  try {
    let l = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE,'utf8')) : [];
    l.unshift({...e, ts:Date.now()});
    if(l.length>300) l=l.slice(0,300);
    writeFileSync(LOG_FILE, JSON.stringify(l));
  } catch(_) {}
}
function pushHist(e) {
  try {
    let h = existsSync(HIST_FILE) ? JSON.parse(readFileSync(HIST_FILE,'utf8')) : [];
    h.unshift({...e, ts:Date.now()});
    if(h.length>150) h=h.slice(0,150);
    writeFileSync(HIST_FILE, JSON.stringify(h));
  } catch(_) {}
}

// ── valid actions ─────────────────────────────────────────────────
const VALID = new Set([
  'none',
  // Script
  'inject_script','batch_inject',
  // Part / Model / Mesh
  'create_part','batch_create','insert_model','clone_object','create_mesh',
  // NPC
  'create_npc',
  // Sound
  'create_sound',
  // GUI
  'create_gui','create_billboard','create_surface_gui',
  // Interaction
  'create_proximity_prompt','create_click_detector',
  // Physics
  'weld_parts','create_tool','create_seat',
  // Effects
  'create_particle','create_light','add_effect',
  // Workspace management
  'clear_workspace','delete_object','delete_multiple','modify_part','select_object',
  // Instance creation (generic)
  'create_instance',
  // Folder / team / animation
  'create_folder','create_team','create_animation',
  // Lighting & environment
  'set_lighting','change_baseplate','fill_terrain','clear_terrain',
  // Spawn
  'create_spawn',
  // Value objects
  'set_value','create_value',
  // Remote events / functions
  'create_remote','batch_remote',
  // Code & print
  'print_output','get_output',
  // Workspace reading
  'read_workspace','workspace_data',
  // Misc
  'set_game_info','modify_humanoid',
]);

// ══════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method==='OPTIONS') return res.status(200).end();

  // ════════════════════════════════════════════════════════════════
  // GET
  // ════════════════════════════════════════════════════════════════
  if (req.method==='GET') {

    // ── Proxy userinfo (KRITIS: plugin tidak bisa fetch roblox.com langsung) ──
    if (req.query.userinfo==='1') {
      const uid = parseInt(req.query.userId||'0');
      if (!uid||uid<=0) return res.status(400).json({ok:false,error:'userId tidak valid'});
      try {
        const r = await fetch(`https://users.roblox.com/v1/users/${uid}`,{
          headers:{'Accept':'application/json'},
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) return res.status(502).json({ok:false,error:`Roblox API ${r.status}`});
        const d = await r.json();
        return res.status(200).json({
          ok: true, userId: uid,
          username: d.name||'', displayName: d.displayName||d.name||'',
        });
      } catch(e) {
        return res.status(500).json({ok:false,error:e.message});
      }
    }

    // ── Check apakah plugin online ──────────────────────────────
    if (req.query.check) {
      const u = san(req.query.user||'');
      const q = getQueue(u);
      return res.status(200).json({
        _pluginConnected: isOnline(u), _lastPoll: lastPoll(u),
        user: u, queueLength: q.length,
      });
    }

    // ── Ambil output konsol ────────────────────────────────────
    if (req.query.get_output) {
      const u = san(req.query.user||'');
      return res.status(200).json(getOutputData(u));
    }

    // ── Ambil workspace scan ───────────────────────────────────
    if (req.query.get_workspace) {
      const u = san(req.query.user||'');
      try {
        if (existsSync(wsFile(u))) return res.status(200).json(JSON.parse(readFileSync(wsFile(u),'utf8')));
      } catch(_) {}
      return res.status(200).json({ok:false,error:'Belum ada workspace data'});
    }

    // ── Plugin polling — kirim seluruh queue ──────────────────
    // Plugin mengambil SEMUA command sekaligus, eksekusi satu per satu,
    // lalu kirim POST reset untuk clear queue.
    const pu = san(req.query.user||req.query.u||'');
    if (!pu) return res.status(400).json({error:'parameter user diperlukan', queue:[]});

    bumpPoll(pu); // plugin masih hidup
    const q = getQueue(pu);
    return res.status(200).json({ queue: q, count: q.length });
  }

  // ════════════════════════════════════════════════════════════════
  // POST
  // ════════════════════════════════════════════════════════════════
  if (req.method==='POST') {
    const body = req.body || {};

    // ── Plugin: clear queue setelah execute ─────────────────────
    if (body.type==='reset' || (body.action==='none' && body.type)) {
      const u = san(body._user||body.user||'');
      if (u) clearQueue(u);
      return res.status(200).json({status:'ok',message:'Queue dibersihkan'});
    }

    // ── Plugin: status check ────────────────────────────────────
    if (body.type==='status') {
      const u = san(body.user||'');
      return res.status(200).json({connected:isOnline(u),lastPoll:lastPoll(u),age:Date.now()-lastPoll(u)});
    }

    // ── Plugin: workspace data ──────────────────────────────────
    if (body.action==='workspace_data') {
      const u = san(body._user||'');
      pushLog({action:'workspace_read',user:u});
      try { writeFileSync(wsFile(u), JSON.stringify({...body,_ts:Date.now()})); } catch(_) {}
      return res.status(200).json({status:'ok'});
    }

    // ── Plugin: output/console data ────────────────────────────
    if (body.action==='output_data') {
      const u = san(body._user||'');
      saveOutput(u, body.outputs||[]);
      return res.status(200).json({status:'ok',count:(body.outputs||[]).length});
    }

    // ── Admin: get logs ─────────────────────────────────────────
    if (body.type==='get_logs') {
      try {
        return res.status(200).json({logs: existsSync(LOG_FILE)?JSON.parse(readFileSync(LOG_FILE,'utf8')):[]});
      } catch(_) { return res.status(200).json({logs:[]}); }
    }

    // ── Admin: get history ──────────────────────────────────────
    if (body.type==='get_history') {
      try {
        return res.status(200).json({history: existsSync(HIST_FILE)?JSON.parse(readFileSync(HIST_FILE,'utf8')):[]});
      } catch(_) { return res.status(200).json({history:[]}); }
    }

    // ════════════════════════════════════════════════════════════
    // WEB / AI MENGIRIM COMMAND → PUSH KE QUEUE
    // Bisa single action ATAU array "batch_commands"
    // ════════════════════════════════════════════════════════════

    // ── Batch: kirim banyak command sekaligus ──────────────────
    // Contoh: { type: "batch_commands", target: "user", commands: [...] }
    if (body.type==='batch_commands' && Array.isArray(body.commands)) {
      const target = san(body.target||body._target_user||'');
      if (!target) return res.status(400).json({error:'target diperlukan'});

      let pushed = 0;
      for (const cmd of body.commands) {
        if (!cmd.action || !VALID.has(cmd.action)) continue;
        pushQueue(target, {
          ...cmd,
          _user: String(body._user||'web').substring(0,50),
          _target_user: target,
          _apiKey: undefined,
        });
        pushed++;
      }

      pushLog({action:'batch_commands',user:body._user||'web',target,count:pushed});
      pushHist({action:'batch_commands',details:`${pushed} commands`,user:body._user||'web',target});

      return res.status(200).json({
        status:'ok', pushed,
        pluginConnected: isOnline(target),
        queueLength: getQueue(target).length,
      });
    }

    // ── Single command ─────────────────────────────────────────
    if (body.action) {
      if (!VALID.has(body.action)) {
        return res.status(400).json({error:'Action tidak valid: '+body.action});
      }

      const target = san(body._target_user||body._user||'');
      if (!target) return res.status(400).json({error:'_target_user diperlukan'});

      pushQueue(target, {
        ...body,
        _user: String(body._user||'web').substring(0,50),
        _target_user: target,
        _apiKey: undefined,
      });

      pushLog({action:body.action,user:body._user||'web',target,name:body.name||'',parent:body.parent||''});
      pushHist({
        action:body.action,
        details: body.name||(body.code?body.code.substring(0,80)+'...':'')||JSON.stringify(body).substring(0,100),
        user:body._user||'web', target,
      });

      return res.status(200).json({
        status:'ok', action:body.action, target,
        pluginConnected: isOnline(target),
        queueLength: getQueue(target).length,
      });
    }

    // ── Prompt log ─────────────────────────────────────────────
    if (body.type==='prompt') {
      pushLog({action:'prompt',user:body.user||'web',msg:(body.msg||'').substring(0,100)});
      return res.status(200).json({status:'ok'});
    }

    return res.status(400).json({error:'Tipe request tidak dikenal'});
  }

  return res.status(405).json({error:'Method not allowed'});
}
