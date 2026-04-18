// api/redeem.js — NEXUS AI Redeem Code Handler v3
// Mendukung kode dari env REDEEM_CODES dan KV custom codes

import { readFileSync, writeFileSync, existsSync } from 'fs';

let kv = null;
async function initKV() {
  if (kv) return kv;
  try { const m = require('@vercel/kv'); kv = m.kv || m.default || m; } catch(_) {}
  return kv;
}

const USED_FILE = '/tmp/nexus_redeemed.json';

const BUILTIN_CODES = {
  // ── GENERAL ───────────────────────────────────────────────
  'NEXUS2026':     { credits: 50,  plan: null,  maxUses: 9999, expires: '2026-12-31', desc: 'Welcome NEXUS AI 2026' },
  'DISCORD100':    { credits: 100, plan: null,  maxUses: 9999, expires: '2026-12-31', desc: 'Discord community bonus' },
  'FREECREDITS':   { credits: 30,  plan: null,  maxUses: 9999, expires: 'never',      desc: 'Free credits starter' },
  'ROBLOXDEV':     { credits: 75,  plan: null,  maxUses: 9999, expires: '2026-08-31', desc: 'Roblox developer bonus' },
  'NEXUSLOVE':     { credits: 70,  plan: null,  maxUses: 9999, expires: '2026-12-31', desc: 'From NEXUS with love' },
  'NEXUSFAM':      { credits: 60,  plan: null,  maxUses: 9999, expires: '2026-12-31', desc: 'NEXUS Family code' },

  // ── LIMITED TIME ──────────────────────────────────────────
  'LAUNCH50':      { credits: 50,  plan: null,  maxUses: 500,  expires: '2026-05-31', desc: 'Launch promo (500 uses)' },
  'SUMMER2026':    { credits: 60,  plan: null,  maxUses: 9999, expires: '2026-09-30', desc: 'Summer special 2026' },
  'APRIL2026':     { credits: 40,  plan: null,  maxUses: 9999, expires: '2026-04-30', desc: 'April bonus' },
  'MAY2026':       { credits: 45,  plan: null,  maxUses: 9999, expires: '2026-05-31', desc: 'May bonus' },
  'JUNI2026':      { credits: 50,  plan: null,  maxUses: 9999, expires: '2026-06-30', desc: 'Juni bonus' },
  'JULY2026':      { credits: 55,  plan: null,  maxUses: 9999, expires: '2026-07-31', desc: 'July bonus' },
  'AGUST2026':     { credits: 60,  plan: null,  maxUses: 9999, expires: '2026-08-31', desc: 'Agustus bonus' },
  'SEPT2026':      { credits: 55,  plan: null,  maxUses: 9999, expires: '2026-09-30', desc: 'September bonus' },
  'STUDIOBUILD':   { credits: 40,  plan: null,  maxUses: 500,  expires: '2026-07-31', desc: 'Studio builder pack' },
  'NEXUSBETA82':   { credits: 80,  plan: null,  maxUses: 300,  expires: '2026-06-30', desc: 'V8.2 Beta reward' },

  // ── CREATOR PACKS ─────────────────────────────────────────
  'CREATOR200':    { credits: 200, plan: null,  maxUses: 200,  expires: '2026-12-31', desc: 'Creator pack' },
  'DEVPACK100':    { credits: 100, plan: null,  maxUses: 300,  expires: '2026-10-31', desc: 'Dev pack' },
  'BUILDER150':    { credits: 150, plan: null,  maxUses: 150,  expires: '2026-08-31', desc: 'Builder pack' },
  'SCRIPTER80':    { credits: 80,  plan: null,  maxUses: 400,  expires: '2026-09-30', desc: 'Scripter pack' },
  'MODELER120':    { credits: 120, plan: null,  maxUses: 250,  expires: '2026-10-31', desc: 'Modeler pack' },
  'UIMAKER90':     { credits: 90,  plan: null,  maxUses: 300,  expires: '2026-09-30', desc: 'UI Maker pack' },
  'GAMEDEV175':    { credits: 175, plan: null,  maxUses: 100,  expires: '2026-08-31', desc: 'Game Dev special' },
  'LUAPRO110':     { credits: 110, plan: null,  maxUses: 200,  expires: '2026-09-30', desc: 'Lua Pro pack' },

  // ── VIP / PRO ─────────────────────────────────────────────
  'NEXUSPRO':      { credits: 200, plan: 'pro', maxUses: 10,   expires: '2026-06-30', desc: 'Pro plan upgrade' },
  'NEXUSVIP500':   { credits: 500, plan: 'pro', maxUses: 5,    expires: '2026-05-31', desc: 'VIP special' },
  'MEGAPACK':      { credits: 300, plan: 'pro', maxUses: 10,   expires: '2026-06-30', desc: 'Mega upgrade' },
  'PROMONTH':      { credits: 250, plan: 'pro', maxUses: 25,   expires: '2026-07-31', desc: 'Pro monthly' },

  // ── ONE-TIME ──────────────────────────────────────────────
  'BETA2025':      { credits: 100, plan: null,  maxUses: 50,   expires: '2026-04-30', desc: 'Beta tester reward' },
  'EARLYBIRD':     { credits: 120, plan: null,  maxUses: 30,   expires: '2026-04-25', desc: 'Early adopter' },
  'QWIEWIEUWI':    { credits: 150, plan: null,  maxUses: 9999, expires: 'never',      desc: 'Special community' },
  'FIINYTID25':    { credits: 999, plan: 'pro', maxUses: 1,    expires: 'never',      desc: 'Developer special' },

  // ── YOUTUBE / SOCIAL ──────────────────────────────────────
  'YOUTUBE50':     { credits: 50,  plan: null,  maxUses: 9999, expires: '2026-12-31', desc: 'YouTube subscriber' },
  'SUBSCRIBE100':  { credits: 100, plan: null,  maxUses: 1000, expires: '2026-12-31', desc: 'Subscribe bonus' },
  'NEXUSSOCIAL':   { credits: 60,  plan: null,  maxUses: 9999, expires: '2026-10-31', desc: 'Social media bonus' },
  'TIKTOK75':      { credits: 75,  plan: null,  maxUses: 9999, expires: '2026-08-31', desc: 'TikTok follower' },
  'INSTANEXUS':    { credits: 55,  plan: null,  maxUses: 9999, expires: '2026-10-31', desc: 'Instagram follow' },
  'VIRALVID':      { credits: 80,  plan: null,  maxUses: 500,  expires: '2026-07-31', desc: 'Viral video bonus' },

  // ── SEASONAL ──────────────────────────────────────────────
  'RAMADAN2026':   { credits: 100, plan: null,  maxUses: 9999, expires: '2026-04-20', desc: 'Ramadan Mubarak!' },
  'LEBARAN2026':   { credits: 80,  plan: null,  maxUses: 9999, expires: '2026-04-30', desc: 'Selamat Lebaran!' },
  'MERDEKA2026':   { credits: 170, plan: null,  maxUses: 1000, expires: '2026-08-20', desc: 'HUT RI ke-81' },
  'NATAL2026':     { credits: 90,  plan: null,  maxUses: 9999, expires: '2026-12-31', desc: 'Merry Christmas 2026' },
  'TAHUNBARU27':   { credits: 100, plan: null,  maxUses: 9999, expires: '2027-01-15', desc: 'Happy New Year 2027' },
  'IMLEK2026':     { credits: 88,  plan: null,  maxUses: 999,  expires: '2026-02-28', desc: 'Gong Xi Fa Cai!' },

  // ── EASTER EGGS ───────────────────────────────────────────
  'NEXUSEGG':      { credits: 250, plan: null,  maxUses: 10,   expires: '2026-12-31', desc: 'You found an easter egg!' },
  'NEXUSEGG2':     { credits: 180, plan: null,  maxUses: 15,   expires: '2026-12-31', desc: 'Secret egg #2!' },
  'NEXUSEGG3':     { credits: 120, plan: null,  maxUses: 25,   expires: '2026-12-31', desc: 'Secret egg #3!' },

  // ── COLLABORATION / EVENT ─────────────────────────────────
  'COLLAB2026':    { credits: 90,  plan: null,  maxUses: 500,  expires: '2026-09-30', desc: 'Collab event' },
  'HACKATHON':     { credits: 200, plan: null,  maxUses: 100,  expires: '2026-07-31', desc: 'Hackathon participant' },
  'CONTEST50':     { credits: 50,  plan: null,  maxUses: 9999, expires: '2026-12-31', desc: 'Contest participation' },
  'WINNER500':     { credits: 500, plan: 'pro', maxUses: 3,    expires: '2026-12-31', desc: 'Contest winner!' },

  // ── COMMUNITY REWARD ──────────────────────────────────────
  'HELPFUL100':    { credits: 100, plan: null,  maxUses: 200,  expires: '2026-12-31', desc: 'Helpful community member' },
  'REPORT30':      { credits: 30,  plan: null,  maxUses: 9999, expires: '2026-12-31', desc: 'Bug reporter reward' },
  'VETERAN150':    { credits: 150, plan: null,  maxUses: 100,  expires: '2026-12-31', desc: 'Veteran member' },

  // ── PROMO ─────────────────────────────────────────────────
  'HALFOFF':       { credits: 50,  plan: null,  maxUses: 9999, expires: '2026-06-30', desc: 'Half off promo' },
  'DOUBLECR':      { credits: 100, plan: null,  maxUses: 500,  expires: '2026-06-30', desc: 'Double credits promo' },
  'WEEKEND99':     { credits: 99,  plan: null,  maxUses: 999,  expires: '2026-12-31', desc: 'Weekend special 99 CR' },
  'FLASH200':      { credits: 200, plan: null,  maxUses: 50,   expires: '2026-05-31', desc: 'Flash sale 200 CR' },
};

