// api/control.js — NEXUS AI RELAY v10.5
// LogService + Script System + Workspace + Queue + Enhanced Validation
import { readFileSync, writeFileSync, existsSync } from 'fs';

const TMP = '/tmp';
export const REQUIRED_PLUGIN_VERSION = 'V10.4';
export const WEB_VERSION = 'V10.4';

// ─── SANITIZE ─────────────────────────────────────────────
function san(user) {
  return (user || 'default').replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase().substring(0, 40);
}

// ─── FILE PATHS ───────────────────────────────────────────
function queueFile(u)    { return `${TMP}/nq_${san(u)}.json`; }
function pollFile(u)     { return `${TMP}/np_${san(u)}.txt`; }
function outFile(u)      { return `${TMP}/no_${san(u)}.json`; }
function wsFile(u)       { return `${TMP}/nw_${san(u)}.json`; }
function scriptFile(u)   { return `${TMP}/ns_${san(u)}.json`; }
function scriptListF(u)  { return `${TMP}/nsl_${san(u)}.json`; }
function logSvcFile(u)   { return `${TMP}/nlg_${san(u)}.json`; }
const LOG_FILE  = `${TMP}/nexus_log.json`;
const HIST_FILE = `${TMP}/nexus_hist.json`;

// ─── QUEUE HELPERS ────────────────────────────────────────
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
  // Limit queue size to 200 to prevent memory issues
  if (q.length > 200) q.splice(0, q.length - 200);
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
// Plugin is online if it polled within last 7 seconds
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

// ─── LOGSERVICE HELPERS ───────────────────────────────────
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

// ─── SCRIPT HELPERS ───────────────────────────────────────
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
const VALID_ACTIONS = new Set([
  'none', 'read_script', 'edit_script', 'list_scripts', 'scan_workspace',
  'get_logs', 'search_instances', 'get_output', 'print_output',
  'inject_script', 'batch_inject', 'run_lua', 'batch_modify',
  'create_part', 'batch_create', 'create_wedge', 'create_cylinder',
  'create_sphere', 'create_truss', 'create_model', 'insert_model',
  'clone_object', 'create_mesh', 'create_folder',
  'create_remote', 'batch_remote', 'create_value', 'set_value',
  'create_npc', 'create_humanoid', 'modify_humanoid',
  'create_gui', 'create_billboard', 'create_surface_gui',
  'create_proximity_prompt', 'create_click_detector', 'create_selectbox',
  'weld_parts', 'create_weld', 'create_attachment', 'create_motor6d',
  'create_constraint', 'create_hinge', 'create_tool', 'create_seat', 'create_hat',
  'create_particle', 'create_light', 'add_effect', 'create_fire', 'create_smoke',
  'create_sparkles', 'create_trail', 'create_beam', 'create_sound',
  'fill_terrain', 'clear_terrain', 'change_baseplate', 'create_sky',
  'create_water', 'create_atmosphere', 'create_spawn', 'set_lighting',
  'create_animation', 'place_decal', 'place_texture', 'create_team',
  'create_door', 'create_window', 'create_stairs', 'create_ramp',
  'create_tree', 'create_rock', 'create_wall',
  'modify_part', 'set_property', 'copy_properties',
  'move_object', 'rotate_object', 'resize_object',
  'select_object', 'delete_object', 'delete_multiple',
  'group_parts', 'ungroup_model', 'anchor_all', 'unanchor_all',
  'create_instance', 'read_workspace', 'workspace_data',
  'batch_commands', 'set_camera', 'set_game_info', 'clear_workspace',
  'teleport_player', 'play_test', 'run_test', 'stop_test',
]);

