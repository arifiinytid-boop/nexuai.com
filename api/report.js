// api/report.js — NEXUS AI Report Handler
// Stores reports in /tmp and optionally emails via Resend

import { readFileSync, writeFileSync, existsSync } from 'fs';

const REPORT_FILE = '/tmp/nexus_reports.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
      return res.status(200).json({ reports });
    } catch (_) {
      return res.status(200).json({ reports: [] });
    }
  }

  // POST new report
  if (req.method === 'POST') {
    const body = req.body || {};
    const { from, message, time, plan, credits, userId } = body;

    if (!message || !from) {
      return res.status(400).json({ error: 'from and message required' });
    }

    // Save to /tmp
    const report = {
      id: Date.now().toString(36),
      from: String(from).substring(0, 50),
      userId: userId || '0',
      message: String(message).substring(0, 2000),
      plan: plan || 'free',
      credits: credits || 0,
      time: time || new Date().toISOString(),
      savedAt: Date.now()
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

    // Optional: send email via Resend if configured
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: 'NEXUS AI <reports@nexusai.com>',
            to: ['arifiinytid@gmail.com'],
            subject: `[NEXUS AI Report] from ${from}`,
            html: `
              <h2>New Report from NEXUS AI</h2>
              <p><strong>User:</strong> ${from} (ID: ${userId})</p>
              <p><strong>Plan:</strong> ${plan} | <strong>Credits:</strong> ${credits}</p>
              <p><strong>Time:</strong> ${time}</p>
              <hr>
              <p><strong>Message:</strong></p>
              <p>${String(message).replace(/\n/g, '<br>')}</p>
            `
          })
        });
      } catch (emailErr) {
        console.error('Email failed (non-critical):', emailErr.message);
      }
    }

    return res.status(200).json({ status: 'ok', id: report.id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
