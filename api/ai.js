// api/ai.js — NEXUS AI Server-Side AI Proxy v10.3
// ALL AI calls routed here — API keys NEVER reach the browser
// Supported providers: gemini, claude, openai, openrouter, deepseek
// Auto-fallback when model is overloaded (503, 429)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { provider, model, messages, system, max_tokens } = body;
    if (!provider || !model || !messages) return res.status(400).json({ error: 'provider, model, messages required' });

    // ── GEMINI ────────────────────────────────────────────────
    if (provider === 'gemini') {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return res.status(503).json({ error: 'Gemini not configured' });

      const modelFallbacks = [
        model,
        'gemini-2.5-flash-lite',
        'gemini-2.5-flash',
        'gemini-1.5-flash-latest',
        'gemini-1.5-flash',
      ];

      const modelsToTry = [...new Set(modelFallbacks)];
      
      let lastError = null;
      for (const tryModel of modelsToTry) {
        try {
          const contents = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: Array.isArray(m.content)
              ? m.content.map(c => c.type === 'image' ? { inline_data: { mime_type: c.source.media_type, data: c.source.data } } : { text: c.text || '' })
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

          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${tryModel}:generateContent?key=${key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(geminiBody),
              signal: AbortSignal.timeout(120000),
            }
          );

          if (!r.ok) {
            const errData = await r.json().catch(() => ({}));
            const errMsg = (errData.error && errData.error.message) || `HTTP ${r.status}`;
            if (r.status === 503 || r.status === 429 || errMsg.includes('overloaded') || errMsg.includes('high demand') || errMsg.includes('quota')) {
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
        error: 'All Gemini models are currently overloaded. ' + (lastError || 'Please try again later.'),
        overloaded: true
      });
    }

    // ── CLAUDE ────────────────────────────────────────────────
    if (provider === 'claude') {
      const key = process.env.CLAUDE_API_KEY;
      if (!key) return res.status(503).json({ error: 'Claude not configured' });
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: model.replace('anthropic/', ''), max_tokens: max_tokens || 16000, system: system || '', messages }),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); return res.status(r.status).json({ error: (e.error && e.error.message) || 'Claude HTTP ' + r.status }); }
      const d = await r.json();
      if (d.content?.[0]?.text) return res.status(200).json({ content: d.content[0].text });
      return res.status(500).json({ error: 'Empty Claude response' });
    }

    // ── OPENAI ────────────────────────────────────────────────
    if (provider === 'openai') {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return res.status(503).json({ error: 'OpenAI not configured' });
      const allMsgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
      const bodyObj = { model, messages: allMsgs };
      if (model.startsWith('o')) bodyObj.max_completion_tokens = max_tokens || 32768; else bodyObj.max_tokens = max_tokens || 16384;
      const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }, body: JSON.stringify(bodyObj), signal: AbortSignal.timeout(120000) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); return res.status(r.status).json({ error: (e.error && e.error.message) || 'OpenAI HTTP ' + r.status }); }
      const d = await r.json();
      const t = d?.choices?.[0]?.message?.content;
      if (!t) return res.status(500).json({ error: 'Empty OpenAI response' });
      return res.status(200).json({ content: t });
    }

    // ── OPENROUTER ────────────────────────────────────────────
    if (provider === 'openrouter') {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) return res.status(503).json({ error: 'OpenRouter not configured' });
      const allMsgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'HTTP-Referer': 'https://nexusai-roblox.vercel.app', 'X-Title': 'NEXUS AI' },
        body: JSON.stringify({ model, messages: allMsgs, max_tokens: max_tokens || 16384, temperature: 0.7 }),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); return res.status(r.status).json({ error: (e.error && e.error.message) || 'OpenRouter HTTP ' + r.status }); }
      const d = await r.json();
      const t = d?.choices?.[0]?.message?.content;
      if (!t) return res.status(500).json({ error: 'Empty OpenRouter response' });
      return res.status(200).json({ content: t });
    }

    // ── DEEPSEEK (NATIVE API) ─────────────────────────────────
    if (provider === 'deepseek') {
      const key = process.env.DEEPSEEK_API_KEY;
      if (!key) return res.status(503).json({ error: 'DeepSeek not configured' });
      const allMsgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
      const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          model: model,
          messages: allMsgs,
          max_tokens: max_tokens || 16384,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: (e.error && e.error.message) || 'DeepSeek HTTP ' + r.status });
      }
      const d = await r.json();
      const t = d?.choices?.[0]?.message?.content;
      if (!t) return res.status(500).json({ error: 'Empty DeepSeek response' });
      return res.status(200).json({ content: t });
    }

    return res.status(400).json({ error: 'Unknown provider: ' + provider });

  } catch (e) {
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
}
