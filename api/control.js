// api/control.js — NEXUS AI RELAY v10.3
// LogService + Script System + Workspace + Queue
import { readFileSync, writeFileSync, existsSync } from 'fs';

const TMP = '/tmp';
export const REQUIRED_PLUGIN_VERSION = 'V10.4';
export const WEB_VERSION = 'V10.4';

function san(user) {
  return (user || 'default').replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase().substring(0, 40);
}
function queueFile(u)    { return `${TMP}/nq_${san(u)}.json`; }
function pollFile(u)     { return `${TMP}/np_${san(u)}.txt`; }
function outFile(u)      { return `${TMP}/no_${san(u)}.json`; }
function wsFile(u)       { return `${TMP}/nw_${san(u)}.json`; }
function scriptFile(u)   { return `${TMP}/ns_${san(u)}.json`; }   // ← NEW: script content
function scriptListF(u)  { return `${TMP}/nsl_${san(u)}.json`; }  // ← NEW: script list
function logSvcFile(u)   { return `${TMP}/nlg_${san(u)}.json`; }  // ← NEW: LogService output
const LOG_FILE  = `${TMP}/nexus_log.json`;
const HIST_FILE = `${TMP}/nexus_hist.json`;

// ─── QUEUE HELPERS ───────────────────────────────────────
function getQueue(u) {
  try { if (existsSync(queueFile(u))) return JSON.parse(readFileSync(queueFile(u), 'utf8')); } catch(_) {}
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
function clearQueue(u) { saveQueue(u, []); }

// ─── POLL HELPERS ─────────────────────────────────────────
function bumpPoll(u) {
  try { writeFileSync(pollFile(u), String(Date.now())); } catch(_) {}
}
function lastPoll(u) {
  try { return parseInt(readFileSync(pollFile(u), 'utf8') || '0'); } catch(_) { return 0; }
}
function isOnline(u) { return (Date.now() - lastPoll(u)) < 7000; }

// ─── OUTPUT HELPERS ───────────────────────────────────────
function saveOutput(u, arr) {
  try { writeFileSync(outFile(u), JSON.stringify({ outputs: arr, ts: Date.now() })); } catch(_) {}
}
function getOutputData(u) {
  try { if (existsSync(outFile(u))) return JSON.parse(readFileSync(outFile(u), 'utf8')); } catch(_) {}
  return { outputs: [] };
}

// ─── LOG HELPERS ──────────────────────────────────────────
function pushLog(e) {
  try {
    let l = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, 'utf8')) : [];
    l.unshift({ ...e, ts: Date.now() });
    if (l.length > 300) l = l.slice(0, 300);
    writeFileSync(LOG_FILE, JSON.stringify(l));
  } catch(_) {}
}
function pushHist(e) {
  try {
    let h = existsSync(HIST_FILE) ? JSON.parse(readFileSync(HIST_FILE, 'utf8')) : [];
    h.unshift({ ...e, ts: Date.now() });
    if (h.length > 150) h = h.slice(0, 150);
    writeFileSync(HIST_FILE, JSON.stringify(h));
  } catch(_) {}
}

// ─── LOGSERVICE HELPERS (NEW V10.3) ───────────────────────
function saveLogSvc(u, logs) {
  try {
    let existing = [];
    try { if (existsSync(logSvcFile(u))) existing = JSON.parse(readFileSync(logSvcFile(u), 'utf8')); } catch(_) {}
    const combined = [...logs, ...existing].slice(0, 500);
    writeFileSync(logSvcFile(u), JSON.stringify(combined));
  } catch(_) {}
}
function getLogSvc(u) {
  try { if (existsSync(logSvcFile(u))) return JSON.parse(readFileSync(logSvcFile(u), 'utf8')); } catch(_) {}
  return [];
}

// ─── SCRIPT HELPERS (NEW V10.3) ───────────────────────────
function saveScriptContent(u, data) {
  try { writeFileSync(scriptFile(u), JSON.stringify({ ...data, _ts: Date.now() })); } catch(_) {}
}
function getScriptContent(u) {
  try { if (existsSync(scriptFile(u))) return JSON.parse(readFileSync(scriptFile(u), 'utf8')); } catch(_) {}
  return null;
}
function saveScriptList(u, data) {
  try { writeFileSync(scriptListF(u), JSON.stringify({ ...data, _ts: Date.now() })); } catch(_) {}
}
function getScriptList(u) {
  try { if (existsSync(scriptListF(u))) return JSON.parse(readFileSync(scriptListF(u), 'utf8')); } catch(_) {}
  return null;
}

