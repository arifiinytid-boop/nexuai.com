// api/sync.js — NEXUS AI User Data Sync v6
// Fix FINAL: Hapus total ping() yang tidak ada di @vercel/kv
// Robust retry, data trimming, error eksplisit ke client

'use strict';

// ─── KV CLIENT ───────────────────────────────────────────────────────────────
// PENTING: @vercel/kv TIDAK punya method .ping()
// Init cukup require + duck-type check saja
let _kv = null;
let _kvReady = false;
let _kvError = null;

function getKVSync() {
  if (_kvReady && _kv) return _kv;
  // Hanya coba init sekali per container (warm lambda caching)
  if (_kvError) return null;
  try {
    const mod = require('@vercel/kv');
    const client = mod.kv || mod.default || mod;
    // Duck-type: pastikan ini KV client yang valid
    if (typeof client !== 'object' || client === null) {
      throw new Error('@vercel/kv: client bukan object');
    }
    if (typeof client.get !== 'function' || typeof client.set !== 'function') {
      throw new Error('@vercel/kv: method .get/.set tidak ada — env vars mungkin belum di-set');
    }
    _kv = client;
    _kvReady = true;
    _kvError = null;
    return _kv;
  } catch (e) {
    _kv = null;
    _kvReady = false;
    _kvError = e.message;
    console.error('[NEXUS sync] KV init gagal:', e.message);
    return null;
  }
}

// Reset state (dipanggil jika operasi KV timeout)
function resetKVState() {
  _kv = null;
  _kvReady = false;
  _kvError = null; // Allow retry on next request
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const KV_PREFIX = 'nexusai:';
const KV_TTL    = 60 * 60 * 24 * 365 * 2; // 2 tahun (detik)
const TIMEOUT_GET = 7000;
const TIMEOUT_SET = 10000;
const MAX_RETRY   = 3;

// ─── UTILS ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' timeout ' + ms + 'ms')), ms))
  ]);
}

// ─── KV OPERATIONS WITH RETRY ─────────────────────────────────────────────────
async function kvGet(username) {
  const client = getKVSync();
  if (!client) return null;

  for (let i = 1; i <= MAX_RETRY; i++) {
    try {
      const result = await withTimeout(
        client.get(KV_PREFIX + username),
        TIMEOUT_GET,
        'kvGet'
      );
      return result ?? null;
    } catch (e) {
      console.error(`[NEXUS sync] kvGet #${i} gagal:`, e.message);
      if (i === MAX_RETRY) { resetKVState(); return null; }
      await sleep(200 * i);
    }
  }
  return null;
}

async function kvSet(username, data) {
  const client = getKVSync();
  if (!client) {
    const hint = _kvError
      ? 'KV error: ' + _kvError + '. Cek env KV_REST_API_URL & KV_REST_API_TOKEN di Vercel Dashboard.'
      : 'KV tidak tersedia. Cek env KV_REST_API_URL & KV_REST_API_TOKEN di Vercel Dashboard.';
    throw new Error(hint);
  }

  // Trim dulu sebelum simpan
  let payload = trimUserData(data);

  // Cek ukuran, potong lebih agresif jika perlu
  const sizeBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  const sizeKB = sizeBytes / 1024;
  if (sizeKB > 4096) {
    console.warn(`[NEXUS sync] ${username}: ${sizeKB.toFixed(0)}KB — potong agresif`);
    payload.convs    = (payload.convs    || []).slice(-8);
    payload.allConvs = (payload.allConvs || []).slice(-8);
  }

  for (let i = 1; i <= MAX_RETRY; i++) {
    try {
      await withTimeout(
        client.set(KV_PREFIX + username, payload, { ex: KV_TTL }),
        TIMEOUT_SET,
        'kvSet'
      );
      return true;
    } catch (e) {
      console.error(`[NEXUS sync] kvSet #${i} gagal:`, e.message);
      if (i === MAX_RETRY) { resetKVState(); throw e; }
      await sleep(300 * i);
    }
  }
}

async function kvDel(username) {
  const client = getKVSync();
  if (!client) throw new Error('KV tidak tersedia');
  await withTimeout(client.del(KV_PREFIX + username), TIMEOUT_SET, 'kvDel');
}

