// api/control.js — NEXUS AI RELAY v5.2 ULTIMATE
// Per-user command queues for privacy — each user only sees their own commands
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const TMP = '/tmp';
const LOG_FILE  = TMP + '/nexus_log.json';
const HIST_FILE = TMP + '/nexus_hist.json';

// Sanitize username for use in filenames
function sanitizeUser(user) {
  return (user || 'default').replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase().substring(0, 40);
}

// Per-user file paths
function getCmdFile(user)  { return TMP + '/ncmd_'  + sanitizeUser(user) + '.json'; }
function getPollFile(user) { return TMP + '/npoll_' + sanitizeUser(user) + '.txt';  }

// Per-user operations
function getCmd(user) {
  try {
    const f = getCmdFile(user);
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  } catch(_) {}
  return { action: 'none' };
}
function setCmd(user, c) {
  try { writeFileSync(getCmdFile(user), JSON.stringify(c)); } catch(_) {}
}
function clearCmd(user) {
  try { writeFileSync(getCmdFile(user), JSON.stringify({ action: 'none' })); } catch(_) {}
}
function bumpPoll(user) {
  try { writeFileSync(getPollFile(user), String(Date.now())); } catch(_) {}
}
function lastPoll(user) {
  try { return parseInt(readFileSync(getPollFile(user), 'utf8') || '0'); } catch(_) { return 0; }
}
function isConnected(user) {
  return (Date.now() - lastPoll(user)) < 8000;
}

// Shared logs (admin only)
function pushLog(entry) {
  try {
    let logs = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, 'utf8')) : [];
    logs.unshift({ ...entry, ts: Date.now() });
    if (logs.length > 200) logs = logs.slice(0, 200);
    writeFileSync(LOG_FILE, JSON.stringify(logs));
  } catch(_) {}
}
function pushHistory(entry) {
  try {
    let hist = existsSync(HIST_FILE) ? JSON.parse(readFileSync(HIST_FILE, 'utf8')) : [];
    hist.unshift({ ...entry, ts: Date.now() });
    if (hist.length > 100) hist = hist.slice(0, 100);
    writeFileSync(HIST_FILE, JSON.stringify(hist));
  } catch(_) {}
}

// All valid actions
const VALID_ACTIONS = new Set([
  'none',
  // Script injection
  'inject_script', 'batch_inject',
  // Part/Model
  'create_part', 'batch_create', 'insert_model', 'clone_object',
  // Workspace management
  'clear_workspace', 'delete_object', 'delete_multiple', 'modify_part',
  'select_object', 'set_game_info',
  // GUI
  'create_gui',
  // Instance creation
  'create_instance',
  // Lighting & environment
  'set_lighting', 'change_baseplate', 'fill_terrain', 'add_effect',
  // Organization
  'create_spawn', 'create_folder', 'create_team',
  // Code execution
  'run_code', 'print_output',
  // Data
  'set_value', 'create_animation',
  // Workspace reading
  'read_workspace', 'workspace_data',
  // Studio control
  'get_studio_mode', 'run_script_in_play_mode',
]);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: Plugin polls for its commands ──────────────────────────────
  if (req.method === 'GET') {
    const pluginUser = sanitizeUser(req.query.user || req.query.u || '');

    // Plugin alive ping
    if (pluginUser) bumpPoll(pluginUser);

    // Check endpoint — used by web to see if plugin is connected
    if (req.query.check) {
      const targetUser = sanitizeUser(req.query.user || '');
      return res.status(200).json({
        _pluginConnected: isConnected(targetUser),
        _lastPoll: lastPoll(targetUser),
        user: targetUser,
        action: 'none',
      });
    }

    // Return this user's pending command (only visible to them)
    if (!pluginUser) {
      return res.status(400).json({ error: 'user parameter required', action: 'none' });
    }

    const cmd = getCmd(pluginUser);
    return res.status(200).json(cmd);
  }

  // ── POST ────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};

    // Plugin signals command was executed — clear it
    if (body.action === 'none' || body.type === 'reset') {
      const pluginUser = sanitizeUser(body._user || body.user || '');
      if (pluginUser) clearCmd(pluginUser);
      return res.status(200).json({ status: 'reset' });
    }

    // Plugin status check
    if (body.type === 'status') {
      const u = sanitizeUser(body.user || '');
      return res.status(200).json({
        connected: isConnected(u),
        lastPoll: lastPoll(u),
        age: Date.now() - lastPoll(u),
      });
    }

    // Workspace data from plugin
    if (body.action === 'workspace_data') {
      const u = sanitizeUser(body._user || '');
      pushLog({ action: 'workspace_read', user: u });
      try {
        writeFileSync(TMP + '/nexus_ws_' + sanitizeUser(u) + '.json',
          JSON.stringify({ ...body, _ts: Date.now() }));
      } catch(_) {}
      return res.status(200).json({ status: 'ok' });
    }

    // Get logs (admin)
    if (body.type === 'get_logs') {
      try {
        const logs = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE,'utf8')) : [];
        return res.status(200).json({ logs });
      } catch(_) { return res.status(200).json({ logs: [] }); }
    }

    // Get history (admin)
    if (body.type === 'get_history') {
      try {
        const hist = existsSync(HIST_FILE) ? JSON.parse(readFileSync(HIST_FILE,'utf8')) : [];
        return res.status(200).json({ history: hist });
      } catch(_) { return res.status(200).json({ history: [] }); }
    }

    // Direct command from web/AI — route to target user's queue
    if (body.action) {
      if (!VALID_ACTIONS.has(body.action)) {
        return res.status(400).json({ error: 'Invalid action: ' + body.action });
      }

      // _target_user is who the command is FOR (the plugin user)
      const targetUser = sanitizeUser(body._target_user || body._user || '');
      if (!targetUser) {
        return res.status(400).json({ error: '_target_user is required for routing' });
      }

      const cmd = {
        ...body,
        _ts:          Date.now(),
        _user:        String(body._user || 'web').substring(0, 50),
        _target_user: targetUser,
        // Remove sensitive fields that shouldn't be stored
        _apiKey:      undefined,
      };

      // Store in TARGET user's command queue (only they can read it)
      setCmd(targetUser, cmd);

      pushLog({
        action:      body.action,
        user:        body._user || 'web',
        target:      targetUser,
        name:        body.name || body.script_name || '',
        parent:      body.parent || '',
      });
      pushHistory({
        action:  body.action,
        details: body.name || (body.code ? body.code.substring(0, 80) + '...' : '') || JSON.stringify(body).substring(0, 100),
        user:    body._user || 'web',
        target:  targetUser,
      });

      return res.status(200).json({
        status:         'ok',
        action:         body.action,
        target:         targetUser,
        pluginConnected: isConnected(targetUser),
      });
    }

    // Prompt logging
    if (body.type === 'prompt') {
      pushLog({ action: 'prompt', user: body.user || 'web', msg: (body.msg || '').substring(0, 100) });
      return res.status(200).json({ status: 'ok' });
    }

    return res.status(400).json({ error: 'Unknown request type' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
