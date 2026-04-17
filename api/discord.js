// api/discord.js — NEXUS AI Discord Bot Webhook Handler v1
// Handles Discord slash commands and sends notifications
// Setup: Set DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_PUBLIC_KEY in Vercel env
// Bot invite: https://discord.com/oauth2/authorize?client_id=YOUR_ID&permissions=8&scope=bot+applications.commands

import { readFileSync, writeFileSync, existsSync } from 'fs';
import crypto from 'crypto';

// ─── Discord signature verification ──────────────────────
function verifyDiscordSignature(req, body) {
  const signature = req.headers['x-signature-ed25519'];
  const timestamp  = req.headers['x-signature-timestamp'];
  const publicKey  = process.env.DISCORD_PUBLIC_KEY;

  if (!signature || !timestamp || !publicKey) return false;

  try {
    const nacl = require('tweetnacl');
    const msg  = Buffer.from(timestamp + JSON.stringify(body));
    const sig  = Buffer.from(signature, 'hex');
    const key  = Buffer.from(publicKey, 'hex');
    return nacl.sign.detached.verify(msg, sig, key);
  } catch(e) {
    // If tweetnacl not available, skip verification in dev
    console.warn('Signature verification skipped:', e.message);
    return process.env.NODE_ENV !== 'production';
  }
}

