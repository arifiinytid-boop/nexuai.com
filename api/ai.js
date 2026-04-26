// api/ai.js — NEXUS AI (Improved v2)

/**
 * Normalize messages array for different providers
 */
function normalizeMessages(msgs, provider) {
  if (!Array.isArray(msgs)) return [];
  const normalized = [];
  for (const m of msgs) {
    if (!m || !m.role) continue;
    const msg = { ...m };
    let role = msg.role;

    if (provider === 'gemini') {
      if (role === 'assistant' || role === 'ai' || role === 'agent' || role === 'model') role = 'model';
      else role = 'user';
    } else {
      if (role === 'assistant' || role === 'ai' || role === 'agent' || role === 'model') role = 'assistant';
      else if (role === 'system') role = 'system';
      else role = 'user';
    }

    // Ensure content is a string or valid array
    if (Array.isArray(msg.content)) {
      // Filter out invalid content items
      msg.content = msg.content.filter(c => c && (c.type === 'text' || c.type === 'image' || c.type === 'document' || c.type === 'inline_data'));
      if (msg.content.length === 0) continue;
    } else {
      msg.content = String(msg.content || '');
      if (!msg.content.trim()) continue;
    }

    msg.role = role;
    normalized.push(msg);
  }

  // Ensure Gemini: no consecutive same-role messages
  if (provider === 'gemini') {
    const deduped = [];
    for (const msg of normalized) {
      if (deduped.length > 0 && deduped[deduped.length - 1].role === msg.role) {
        // Merge content
        const prev = deduped[deduped.length - 1];
        if (typeof prev.content === 'string' && typeof msg.content === 'string') {
          prev.content += '\n' + msg.content;
        }
      } else {
        deduped.push(msg);
      }
    }
    return deduped;
  }

  return normalized;
}

/**
 * Fetch with timeout and retry
 */
async function fetchWithRetry(url, options, retries = 2, timeoutMs = 120000) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal
          ? // merge signals if user already has one
            createMergedSignal(options.signal, controller.signal)
          : controller.signal,
      });
      clearTimeout(timeout);
      return response;
    } catch (e) {
      clearTimeout(timeout);
      lastError = e;
      if (e.name === 'AbortError') throw e; // Don't retry on abort
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error('Request failed after retries');
}

/**
 * Merge two AbortSignals
 */
function createMergedSignal(signal1, signal2) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal1.addEventListener('abort', abort);
  signal2.addEventListener('abort', abort);
  return controller.signal;
}

/**
 * Parse error from API response
 */