async function kvKeys(pattern) {
  const client = getKVSync();
  if (!client) return [];
  try {
    return (await withTimeout(client.keys(pattern), TIMEOUT_GET, 'kvKeys')) || [];
  } catch (e) {
    console.error('[NEXUS sync] kvKeys gagal:', e.message);
    return [];
  }
}

// ─── DATA TRIMMING ────────────────────────────────────────────────────────────
function trimMsgs(msgs, maxMsgs, maxChars) {
  maxMsgs  = maxMsgs  || 60;
  maxChars = maxChars || 6000;
  if (!Array.isArray(msgs)) return [];
  return msgs.slice(-maxMsgs).map(function(m) {
    var msg = Object.assign({}, m);
    // Potong konten terlalu panjang
    if (typeof msg.content === 'string' && msg.content.length > maxChars) {
      msg.content = msg.content.slice(0, maxChars) + '\n...[trimmed by server]';
    }
    // Buang base64 gambar (hemat ruang besar)
    if (Array.isArray(msg.attachments)) {
      msg.attachments = msg.attachments.map(function(a) {
        if (a.type === 'image') return { type: 'image', name: a.name, mime: a.mime };
        return { type: a.type, name: a.name };
      });
    }
    // Hapus duplikat rawContent
    delete msg._rawContent;
    return msg;
  });
}

function trimUserData(data) {
  if (!data || typeof data !== 'object') return data;
  var d = Object.assign({}, data);

  if (Array.isArray(d.convs)) {
    d.convs = d.convs.slice(-50).map(function(cv) {
      return Object.assign({}, cv, { msgs: trimMsgs(cv.msgs) });
    });
  }
  if (Array.isArray(d.allConvs)) {
    d.allConvs = d.allConvs.slice(-50).map(function(cv) {
      return Object.assign({}, cv, { msgs: trimMsgs(cv.msgs) });
    });
  }
  if (Array.isArray(d.projects)) {
    d.projects = d.projects.slice(-100);
  }

  // Hapus field temp yang tidak perlu dipersisten ke KV
  delete d.draftAttach;

  return d;
}

// ─── OWNER / ADMIN HELPERS ────────────────────────────────────────────────────
function parseIdList(envStr) {
  return (envStr || '').split(',').map(function(s) {
    var parts = s.trim().split(':');
    return { id: parts[0].trim(), name: parts[1] ? parts[1].trim() : null };
  }).filter(function(x) { return x.id; });
}

function getOwnerIds() {
  var fromEnv = parseIdList(process.env.OWNER_IDS);
  if (fromEnv.length === 0) return [{ id: '128649548', name: 'FIINYTID25' }];
  return fromEnv;
}

function getAdminIds() {
  return parseIdList(process.env.ADMIN_IDS);
}

function isOwnerById(userId) {
  var uid = String(userId || '').trim();
  if (!uid) return false;
  return getOwnerIds().some(function(o) { return String(o.id).trim() === uid; });
}

function isAdminById(userId) {
  if (isOwnerById(userId)) return true;
  var uid = String(userId || '').trim();
  if (!uid) return false;
  return getAdminIds().some(function(a) { return String(a.id).trim() === uid; });
}

function normalizeKey(key) {
  return (key || '').toLowerCase().trim();
}

function applyRoleOverrides(data) {
  if (!data || !data.robloxId) return data;
  if (isOwnerById(data.robloxId)) {
    data.credits = 999999;
    data.plan    = 'owner';
    data.roles   = ['owner', 'admin'];
  } else if (isAdminById(data.robloxId)) {
    data.credits = 999999;
    if (!Array.isArray(data.roles)) data.roles = [];
    if (!data.roles.includes('admin')) data.roles.push('admin');
  }
  return data;
}

// ─── CRUD WRAPPERS ────────────────────────────────────────────────────────────
async function getUser(username) {
  var key = normalizeKey(username);
  if (!key) return null;
  try { return await kvGet(key); }
  catch (e) { console.error('[NEXUS sync] getUser:', e.message); return null; }
}

async function setUser(username, data) {
  var key = normalizeKey(username);
  if (!key || !data) return false;
  try { await kvSet(key, data); return true; }
  catch (e) { console.error('[NEXUS sync] setUser:', e.message); return false; }
}