async function getCustomCodes() {
  const kvClient = await initKV();
  if (kvClient) {
    try { return (await kvClient.get('nexusai:_custom_codes')) || {}; } catch(_) {}
  }
  return {};
}

async function getAllCodes() {
  const codes = { ...BUILTIN_CODES };
  // From env
  const envStr = process.env.REDEEM_CODES || '';
  if (envStr) {
    envStr.split(',').forEach(entry => {
      const parts = entry.trim().split(':');
      if (parts.length >= 2) {
        const code    = parts[0].trim().toUpperCase();
        const creds   = parseFloat(parts[1]) || 0;
        const plan    = parts[2] && parts[2] !== 'null' ? parts[2].trim() : null;
        const maxU    = parseInt(parts[3]) || 9999;
        const expires = parts[4] ? parts[4].trim() : 'never';
        if (code) codes[code] = { credits: creds, plan, maxUses: maxU, expires, desc: 'Env code' };
      }
    });
  }
  // From KV (custom codes added via /add-redeem)
  const custom = await getCustomCodes();
  for (const [code, data] of Object.entries(custom)) {
    codes[code.toUpperCase()] = data;
  }
  return codes;
}

function getUsed() {
  try {
    if (existsSync(USED_FILE)) return JSON.parse(readFileSync(USED_FILE, 'utf8'));
  } catch(_) {}
  return {};
}
function saveUsed(used) {
  try { writeFileSync(USED_FILE, JSON.stringify(used)); } catch(_) {}
}

