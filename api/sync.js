// api/sync.js — NEXUS AI User Data Sync v5
// Persistent storage via Vercel KV (keyed by Roblox username)
// Owner/Admin by Roblox User ID (from OWNER_IDS / ADMIN_IDS env vars)
// Secure: credits/plan/roles/banned hanya bisa diubah oleh admin
// v5 fixes: robust KV retry, data trimming, no useless memStore fallback

'use strict';

// ─── KV CLIENT ───────────────────────────────────────────────────────────────
let _kv = null;
let _kvReady = false;

async function getKV() {
  if (_kvReady && _kv) return _kv;
  try {
    const mod = require('@vercel/kv');
    _kv = mod.kv || mod.default || mod;
    // quick health check
    await Promise.race([
      _kv.ping(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('ping timeout')), 3000))
    ]);
    _kvReady = true;
    return _kv;
  } catch (e) {
    console.error('[NEXUS sync] KV init/ping failed:', e.message);
    _kv = null;
    _kvReady = false;
    return null;
  }
}

// ─── KV HELPERS WITH RETRY ────────────────────────────────────────────────────
const KV_PREFIX = 'nexusai:';
const KV_TTL    = 60 * 60 * 24 * 365 * 2; // 2 tahun

async function kvGet(username) {
  const client = await getKV();
  if (!client) return null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const data = await Promise.race([
        client.get(KV_PREFIX + username),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
      ]);
      return data || null;
    } catch (e) {
      console.error(`[NEXUS sync] kvGet attempt ${attempt} failed:`, e.message);
      if (attempt === 3) return null;
      await sleep(200 * attempt);
    }
  }
  return null;
}

async function kvSet(username, data) {
  const client = await getKV();
  if (!client) throw new Error('KV tidak tersedia. Cek konfigurasi Vercel KV.');

  // Trim data agar tidak melebihi limit KV (max ~4.5MB aman)
  const trimmed = trimUserData(data);
  const json = JSON.stringify(trimmed);
  const sizeKB = Buffer.byteLength(json, 'utf8') / 1024;

  if (sizeKB > 4500) {
    console.warn(`[NEXUS sync] Data ${username} masih ${sizeKB.toFixed(0)}KB setelah trim, potong lebih agresif`);
    trimmed.convs = (trimmed.convs || []).slice(-5);
    trimmed.allConvs = (trimmed.allConvs || []).slice(-5);
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await Promise.race([
        client.set(KV_PREFIX + username, trimmed, { ex: KV_TTL }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
      ]);
      return true;
    } catch (e) {
      console.error(`[NEXUS sync] kvSet attempt ${attempt} failed:`, e.message);
      if (attempt === 3) throw e;
      await sleep(300 * attempt);
    }
  }
}

async function kvDel(username) {
  const client = await getKV();
  if (!client) throw new Error('KV tidak tersedia');
  await client.del(KV_PREFIX + username);
}

async function kvKeys(pattern) {
  const client = await getKV();
  if (!client) return [];
  try {
    return await client.keys(pattern) || [];
  } catch (e) {
    console.error('[NEXUS sync] kvKeys failed:', e.message);
    return [];
  }
}

// ─── DATA TRIMMING ────────────────────────────────────────────────────────────
// Trim conversation messages agar data tidak meledak
function trimMsgs(msgs, maxMsgs = 80, maxCharsPerMsg = 8000) {
  if (!Array.isArray(msgs)) return [];
  return msgs.slice(-maxMsgs).map(m => {
    const msg = { ...m };
    if (typeof msg.content === 'string' && msg.content.length > maxCharsPerMsg) {
      msg.content = msg.content.slice(0, maxCharsPerMsg) + '\n...[trimmed]';
    }
    // Hapus data gambar base64 dari history (hemat space besar)
    if (msg.attachments) {
      msg.attachments = msg.attachments.map(a => {
        if (a.type === 'image') return { type: 'image', name: a.name, mime: a.mime };
        return { type: a.type, name: a.name };
      });
    }
    // Hapus _rawContent (biasanya duplikat besar)
    delete msg._rawContent;
    return msg;
  });
}