async function listUsers() {
  var keys = await kvKeys(KV_PREFIX + '*');
  var result = {};
  var entries = await Promise.allSettled(
    keys
      .map(function(k) { return k.replace(KV_PREFIX, ''); })
      .filter(function(k) { return !k.startsWith('_'); })
      .map(async function(k) {
        var data = await kvGet(k);
        return { k: k, data: data };
      })
  );
  for (var e of entries) {
    if (e.status === 'fulfilled' && e.value && e.value.data) {
      result[e.value.k] = e.value.data;
    }
  }
  return result;
}

// ─── CORS ────────────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════════
module.exports = async function(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const userKey = normalizeKey(req.query.user || '');

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {

    // Health check — tes KV dengan operasi nyata (bukan ping)
    if (req.query.health === '1') {
      const client = getKVSync();
      var canWrite = false;
      var canRead  = false;
      if (client) {
        try {
          await withTimeout(
            client.set(KV_PREFIX + '__health__', { ok: true, ts: Date.now() }, { ex: 60 }),
            5000, 'healthWrite'
          );
          canWrite = true;
          const r = await withTimeout(client.get(KV_PREFIX + '__health__'), 5000, 'healthRead');
          canRead = !!r;
        } catch (e) { /* ignore */ }
      }
      return res.json({
        kv: !!client,
        canWrite,
        canRead,
        initError: _kvError || null
      });
    }

    // List semua user
    if (req.query.list === '1') {
      try { return res.json(await listUsers()); }
      catch (e) { return res.status(500).json({ error: e.message }); }
    }

    if (!userKey) return res.json(null);

    try {
      let data = await getUser(userKey);
      if (!data) return res.json(null);
      data = applyRoleOverrides(data);
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: 'Gagal baca data: ' + e.message });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const { user, data, action } = body;

    // ── ADMIN ACTIONS ─────────────────────────────────────────────────────────
    if (action) {

      if (action === 'give-credits') {
        const { target, amount } = body;
        if (!target || isNaN(amount)) return res.status(400).json({ error: 'Invalid params' });
        const tKey = normalizeKey(target);
        const ex = (await getUser(tKey)) || {};
        ex.credits  = parseFloat(((ex.credits || 0) + parseFloat(amount)).toFixed(4));
        ex._updated = Date.now();
        if (!(await setUser(tKey, ex))) return res.status(500).json({ error: 'KV_SAVE_FAILED' });
        return res.json({ success: true, newCredits: ex.credits, user: target });
      }

      if (action === 'set-credits') {
        const { target, amount } = body;
        if (!target || isNaN(amount)) return res.status(400).json({ error: 'Invalid params' });
        const tKey = normalizeKey(target);
        const ex = (await getUser(tKey)) || {};
        ex.credits  = parseFloat(parseFloat(amount).toFixed(4));
        ex._updated = Date.now();
        if (!(await setUser(tKey, ex))) return res.status(500).json({ error: 'KV_SAVE_FAILED' });
        return res.json({ success: true, newCredits: ex.credits });
      }

      if (action === 'set-plan') {
        const { target, plan } = body;
        if (!target || !plan) return res.status(400).json({ error: 'Invalid params' });
        const tKey = normalizeKey(target);
        const ex = (await getUser(tKey)) || {};
        ex.plan     = plan;
        if (plan === 'pro') ex.credits = Math.max(ex.credits || 0, 200);
        ex._updated = Date.now();
        if (!(await setUser(tKey, ex))) return res.status(500).json({ error: 'KV_SAVE_FAILED' });
        return res.json({ success: true });
      }

      if (action === 'reset-credits') {
        const { target } = body;
        if (!target) return res.status(400).json({ error: 'Invalid params' });
        const tKey = normalizeKey(target);
        const ex = (await getUser(tKey)) || {};
        ex.credits  = 30;
        ex._updated = Date.now();
        if (!(await setUser(tKey, ex))) return res.status(500).json({ error: 'KV_SAVE_FAILED' });
        return res.json({ success: true });
      }

      if (action === 'ban') {
        const { target, reason } = body;
        if (!target) return res.status(400).json({ error: 'Invalid params' });
        const tKey = normalizeKey(target);
        const ex = (await getUser(tKey)) || {};
        ex.banned    = true;
        ex.banReason = reason || 'No reason given';
        ex.bannedAt  = Date.now();
        ex._updated  = Date.now();
        if (!(await setUser(tKey, ex))) return res.status(500).json({ error: 'KV_SAVE_FAILED' });
        return res.json({ success: true });
      }

      if (action === 'unban') {
        const { target } = body;
        if (!target) return res.status(400).json({ error: 'Invalid params' });
        const tKey = normalizeKey(target);
        const ex = (await getUser(tKey)) || {};
        ex.banned     = false;
        ex.banReason  = null;
        ex.unbannedAt = Date.now();
        ex._updated   = Date.now();
        if (!(await setUser(tKey, ex))) return res.status(500).json({ error: 'KV_SAVE_FAILED' });
        return res.json({ success: true });
      }

      if (action === 'add-admin') {
        const { target, requesterUserId } = body;
        if (!isOwnerById(requesterUserId)) return res.status(403).json({ error: 'Owner only' });
        const tKey = normalizeKey(target);
        const ex = (await getUser(tKey)) || {};
        ex.roles = ex.roles || [];
        if (!ex.roles.includes('admin')) ex.roles.push('admin');
        ex.credits  = 999999;
        ex._updated = Date.now();
        if (!(await setUser(tKey, ex))) return res.status(500).json({ error: 'KV_SAVE_FAILED' });
        return res.json({ success: true });
      }

      if (action === 'remove-admin') {
        const { target, requesterUserId } = body;
        if (!isOwnerById(requesterUserId)) return res.status(403).json({ error: 'Owner only' });
        const tKey = normalizeKey(target);
        const ex = (await getUser(tKey)) || {};
        ex.roles    = (ex.roles || []).filter(function(r) { return r !== 'admin'; });
        ex._updated = Date.now();
        if (!(await setUser(tKey, ex))) return res.status(500).json({ error: 'KV_SAVE_FAILED' });
        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action: ' + action });
    }

    // ── NORMAL USER SYNC ──────────────────────────────────────────────────────
    if (!user) return res.status(400).json({ error: 'Missing user' });
    if (!data) return res.status(400).json({ error: 'Missing data' });

    const key = normalizeKey(user);
    if (!key) return res.status(400).json({ error: 'Invalid user' });

    try {
      const existing = await getUser(key);

      if (existing && existing.banned) {
        return res.status(403).json({
          error: 'Account banned',
          reason: existing.banReason || 'Violation of ToS'
        });
      }

      // Field yang BOLEH diupdate oleh client
      const SAFE_FIELDS = [
        'convs', 'allConvs', 'curConv', 'model', 'guiModel',
        'lastClaim', 'draftText', 'avatar', 'displayName',
        'settings', 'preferences', 'projects'
      ];

      const clientUpdate = {};
      SAFE_FIELDS.forEach(function(f) {
        if (data[f] !== undefined) clientUpdate[f] = data[f];
      });

      let merged;
      if (existing) {
        merged = Object.assign(
          {},
          existing,        // semua field dari KV (termasuk credits, plan, dll)
          clientUpdate,    // hanya safe fields dari client
          {
            // Field kontrol: SELALU pakai nilai dari KV, TIDAK bisa di-override client
            credits:     existing.credits,
            plan:        existing.plan     || 'free',
            roles:       existing.roles    || [],
            banned:      existing.banned   || false,
            banReason:   existing.banReason || null,
            robloxId:    existing.robloxId     || data.robloxId     || '',
            googleEmail: existing.googleEmail  || data.googleEmail  || '',
            _updated:    Date.now()
          }
        );
      } else {
        // User pertama kali
        merged = Object.assign(
          {},
          clientUpdate,
          {
            credits:     30,
            plan:        'free',
            roles:       [],
            banned:      false,
            banReason:   null,
            robloxId:    data.robloxId     || '',
            googleEmail: data.googleEmail  || '',
            _created:    Date.now(),
            _updated:    Date.now()
          }
        );
      }

      merged = applyRoleOverrides(merged);

      const ok = await setUser(key, merged);
      if (!ok) {
        const kvErrMsg = _kvError
          ? 'KV error: ' + _kvError
          : 'Cek env KV_REST_API_URL & KV_REST_API_TOKEN di Vercel Dashboard → Storage → KV';
        return res.status(500).json({
          error: 'KV_SAVE_FAILED — ' + kvErrMsg,
          code:  'KV_SAVE_FAILED'
        });
      }

      return res.json({ success: true, data: merged });

    } catch (e) {
      console.error('[NEXUS sync] POST error:', e.message);
      return res.status(500).json({ error: 'Internal error: ' + e.message });
    }
  }

  // ── DELETE ───────────────────────────────────────────────────────────────────
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
