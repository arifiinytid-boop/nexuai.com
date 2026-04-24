// api/redeem.js — Redeem code handler
import { kv } from "@vercel/kv";
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { code, user, userId } = req.body || {};
  if (!code || !user) return res.status(400).json({ error: 'code and user required' });
  try {
    // Check code in KV
    const codeData = await kv.get(`nexus:code:${code.toUpperCase()}`);
    if (!codeData) return res.status(404).json({ error: 'Code tidak valid atau sudah kadaluarsa.' });
    // Check if user already used this code
    const usedKey = `nexus:code_used:${code.toUpperCase()}:${user}`;
    const alreadyUsed = await kv.get(usedKey);
    if (alreadyUsed) return res.status(400).json({ error: 'Kamu sudah menggunakan kode ini.' });
    // Check uses
    if (codeData.uses >= codeData.maxUses) return res.status(400).json({ error: 'Kode sudah mencapai batas penggunaan.' });
    // Mark used
    await kv.set(usedKey, true, { ex: 86400 * 365 });
    await kv.set(`nexus:code:${code.toUpperCase()}`, { ...codeData, uses: codeData.uses + 1 });
    // Give credits to user
    const userData = await kv.get(`nexus:user:${user}`) || {};
    const newCredits = parseFloat(userData.credits || 30) + parseFloat(codeData.credits || 0);
    await kv.set(`nexus:user:${user}`, { ...userData, credits: newCredits, _updated: Date.now() });
    return res.status(200).json({ success: true, credits: codeData.credits, newCredits });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