// ─── VALID ACTIONS ────────────────────────────────────────
const VALID = new Set([
  'none',
  // Script actions (NEW V10.3)
  'read_script', 'edit_script', 'list_scripts', 'scan_workspace', 'get_logs', 'search_instances',
  // Inject
  'inject_script', 'batch_inject', 'run_lua', 'batch_modify',
  // Parts / Models
  'create_part', 'batch_create', 'create_wedge', 'create_cylinder', 'create_sphere', 'create_truss',
  'create_model', 'insert_model', 'clone_object', 'create_mesh',
  // Folders
  'create_folder',
  // Remotes
  'create_remote', 'batch_remote',
  // Values
  'create_value', 'set_value',
  // NPC / Characters
  'create_npc', 'create_humanoid', 'modify_humanoid',
  // GUI
  'create_gui', 'create_billboard', 'create_surface_gui',
  // Interaction
  'create_proximity_prompt', 'create_click_detector', 'create_selectbox',
  // Joints / Constraints
  'weld_parts', 'create_weld', 'create_attachment', 'create_motor6d',
  'create_constraint', 'create_hinge',
  // Tools
  'create_tool', 'create_seat', 'create_hat',
  // Effects
  'create_particle', 'create_light', 'add_effect',
  'create_fire', 'create_smoke', 'create_sparkles',
  'create_trail', 'create_beam',
  // Sound
  'create_sound',
  // Terrain / World
  'fill_terrain', 'clear_terrain', 'change_baseplate',
  'create_sky', 'create_water',
  // Spawn
  'create_spawn',
  // Lighting
  'set_lighting',
  // Animation
  'create_animation',
  // Decals
  'place_decal', 'place_texture',
  // Teams
  'create_team',
  // Building helpers
  'create_door', 'create_window', 'create_stairs', 'create_ramp',
  'create_tree', 'create_rock',
  // Object manipulation
  'modify_part', 'set_property', 'copy_properties',
  'move_object', 'rotate_object', 'resize_object',
  'select_object', 'delete_object', 'delete_multiple',
  'group_parts', 'ungroup_model', 'anchor_all', 'unanchor_all',
  // Instance
  'create_instance',
  // Output / Debug
  'print_output', 'get_output',
  // Workspace
  'read_workspace', 'workspace_data',
  // Batch
  'batch_commands',
  // Misc
  'set_game_info', 'clear_workspace',
]);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ══════════════════════════════════════════════════════════
  // GET
  // ══════════════════════════════════════════════════════════
  if (req.method === 'GET') {

    // Version check
    if (req.query.version === '1') {
      return res.status(200).json({
        ok: true,
        required_plugin_version: REQUIRED_PLUGIN_VERSION,
        web_version: WEB_VERSION,
        update_url: 'https://discord.gg/HuGtbRvD',
        changelog: 'V10.3: LogService, Script Read/Edit/Create, Full Classname Support',
      });
    }

    // User info proxy
    if (req.query.userinfo === '1') {
      const uid = parseInt(req.query.userId || '0');
      if (!uid || uid <= 0) return res.status(400).json({ ok: false, error: 'Invalid userId' });
      try {
        const r = await fetch(
          `https://users.roblox.com/v1/users/${uid}`,
          { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) }
        );
        if (!r.ok) return res.status(502).json({ ok: false, error: `Roblox API ${r.status}` });
        const d = await r.json();
        return res.status(200).json({
          ok: true, userId: uid,
          username: d.name || '',
          displayName: d.displayName || d.name || '',
        });
      } catch(e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }

    // Plugin status check
    if (req.query.check) {
      const u = san(req.query.user || '');
      return res.status(200).json({
        _pluginConnected: isOnline(u),
        _lastPoll: lastPoll(u),
        user: u,
        queueLength: getQueue(u).length,
        required_plugin_version: REQUIRED_PLUGIN_VERSION,
        web_version: WEB_VERSION,
      });
    }

    // Get output
    if (req.query.get_output) {
      const u = san(req.query.user || '');
      return res.status(200).json(getOutputData(u));
    }

    // Get workspace
    if (req.query.get_workspace) {
      const u = san(req.query.user || '');
      try {
        if (existsSync(wsFile(u))) return res.status(200).json(JSON.parse(readFileSync(wsFile(u), 'utf8')));
      } catch(_) {}
      return res.status(200).json({ ok: false, error: 'No workspace data' });
    }

    // ── NEW V10.3: Get script content ──
    if (req.query.get_script) {
      const u = san(req.query.user || '');
      const content = getScriptContent(u);
      if (content) return res.status(200).json({ ok: true, ...content });
      return res.status(200).json({ ok: false, error: 'No script content available' });
    }

    // ── NEW V10.3: Get script list ──
    if (req.query.get_script_list) {
      const u = san(req.query.user || '');
      const list = getScriptList(u);
      if (list) return res.status(200).json({ ok: true, ...list });
      return res.status(200).json({ ok: false, error: 'No script list available' });
    }

    // ── NEW V10.3: Get LogService output ──
    if (req.query.get_logsvc) {
      const u = san(req.query.user || '');
      const logs = getLogSvc(u);
      return res.status(200).json({ ok: true, logs, count: logs.length });
    }

    // Plugin polling
    const pu = san(req.query.user || req.query.u || '');
    if (!pu) return res.status(400).json({ error: 'user required', queue: [] });
    bumpPoll(pu);
    const q = getQueue(pu);
    return res.status(200).json({
      queue: q, count: q.length,
      required_plugin_version: REQUIRED_PLUGIN_VERSION,
      web_version: WEB_VERSION,
    });
  }

  // ══════════════════════════════════════════════════════════
  // POST
  // ══════════════════════════════════════════════════════════
  if (req.method === 'POST') {
    const body = req.body || {};

    // Reset queue
    if (body.type === 'reset' || (body.action === 'none' && body.type)) {
      const u = san(body._user || body.user || '');
      if (u) clearQueue(u);
      return res.status(200).json({ status: 'ok' });
    }

    // Status
    if (body.type === 'status') {
      const u = san(body.user || '');
      return res.status(200).json({
        connected: isOnline(u), lastPoll: lastPoll(u),
        required_plugin_version: REQUIRED_PLUGIN_VERSION,
        web_version: WEB_VERSION,
      });
    }

    // Workspace data from plugin
    if (body.action === 'workspace_data') {
      const u = san(body._user || '');
      pushLog({ action: 'workspace_read', user: u });
      try { writeFileSync(wsFile(u), JSON.stringify({ ...body, _ts: Date.now() })); } catch(_) {}
      return res.status(200).json({ status: 'ok' });
    }

    // Output data from plugin
    if (body.action === 'output_data') {
      const u = san(body._user || '');
      saveOutput(u, body.outputs || []);
      return res.status(200).json({ status: 'ok' });
    }

    // ── NEW V10.3: Script content from plugin (read_script result) ──
    if (body.action === 'script_content' || body.type === 'script_content') {
      const u = san(body._user || '');
      saveScriptContent(u, {
        name: body.name || '',
        parent: body.parent || '',
        scriptType: body.scriptType || 'Script',
        source: body.source || '',
        lineCount: body.lineCount || 0,
      });
      pushLog({ action: 'script_read', user: u, name: body.name, parent: body.parent });
      return res.status(200).json({ status: 'ok', name: body.name, lineCount: body.lineCount });
    }

    // ── NEW V10.3: Script list from plugin ──
    if (body.action === 'script_list' || body.type === 'script_list') {
      const u = san(body._user || '');
      saveScriptList(u, {
        parent: body.parent || '',
        scripts: body.scripts || [],
        count: body.count || 0,
      });
      pushLog({ action: 'script_list', user: u, parent: body.parent, count: body.count });
      return res.status(200).json({ status: 'ok', count: body.count });
    }

    // ── NEW V10.3: LogService output from plugin ──
    if (body.action === 'log_output' || body.type === 'log_output') {
      const u = san(body._user || '');
      const logs = body.logs || [];
      saveLogSvc(u, logs);
      return res.status(200).json({ status: 'ok', received: logs.length });
    }

    // Get logs
    if (body.type === 'get_logs') {
      try {
        return res.status(200).json({
          logs: existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, 'utf8')) : [],
        });
      } catch(_) { return res.status(200).json({ logs: [] }); }
    }

    // Get history
    if (body.type === 'get_history') {
      try {
        return res.status(200).json({
          history: existsSync(HIST_FILE) ? JSON.parse(readFileSync(HIST_FILE, 'utf8')) : [],
        });
      } catch(_) { return res.status(200).json({ history: [] }); }
    }

    // Batch commands
    if (body.type === 'batch_commands' && Array.isArray(body.commands)) {
      const target = san(body.target || body._target_user || '');
      if (!target) return res.status(400).json({ error: 'target required' });
      let pushed = 0;
      for (const cmd of body.commands) {
        if (!cmd.action || !VALID.has(cmd.action)) continue;
        pushQueue(target, {
          ...cmd,
          _user: String(body._user || 'web').substring(0, 50),
          _target_user: target,
          _apiKey: undefined,
        });
        pushed++;
      }
      pushLog({ action: 'batch_commands', user: body._user || 'web', target, count: pushed });
      return res.status(200).json({
        status: 'ok', pushed,
        pluginConnected: isOnline(target),
        queueLength: getQueue(target).length,
        required_plugin_version: REQUIRED_PLUGIN_VERSION,
      });
    }

    // JSON executor — parse ```json blocks from AI response
    if (body.type === 'execute_json' && body.text) {
      const target = san(body._target_user || body._user || '');
      if (!target) return res.status(400).json({ error: '_target_user required' });
      const jsonBlockRe = /```json\s*([\s\S]*?)```/g;
      let match, pushed = 0;
      const errors = [];
      while ((match = jsonBlockRe.exec(body.text)) !== null) {
        try {
          const parsed = JSON.parse(match[1].trim());
          const cmds = Array.isArray(parsed) ? parsed : [parsed];
          for (const cmd of cmds) {
            if (!cmd.action) continue;
            if (cmd.action === 'batch_commands' && Array.isArray(cmd.commands)) {
              for (const subCmd of cmd.commands) {
                if (!subCmd.action || !VALID.has(subCmd.action)) continue;
                pushQueue(target, {
                  ...subCmd,
                  _user: String(body._user || 'web').substring(0, 50),
                  _target_user: target, _apiKey: undefined,
                });
                pushed++;
              }
            } else if (VALID.has(cmd.action)) {
              pushQueue(target, {
                ...cmd,
                _user: String(body._user || 'web').substring(0, 50),
                _target_user: target, _apiKey: undefined,
              });
              pushed++;
            }
          }
        } catch(e) { errors.push(e.message); }
      }
      pushLog({ action: 'execute_json', user: body._user || 'web', target, count: pushed });
      return res.status(200).json({
        status: 'ok', pushed, errors,
        pluginConnected: isOnline(target),
        queueLength: getQueue(target).length,
      });
    }

    // Single command
    if (body.action) {
      if (!VALID.has(body.action)) {
        return res.status(400).json({ error: 'Invalid action: ' + body.action });
      }
      const target = san(body._target_user || body._user || '');
      if (!target) return res.status(400).json({ error: '_target_user required' });
      pushQueue(target, {
        ...body,
        _user: String(body._user || 'web').substring(0, 50),
        _target_user: target, _apiKey: undefined,
      });
      pushLog({
        action: body.action, user: body._user || 'web', target,
        name: body.name || '', parent: body.parent || '',
      });
      pushHist({
        action: body.action,
        details: body.name || (body.code ? body.code.substring(0, 80) + '...' : '') || JSON.stringify(body).substring(0, 100),
        user: body._user || 'web', target,
      });
      return res.status(200).json({
        status: 'ok', action: body.action, target,
        pluginConnected: isOnline(target),
        queueLength: getQueue(target).length,
        required_plugin_version: REQUIRED_PLUGIN_VERSION,
      });
    }

    // Prompt log
    if (body.type === 'prompt') {
      pushLog({ action: 'prompt', user: body.user || 'web', msg: (body.msg || '').substring(0, 100) });
      return res.status(200).json({ status: 'ok' });
    }

    return res.status(400).json({ error: 'Unknown request type' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
