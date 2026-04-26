// api/redeem.js — NEXUS AI Redeem Code Manager API v2
// User: POST /api/redeem dengan {code, user, userId} -> redeem kode
// Admin: GET /api/redeem?list=1&token=... -> list semua kode
// Admin: POST /api/redeem dengan {action:'create', token, credits, maxUses, expiresInDays} -> buat kode
// Admin: DELETE /api/redeem dengan {code, token} -> hapus kode

import { kv } from "@vercel/kv";

const CODES_LIST_KEY = 'nexus:code_list';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'nexusadmin2024';

// Helper untuk generate kode acak (8 karakter uppercase)
function generateRandomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // hilangkan karakter yang mirip
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const isAdmin = token === ADMIN_TOKEN;

  // ═══════════════════════════════════════════════════════════
  // GET — admin: list all codes
  // ═══════════════════════════════════════════════════════════
  if (req.method === 'GET') {
    if (!isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const codes = (await kv.get(CODES_LIST_KEY)) || [];
      return res.status(200).json({ codes });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // DELETE — admin: delete a code
  // ═══════════════════════════════════════════════════════════
  if (req.method === 'DELETE') {
    if (!isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'code required' });
    try {
      const upperCode = code.toUpperCase();
      // Hapus dari daftar
      const codes = (await kv.get(CODES_LIST_KEY)) || [];
      const newCodes = codes.filter(c => c.code !== upperCode);
      await kv.set(CODES_LIST_KEY, newCodes);
      // Hapus data kode
      await kv.del(`nexus:code:${upperCode}`);
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // POST
  // ═══════════════════════════════════════════════════════════
  if (req.method === 'POST') {
    const body = req.body || {};

    // ── Admin: create new code ────────────────────────────────
    if (body.action === 'create' && isAdmin) {
      const { credits, maxUses, expiresInDays } = body;
      if (!credits || !maxUses) return res.status(400).json({ error: 'credits and maxUses required' });
      try {
        const code = generateRandomCode();
        const newCode = {
          code,
          credits: parseFloat(credits),
          maxUses: parseInt(maxUses),
          uses: 0,
          expiresAt: expiresInDays
            ? new Date(Date.now() + parseInt(expiresInDays) * 86400000).toISOString()
            : null,
          createdAt: new Date().toISOString(),
        };
        // Simpan data kode
        await kv.set(`nexus:code:${code}`, newCode);
        // Tambahkan ke daftar
        const codes = (await kv.get(CODES_LIST_KEY)) || [];
        codes.push({ code, credits: newCode.credits, maxUses: newCode.maxUses, uses: 0, expiresAt: newCode.expiresAt, createdAt: newCode.createdAt });
        await kv.set(CODES_LIST_KEY, codes);
        return res.status(200).json({ success: true, code: newCode });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // ── User: redeem code ─────────────────────────────────────
    const { code, user, userId } = body;
    if (!code || !user) return res.status(400).json({ error: 'code and user required' });
    try {
      const upperCode = code.toUpperCase();
      const codeData = await kv.get(`nexus:code:${upperCode}`);
      if (!codeData) return res.status(404).json({ error: 'Code invalid or expired.' });

      // Cek expired
      if (codeData.expiresAt && new Date(codeData.expiresAt) < new Date()) {
        return res.status(400).json({ error: 'Code already expired.' });
      }

      // Cek sudah dipakai user
      const usedKey = `nexus:code_used:${upperCode}:${user}`;
      const alreadyUsed = await kv.get(usedKey);
      if (alreadyUsed) return res.status(400).json({ error: 'You have already used this code.' });

      // Cek limit
      if (codeData.uses >= codeData.maxUses) {
        return res.status(400).json({ error: 'This code has reached the maximum number of uses.' });
      }

      // Tandai digunakan
      await kv.set(usedKey, true, { ex: 86400 * 365 });
      // Update uses
      const updatedCode = { ...codeData, uses: codeData.uses + 1 };
      await kv.set(`nexus:code:${upperCode}`, updatedCode);

      // Update daftar kode untuk sinkronisasi uses (opsional, bisa diabaikan jika jarang)
      // Tidak wajib, karena daftar di list hanya untuk tampilan, bisa kita update juga.
      // (ringan saja)
      const codes = (await kv.get(CODES_LIST_KEY)) || [];
      const idx = codes.findIndex(c => c.code === upperCode);
      if (idx !== -1) {
        codes[idx].uses = updatedCode.uses;
        await kv.set(CODES_LIST_KEY, codes);
      }

      // Tambahkan kredit ke user
      const userDataKey = `nexusai:${user.toLowerCase()}`;
      const userData = (await kv.get(userDataKey)) || {};
      const newCredits = parseFloat(userData.credits || 30) + parseFloat(codeData.credits || 0);
      await kv.set(userDataKey, { ...userData, credits: parseFloat(newCredits.toFixed(4)), _updated: Date.now() });

      return res.status(200).json({ success: true, credits: codeData.credits, newCredits });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