// ─── Owner / Admin check by Discord User ID ───────────────
// Set DISCORD_OWNER_IDS=discordId1,discordId2 in Vercel env
function getDiscordOwners() {
  return (process.env.DISCORD_OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
}
function getDiscordAdmins() {
  return (process.env.DISCORD_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
}
function isDiscordOwner(userId) { return getDiscordOwners().includes(String(userId)); }
function isDiscordAdmin(userId) { return isDiscordOwner(userId) || getDiscordAdmins().includes(String(userId)); }

// ─── KV helper (same as sync.js) ─────────────────────────
let kv = null;
async function initKV() {
  if (kv) return kv;
  try { const m = require('@vercel/kv'); kv = m.kv || m.default || m; } catch(_) {}
  return kv;
}
async function getUser(key) {
  const k = await initKV();
  if (k) { try { return await k.get('nexusai:' + key.toLowerCase()); } catch(_) {} }
  return null;
}
async function setUser(key, data) {
  const k = await initKV();
  if (k) { try { await k.set('nexusai:' + key.toLowerCase(), data, { ex: 60*60*24*365 }); return; } catch(_) {} }
}

// ─── Send Discord message ─────────────────────────────────
async function sendDiscordMessage(channelId, content, embeds = []) {
  const token = process.env.DISCORD_TOKEN;
  if (!token || !channelId) return;
  try {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bot ${token}` },
      body: JSON.stringify({ content, embeds })
    });
  } catch(e) { console.error('Discord send error:', e.message); }
}

// ─── Discord embed builders ───────────────────────────────
function reportEmbed(data) {
  return [{
    title: '📩 Bug Report Baru',
    color: 0x00e5ff,
    fields: [
      { name: '👤 User', value: `@${data.from} (ID: ${data.userId || '?'})`, inline: true },
      { name: '💳 Plan', value: data.plan || 'free', inline: true },
      { name: '⭐ Credits', value: String(data.credits || 0), inline: true },
      { name: '📝 Pesan', value: String(data.message || '-').substring(0, 1000) },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'NEXUS AI Report System' },
    thumbnail: data.userId ? { url: `https://www.roblox.com/headshot-thumbnail/image?userId=${data.userId}&width=60&height=60&format=png` } : undefined,
  }];
}

function paymentEmbed(data) {
  return [{
    title: '💳 Pembayaran Baru!',
    color: 0x00ff88,
    fields: [
      { name: '👤 User', value: `@${data.from} (ID: ${data.userId || '?'})`, inline: true },
      { name: '📦 Paket', value: data.paymentPack || '-', inline: true },
      { name: '💰 Total', value: data.paymentTotal || '-', inline: true },
      { name: '💳 Metode', value: (data.paymentMethod || '-').toUpperCase(), inline: true },
      { name: '⭐ Credits', value: String(data.paymentCR || 0) + ' CR', inline: true },
    ],
    description: '⚠️ **Verifikasi transfer dan tambahkan credits!**',
    timestamp: new Date().toISOString(),
    footer: { text: 'NEXUS AI Payment System' },
    thumbnail: data.userId ? { url: `https://www.roblox.com/headshot-thumbnail/image?userId=${data.userId}&width=60&height=60&format=png` } : undefined,
  }];
}

// ─── Command handlers ─────────────────────────────────────
async function handleCommand(interaction) {
  const { data, member, user } = interaction;
  const cmdName = data.name;
  const userId  = member?.user?.id || user?.id;
  const options  = {};
  (data.options || []).forEach(o => { options[o.name] = o.value; });

  // Helper: respond
  const respond = (content, ephemeral = false) => ({
    type: 4,
    data: { content, flags: ephemeral ? 64 : 0 }
  });
  const respondEmbed = (embeds, content = '', ephemeral = false) => ({
    type: 4,
    data: { content, embeds, flags: ephemeral ? 64 : 0 }
  });

  // ── /help ─────────────────────────────────────────────
  if (cmdName === 'help') {
    const isAdmin = isDiscordAdmin(userId);
    const cmds = [
      '`/help` — Tampilkan commands',
      '`/status` — Status NEXUS AI',
      '`/info <username>` — Info user Roblox',
      ...(isAdmin ? [
        '`/give <username> <amount>` — Tambah credits (Admin)',
        '`/take <username> <amount>` — Kurangi credits (Admin)',
        '`/setplan <username> <plan>` — Set plan user (Admin)',
        '`/ban <username> [reason]` — Ban user (Admin)',
        '`/unban <username>` — Unban user (Admin)',
        '`/userinfo <username>` — Detail user lengkap (Admin)',
        '`/broadcast <message>` — Kirim pesan ke log (Owner)',
      ] : []),
    ];
    return respondEmbed([{
      title: '⚡ NEXUS AI Bot Commands',
      color: 0x00e5ff,
      description: cmds.join('\n'),
      footer: { text: 'NEXUS AI · NEXUS STUDIO' },
    }], '', true);
  }

  // ── /status ───────────────────────────────────────────
  if (cmdName === 'status') {
    return respondEmbed([{
      title: '⚡ NEXUS AI Status',
      color: 0x00ff88,
      fields: [
        { name: '🌐 Website', value: 'nexusai-com.vercel.app', inline: true },
        { name: '🤖 Version', value: 'V7 Release', inline: true },
        { name: '📡 API', value: 'Online ✅', inline: true },
        { name: '🎮 Discord', value: 'discord.gg/HuGtbRvD', inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'NEXUS AI · NEXUS STUDIO' },
    }]);
  }

  // ── /info <username> ──────────────────────────────────
  if (cmdName === 'info') {
    const username = options.username;
    if (!username) return respond('❌ Username diperlukan!', true);
    const userData = await getUser(username);
    if (!userData) return respond(`❌ User @${username} tidak ditemukan di database.`, true);
    return respondEmbed([{
      title: `👤 @${username}`,
      color: 0x00e5ff,
      fields: [
        { name: '💰 Credits', value: parseFloat(userData.credits || 0).toFixed(2) + ' CR', inline: true },
        { name: '📋 Plan', value: userData.plan || 'free', inline: true },
        { name: '🚫 Banned', value: userData.banned ? 'Yes ❌' : 'No ✅', inline: true },
      ],
      thumbnail: userData.robloxId ? { url: `https://www.roblox.com/headshot-thumbnail/image?userId=${userData.robloxId}&width=80&height=80&format=png` } : undefined,
      footer: { text: 'NEXUS AI Database' },
    }], '', true);
  }

  // ── Admin-only commands ───────────────────────────────
  if (!isDiscordAdmin(userId)) {
    return respond('❌ Kamu tidak memiliki akses ke command ini.', true);
  }

  // ── /give <username> <amount> ─────────────────────────
  if (cmdName === 'give') {
    const username = options.username;
    const amount   = parseFloat(options.amount);
    if (!username || isNaN(amount) || amount <= 0) return respond('❌ Parameter tidak valid.', true);
    const existing = await getUser(username) || {};
    existing.credits = parseFloat(((existing.credits || 0) + amount).toFixed(4));
    existing._updated = Date.now();
    await setUser(username, existing);
    return respond(`✅ Berhasil! +${amount} CR → @${username}\nTotal: ${existing.credits} CR`);
  }

  // ── /take <username> <amount> ─────────────────────────
  if (cmdName === 'take') {
    const username = options.username;
    const amount   = parseFloat(options.amount);
    if (!username || isNaN(amount) || amount <= 0) return respond('❌ Parameter tidak valid.', true);
    const existing = await getUser(username) || {};
    existing.credits = parseFloat(((existing.credits || 0) - amount).toFixed(4));
    existing._updated = Date.now();
    await setUser(username, existing);
    return respond(`✅ -${amount} CR dari @${username}\nSisa: ${existing.credits} CR`);
  }

  // ── /setplan <username> <plan> ────────────────────────
  if (cmdName === 'setplan') {
    const username = options.username;
    const plan     = options.plan;
    if (!username || !['free','pro','owner'].includes(plan)) return respond('❌ Plan harus: free, pro, atau owner.', true);
    const existing = await getUser(username) || {};
    existing.plan  = plan;
    if (plan === 'pro')   existing.credits = Math.max(existing.credits || 0, 200);
    if (plan === 'owner') existing.credits = 999999;
    existing._updated = Date.now();
    await setUser(username, existing);
    return respond(`✅ Plan @${username} → **${plan.toUpperCase()}**`);
  }

  // ── /ban <username> [reason] ──────────────────────────
  if (cmdName === 'ban') {
    const username = options.username;
    const reason   = options.reason || 'No reason provided';
    if (!username) return respond('❌ Username diperlukan.', true);
    const existing = await getUser(username) || {};
    existing.banned    = true;
    existing.banReason = reason;
    existing.bannedAt  = Date.now();
    existing._updated  = Date.now();
    await setUser(username, existing);
    return respond(`🔨 @${username} telah di-**BAN**\nAlasan: ${reason}`);
  }

  // ── /unban <username> ─────────────────────────────────
  if (cmdName === 'unban') {
    const username = options.username;
    if (!username) return respond('❌ Username diperlukan.', true);
    const existing = await getUser(username) || {};
    existing.banned    = false;
    existing.banReason = null;
    existing._updated  = Date.now();
    await setUser(username, existing);
    return respond(`✅ @${username} telah di-**UNBAN**`);
  }

  // ── /userinfo <username> ──────────────────────────────
  if (cmdName === 'userinfo') {
    const username = options.username;
    if (!username) return respond('❌ Username diperlukan.', true);
    const userData = await getUser(username);
    if (!userData) return respond(`❌ User @${username} tidak ditemukan.`, true);
    return respondEmbed([{
      title: `🔍 Admin Info: @${username}`,
      color: 0xffd600,
      fields: [
        { name: '💰 Credits', value: parseFloat(userData.credits || 0).toFixed(2) + ' CR', inline: true },
        { name: '📋 Plan', value: userData.plan || 'free', inline: true },
        { name: '🚫 Banned', value: userData.banned ? `Yes - ${userData.banReason || '?'}` : 'No', inline: true },
        { name: '🆔 Roblox ID', value: String(userData.robloxId || '-'), inline: true },
        { name: '📅 Last Seen', value: userData._updated ? new Date(userData._updated).toLocaleString() : '-', inline: true },
        { name: '📧 Email', value: userData.googleEmail || '-', inline: true },
        { name: '🎭 Roles', value: (userData.roles || []).join(', ') || 'none', inline: true },
      ],
      thumbnail: userData.robloxId ? { url: `https://www.roblox.com/headshot-thumbnail/image?userId=${userData.robloxId}&width=80&height=80&format=png` } : undefined,
      footer: { text: 'NEXUS AI Admin Panel' },
    }], '', true);
  }

  // ── /broadcast (owner only) ───────────────────────────
  if (cmdName === 'broadcast') {
    if (!isDiscordOwner(userId)) return respond('❌ Owner only command.', true);
    const message = options.message;
    const notifChannel = process.env.DISCORD_NOTIF_CHANNEL;
    if (notifChannel && message) {
      await sendDiscordMessage(notifChannel, `📢 **NEXUS AI Broadcast:**\n${message}`);
    }
    return respond(`✅ Broadcast terkirim: ${message}`);
  }

  return respond('❌ Command tidak dikenal.', true);
}

// ─── Main handler ─────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: Register slash commands (call once) ──────────
  if (req.method === 'GET') {
    if (req.query.register !== '1') {
      return res.json({ status: 'NEXUS AI Discord Bot', version: 'V7' });
    }

    const token    = process.env.DISCORD_TOKEN;
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!token || !clientId) {
      return res.status(400).json({ error: 'DISCORD_TOKEN and DISCORD_CLIENT_ID required' });
    }

    const commands = [
      { name: 'help',      description: 'Tampilkan daftar commands NEXUS AI' },
      { name: 'status',    description: 'Status website & bot NEXUS AI' },
      { name: 'info',      description: 'Info user Roblox',
        options: [{ name: 'username', description: 'Username Roblox', type: 3, required: true }] },
      { name: 'give',      description: '[ADMIN] Tambah credits ke user',
        options: [
          { name: 'username', description: 'Username Roblox', type: 3, required: true },
          { name: 'amount',   description: 'Jumlah credits',  type: 10, required: true },
        ]},
      { name: 'take',      description: '[ADMIN] Kurangi credits dari user',
        options: [
          { name: 'username', description: 'Username Roblox', type: 3, required: true },
          { name: 'amount',   description: 'Jumlah credits',  type: 10, required: true },
        ]},
      { name: 'setplan',   description: '[ADMIN] Set plan user',
        options: [
          { name: 'username', description: 'Username Roblox', type: 3, required: true },
          { name: 'plan',     description: 'Plan (free/pro/owner)', type: 3, required: true,
            choices: [
              { name: 'Free',  value: 'free'  },
              { name: 'Pro',   value: 'pro'   },
              { name: 'Owner', value: 'owner' },
            ]},
        ]},
      { name: 'ban',       description: '[ADMIN] Ban user',
        options: [
          { name: 'username', description: 'Username Roblox', type: 3, required: true },
          { name: 'reason',   description: 'Alasan ban',      type: 3, required: false },
        ]},
      { name: 'unban',     description: '[ADMIN] Unban user',
        options: [{ name: 'username', description: 'Username Roblox', type: 3, required: true }] },
      { name: 'userinfo',  description: '[ADMIN] Detail lengkap user',
        options: [{ name: 'username', description: 'Username Roblox', type: 3, required: true }] },
      { name: 'broadcast', description: '[OWNER] Kirim broadcast ke channel notif',
        options: [{ name: 'message', description: 'Pesan broadcast', type: 3, required: true }] },
    ];

    try {
      const r = await fetch(
        `https://discord.com/api/v10/applications/${clientId}/commands`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bot ${token}` },
          body: JSON.stringify(commands),
        }
      );
      const data = await r.json();
      return res.json({ success: r.ok, registered: commands.length, data });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST: Receive Discord interactions ────────────────
  if (req.method === 'POST') {
    const body = req.body || {};

    // ── Handle report/payment notifications (from api/report.js) ──
    if (body._nexusNotify) {
      const notifChannel = process.env.DISCORD_NOTIF_CHANNEL;
      if (!notifChannel) return res.json({ status: 'no channel configured' });

      if (body.type === 'payment') {
        await sendDiscordMessage(notifChannel, '💳 **Pembayaran Masuk!**', paymentEmbed(body));
      } else if (body.type === 'report') {
        await sendDiscordMessage(notifChannel, '📩 **Report Baru!**', reportEmbed(body));
      } else {
        await sendDiscordMessage(notifChannel, body.message || 'Notifikasi dari NEXUS AI');
      }
      return res.json({ status: 'ok' });
    }

    // ── PING (Discord verification) ───────────────────────
    if (body.type === 1) {
      return res.json({ type: 1 });
    }

    // ── Slash command interaction ──────────────────────────
    if (body.type === 2) {
      try {
        const response = await handleCommand(body);
        return res.json(response);
      } catch(e) {
        console.error('Command error:', e.message);
        return res.json({ type: 4, data: { content: '❌ Error: ' + e.message, flags: 64 } });
      }
    }

    return res.json({ type: 1 });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