async function parseApiError(response, providerName) {
  let errMsg = `${providerName} error ${response.status}`;
  try {
    const errData = await response.json();
    if (errData?.error?.message) errMsg = errData.error.message;
    else if (errData?.message) errMsg = errData.message;
    else if (typeof errData?.error === 'string') errMsg = errData.error;
    // Return original error data for status handling
    return { message: errMsg, status: response.status, data: errData };
  } catch (_) {
    return { message: errMsg, status: response.status, data: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = req.body || {};
  } catch (_) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const { provider, model, messages, system, max_tokens } = body;

  if (!provider || !model) {
    return res.status(400).json({ error: 'provider and model are required' });
  }
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required and must not be empty' });
  }

  try {
    // ══════════════════════════════════════════════════════════════════
    // 1. GEMINI
    // ══════════════════════════════════════════════════════════════════
    if (provider === 'gemini') {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return res.status(503).json({ error: 'Gemini not configured. Add GEMINI_API_KEY to environment variables.' });

      // Build fallback chain
      const modelChain = [model];
      if (model !== 'gemini-2.5-flash-lite') modelChain.push('gemini-2.5-flash-lite');
      if (model !== 'gemini-2.0-flash') modelChain.push('gemini-2.0-flash');
      const uniqueChain = [...new Set(modelChain)];

      const normalized = normalizeMessages(messages, 'gemini');

      const contents = normalized.map(m => {
        if (Array.isArray(m.content)) {
          const parts = m.content.map(c => {
            if (c.type === 'image' && c.source) {
              return {
                inline_data: {
                  mime_type: c.source.media_type || 'image/png',
                  data: c.source.data || c.data || '',
                },
              };
            }
            return { text: c.text || c.content || '' };
          });
          return { role: m.role, parts };
        }
        return { role: m.role, parts: [{ text: String(m.content || '') }] };
      });

      const geminiBody = {
        contents,
        generationConfig: {
          maxOutputTokens: Math.min(max_tokens || 65536, 65536),
          temperature: 0.7,
        },
      };
      if (system) {
        geminiBody.systemInstruction = { parts: [{ text: system }] };
      }

      let lastError = null;
      for (const tryModel of uniqueChain) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${tryModel}:generateContent?key=${key}`;
          const r = await fetchWithRetry(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiBody),
          });

          if (!r.ok) {
            const err = await parseApiError(r, 'Gemini');
            lastError = err.message;
            // Retry on overload / quota
            if (err.status === 503 || err.status === 429 ||
                err.message.includes('overloaded') || err.message.includes('quota') ||
                err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('UNAVAILABLE')) {
              continue;
            }
            return res.status(err.status || 500).json({ error: err.message });
          }

          const data = await r.json();
          const candidate = data?.candidates?.[0];
          const text = candidate?.content?.parts?.map(p => p.text || '').join('') || '';

          if (!text) {
            const reason = candidate?.finishReason;
            if (reason === 'SAFETY') {
              return res.status(400).json({ error: 'Response blocked by safety filters. Please rephrase your question.' });
            }
            lastError = `Empty response from ${tryModel} (finishReason: ${reason || 'unknown'})`;
            continue;
          }
          return res.status(200).json({ content: text, model_used: tryModel });
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          lastError = e.message;
          continue;
        }
      }

      return res.status(503).json({
        error: 'Gemini models are currently overloaded or unavailable. ' + (lastError || ''),
        overloaded: true,
        suggestion: 'Try switching to a Groq or Mistral model.',
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // 2. CLAUDE (Anthropic)
    // ══════════════════════════════════════════════════════════════════
    if (provider === 'claude') {
      const key = process.env.CLAUDE_API_KEY;
      if (!key) return res.status(503).json({ error: 'Claude not configured. Add CLAUDE_API_KEY to environment variables.' });

      const normalized = normalizeMessages(messages, 'claude');
      const cleanModel = model.replace('anthropic/', '').trim();

      const r = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: cleanModel,
          max_tokens: Math.min(max_tokens || 16000, 64000),
          system: system || undefined,
          messages: normalized,
        }),
      });

      if (!r.ok) {
        const err = await parseApiError(r, 'Claude');
        return res.status(err.status || 500).json({ error: err.message });
      }

      const d = await r.json();
      const text = d.content?.find(c => c.type === 'text')?.text || '';
      if (!text) return res.status(500).json({ error: 'Empty response from Claude' });
      return res.status(200).json({ content: text });
    }

    // ══════════════════════════════════════════════════════════════════
    // 3. OPENAI
    // ══════════════════════════════════════════════════════════════════
    if (provider === 'openai') {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return res.status(503).json({ error: 'OpenAI not configured. Add OPENAI_API_KEY to environment variables.' });

      const normalized = normalizeMessages(messages, 'openai');
      const allMsgs = system ? [{ role: 'system', content: system }, ...normalized] : normalized;

      const r = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: allMsgs,
          max_tokens: Math.min(max_tokens || 16384, 128000),
        }),
      });

      if (!r.ok) {
        const err = await parseApiError(r, 'OpenAI');
        if (err.status === 429) {
          return res.status(429).json({ error: 'OpenAI rate limit reached. Please wait a moment and try again.' });
        }
        if (err.status === 402 || err.message.includes('insufficient_quota')) {
          return res.status(402).json({ error: 'OpenAI quota exceeded. Please add credits to your OpenAI account.' });
        }
        return res.status(err.status || 500).json({ error: err.message });
      }

      const d = await r.json();
      const text = d?.choices?.[0]?.message?.content;
      if (!text) return res.status(500).json({ error: 'Empty response from OpenAI' });
      return res.status(200).json({ content: text });
    }

    // ══════════════════════════════════════════════════════════════════
    // 4. OPENROUTER
    // ══════════════════════════════════════════════════════════════════
    if (provider === 'openrouter') {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) return res.status(503).json({ error: 'OpenRouter not configured. Add OPENROUTER_API_KEY to environment variables.' });

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
          max_tokens: Math.min(max_tokens || 16384, 200000),
          temperature: 0.7,
        }),
      });

      if (!r.ok) {
        const err = await parseApiError(r, 'OpenRouter');
        if (err.status === 402 || err.message.toLowerCase().includes('insufficient balance')) {
          return res.status(402).json({ error: 'OpenRouter balance is empty. Please top up at openrouter.ai' });
        }
        if (err.status === 429) {
          return res.status(429).json({ error: 'OpenRouter rate limit. Please wait and try again.' });
        }
        return res.status(err.status || 500).json({ error: err.message });
      }

      const d = await r.json();
      const text = d?.choices?.[0]?.message?.content;
      if (!text) {
        const errorInfo = d?.error;
        if (errorInfo) return res.status(500).json({ error: `OpenRouter: ${errorInfo.message || JSON.stringify(errorInfo)}` });
        return res.status(500).json({ error: 'Empty response from OpenRouter' });
      }
      return res.status(200).json({ content: text });
    }

    // ══════════════════════════════════════════════════════════════════
    // 5. DEEPSEEK
    // ══════════════════════════════════════════════════════════════════
    if (provider === 'deepseek') {
      const key = process.env.DEEPSEEK_API_KEY;
      if (!key) return res.status(503).json({ error: 'DeepSeek not configured. Add DEEPSEEK_API_KEY to environment variables.' });

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
          max_tokens: Math.min(max_tokens || 16384, 65536),
          temperature: 0.7,
        }),
      });

      if (!r.ok) {
        const err = await parseApiError(r, 'DeepSeek');
        if (err.status === 402 || err.message.toLowerCase().includes('insufficient balance')) {
          return res.status(402).json({ error: 'DeepSeek balance is empty. Please top up at platform.deepseek.com' });
        }
        return res.status(err.status || 500).json({ error: err.message });
      }

      const d = await r.json();
      const choice = d?.choices?.[0];
      if (!choice) return res.status(500).json({ error: 'Empty response from DeepSeek' });

      const content = choice.message?.content || '';
      const reasoning = choice.message?.reasoning_content || '';

      let finalContent = '';
      if (reasoning) {
        finalContent += '🧠 **Reasoning (DeepSeek R1):**\n' + reasoning + '\n\n---\n\n';
      }
      finalContent += content;

      if (!finalContent.trim()) return res.status(500).json({ error: 'Empty response from DeepSeek' });
      return res.status(200).json({ content: finalContent, reasoning: reasoning || undefined });
    }

    // ══════════════════════════════════════════════════════════════════
    // 6. GROQ
    // ══════════════════════════════════════════════════════════════════
    if (provider === 'groq') {
      const key = process.env.GROQ_API_KEY;
      if (!key) return res.status(503).json({ error: 'Groq not configured. Add GROQ_API_KEY to environment variables.' });

      const normalized = normalizeMessages(messages, 'groq');
      const allMsgs = system ? [{ role: 'system', content: system }, ...normalized] : normalized;

      // Groq has token limits per model
      const groqMaxTokens = {
        'llama-3.1-8b-instant': 8192,
        'llama-3.3-70b-versatile': 32768,
        'openai/gpt-oss-120b': 16384,
      };
      const modelMax = groqMaxTokens[model] || 8192;

      const r = await fetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: allMsgs,
          max_completion_tokens: Math.min(max_tokens || modelMax, modelMax),
          temperature: 0.7,
        }),
      });

      if (!r.ok) {
        const err = await parseApiError(r, 'Groq');
        if (err.status === 429) {
          return res.status(429).json({ error: 'Groq rate limit reached. Please try again in a moment.' });
        }
        if (err.status === 413 || err.message.includes('context_length_exceeded') || err.message.includes('too large')) {
          return res.status(413).json({ error: 'Message too long for Groq. Please start a new chat or use a model with larger context.' });
        }
        return res.status(err.status || 500).json({ error: err.message });
      }

      const d = await r.json();
      const text = d?.choices?.[0]?.message?.content;
      if (!text) return res.status(500).json({ error: 'Empty response from Groq' });
      return res.status(200).json({ content: text });
    }

    // ══════════════════════════════════════════════════════════════════
    // 7. MISTRAL
    // ══════════════════════════════════════════════════════════════════
    if (provider === 'mistral') {
      const key = process.env.MISTRAL_API_KEY;
      if (!key) return res.status(503).json({ error: 'Mistral not configured. Add MISTRAL_API_KEY to environment variables.' });

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
          max_tokens: Math.min(max_tokens || 16384, 65536),
          temperature: 0.7,
        }),
      });

      if (!r.ok) {
        const err = await parseApiError(r, 'Mistral');
        if (err.status === 429) {
          return res.status(429).json({ error: 'Mistral rate limit. Please wait and try again.' });
        }
        if (err.status === 402) {
          return res.status(402).json({ error: 'Mistral quota exceeded. Please add credits.' });
        }
        return res.status(err.status || 500).json({ error: err.message });
      }

      const d = await r.json();
      const text = d?.choices?.[0]?.message?.content;
      if (!text) return res.status(500).json({ error: 'Empty response from Mistral' });
      return res.status(200).json({ content: text });
    }

    // ══════════════════════════════════════════════════════════════════
    // Unknown provider
    // ══════════════════════════════════════════════════════════════════
    return res.status(400).json({
      error: `Unknown provider: "${provider}". Supported: gemini, claude, openai, openrouter, deepseek, groq, mistral`,
    });

  } catch (e) {
    // Global error handler
    if (e.name === 'AbortError') {
      return res.status(408).json({ error: 'Request timed out. Please try again.' });
    }
    console.error('NEXUS AI Proxy Error:', e);
    return res.status(500).json({
      error: e.message || 'Internal server error. Please try again.',
    });
  }
}
