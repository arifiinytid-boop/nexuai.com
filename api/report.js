// api/report.js — NEXUS AI Report Handler v3
// Handles bug reports AND payment confirmations
// Sends beautiful HTML emails via Resend

import { readFileSync, writeFileSync, existsSync } from 'fs';

const REPORT_FILE = '/tmp/nexus_reports.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET reports (admin only)
  if (req.method === 'GET') {
    const token = req.query.token;
    if (token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const reports = existsSync(REPORT_FILE)
        ? JSON.parse(readFileSync(REPORT_FILE, 'utf8'))
        : [];
      return res.status(200).json({ reports, total: reports.length });
    } catch (_) {
      return res.status(200).json({ reports: [], total: 0 });
    }
  }

  // POST new report
  if (req.method === 'POST') {
    const body = req.body || {};
    const {
      from, message, time, plan, credits, userId,
      avatar, type,
      paymentPack, paymentCR, paymentMethod, paymentTotal
    } = body;

    if (!message || !from) {
      return res.status(400).json({ error: 'from and message required' });
    }

    const isPayment = type === 'payment';
    const report = {
      id:      Date.now().toString(36),
      from:    String(from).substring(0, 50),
      userId:  userId || '0',
      avatar:  avatar || '',
      message: String(message).substring(0, 2000),
      plan:    plan || 'free',
      credits: credits || 0,
      time:    time || new Date().toISOString(),
      savedAt: Date.now(),
      type:    type || 'bug',
      ...(isPayment ? { paymentPack, paymentCR, paymentMethod, paymentTotal } : {}),
    };

    try {
      let reports = [];
      if (existsSync(REPORT_FILE)) {
        reports = JSON.parse(readFileSync(REPORT_FILE, 'utf8'));
      }
      reports.unshift(report);
      if (reports.length > 500) reports = reports.slice(0, 500);
      writeFileSync(REPORT_FILE, JSON.stringify(reports));
    } catch (e) {
      console.error('Failed to save report:', e.message);
    }

    // Send email via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const avatarHtml = avatar
        ? `<img src="${avatar}" style="width:60px;height:60px;border-radius:50%;border:2px solid #00e5ff;object-fit:cover;display:block;margin:0 auto 10px;" alt="${from}" onerror="this.style.display='none'">`
        : `<div style="width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#00e5ff,#8800ff);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:white;margin:0 auto 10px;">${from.charAt(0).toUpperCase()}</div>`;

      const subject = isPayment
        ? `💳 [NEXUS AI PAYMENT] ${from} — ${paymentTotal} (${paymentPack})`
        : `📩 [NEXUS AI REPORT] dari @${from}`;

      const emailBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#030312;font-family:'Courier New',monospace;">
<div style="max-width:580px;margin:0 auto;padding:24px 16px;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0a0b22,#06071a);border:1px solid rgba(0,229,255,.2);border-radius:12px;padding:20px;margin-bottom:16px;text-align:center;position:relative;overflow:hidden;">
    <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#00e5ff,#8800ff);"></div>
    <div style="font-family:'Courier New',monospace;font-size:20px;font-weight:700;background:linear-gradient(135deg,#00e5ff,#8800ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;color:#00e5ff;margin-bottom:4px;">NEXUS AI</div>
    <div style="font-size:10px;color:#3a4a7a;letter-spacing:3px;text-transform:uppercase;">${isPayment ? '💳 KONFIRMASI PEMBAYARAN' : '📩 LAPORAN BARU'}</div>
  </div>

  <!-- User Card -->
  <div style="background:#06071a;border:1px solid rgba(0,229,255,.12);border-radius:10px;padding:20px;margin-bottom:16px;text-align:center;">
    ${avatarHtml}
    <div style="font-size:16px;font-weight:700;color:white;margin-bottom:4px;">@${from}</div>
    <div style="font-size:11px;color:#3a4a7a;">Roblox ID: ${userId || '-'}</div>
    <div style="display:inline-flex;gap:8px;margin-top:8px;flex-wrap:wrap;justify-content:center;">
      <span style="background:rgba(255,214,0,.12);color:#ffd600;border:1px solid rgba(255,214,0,.2);border-radius:12px;padding:2px 10px;font-size:10px;font-weight:700;">${credits} CR</span>
      <span style="background:rgba(0,229,255,.08);color:#00e5ff;border:1px solid rgba(0,229,255,.2);border-radius:12px;padding:2px 10px;font-size:10px;font-weight:700;">${plan?.toUpperCase() || 'FREE'}</span>
    </div>
  </div>

  ${isPayment ? `
  <!-- Payment Details -->
  <div style="background:#06071a;border:1px solid rgba(0,255,170,.2);border-radius:10px;padding:20px;margin-bottom:16px;">
    <div style="font-size:11px;color:#00ffaa;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px;">💳 DETAIL PEMBAYARAN</div>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:7px 0;color:#3a4a7a;font-size:11px;width:120px;">Paket</td><td style="padding:7px 0;color:white;font-weight:700;font-size:12px;">${paymentPack || '-'}</td></tr>
      <tr><td style="padding:7px 0;color:#3a4a7a;font-size:11px;">Credits</td><td style="padding:7px 0;color:#ffd600;font-weight:700;font-size:14px;">${paymentCR} CR</td></tr>
      <tr><td style="padding:7px 0;color:#3a4a7a;font-size:11px;">Metode</td><td style="padding:7px 0;color:#00e5ff;font-weight:700;font-size:12px;">${paymentMethod?.toUpperCase() || '-'}</td></tr>
      <tr style="border-top:1px solid rgba(0,229,255,.12);">
        <td style="padding:12px 0 7px;color:white;font-size:12px;font-weight:700;">TOTAL BAYAR</td>
        <td style="padding:12px 0 7px;color:#00ffaa;font-size:18px;font-weight:700;">${paymentTotal || '-'}</td>
      </tr>
    </table>
    <div style="background:rgba(255,214,0,.05);border:1px solid rgba(255,214,0,.2);border-radius:6px;padding:10px;margin-top:10px;">
      <div style="font-size:10px;color:#ffd600;margin-bottom:4px;">⚠️ ACTION REQUIRED:</div>
      <div style="font-size:11px;color:#b8cfff;">Tambahkan <strong style="color:#ffd600;">${paymentCR} CR</strong> ke akun <strong style="color:white;">@${from}</strong> (ID: ${userId}) setelah memverifikasi transfer.</div>
    </div>
  </div>` : ''}

  <!-- Message -->
  <div style="background:#06071a;border:1px solid rgba(0,229,255,.12);border-radius:10px;padding:16px;margin-bottom:16px;">
    <div style="font-size:11px;color:#00e5ff;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">💬 ${isPayment ? 'CATATAN TRANSFER' : 'PESAN'}</div>
    <div style="font-size:12px;color:#b8cfff;line-height:1.7;white-space:pre-wrap;word-break:break-word;">${String(message).replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>
  </div>

  <!-- Meta -->
  <div style="background:#06071a;border:1px solid rgba(0,229,255,.08);border-radius:10px;padding:14px;margin-bottom:16px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:4px 0;color:#3a4a7a;font-size:10px;">Waktu</td><td style="padding:4px 0;color:#b8cfff;font-size:10px;">${time || new Date().toISOString()}</td></tr>
      <tr><td style="padding:4px 0;color:#3a4a7a;font-size:10px;">Report ID</td><td style="padding:4px 0;color:#b8cfff;font-size:10px;">${report.id}</td></tr>
    </table>
  </div>

  <!-- Footer -->
  <div style="text-align:center;font-size:9px;color:#3a4a7a;padding-top:10px;">
    NEXUS AI · NEXUS STUDIO · Built by FIINYTID25<br>
    nexusai-com.vercel.app
  </div>
</div>
</body>
</html>`;

      try {
        const emailResp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendKey}`
          },
          body: JSON.stringify({
            from: 'NEXUS AI <onboarding@resend.dev>',
            to:   ['arifiinytid@gmail.com'],
            subject,
            html: emailBody,
          })
        });
        if (!emailResp.ok) {
          const errData = await emailResp.json().catch(() => ({}));
          console.error('Resend error:', errData);
        }
      } catch (emailErr) {
        console.error('Email failed:', emailErr.message);
      }
    } else {
      console.warn('RESEND_API_KEY not set in Vercel environment variables!');
    }

    return res.status(200).json({ status: 'ok', id: report.id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