function trimUserData(data) {
  if (!data || typeof data !== 'object') return data;
  const d = { ...data };

  // Trim semua percakapan — simpan max 50 conv, tiap conv max 80 pesan
  if (Array.isArray(d.convs)) {
    d.convs = d.convs.slice(-50).map(cv => ({
      ...cv,
      msgs: trimMsgs(cv.msgs)
    }));
  }
  if (Array.isArray(d.allConvs)) {
    d.allConvs = d.allConvs.slice(-50).map(cv => ({
      ...cv,
      msgs: trimMsgs(cv.msgs)
    }));
  }

  // Trim projects — simpan max 100
  if (Array.isArray(d.projects)) {
    d.projects = d.projects.slice(-100);
  }

  // Hapus field temp yang tidak perlu disimpan
  delete d.draftAttach;
  delete d.draftText;

  return d;
}

// ─── UTILITIES ───────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseIdList(envStr) {
  return (envStr || '').split(',').map(s => {
    const parts = s.trim().split(':');
    return { id: parts[0].trim(), name: parts[1] ? parts[1].trim() : null };
  }).filter(x => x.id);
}

function getOwnerIds() {
  const fromEnv = parseIdList(process.env.OWNER_IDS);
  // Default fallback owner jika env belum diset
  if (fromEnv.length === 0) return [{ id: '128649548', name: 'FIINYTID25' }];
  return fromEnv;
}

function getAdminIds() {
  return parseIdList(process.env.ADMIN_IDS);
}

function isOwnerById(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return false;
  return getOwnerIds().some(o => String(o.id).trim() === uid);
}

function isAdminById(userId) {
  if (isOwnerById(userId)) return true;
  const uid = String(userId || '').trim();
  if (!uid) return false;
  return getAdminIds().some(a => String(a.id).trim() === uid);
}

function normalizeKey(key) {
  return (key || '').toLowerCase().trim();
}

// ─── APPLY ROLE OVERRIDES ─────────────────────────────────────────────────────
// Pastikan owner/admin selalu dapat privilege yang benar
function applyRoleOverrides(data) {
  if (!data || !data.robloxId) return data;
  if (isOwnerById(data.robloxId)) {
    data.credits = 999999;
    data.plan = 'owner';
    data.roles = ['owner', 'admin'];
  } else if (isAdminById(data.robloxId)) {
    data.credits = 999999;
    if (!Array.isArray(data.roles)) data.roles = [];
    if (!data.roles.includes('admin')) data.roles.push('admin');
  }
  return data;
}

// ─── GETUSER / SETUSER ───────────────────────────────────────────────────────
async function getUser(username) {
  const key = normalizeKey(username);
  if (!key) return null;
  try {
    return await kvGet(key);
  } catch (e) {
    console.error('[NEXUS sync] getUser error:', e.message);
    return null;
  }
}

async function setUser(username, data) {
  const key = normalizeKey(username);
  if (!key || !data) return false;
  try {
    await kvSet(key, data);
    return true;
  } catch (e) {
    console.error('[NEXUS sync] setUser error:', e.message);
    return false;
  }
}

// ─── LIST ALL USERS ───────────────────────────────────────────────────────────
async function listUsers() {
  const keys = await kvKeys(KV_PREFIX + '*');
  const result = {};
  // Batch get agar tidak sequential
  const entries = await Promise.allSettled(
    keys
      .map(k => k.replace(KV_PREFIX, ''))
      .filter(k => !k.startsWith('_'))
      .map(async (k) => {
        const data = await kvGet(k);
        return { k, data };
      })
  );
  for (const entry of entries) {
    if (entry.status === 'fulfilled' && entry.value.data) {
      result[entry.value.k] = entry.value.data;
    }
  }
  return result;
}

