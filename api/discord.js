// api/discord.js — NEXUS AI Webhook Notification Handler
// Hanya mengurus notifikasi (Payment, Report, dll) dari website ke Discord

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const body = req.body || {};

    // ── Handle report/payment notifications ──
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

    // ── PING (Discord verification fallback) ──
    if (body.type === 1) {
      return res.json({ type: 1 });
    }
  }

  return res.status(200).json({ status: 'NEXUS AI API Route Active. Slash commands di-handle oleh Gateway Bot.' });
}

// ─── Helper Functions ─────────────────────────────────────
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
