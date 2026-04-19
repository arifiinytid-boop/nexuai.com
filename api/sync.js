// api/sync.js — NEXUS AI User Data Sync V8.2
// FIX: pakai SCAN agar semua user ter-load (bukan keys() yang ada limit)

let kv = null;
async function getKV() {
  if (kv) return kv;
  try { const m = await import('@vercel/kv'); kv = m.kv || m.default || m; } catch(e) {}
  return kv;
}

// Ambil semua user via SCAN (pakai pagination supaya tidak ada yang ketinggalan)
async function scanAllUsers(db) {
  const allKeys = [];
  let cursor = 0;
  try {
    do {
      const [newCursor, batch] = await db.scan(cursor, { match: 'nexusai:*', count: 200 });
      cursor = parseInt(newCursor);
      allKeys.push(...batch);
    } while (cursor !== 0);
  } catch(e) {
    // Fallback ke keys() jika scan tidak tersedia
    try {
      const keys = await db.keys('nexusai:*');
      allKeys.push(...keys);
    } catch(_) {}
  }
  return allKeys;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = await getKV();
  if (!db) return res.status(503).json({ error: 'KV tidak tersedia' });

  // ── GET: list semua user ──────────────────────────────────────
  if (req.method === 'GET' && req.query.list === '1') {
    try {
      const allKeys = await scanAllUsers(db);
      const result  = {};

      await Promise.all(allKeys.map(async k => {
        const name = k.replace('nexusai:', '');
        // Hanya return user data, skip system keys
        if (!name.startsWith('_')) {
          const data = await db.get(k);
          if (data) result[name] = data;
        }
      }));

      return res.status(200).json(result);
    } catch(e) {
      console.error('sync list error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── GET: ambil data satu user ─────────────────────────────────
  if (req.method === 'GET' && req.query.user) {
    try {
      const username = String(req.query.user).toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (!username) return res.status(400).json({ error: 'username tidak valid' });
      const data = await db.get('nexusai:' + username);
      if (!data) return res.status(404).json(null);
      return res.status(200).json(data);
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── GET: stats summary ────────────────────────────────────────
  if (req.method === 'GET' && req.query.stats === '1') {
    try {
      const allKeys = await scanAllUsers(db);
      let total = 0, pro = 0, credits = 0;
      await Promise.all(allKeys.map(async k => {
        const name = k.replace('nexusai:', '');
        if (!name.startsWith('_')) {
          const d = await db.get(k);
          if (d) {
            total++;
            credits += parseFloat(d.credits || 0);
            if (d.plan === 'pro') pro++;
          }
        }
      }));
      return res.status(200).json({ total, pro, credits: Math.floor(credits) });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST: berbagai action ─────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};
    const username = String(body.user || body.target || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!username) return res.status(400).json({ error: 'user diperlukan' });

    const action = body.action || '';

    // ── give-credits ──────────────────────────────────────────
    if (action === 'give-credits') {
      const target = String(body.target || username).toLowerCase();
      const amount = parseFloat(body.amount || 0);
      try {
        const existing = await db.get('nexusai:' + target) || { credits: 0, plan: 'free', _created: Date.now() };
        existing.credits  = parseFloat(Math.max(-3, ((existing.credits || 0) + amount)).toFixed(4));
        existing._updated = Date.now();
        await db.set('nexusai:' + target, existing, { ex: 60*60*24*365 });
        return res.status(200).json({ success: true, newCredits: existing.credits, user: target });
      } catch(e) {
        return res.status(500).json({ success: false, error: e.message });
      }
    }

    // ── set-plan ──────────────────────────────────────────────
    if (action === 'set-plan') {
      const target = String(body.target || username).toLowerCase();
      const plan   = body.plan === 'pro' ? 'pro' : 'free';
      try {
        const existing = await db.get('nexusai:' + target) || { credits: 0 };
        existing.plan = plan;
        if (plan === 'pro') existing.credits = Math.max(existing.credits || 0, 200);
        existing._updated = Date.now();
        await db.set('nexusai:' + target, existing, { ex: 60*60*24*365 });
        return res.status(200).json({ success: true, plan, user: target });
      } catch(e) {
        return res.status(500).json({ success: false, error: e.message });
      }
    }

    // ── ban / unban ───────────────────────────────────────────
    if (action === 'ban' || action === 'unban') {
      const target = String(body.target || username).toLowerCase();
      try {
        const existing = await db.get('nexusai:' + target) || {};
        existing.banned    = action === 'ban';
        existing.banReason = action === 'ban' ? (body.reason || 'Admin action') : null;
        existing._updated  = Date.now();
        await db.set('nexusai:' + target, existing, { ex: 60*60*24*365 });
        return res.status(200).json({ success: true, banned: existing.banned });
      } catch(e) {
        return res.status(500).json({ success: false, error: e.message });
      }
    }

    // ── sync user data (dari login web) ───────────────────────
    if (action === 'sync' || action === 'login') {
      try {
        const existing = await db.get('nexusai:' + username) || {
          credits: 30, plan: 'free', _created: Date.now()
        };
        // Update dari data yang dikirim
        if (body.robloxId)    existing.robloxId    = body.robloxId;
        if (body.displayName) existing.displayName = body.displayName;
        if (body.googleEmail) existing.googleEmail = body.googleEmail;
        if (body.avatar)      existing.avatar      = body.avatar;
        existing._updated = Date.now();
        await db.set('nexusai:' + username, existing, { ex: 60*60*24*365 });
        return res.status(200).json({ success: true, ...existing });
      } catch(e) {
        return res.status(500).json({ success: false, error: e.message });
      }
    }

    // ── deduct (kurangi credits per penggunaan AI) ────────────
    if (action === 'deduct') {
      const amount = parseFloat(body.amount || 1);
      try {
        const existing = await db.get('nexusai:' + username) || { credits: 0, plan: 'free' };
        if (existing.plan === 'pro') return res.status(200).json({ success: true, credits: existing.credits, unlimited: true });
        if (existing.banned) return res.status(403).json({ success: false, error: 'Akun dibanned' });
        if ((existing.credits || 0) < amount) return res.status(402).json({ success: false, error: 'Credits tidak cukup' });
        existing.credits  = parseFloat(((existing.credits || 0) - amount).toFixed(4));
        existing._updated = Date.now();
        await db.set('nexusai:' + username, existing, { ex: 60*60*24*365 });
        return res.status(200).json({ success: true, credits: existing.credits });
      } catch(e) {
        return res.status(500).json({ success: false, error: e.message });
      }
    }

    // ── Internal: tambah kode custom ──────────────────────────
    if (action === '_internal_add_code') {
      try {
        const custom = await db.get('nexusai:_custom_codes') || {};
        const code   = String(body.code || '').toUpperCase();
        if (!code || !body.credits) return res.status(400).json({ error: 'code dan credits diperlukan' });
        custom[code] = {
          credits:   parseInt(body.credits),
          maxUses:   parseInt(body.maxUses || 9999),
          expires:   body.expires || 'never',
          createdAt: Date.now(),
        };
        await db.set('nexusai:_custom_codes', custom);
        return res.status(200).json({ success: true, code });
      } catch(e) {
        return res.status(500).json({ success: false, error: e.message });
      }
    }

    // Fallback: update raw data
    try {
      const existing = await db.get('nexusai:' + username) || {};
      const newData  = { ...existing, ...body, _updated: Date.now() };
      // Hapus field berbahaya
      delete newData.action; delete newData.user; delete newData._apiKey;
      await db.set('nexusai:' + username, newData, { ex: 60*60*24*365 });
      return res.status(200).json({ success: true, ...newData });
    } catch(e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