// ─── RATE LIMITING (simple per-user) ──────────────────────
const rateLimits = new Map();
function checkRateLimit(user, maxPerMinute = 120) {
  const now = Date.now();
  const key = san(user);
  if (!rateLimits.has(key)) rateLimits.set(key, { count: 0, reset: now + 60000 });
  const rl = rateLimits.get(key);
  if (now > rl.reset) { rl.count = 0; rl.reset = now + 60000; }
  rl.count++;
  return rl.count <= maxPerMinute;
}

// ─── MAIN HANDLER ─────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ══════════════════════════════════════════════════════════
  // GET ENDPOINTS
  // ══════════════════════════════════════════════════════════
  if (req.method === 'GET') {

    // ── Version check ──────────────────────────────────────
    if (req.query.version === '1') {
      return res.status(200).json({
        ok: true,
        required_plugin_version: REQUIRED_PLUGIN_VERSION,
        web_version: WEB_VERSION,
        update_url: 'https://discord.gg/HuGtbRvD',
        changelog: 'V10.5: Enhanced validation, rate limiting, full classname support, batch improvements',
        features: ['LogService', 'Script Read/Edit/Create', 'Workspace Scan', 'Full Classname Support', 'Batch Commands', '50+ Actions'],
      });
    }

    // ── User info proxy (Roblox API) ──────────────────────
    if (req.query.userinfo === '1') {
      const uid = parseInt(req.query.userId || '0');
      if (!uid || uid <= 0 || uid > 9999999999) {
        return res.status(400).json({ ok: false, error: 'Invalid userId' });
      }
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
          isBanned: d.isBanned || false,
        });
      } catch(e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }

    // ── Plugin status check ────────────────────────────────
    if (req.query.check) {
      const u = san(req.query.user || '');
      const online = isOnline(u);
      return res.status(200).json({
        _pluginConnected: online,
        connected: online,
        online: online,
        _lastPoll: lastPoll(u),
        user: u,
        queueLength: getQueue(u).length,
        required_plugin_version: REQUIRED_PLUGIN_VERSION,
        web_version: WEB_VERSION,
      });
    }

    // ── Get plugin output ──────────────────────────────────
    if (req.query.get_output) {
      const u = san(req.query.user || '');
      return res.status(200).json(getOutputData(u));
    }

    // ── Get workspace data ─────────────────────────────────
    if (req.query.get_workspace) {
      const u = san(req.query.user || '');
      try {
        if (existsSync(wsFile(u))) return res.status(200).json(JSON.parse(readFileSync(wsFile(u), 'utf8')));
      } catch(_) {}
      return res.status(200).json({ ok: false, error: 'No workspace data' });
    }

    // ── Get script content ─────────────────────────────────
    if (req.query.get_script) {
      const u = san(req.query.user || '');
      const content = getScriptContent(u);
      if (content) return res.status(200).json({ ok: true, ...content });
      return res.status(200).json({ ok: false, error: 'No script content available' });
    }

    // ── Get script list ────────────────────────────────────
    if (req.query.get_script_list) {
      const u = san(req.query.user || '');
      const list = getScriptList(u);
      if (list) return res.status(200).json({ ok: true, ...list });
      return res.status(200).json({ ok: false, error: 'No script list available' });
    }

    // ── Get LogService output ──────────────────────────────
    if (req.query.get_logsvc) {
      const u = san(req.query.user || '');
      const logs = getLogSvc(u);
      const since = parseInt(req.query.since || '0');
      const filtered = since ? logs.filter(l => (l.ts || 0) > since) : logs;
      return res.status(200).json({ ok: true, logs: filtered, count: filtered.length });
    }

    // ── Activity logs ──────────────────────────────────────
    if (req.query.get_logs) {
      try {
        const logs = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, 'utf8')) : [];
        return res.status(200).json({ ok: true, logs, count: logs.length });
      } catch(_) { return res.status(200).json({ ok: true, logs: [] }); }
    }

    // ── Clear queue for user ───────────────────────────────
    if (req.query.clear_queue) {
      const u = san(req.query.user || '');
      clearQueue(u);
      return res.status(200).json({ ok: true, message: 'Queue cleared' });
    }

    // ── Plugin polling (default GET) ───────────────────────
    const pu = san(req.query.user || req.query.u || '');
    if (!pu) return res.status(400).json({ error: 'user required', queue: [] });
    bumpPoll(pu);
    const q = getQueue(pu);
    // Clear queue after delivering
    if (q.length > 0) clearQueue(pu);
    return res.status(200).json({
      queue: q,
      count: q.length,
      required_plugin_version: REQUIRED_PLUGIN_VERSION,
      web_version: WEB_VERSION,
    });
  }

  // ══════════════════════════════════════════════════════════
  // POST ENDPOINTS
  // ══════════════════════════════════════════════════════════
  if (req.method === 'POST') {
    const body = req.body || {};

    // ── Rate limit check ───────────────────────────────────
    const ratUser = san(body._user || body.user || 'anon');
    if (!checkRateLimit(ratUser, 120)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Max 120 requests/minute.' });
    }

    // ── Reset queue ────────────────────────────────────────
    if (body.type === 'reset' || (body.action === 'none' && body.type)) {
      const u = san(body._user || body.user || '');
      if (u) clearQueue(u);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Status check ───────────────────────────────────────
    if (body.type === 'status') {
      const u = san(body.user || '');
      return res.status(200).json({
        connected: isOnline(u),
        online: isOnline(u),
        lastPoll: lastPoll(u),
        required_plugin_version: REQUIRED_PLUGIN_VERSION,
        web_version: WEB_VERSION,
      });
    }

    // ── Workspace data from plugin ─────────────────────────
    if (body.action === 'workspace_data') {
      const u = san(body._user || '');
      pushLog({ action: 'workspace_read', user: u, ts: Date.now() });
      try { writeFileSync(wsFile(u), JSON.stringify({ ...body, _ts: Date.now() })); } catch(_) {}
      return res.status(200).json({ status: 'ok' });
    }

    // ── Output data from plugin ────────────────────────────
    if (body.action === 'output_data') {
      const u = san(body._user || '');
      saveOutput(u, body.outputs || []);
      return res.status(200).json({ status: 'ok' });
    }

    // ── Script content from plugin ─────────────────────────
    if (body.action === 'script_content' || body.type === 'script_content') {
      const u = san(body._user || '');
      saveScriptContent(u, {
        name: body.name || '',
        parent: body.parent || '',
        scriptType: body.scriptType || 'Script',
        source: body.source || '',
        lineCount: body.lineCount || 0,
        updatedAt: Date.now(),
      });
      pushLog({ action: 'script_read', user: u, name: body.name, parent: body.parent });
      return res.status(200).json({ status: 'ok', name: body.name, lineCount: body.lineCount });
    }

    // ── Script list from plugin ────────────────────────────
    if (body.action === 'script_list' || body.type === 'script_list') {
      const u = san(body._user || '');
      saveScriptList(u, {
        parent: body.parent || '',
        scripts: body.scripts || [],
        count: body.count || 0,
        updatedAt: Date.now(),
      });
      pushLog({ action: 'script_list', user: u, parent: body.parent, count: body.count });
      return res.status(200).json({ status: 'ok', count: body.count });
    }

    // ── LogService output from plugin ──────────────────────
    if (body.action === 'log_output' || body.type === 'log_output') {
      const u = san(body._user || '');
      const logs = Array.isArray(body.logs) ? body.logs.slice(0, 100) : [];
      saveLogSvc(u, logs);
      return res.status(200).json({ status: 'ok', received: logs.length });
    }

    // ── Get activity logs ──────────────────────────────────
    if (body.type === 'get_logs') {
      try {
        const logs = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, 'utf8')) : [];
        return res.status(200).json({ logs });
      } catch(_) { return res.status(200).json({ logs: [] }); }
    }

    // ── Get history ────────────────────────────────────────
    if (body.type === 'get_history') {
      try {
        const hist = existsSync(HIST_FILE) ? JSON.parse(readFileSync(HIST_FILE, 'utf8')) : [];
        return res.status(200).json({ history: hist });
      } catch(_) { return res.status(200).json({ history: [] }); }
    }

    // ── Batch commands ─────────────────────────────────────
    if (body.type === 'batch_commands' && Array.isArray(body.commands)) {
      const target = san(body.target || body._target_user || '');
      if (!target) return res.status(400).json({ error: 'target required' });
      let pushed = 0;
      const skipped = [];
      for (const cmd of body.commands) {
        if (!cmd.action) continue;
        if (!VALID_ACTIONS.has(cmd.action)) {
          skipped.push(cmd.action);
          continue;
        }
        pushQueue(target, {
          ...cmd,
          _user: String(body._user || 'web').substring(0, 50),
          _target_user: target,
          _apiKey: undefined,
        });
        pushed++;
      }
      pushLog({ action: 'batch_commands', user: body._user || 'web', target, count: pushed, skipped });
      return res.status(200).json({
        status: 'ok',
        pushed,
        skipped,
        pluginConnected: isOnline(target),
        queueLength: getQueue(target).length,
        required_plugin_version: REQUIRED_PLUGIN_VERSION,
      });
    }

    // ── JSON executor (parse ```json blocks from AI text) ──
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
                if (!subCmd.action || !VALID_ACTIONS.has(subCmd.action)) continue;
                pushQueue(target, { ...subCmd, _user: String(body._user||'web').substring(0,50), _target_user: target, _apiKey: undefined });
                pushed++;
              }
            } else if (VALID_ACTIONS.has(cmd.action)) {
              pushQueue(target, { ...cmd, _user: String(body._user||'web').substring(0,50), _target_user: target, _apiKey: undefined });
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

    // ── Inject command wrapper ─────────────────────────────
    if (body.type === 'inject_command' && body.command) {
      const target = san(body._target_user || body._user || '');
      if (!target) return res.status(400).json({ error: 'target required' });
      const cmd = body.command;
      if (!cmd.action || !VALID_ACTIONS.has(cmd.action)) {
        return res.status(400).json({ error: 'Invalid action: ' + (cmd.action || 'none') });
      }
      pushQueue(target, { ...cmd, _user: String(body._user||'web').substring(0,50), _target_user: target });
      pushLog({ action: cmd.action, user: body._user||'web', target, name: cmd.name||'' });
      return res.status(200).json({
        status: 'ok', pushed: 1,
        pluginConnected: isOnline(target),
        queueLength: getQueue(target).length,
      });
    }

    // ── Single command ─────────────────────────────────────
    if (body.action) {
      if (!VALID_ACTIONS.has(body.action)) {
        return res.status(400).json({ error: 'Invalid action: ' + body.action, valid_actions: [...VALID_ACTIONS] });
      }
      const target = san(body._target_user || body._user || '');
      if (!target) return res.status(400).json({ error: '_target_user required' });
      pushQueue(target, {
        ...body,
        _user: String(body._user || 'web').substring(0, 50),
        _target_user: target,
        _apiKey: undefined,
      });
      pushLog({
        action: body.action,
        user: body._user || 'web',
        target,
        name: body.name || '',
        parent: body.parent || '',
      });
      pushHist({
        action: body.action,
        details: body.name || (body.code ? body.code.substring(0, 80) + '...' : '') || JSON.stringify(body).substring(0, 100),
        user: body._user || 'web',
        target,
      });
      return res.status(200).json({
        status: 'ok',
        action: body.action,
        target,
        pluginConnected: isOnline(target),
        queueLength: getQueue(target).length,
        required_plugin_version: REQUIRED_PLUGIN_VERSION,
      });
    }

    return res.status(400).json({ error: 'Unknown request type', body_keys: Object.keys(body) });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
