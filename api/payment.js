// api/payment.js — NEXUS AI Payment System v2
// Supports: GET config, POST create transaction, PATCH confirm (admin)
// Stores transactions in /tmp/nexus_payments.json
// Auto-grants credits after admin confirmation via sync.js

import { readFileSync, writeFileSync, existsSync } from 'fs';

const PAYMENTS_FILE = '/tmp/nexus_payments.json';

// ─── Helpers ───────────────────────────────────────────────
function loadPayments() {
  try {
    if (existsSync(PAYMENTS_FILE)) return JSON.parse(readFileSync(PAYMENTS_FILE, 'utf8'));
  } catch (_) {}
  return [];
}

function savePayments(payments) {
  try {
    writeFileSync(PAYMENTS_FILE, JSON.stringify(payments.slice(0, 500)));
  } catch (_) {}
}

function generateCode() {
  return 'NPAY-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

// ─── Main Handler ──────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ovo = process.env.OVO_NUMBER || '';
  const dana = process.env.DANA_NUMBER || '';
  const owner = process.env.PAYMENT_OWNER_NAME || 'NEXUS STUDIO';
  const adminToken = process.env.ADMIN_TOKEN || 'nexusadmin2024';

  // ═══════════════════════════════════════════════════════════
  // GET — config / status
  // ═══════════════════════════════════════════════════════════
  if (req.method === 'GET') {
    // Jika ada query "id", ambil status transaksi spesifik
    if (req.query.id) {
      const payments = loadPayments();
      const tx = payments.find(p => p.id === req.query.id);
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });
      return res.status(200).json({
        id: tx.id,
        status: tx.status,         // 'pending' / 'confirmed' / 'rejected'
        package: tx.package,
        credits: tx.credits,
        method: tx.method,
        total: tx.total,
        createdAt: tx.createdAt,
        confirmedAt: tx.confirmedAt || null,
      });
    }

    // Daftar transaksi (khusus admin)
    if (req.query.admin === '1') {
      const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
      if (token !== adminToken) return res.status(401).json({ error: 'Unauthorized' });
      const payments = loadPayments();
      return res.status(200).json({ payments, total: payments.length });
    }

    // Normal config
    if (!ovo && !dana) {
      return res.status(503).json({
        error: 'Payment not configured',
        message: 'Admin must set OVO_NUMBER and DANA_NUMBER in Vercel environment variables.',
      });
    }

    // Helper untuk masking
    function maskNumber(num) {
      if (!num || num.length < 8) return num;
      return num.substring(0, 4) + '****' + num.substring(num.length - 4);
    }

    return res.status(200).json({
      ovo: {
        available: !!ovo,
        number: ovo,            // full number (frontend akan menampilkan di tempat yang aman)
        masked: maskNumber(ovo),
        name: owner,
      },
      dana: {
        available: !!dana,
        number: dana,
        masked: maskNumber(dana),
        name: owner,
      },
      owner: owner,
      // Daftar paket yang tersedia (digunakan frontend untuk menampilkan pilihan)
      packages: [
        { id: 'small',   cr: 21,  idr: 79000,   usd: 4.99,  label: '21 CR — Small' },
        { id: 'popular', cr: 86,  idr: 299000,  usd: 18.99, label: '86 CR — Popular', popular: true },
        { id: 'mega',    cr: 438, idr: 1500000, usd: 93.99, label: '438 CR — Mega' },
      ],
    });
  }

  // ═══════════════════════════════════════════════════════════
  // POST — create transaction
  // ═══════════════════════════════════════════════════════════
  if (req.method === 'POST') {
    const {
      username,      // Roblox username (lowercase)
      userId,        // Roblox user ID
      packId,        // ID paket (dari daftar packages)
      method,        // 'ovo' / 'dana'
      amount,        // nominal yang di-transfer (IDR)
      note,          // catatan transfer
    } = req.body || {};

    if (!username || !packId || !method || !amount) {
      return res.status(400).json({ error: 'Missing required fields: username, packId, method, amount' });
    }

    // Cari paket
    const packages = [
      { id: 'small',   cr: 21,  idr: 79000 },
      { id: 'popular', cr: 86,  idr: 299000 },
      { id: 'mega',    cr: 438, idr: 1500000 },
    ];
    const pkg = packages.find(p => p.id === packId);
    if (!pkg) return res.status(400).json({ error: 'Invalid package ID' });

    // Buat transaksi baru
    const newTx = {
      id: generateCode(),
      username: username.toLowerCase().trim(),
      userId: userId || '0',
      package: pkg.id,
      credits: pkg.cr,
      method,
      total: pkg.idr,
      amountTransferred: parseInt(amount) || 0,
      note: note || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      confirmedAt: null,
    };

    const payments = loadPayments();
    payments.unshift(newTx);
    savePayments(payments);

    // Kirim notifikasi email ke admin (jika tersedia)
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendKey}`
          },
          body: JSON.stringify({
            from: 'NEXUS AI <onboarding@resend.dev>',
            to: ['arifiinytid@gmail.com'],
            subject: `💳 NEW PAYMENT: ${username} — Rp ${pkg.idr} (${pkg.id})`,
            html: `<p>New payment from <strong>@${username}</strong> (ID: ${userId})</p>
                   <p>Package: ${pkg.id} — ${pkg.cr} CR</p>
                   <p>Total: Rp ${pkg.idr}</p>
                   <p>Transaction Code: <strong>${newTx.id}</strong></p>
                   <p>Confirm via admin panel or API.</p>`,
          })
        });
      } catch (_) {}
    }

    return res.status(201).json({
      success: true,
      transaction: {
        id: newTx.id,
        code: newTx.id,
        status: 'pending',
        instructions: {
          method,
          number: method === 'ovo' ? ovo : dana,
          name: owner,
          amount: 'Rp ' + pkg.idr.toLocaleString('id-ID'),
          note: note || `NEXUS-${username}-${pkg.cr}CR`,
        },
      },
    });
  }

  // ═══════════════════════════════════════════════════════════
  // PATCH — admin actions (confirm / reject)
  // ═══════════════════════════════════════════════════════════
  if (req.method === 'PATCH') {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (token !== adminToken) return res.status(401).json({ error: 'Unauthorized' });

    const { id, action } = req.body || {};
    if (!id || !action) return res.status(400).json({ error: 'id and action required' });

    const payments = loadPayments();
    const tx = payments.find(p => p.id === id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.status !== 'pending') return res.status(400).json({ error: 'Transaction already processed' });

    if (action === 'confirm') {
      // Beri kredit ke user melalui sync.js
      try {
        const syncUrl = `https://${req.headers.host || 'nexusai-roblox.vercel.app'}/api/sync`;
        const syncRes = await fetch(syncUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'give-credits',
            target: tx.username,
            amount: tx.credits,
          }),
        });
        if (!syncRes.ok) throw new Error('Sync failed');
        tx.status = 'confirmed';
        tx.confirmedAt = new Date().toISOString();
        savePayments(payments);
        return res.status(200).json({ success: true, message: `Credited ${tx.credits} CR to @${tx.username}` });
      } catch (e) {
        return res.status(500).json({ error: 'Failed to grant credits: ' + e.message });
      }
    } else if (action === 'reject') {
      tx.status = 'rejected';
      tx.confirmedAt = new Date().toISOString();
      savePayments(payments);
      return res.status(200).json({ success: true, message: 'Transaction rejected' });
    }
    return res.status(400).json({ error: 'Invalid action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
