// api/report.js — NEXUS AI Report & Payment Confirmation V8.2
// Bug reports + payment confirmations dengan notifikasi Discord + email (Resend)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const type = body.type || 'report'; // 'report' | 'payment'

  const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
  const ADMIN_EMAIL    = process.env.ADMIN_EMAIL || 'arifiinytid@gmail.com';

  // ── Helper: kirim ke Discord channel ─────────────────────────
  async function sendDiscordNotif(channelId, embeds, content = '') {
    if (!DISCORD_TOKEN || !channelId) return false;
    try {
      const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bot ${DISCORD_TOKEN}` },
        body: JSON.stringify({ content, embeds }),
      });
      return r.ok;
    } catch(e) { console.error('Discord notif error:', e.message); return false; }
  }

  // ── Helper: ambil channel dari KV ────────────────────────────
  async function getNotifChannel(notifType) {
    try {
      const { kv } = await import('@vercel/kv');
      const config = await kv.get('nexusai:_ticket_config') || {};
      return config[`notif_${notifType}`] || config['notif_general'] || process.env.DISCORD_NOTIF_CHANNEL || null;
    } catch(e) {
      return process.env.DISCORD_NOTIF_CHANNEL || null;
    }
  }

  // ── Helper: kirim email via Resend ───────────────────────────
  async function sendEmail(subject, html) {
    if (!RESEND_API_KEY || !ADMIN_EMAIL) return false;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: 'NEXUS AI <noreply@nexusai-com.vercel.app>',
          to:   ADMIN_EMAIL,
          subject,
          html,
        }),
      });
      return r.ok;
    } catch(e) { console.error('Resend error:', e.message); return false; }
  }

  try {
    // ════════════════════════════════════════
    // Bug Report
    // ════════════════════════════════════════
    if (type === 'report') {
      const from    = body.from    || body.username || 'Anonymous';
      const userId  = body.userId  || body.robloxId || '?';
      const message = String(body.message || '').substring(0, 2000);
      const plan    = body.plan    || 'free';
      const credits = body.credits || 0;
      const browser = body.browser || '-';
      const page    = body.page    || '-';

      if (!message) return res.status(400).json({ error: 'Pesan tidak boleh kosong' });

      // Discord embed
      const embed = {
        title:       '📩 Bug Report Baru',
        color:       0x00e5ff,
        description: message.substring(0, 1000),
        fields: [
          { name: '👤 User',    value: `@${from} (ID: ${userId})`,    inline: true },
          { name: '💳 Plan',    value: plan,                           inline: true },
          { name: '⭐ Credits', value: String(credits),                inline: true },
          { name: '🌐 Browser', value: browser,                       inline: true },
          { name: '📄 Halaman', value: page,                          inline: true },
        ],
        timestamp: new Date().toISOString(),
        footer:    { text: 'NEXUS AI Report System V8.2' },
        thumbnail: userId !== '?' ? { url: `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=60&height=60&format=png` } : undefined,
      };

      const channelId = await getNotifChannel('report');
      const discordOk = await sendDiscordNotif(channelId, [embed], '**📩 Bug Report Baru!**');

      // Email fallback
      if (RESEND_API_KEY && ADMIN_EMAIL) {
        await sendEmail(`[NEXUS AI] Bug Report dari @${from}`, `
          <h2>Bug Report Baru</h2>
          <p><b>User:</b> @${from} (ID: ${userId})</p>
          <p><b>Plan:</b> ${plan} | <b>Credits:</b> ${credits}</p>
          <p><b>Browser:</b> ${browser}</p>
          <p><b>Halaman:</b> ${page}</p>
          <hr>
          <p>${message.replace(/\n/g, '<br>')}</p>
        `);
      }

      return res.status(200).json({ success: true, discord: discordOk });
    }

    // ════════════════════════════════════════
    // Payment Confirmation
    // ════════════════════════════════════════
    if (type === 'payment') {
      const from        = body.from        || body.username || 'Anonymous';
      const userId      = body.userId      || body.robloxId || '?';
      const paymentPack = body.paymentPack || body.pack || '-';
      const paymentTotal= body.paymentTotal|| body.total || '-';
      const paymentMethod=body.paymentMethod||body.method|| '-';
      const paymentCR   = body.paymentCR   || body.credits || 0;
      const proofUrl    = body.proofUrl    || null;
      const notes       = body.notes       || '-';

      const embed = {
        title:       '💳 Pembayaran Baru!',
        color:       0x00ff88,
        description: '⚠️ **Verifikasi transfer dan tambahkan credits!**',
        fields: [
          { name: '👤 User',    value: `@${from} (ID: ${userId})`,    inline: true },
          { name: '📦 Paket',   value: paymentPack,                    inline: true },
          { name: '💰 Total',   value: paymentTotal,                   inline: true },
          { name: '💳 Metode',  value: paymentMethod.toUpperCase(),   inline: true },
          { name: '⭐ Credits', value: `+${paymentCR} CR`,            inline: true },
          { name: '📝 Catatan', value: notes,                         inline: true },
          ...(proofUrl ? [{ name: '🖼️ Bukti', value: proofUrl }] : []),
        ],
        timestamp: new Date().toISOString(),
        footer:    { text: 'NEXUS AI Payment System V8.2 · Segera proses!' },
        thumbnail: userId !== '?' ? { url: `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=60&height=60&format=png` } : undefined,
        ...(proofUrl ? { image: { url: proofUrl } } : {}),
      };

      const channelId = await getNotifChannel('payment');
      const discordOk = await sendDiscordNotif(channelId, [embed], '**💳 PEMBAYARAN BARU! Cek dan proses segera.**');

      if (RESEND_API_KEY && ADMIN_EMAIL) {
        await sendEmail(`[NEXUS AI] Pembayaran dari @${from} — ${paymentTotal}`, `
          <h2>💳 Pembayaran Baru!</h2>
          <p><b>User:</b> @${from} (ID: ${userId})</p>
          <p><b>Paket:</b> ${paymentPack} | <b>Credits:</b> +${paymentCR} CR</p>
          <p><b>Total:</b> ${paymentTotal} via ${paymentMethod.toUpperCase()}</p>
          <p><b>Catatan:</b> ${notes}</p>
          ${proofUrl ? `<p><b>Bukti:</b> <a href="${proofUrl}">Lihat Bukti</a></p>` : ''}
          <hr><p><b>⚠️ Verifikasi dan tambahkan credits ke akun @${from}!</b></p>
        `);
      }

      return res.status(200).json({ success: true, discord: discordOk });
    }

    // ════════════════════════════════════════
    // General Notification
    // ════════════════════════════════════════
    if (type === 'general' || type === 'newuser') {
      const from    = body.from || 'System';
      const message = String(body.message || '').substring(0, 2000);
      const embed = {
        title:    type === 'newuser' ? '👤 User Baru Bergabung!' : '📢 Notifikasi NEXUS AI',
        color:    type === 'newuser' ? 0x8800ff : 0x00e5ff,
        description: message,
        fields:   body.userId ? [{ name: 'User', value: `@${from} (ID: ${body.userId})`, inline: true }] : [],
        timestamp: new Date().toISOString(),
        footer:   { text: 'NEXUS AI V8.2' },
      };
      const channelId = await getNotifChannel(type);
      const ok        = await sendDiscordNotif(channelId, [embed]);
      return res.status(200).json({ success: true, discord: ok });
    }

    return res.status(400).json({ error: 'type tidak valid' });
  } catch(e) {
    console.error('report.js error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
