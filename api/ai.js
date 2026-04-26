// api/ai.js — NEXUS AI

function normalizeMessages(msgs, provider) {
  if (!Array.isArray(msgs)) return [];
  return msgs.map(m => {
    const msg = { ...m };
    let role = msg.role;
    if (provider === 'gemini') {
      if (role === 'assistant' || role === 'ai' || role === 'model') role = 'model';
      else if (role !== 'user') role = 'user';
    } else {
      if (role === 'assistant' || role === 'ai' || role === 'model') role = 'assistant';
      else if (role === 'system') role = 'system';
      else role = 'user';
    }
    msg.role = role;
    return msg;
  });
}

/**
 * Helper untuk fetch dengan retry
 */
async function fetchWithRetry(url, options, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      return response;
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

export default async function handler(req, res) {
  // CORS + preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const { provider, model, messages, system, max_tokens } = body;
    
    if (!provider || !model || !messages) {
      return res.status(400).json({ error: 'provider, model, messages required' });
    }

    // ──────────────────────────────────────────────────────────
    // 1. GEMINI
    // ──────────────────────────────────────────────────────────
    if (provider === 'gemini') {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return res.status(503).json({ error: 'Gemini not configured. Set GEMINI_API_KEY in Vercel.' });

      const modelFallbacks = [
        model,
        'gemini-2.5-flash-lite',
        'gemini-1.5-flash',
      ];
      const modelsToTry = [...new Set(modelFallbacks)];

      let lastError = null;
      for (const tryModel of modelsToTry) {
        try {
          const normalized = normalizeMessages(messages, 'gemini');
          const contents = normalized.map(m => ({
            role: m.role,
            parts: Array.isArray(m.content)
              ? m.content.map(c => c.type === 'image'
                  ? { inline_data: { mime_type: c.source?.media_type || 'image/png', data: c.source?.data || c.data || '' } }
                  : { text: c.text || '' })
              : [{ text: String(m.content || '') }],
          }));

          const geminiBody = {
            contents,
            systemInstruction: system ? { parts: [{ text: system }] } : undefined,
            generationConfig: {
              maxOutputTokens: max_tokens || 65536,
              temperature: 0.7,
            },
          };

          const r = await fetchWithRetry(
            `https://generativelanguage.googleapis.com/v1beta/models/${tryModel}:generateContent?key=${key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(geminiBody),
            }
          );

          if (!r.ok) {
            const errData = await r.json().catch(() => ({}));
            const errMsg = (errData.error && errData.error.message) || `HTTP ${r.status}`;
            if (r.status === 503 || r.status === 429 || 
                errMsg.includes('overloaded') || errMsg.includes('quota')) {
              lastError = errMsg;
              continue;
            }
            return res.status(r.status).json({ error: errMsg });
          }

          const data = await r.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) {
            lastError = 'Empty response from ' + tryModel;
            continue;
          }
          return res.status(200).json({ content: text, model_used: tryModel });
        } catch (e) {
          lastError = e.message;
          continue;
        }
      }

      return res.status(503).json({
        error: 'All Gemini models are currently overloaded. ' + (lastError || ''),
        overloaded: true,
      });
    }

    // ──────────────────────────────────────────────────────────
    // 2. CLAUDE (Anthropic)
    // ──────────────────────────────────────────────────────────
    if (provider === 'claude') {
      const key = process.env.CLAUDE_API_KEY;
      if (!key) return res.status(503).json({ error: 'Claude not configured. Set CLAUDE_API_KEY in Vercel.' });

      const normalized = normalizeMessages(messages, 'claude');
      const r = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model.replace('anthropic/', ''),
          max_tokens: max_tokens || 16000,
          system: system || '',
          messages: normalized,
        }),
      });

      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: (e.error && e.error.message) || 'Claude HTTP ' + r.status });
      }
      const d = await r.json();
      const t = d.content?.[0]?.text;
      if (!t) return res.status(500).json({ error: 'Empty Claude response' });
      return res.status(200).json({ content: t });
    }

    // ──────────────────────────────────────────────────────────
    // 3. OPENAI
    // ──────────────────────────────────────────────────────────
    if (provider === 'openai') {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return res.status(503).json({ error: 'OpenAI not configured. Set OPENAI_API_KEY in Vercel.' });

      const normalized = normalizeMessages(messages, 'openai');
      const allMsgs = system ? [{ role: 'system', content: system }, ...normalized] : normalized;
      const bodyObj = { model, messages: allMsgs };
      bodyObj.max_tokens = max_tokens || 16384;

      const r = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify(bodyObj),
      });

      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: (e.error && e.error.message) || 'OpenAI HTTP ' + r.status });
      }
      const d = await r.json();
      const t = d?.choices?.[0]?.message?.content;
      if (!t) return res.status(500).json({ error: 'Empty OpenAI response' });
      return res.status(200).json({ content: t });
    }

    // ──────────────────────────────────────────────────────────
    // 4. OPENROUTER
    // ──────────────────────────────────────────────────────────
    if (provider === 'openrouter') {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) return res.status(503).json({ error: 'OpenRouter not configured. Set OPENROUTER_API_KEY in Vercel.' });

      const normalized = normalizeMessages(messages, 'openrouter');
      const allMsgs = system ? [{ role: 'system', content: system }, ...normalized] : normalized;

      const r = await fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          'HTTP-Referer': 'https://nexusai-roblox.vercel.app',
          'X-Title': 'NEXUS AI',
        },
        body: JSON.stringify({
          model,
          messages: allMsgs,
          max_tokens: max_tokens || 16384,
          temperature: 0.7,
        }),
      });

      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        const errMsg = (e.error && e.error.message) || `OpenRouter HTTP ${r.status}`;
        if (errMsg.toLowerCase().includes('insufficient balance') || e.error?.code === 402) {
          return res.status(402).json({ error: 'Insufficient Balance — Saldo OpenRouter Anda habis.' });
        }
        return res.status(r.status).json({ error: errMsg });
      }
      const d = await r.json();
      const t = d?.choices?.[0]?.message?.content;
      if (!t) return res.status(500).json({ error: 'Empty OpenRouter response' });
      return res.status(200).json({ content: t });
    }

    // ──────────────────────────────────────────────────────────
    // 5. DEEPSEEK (native) + Model Reasoning (R1)
    // ──────────────────────────────────────────────────────────
    if (provider === 'deepseek') {
      const key = process.env.DEEPSEEK_API_KEY;
      if (!key) return res.status(503).json({ error: 'DeepSeek not configured. Set DEEPSEEK_API_KEY in Vercel.' });

      const normalized = normalizeMessages(messages, 'deepseek');
      const allMsgs = system ? [{ role: 'system', content: system }, ...normalized] : normalized;

      const r = await fetchWithRetry('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: allMsgs,
          max_tokens: max_tokens || 16384,
          temperature: 0.7,
        }),
      });

      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        const errMsg = (e.error && e.error.message) || `DeepSeek HTTP ${r.status}`;
        if (errMsg.toLowerCase().includes('insufficient balance') || e.error?.code === 402) {
          return res.status(402).json({ error: 'Insufficient Balance — Saldo DeepSeek Anda habis.' });
        }
        return res.status(r.status).json({ error: errMsg });
      }
      const d = await r.json();
      const choice = d?.choices?.[0];
      if (!choice) return res.status(500).json({ error: 'Empty DeepSeek response' });

      // Ambil konten utama dan reasoning (jika ada, dari model R1)
      const content = choice.message?.content || '';
      const reasoning = choice.message?.reasoning_content || '';

      // Gabungkan reasoning + konten (reasoning di atas, konten di bawah)
      let finalContent = '';
      if (reasoning) {
        finalContent += '🧠 **Reasoning (DeepSeek R1):**\n' + reasoning + '\n\n---\n\n';
      }
      finalContent += content;

      if (!finalContent.trim()) return res.status(500).json({ error: 'Empty DeepSeek response' });
      return res.status(200).json({ content: finalContent, reasoning: reasoning || undefined });
    }

    // ──────────────────────────────────────────────────────────
    // 6. GROQ (gratis, kompatibel OpenAI)
    // ──────────────────────────────────────────────────────────
    if (provider === 'groq') {
      const key = process.env.GROQ_API_KEY;
      if (!key) return res.status(503).json({ error: 'Groq not configured. Set GROQ_API_KEY in Vercel.' });

      const normalized = normalizeMessages(messages, 'groq');
      const allMsgs = system ? [{ role: 'system', content: system }, ...normalized] : normalized;

      const r = await fetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: allMsgs,
          max_tokens: max_tokens || 1024,
          temperature: 0.7,
        }),
      });

      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: (e.error && e.error.message) || 'Groq HTTP ' + r.status });
      }
      const d = await r.json();
      const t = d?.choices?.[0]?.message?.content;
      if (!t) return res.status(500).json({ error: 'Empty Groq response' });
      return res.status(200).json({ content: t });
    }

    // ──────────────────────────────────────────────────────────
    // 7. MISTRAL (gratis tier)
    // ──────────────────────────────────────────────────────────
    if (provider === 'mistral') {
      const key = process.env.MISTRAL_API_KEY;
      if (!key) return res.status(503).json({ error: 'Mistral not configured. Set MISTRAL_API_KEY in Vercel.' });

      const normalized = normalizeMessages(messages, 'mistral');
      const allMsgs = system ? [{ role: 'system', content: system }, ...normalized] : normalized;

      const r = await fetchWithRetry('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: allMsgs,
          max_tokens: max_tokens || 16384,
          temperature: 0.7,
        }),
      });

      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: (e.error && e.error.message) || 'Mistral HTTP ' + r.status });
      }
      const d = await r.json();
      const t = d?.choices?.[0]?.message?.content;
      if (!t) return res.status(500).json({ error: 'Empty Mistral response' });
      return res.status(200).json({ content: t });
    }

    // ──────────────────────────────────────────────────────────
    // Unknown provider
    // ──────────────────────────────────────────────────────────
    return res.status(400).json({ error: 'Unknown provider: ' + provider });

  } catch (e) {
    console.error('AI Proxy Error:', e);
    return res.status(500).json({ 
      error: e.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
}
