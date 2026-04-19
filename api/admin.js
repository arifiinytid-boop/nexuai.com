// api/admin.js — NEXUS AI Admin/Owner Management V8.2
// Cek role user berdasarkan Roblox User ID dan username

let kv = null;
async function getKV() {
  if (kv) return kv;
  try { const m = await import('@vercel/kv'); kv = m.kv || m.default || m; } catch(e) {}
  return kv;
}

// Owner IDs dari env var (Roblox User IDs, comma-separated)
function getOwnerIds() {
  return (process.env.OWNER_IDS || process.env.DISCORD_OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
}
// Admin IDs dari env var (Roblox User IDs, comma-separated)
function getAdminIds() {
  const ownerIds = getOwnerIds();
  const adminOnly = (process.env.ADMIN_IDS || process.env.DISCORD_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return [...ownerIds, ...adminOnly]; // owners selalu juga admin
}

function isOwner(id) { return id && getOwnerIds().includes(String(id)); }
function isAdmin(id) { return id && getAdminIds().includes(String(id)); }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = await getKV();

  // ── GET: cek role berdasarkan robloxId atau username ─────────
  if (req.method === 'GET') {
    const robloxId = req.query.robloxId || req.query.userId || null;
    const username = req.query.username ? String(req.query.username).toLowerCase() : null;

    // Cek dari env var (robloxId)
    if (robloxId) {
      const owner = isOwner(robloxId);
      const admin = isAdmin(robloxId);
      if (owner || admin) {
        return res.status(200).json({
          robloxId,
          role:    owner ? 'owner' : 'admin',
          isOwner: owner,
          isAdmin: admin,
        });
      }
    }

    // Cek dari KV (username → roles array atau plan)
    if (username && db) {
      try {
        const userData = await db.get('nexusai:' + username);
        if (userData) {
          const roles  = userData.roles || [];
          const plan   = userData.plan || 'free';
          const owner  = plan === 'owner' || roles.includes('owner');
          const admin  = owner || plan === 'admin' || roles.includes('admin');
          // Juga cek robloxId dari KV
          if (!owner && !admin && userData.robloxId) {
            const ownerByKvId = isOwner(userData.robloxId);
            const adminByKvId = isAdmin(userData.robloxId);
            if (ownerByKvId || adminByKvId) {
              // Sync role ke user data
              if (db) {
                userData.plan = ownerByKvId ? 'owner' : 'admin';
                userData.roles = ownerByKvId ? ['owner', 'admin'] : ['admin'];
                await db.set('nexusai:' + username, userData, { ex: 60*60*24*365 });
              }
              return res.status(200).json({
                username,
                role: ownerByKvId ? 'owner' : 'admin',
                isOwner: ownerByKvId,
                isAdmin: true,
                credits: userData.credits || 0,
                plan: userData.plan,
              });
            }
          }
          return res.status(200).json({
            username,
            role:    owner ? 'owner' : admin ? 'admin' : 'user',
            isOwner: owner,
            isAdmin: admin,
            credits: userData.credits || 0,
            plan,
          });
        }
      } catch(e) {}
    }

    return res.status(200).json({ role: 'user', isOwner: false, isAdmin: false });
  }

  // ── POST: update role user ────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};
    // Verifikasi requester adalah owner
    const reqId = body.requesterId ? String(body.requesterId) : null;
    if (!reqId || !isOwner(reqId)) {
      return res.status(403).json({ error: 'Hanya Owner yang bisa mengubah role' });
    }

    const targetUsername = String(body.target || '').toLowerCase();
    const newRole        = body.role || 'user';
    if (!targetUsername) return res.status(400).json({ error: 'target diperlukan' });
    if (!['user','admin','owner'].includes(newRole)) return res.status(400).json({ error: 'role tidak valid' });

    if (!db) return res.status(503).json({ error: 'KV tidak tersedia' });

    try {
      const existing = await db.get('nexusai:' + targetUsername) || {};
      existing.roles   = newRole === 'owner' ? ['owner', 'admin'] : newRole === 'admin' ? ['admin'] : [];
      existing.plan    = newRole === 'user' ? (existing.plan || 'free') : newRole;
      existing._updated = Date.now();
      await db.set('nexusai:' + targetUsername, existing, { ex: 60*60*24*365 });
      return res.status(200).json({ success: true, target: targetUsername, role: newRole });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