function isExpired(code) {
  if (!code.expires || code.expires === 'never') return false;
  return new Date() > new Date(code.expires + 'T23:59:59');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const token = req.query.token;
    if (token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
    const codes = await getAllCodes();
    const used  = getUsed();
    const list  = Object.entries(codes).map(([code, data]) => ({
      code, ...data,
      usedBy:  used[code] ? Object.keys(used[code]).length : 0,
      expired: isExpired(data),
    }));
    return res.status(200).json({ codes: list, total: list.length });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const code = (body.code || '').trim().toUpperCase();
    const user = (body.user || '').trim().toLowerCase();

    if (!code) return res.status(400).json({ error: 'Kode tidak boleh kosong' });
    if (!user) return res.status(400).json({ error: 'User tidak boleh kosong' });

    const codes    = await getAllCodes();
    const codeData = codes[code];

    if (!codeData) {
      return res.status(404).json({ error: `Kode "${code}" tidak valid atau tidak ditemukan` });
    }
    if (isExpired(codeData)) {
      return res.status(400).json({ error: `Kode "${code}" sudah kadaluarsa (${codeData.expires})` });
    }

    const used      = getUsed();
    const codeUsed  = used[code] || {};
    const totalUses = Object.keys(codeUsed).length;

    if (totalUses >= codeData.maxUses) {
      return res.status(400).json({ error: 'Kode sudah habis digunakan' });
    }
    if (codeUsed[user]) {
      return res.status(400).json({ error: 'Kamu sudah pernah menggunakan kode ini' });
    }

    if (!used[code]) used[code] = {};
    used[code][user] = { ts: Date.now(), remaining: codeData.maxUses - totalUses - 1 };
    saveUsed(used);

    const remaining = codeData.maxUses - totalUses - 1;
    const expText   = codeData.expires === 'never' ? '' : ` (s/d ${codeData.expires})`;
    const planText  = codeData.plan ? ` + upgrade ke ${codeData.plan.toUpperCase()}` : '';
    const remText   = codeData.maxUses < 9999 ? ` · Sisa: ${remaining} uses` : '';

    return res.status(200).json({
      success: true,
      credits: codeData.credits,
      plan:    codeData.plan,
      desc:    codeData.desc,
      expires: codeData.expires,
      message: `+${codeData.credits} CR${planText} berhasil ditambahkan!${expText}${remText}`,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
