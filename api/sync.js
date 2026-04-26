// api/sync.js — NEXUS AI User Data Sync v4
// Persistent storage via Vercel KV (keyed by Roblox username)
// Owner/Admin by Roblox User ID (from OWNER_IDS / ADMIN_IDS env vars)
// Secure: credits/plan/roles/banned hanya bisa diubah oleh admin

let kv = null;
let kvReady = false;

async function initKV() {
  if (kvReady) return kv;
  try {
    const kvModule = require('@vercel/kv');
    kv = kvModule.kv || kvModule.default || kvModule;
    kvReady = true;
  } catch (e) {
    kv = null;
    kvReady = false;
  }
  return kv;
}

const memStore = {};

async function getUser(key) {
  if (!key) return null;
  const normalKey = key.toLowerCase().trim();
  const kvClient = await initKV();
  if (kvClient && kvReady) {
    try { return await kvClient.get('nexusai:' + normalKey); } catch(e) {}
  }
  return memStore[normalKey] || null;
}

async function setUser(key, data) {
  const normalKey = (key || '').toLowerCase().trim();
  if (!normalKey) return;
  const kvClient = await initKV();
  if (kvClient && kvReady) {
    try {
      await kvClient.set('nexusai:' + normalKey, data, { ex: 60 * 60 * 24 * 365 });
      return;
    } catch(e) { console.error('setUser error:', e.message); }
  }
  memStore[normalKey] = data;
}

async function listUsers() {
  const kvClient = await initKV();
  if (kvClient && kvReady) {
    try {
      const keys = await kvClient.keys('nexusai:*');
      const result = {};
      for (const k of keys) {
        const userKey = k.replace('nexusai:', '');
        if (userKey.startsWith('_')) continue; // skip internal keys
        const data = await kvClient.get(k);
        if (data) result[userKey] = data;
      }
      return result;
    } catch(e) { console.error('listUsers error:', e.message); }
  }
  const filtered = {};
  for (const [k,v] of Object.entries(memStore)) {
    if (!k.startsWith('_')) filtered[k] = v;
  }
  return filtered;
}

// ─── Owner / Admin dari Env ───────────────────────────────
function parseIdList(envStr) {
  return (envStr || '').split(',').map(s => {
    const parts = s.trim().split(':');
    return { id: parts[0].trim(), name: parts[1] ? parts[1].trim() : null };
  }).filter(x => x.id);
}

function getOwnerIds() {
  const fromEnv = parseIdList(process.env.OWNER_IDS);
  if (fromEnv.length === 0) return [{ id: '128649548', name: 'FIINYTID25' }];
  return fromEnv;
}

function getAdminIds() {
  return parseIdList(process.env.ADMIN_IDS);
}

function isOwnerById(userId) {
  const uid = String(userId).trim();
  return getOwnerIds().some(o => String(o.id).trim() === uid);
}

function isAdminById(userId) {
  if (isOwnerById(userId)) return true;
  const uid = String(userId).trim();
  return getAdminIds().some(a => String(a.id).trim() === uid);
}