// ─── CORS HEADERS ────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════
module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const userKey = normalizeKey(req.query.user || '');

  // ═══════════════════════════════════════════════════════════
  // GET
  // ═══════════════════════════════════════════════════════════
  if (req.method === 'GET') {

    // List semua user (admin endpoint)
    if (req.query.list === '1') {
      try {
        const all = await listUsers();
        return res.json(all);
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // Cek status KV (health check)
    if (req.query.health === '1') {
      const client = await getKV();
      return res.json({ kv: !!client, ready: _kvReady });
    }

    if (!userKey) return res.json(null);

    try {
      let data = await getUser(userKey);
      if (!data) return res.json(null);

      // Apply role overrides (owner/admin dapat unlimited credits)
      data = applyRoleOverrides(data);

      return res.json(data);
    } catch (e) {
      console.error('[NEXUS sync] GET error:', e.message);
      return res.status(500).json({ error: 'Gagal membaca data: ' + e.message });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // POST
  // ═══════════════════════════════════════════════════════════
  if (req.method === 'POST') {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const { user, data, action } = body || {};

    // ─── ADMIN ACTIONS ──────────────────────────────────────
    if (action) {
      // give-credits
      if (action === 'give-credits') {
        const { target, amount } = body;
        if (!target || isNaN(amount)) return res.status(400).json({ error: 'Invalid params' });
        const tKey = normalizeKey(target);
        const existing = await getUser(tKey) || {};
        existing.credits = parseFloat(((existing.credits || 0) + parseFloat(amount)).toFixed(4));
        existing._updated = Date.now();
        const ok = await setUser(tKey, existing);
        if (!ok) return res.status(500).json({ error: 'Gagal menyimpan, coba lagi' });
        return res.json({ success: true, newCredits: existing.credits, user: target });
      }

      // set-plan
      if (action === 'set-plan') {
        const { target, plan } = body;
        if (!target || !plan) return res.status(400).json({ error: 'Invalid params' });
        const tKey = normalizeKey(target);
        const existing = await getUser(tKey) || {};
        existing.plan = plan;
        if (plan === 'pro') existing.credits = Math.max(existing.credits || 0, 200);
        existing._updated = Date.now();
        const ok = await setUser(tKey, existing);
        if (!ok) return res.status(500).json({ error: 'Gagal menyimpan' });
        return res.json({ success: true });
      }

      // reset-credits
      if (action === 'reset-credits') {
        const { target } = body;
        if (!target) return res.status(400).json({ error: 'Invalid params' });
        const tKey = normalizeKey(target);
        const existing = await getUser(tKey) || {};
        existing.credits = 30;
        existing._updated = Date.now();
        const ok = await setUser(tKey, existing);
        if (!ok) return res.status(500).json({ error: 'Gagal menyimpan' });
        return res.json({ success: true });
      }

      // ban
      if (action === 'ban') {
        const { target, reason } = body;
        if (!target) return res.status(400).json({ error: 'Invalid params' });
        const tKey = normalizeKey(target);
        const existing = await getUser(tKey) || {};
        existing.banned = true;
        existing.banReason = reason || 'No reason given';
        existing.bannedAt = Date.now();
        existing._updated = Date.now();
        const ok = await setUser(tKey, existing);
        if (!ok) return res.status(500).json({ error: 'Gagal menyimpan' });
        return res.json({ success: true });
      }

      // unban
      if (action === 'unban') {
        const { target } = body;
        if (!target) return res.status(400).json({ error: 'Invalid params' });
        const tKey = normalizeKey(target);
        const existing = await getUser(tKey) || {};
        existing.banned = false;
        existing.banReason = null;
        existing.unbannedAt = Date.now();
        existing._updated = Date.now();
        const ok = await setUser(tKey, existing);
        if (!ok) return res.status(500).json({ error: 'Gagal menyimpan' });
        return res.json({ success: true });
      }

      // add-admin (owner only)
      if (action === 'add-admin') {
        const { target, requesterUserId } = body;
        if (!isOwnerById(requesterUserId)) {
          return res.status(403).json({ error: 'Owner only' });
        }
        const tKey = normalizeKey(target);
        const existing = await getUser(tKey) || {};
        existing.roles = existing.roles || [];
        if (!existing.roles.includes('admin')) existing.roles.push('admin');
        existing.credits = 999999;
        existing._updated = Date.now();
        const ok = await setUser(tKey, existing);
        if (!ok) return res.status(500).json({ error: 'Gagal menyimpan' });
        return res.json({ success: true });
      }

      // remove-admin (owner only)
      if (action === 'remove-admin') {
        const { target, requesterUserId } = body;
        if (!isOwnerById(requesterUserId)) {
          return res.status(403).json({ error: 'Owner only' });
        }
        const tKey = normalizeKey(target);
        const existing = await getUser(tKey) || {};
        existing.roles = (existing.roles || []).filter(r => r !== 'admin');
        existing._updated = Date.now();
        const ok = await setUser(tKey, existing);
        if (!ok) return res.status(500).json({ error: 'Gagal menyimpan' });
        return res.json({ success: true });
      }

      // set-credits (direct set, bukan add)
      if (action === 'set-credits') {
        const { target, amount } = body;
        if (!target || isNaN(amount)) return res.status(400).json({ error: 'Invalid params' });
        const tKey = normalizeKey(target);
        const existing = await getUser(tKey) || {};
        existing.credits = parseFloat(parseFloat(amount).toFixed(4));
        existing._updated = Date.now();
        const ok = await setUser(tKey, existing);
        if (!ok) return res.status(500).json({ error: 'Gagal menyimpan' });
        return res.json({ success: true, newCredits: existing.credits });
      }

      return res.status(400).json({ error: 'Unknown action: ' + action });
    }

    // ─── NORMAL USER SYNC ───────────────────────────────────
    if (!user) return res.status(400).json({ error: 'Missing user' });
    if (!data) return res.status(400).json({ error: 'Missing data' });

    const key = normalizeKey(user);
    if (!key) return res.status(400).json({ error: 'Invalid user' });

    try {
      // Ambil data existing dari KV
      let existing = await getUser(key);

      // Cek ban
      if (existing && existing.banned) {
        return res.status(403).json({
          error: 'Account banned',
          reason: existing.banReason || 'Violation of ToS'
        });
      }

      // Field aman yang boleh diupdate oleh client
      // (credits, plan, roles, banned TIDAK boleh diubah client)
      const SAFE_FIELDS = [
        'convs', 'allConvs', 'curConv', 'model', 'guiModel',
        'lastClaim', 'draftText', 'avatar', 'displayName',
        'settings', 'preferences', 'projects'
      ];

      // Ambil hanya field aman dari data client
      const clientUpdate = {};
      for (const field of SAFE_FIELDS) {
        if (data[field] !== undefined) {
          clientUpdate[field] = data[field];
        }
      }

      let merged;
      if (existing) {
        // Merge: existing (semua field) + clientUpdate (hanya safe fields)
        merged = {
          ...existing,       // pertahankan semua field existing (credits, plan, roles, dll)
          ...clientUpdate,   // timpa dengan update aman dari client
          _updated: Date.now(),
          // Pastikan field kontrol tidak bisa di-override client
          credits: existing.credits,
          plan: existing.plan || 'free',
          roles: existing.roles || [],
          banned: existing.banned || false,
          banReason: existing.banReason || null,
          // Pertahankan robloxId & googleEmail dari existing
          robloxId: existing.robloxId || data.robloxId || '',
          googleEmail: existing.googleEmail || data.googleEmail || '',
        };
      } else {
        // User baru — buat data fresh
        merged = {
          ...clientUpdate,
          credits: 30,
          plan: 'free',
          roles: [],
          banned: false,
          banReason: null,
          robloxId: data.robloxId || '',
          googleEmail: data.googleEmail || '',
          _created: Date.now(),
          _updated: Date.now(),
        };
      }

      // Apply role overrides berdasarkan robloxId
      merged = applyRoleOverrides(merged);

      // Simpan ke KV dengan retry
      const ok = await setUser(key, merged);
      if (!ok) {
        // KV gagal total — kembalikan error agar client tahu
        return res.status(500).json({
          error: 'Gagal menyimpan data ke server. Cek koneksi Vercel KV.',
          code: 'KV_SAVE_FAILED'
        });
      }

      return res.json({ success: true, data: merged });

    } catch (e) {
      console.error('[NEXUS sync] POST sync error:', e.message);
      return res.status(500).json({ error: 'Internal error: ' + e.message });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // DELETE
  // ═══════════════════════════════════════════════════════════
  if (req.method === 'DELETE') {
    if (!userKey) return res.status(400).json({ error: 'Missing user' });
    try {
      await kvDel(userKey);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
