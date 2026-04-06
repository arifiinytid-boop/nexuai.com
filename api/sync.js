// api/sync.js — NEXUS AI Cross-device user data sync v2.0
// Supports Vercel KV (@vercel/kv) for real persistence.
// If KV not configured, falls back to in-memory (resets on cold start).
// To enable KV: vercel env add KV_URL  (from Vercel dashboard → Storage → KV)

let kv = null;
try {
  const { kv: vercelKV } = require('@vercel/kv');
  kv = vercelKV;
  console.log('[sync] Vercel KV connected');
} catch (e) {
  console.log('[sync] KV not available, using in-memory store');
}

// In-memory fallback (lost on cold start)
const memStore = {};

async function kvGet(key) {
  if (kv) {
    try {
      const val = await kv.get(key);
      // KV may return string or object depending on how it was stored
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch(e) { return val; }
      }
      return val;
    } catch (e) {
      console.error('[sync] KV get error:', e.message);
    }
  }
  return memStore[key] ?? null;
}

async function kvSet(key, value) {
  if (kv) {
    try {
      await kv.set(key, JSON.stringify(value), { ex: 60 * 60 * 24 * 30 }); // 30 days TTL
      return true;
    } catch (e) {
      console.error('[sync] KV set error:', e.message);
    }
  }
  memStore[key] = value;
  return true;
}

async function kvList(prefix) {
  if (kv) {
    try {
      const keys = await kv.keys(prefix + '*');
      const result = {};
      for (const k of keys) {
        result[k] = await kvGet(k);
      }
      return result;
    } catch (e) {}
  }
  // In-memory list
  const result = {};
  for (const [k, v] of Object.entries(memStore)) {
    if (k.startsWith(prefix)) result[k] = v;
  }
  return result;
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const userParam = (req.query.user || '').toLowerCase().trim();
  const action = req.query.action || '';

  // ── GET ──
  if (req.method === 'GET') {
    if (!userParam && action !== 'list-users') {
      res.json(null); return;
    }

    // Admin: list all users
    if (action === 'list-users') {
      const all = await kvList('nexus_user:');
      const users = Object.entries(all).map(([k, v]) => ({
        username: k.replace('nexus_user:', ''),
        credits: v?.credits ?? 0,
        plan: v?.plan ?? 'free',
        lastSeen: v?._updated ?? 0,
      }));
      res.json(users);
      return;
    }

    const data = await kvGet('nexus_user:' + userParam);
    res.json(data);
    return;
  }

  // ── POST ──
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const { user, data, action: bodyAction } = body;

      // Admin: give credits
      if (bodyAction === 'give-credits' && user && body.amount !== undefined) {
        const key = 'nexus_user:' + user.toLowerCase();
        const existing = await kvGet(key) || { credits: 0, plan: 'free' };
        existing.credits = parseFloat(((existing.credits || 0) + parseFloat(body.amount)).toFixed(4));
        existing._updated = Date.now();
        await kvSet(key, existing);
        res.json({ success: true, newCredits: existing.credits });
        return;
      }

      // Admin: set plan
      if (bodyAction === 'set-plan' && user && body.plan) {
        const key = 'nexus_user:' + user.toLowerCase();
        const existing = await kvGet(key) || {};
        existing.plan = body.plan;
        existing._updated = Date.now();
        await kvSet(key, existing);
        res.json({ success: true });
        return;
      }

      // Normal sync
      if (!user || !data) {
        res.status(400).json({ error: 'Missing user or data' });
        return;
      }

      const key = 'nexus_user:' + user.toLowerCase().trim();
      const toSave = { ...data, _updated: Date.now() };
      await kvSet(key, toSave);
      res.json({ success: true });
    } catch (e) {
      console.error('[sync] POST error:', e);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    if (!userParam) { res.status(400).json({ error: 'Missing user' }); return; }
    try {
      if (kv) await kv.del('nexus_user:' + userParam);
      else delete memStore['nexus_user:' + userParam];
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
