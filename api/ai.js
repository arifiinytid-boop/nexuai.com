// api/ai.js — NEXUS AI Secure Proxy v1.0
// All API keys stay server-side — NEVER exposed to client
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const { provider, model, messages, system, max_tokens, attachments } = body;

  if (!provider || !model || !messages) {
    return res.status(400).json({ error: 'provider, model, messages required' });
  }

  try {
    if (provider === 'gemini') {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return res.status(503).json({ error: 'Gemini not configured' });

      const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content || '' }]
      }));

      // Handle image attachments in last user message
      if (attachments && attachments.length > 0 && contents.length > 0) {
        const last = contents[contents.length - 1];
        if (last.role === 'user') {
          attachments.filter(a => a.type === 'image').forEach(a => {
            last.parts.push({
              inline_data: {
                mime_type: a.mime || 'image/jpeg',
                data: a.dataUrl ? a.dataUrl.split(',')[1] : a.data
              }
            });
          });
        }
      }

      const geminiBody = {
        contents,
        systemInstruction: { parts: [{ text: system || '' }] },
        generationConfig: { maxOutputTokens: 65536, temperature: 0.7 }
      };

      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody), signal: AbortSignal.timeout(90000) }
      );
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: (e.error && e.error.message) || 'Gemini error ' + r.status });
      }
      const d = await r.json();
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) return res.status(500).json({ error: 'Empty response from Gemini' });
      return res.status(200).json({ text });
    }

    if (provider === 'claude') {
      const key = process.env.CLAUDE_API_KEY;
      if (!key) return res.status(503).json({ error: 'Claude not configured' });
      const cleanModel = model.replace('anthropic/', '');
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: cleanModel, max_tokens: max_tokens || 16000, system: system || '', messages }),
        signal: AbortSignal.timeout(90000)
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); return res.status(r.status).json({ error: (e.error?.message) || 'Claude error ' + r.status }); }
      const d = await r.json();
      if (d.content?.[0]?.text) return res.status(200).json({ text: d.content[0].text });
      return res.status(500).json({ error: 'Empty Claude response' });
    }

    if (provider === 'openai') {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return res.status(503).json({ error: 'OpenAI not configured' });
      const all = [{ role: 'system', content: system || '' }, ...messages];
      const bodyObj = { model, messages: all };
      if (model.startsWith('o')) bodyObj.max_completion_tokens = 32768; else bodyObj.max_tokens = 16384;
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify(bodyObj), signal: AbortSignal.timeout(90000)
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); return res.status(r.status).json({ error: (e.error?.message) || 'OpenAI error ' + r.status }); }
      const d = await r.json();
      const text = d.choices?.[0]?.message?.content;
      if (text) return res.status(200).json({ text });
      return res.status(500).json({ error: 'Empty OpenAI response' });
    }

    if (provider === 'openrouter') {
      const key = process.env.OR_KEY || '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';
      const all = [{ role: 'system', content: system || '' }, ...messages];
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'HTTP-Referer': 'https://nexusai-com.vercel.app', 'X-Title': 'NEXUS AI' },
        body: JSON.stringify({ model, messages: all, max_tokens: 16384, temperature: 0.7 }),
        signal: AbortSignal.timeout(90000)
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); return res.status(r.status).json({ error: (e.error?.message) || 'OpenRouter error ' + r.status }); }
      const d = await r.json();
      const text = d.choices?.[0]?.message?.content;
      if (text) return res.status(200).json({ text });
      return res.status(500).json({ error: 'Empty OpenRouter response' });
    }

    return res.status(400).json({ error: 'Unknown provider: ' + provider });
  } catch(e) {
    console.error('AI proxy error:', e.message);
    return res.status(500).json({ error: e.message || 'Internal error' });
  }
}