// ─── EXPORT HANDLER ───────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const userKey = (req.query.user || '').toLowerCase().trim();

  // ═══════════════════════════════════════════════════════════
  // GET
  // ═══════════════════════════════════════════════════════════
  if (req.method === 'GET') {
    if (req.query.list === '1') {
      const all = await listUsers();
      return res.json(all);
    }
    if (!userKey) return res.json(null);
    const data = await getUser(userKey);
    // Auto-set unlimited credits untuk owner/admin saat GET
    if (data && data.robloxId && isOwnerById(data.robloxId)) {
      data.credits = 999999;
      data.plan = 'owner';
      data.roles = ['owner', 'admin'];
    } else if (data && data.robloxId && isAdminById(data.robloxId)) {
      data.credits = 999999;
      if (!data.roles) data.roles = ['admin'];
      if (!data.roles.includes('admin')) data.roles.push('admin');
    }
    return res.json(data);
  }

  // ═══════════════════════════════════════════════════════════
  // POST
  // ═══════════════════════════════════════════════════════════
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { user, data, action } = body || {};

      // ─── ADMIN ACTIONS ──────────────────────────────────
      if (action) {
        // give-credits: bisa ke user yang belum pernah login
        if (action === 'give-credits') {
          const { target, amount } = body;
          if (!target || isNaN(amount)) return res.status(400).json({ error: 'Invalid params' });
          const existing = await getUser(target.toLowerCase()) || {};
          existing.credits = parseFloat(((existing.credits || 0) + parseFloat(amount)).toFixed(4));
          existing._updated = Date.now();
          await setUser(target.toLowerCase(), existing);
          return res.json({ success: true, newCredits: existing.credits, user: target });
        }

        if (action === 'set-plan') {
          const { target, plan } = body;
          if (!target || !plan) return res.status(400).json({ error: 'Invalid params' });
          const existing = await getUser(target.toLowerCase()) || {};
          existing.plan = plan;
          if (plan === 'pro' || plan === 'owner') {
            existing.credits = Math.max(existing.credits || 0, 200);
          }
          existing._updated = Date.now();
          await setUser(target.toLowerCase(), existing);
          return res.json({ success: true });
        }

        if (action === 'reset-credits') {
          const { target } = body;
          if (!target) return res.status(400).json({ error: 'Invalid params' });
          const existing = await getUser(target.toLowerCase()) || {};
          existing.credits = 30;
          existing._updated = Date.now();
          await setUser(target.toLowerCase(), existing);
          return res.json({ success: true });
        }

        if (action === 'ban') {
          const { target, reason } = body;
          if (!target) return res.status(400).json({ error: 'Invalid params' });
          const existing = await getUser(target.toLowerCase()) || {};
          existing.banned = true;
          existing.banReason = reason || 'No reason given';
          existing.bannedAt = Date.now();
          existing._updated = Date.now();
          await setUser(target.toLowerCase(), existing);
          return res.json({ success: true });
        }

        if (action === 'unban') {
          const { target } = body;
          if (!target) return res.status(400).json({ error: 'Invalid params' });
          const existing = await getUser(target.toLowerCase()) || {};
          existing.banned = false;
          existing.banReason = null;
          existing.unbannedAt = Date.now();
          existing._updated = Date.now();
          await setUser(target.toLowerCase(), existing);
          return res.json({ success: true });
        }

        if (action === 'add-admin') {
          const { target, requesterUserId } = body;
          if (!isOwnerById(requesterUserId)) return res.status(403).json({ error: 'Owner only' });
          const existing = await getUser(target.toLowerCase()) || {};
          existing.roles = existing.roles || [];
          if (!existing.roles.includes('admin')) existing.roles.push('admin');
          existing.credits = 999999;
          existing._updated = Date.now();
          await setUser(target.toLowerCase(), existing);
          return res.json({ success: true });
        }

        return res.status(400).json({ error: 'Unknown action' });
      }

      // ─── NORMAL USER SYNC ───────────────────────────────
      if (!user || !data) return res.status(400).json({ error: 'Missing user or data' });
      const key = user.toLowerCase();

      // Cek apakah user di-ban
      const existing = await getUser(key);
      if (existing && existing.banned) {
        return res.status(403).json({ error: 'Account banned', reason: existing.banReason || 'Violation of ToS' });
      }

      // Field yang TIDAK BOLEH diubah oleh client:
      // credits, plan, roles, banned, googleEmail, robloxId
      // (googleEmail & robloxId hanya di-set saat login pertama)
      const safeFields = [
        'convs', 'curConv', 'model', 'lastClaim', 'guiModel',
        'draftText', 'draftAttach', 'avatar', 'displayName',
        'settings', 'preferences'
      ];

      const newData = {};
      // Ambil hanya field aman dari data yang dikirim client
      for (const field of safeFields) {
        if (data[field] !== undefined) newData[field] = data[field];
      }

      // Gabung dengan existing data (jika ada), pertahankan field kontrol
      const merged = existing
        ? { ...existing, ...newData, _updated: Date.now() }
        : {
            ...newData,
            credits: 30,               // default kredit pertama
            plan: 'free',
            roles: [],
            banned: false,
            robloxId: data.robloxId || '',
            googleEmail: data.googleEmail || '',
            _updated: Date.now()
          };

      // Pastikan robloxId & googleEmail tidak hilang (kalau sudah ada)
      if (existing) {
        if (!merged.robloxId) merged.robloxId = existing.robloxId;
        if (!merged.googleEmail) merged.googleEmail = existing.googleEmail;
      }

      // Auto-set owner/admin berdasarkan robloxId (fallback jika dari env)
      if (merged.robloxId && isOwnerById(merged.robloxId)) {
        merged.credits = 999999;
        merged.plan = 'owner';
        merged.roles = ['owner', 'admin'];
      } else if (merged.robloxId && isAdminById(merged.robloxId)) {
        merged.credits = 999999;
        merged.roles = merged.roles || [];
        if (!merged.roles.includes('admin')) merged.roles.push('admin');
      }

      await setUser(key, merged);
      return res.json({ success: true, data: merged });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // DELETE
  // ═══════════════════════════════════════════════════════════
  if (req.method === 'DELETE') {
    if (!userKey) return res.status(400).json({ error: 'Missing user' });
    try {
      const kvClient = await initKV();
      if (kvClient && kvReady) { await kvClient.del('nexusai:' + userKey); }
      else { delete memStore[userKey]; }
      return res.json({ success: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
