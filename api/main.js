// api/main.js — NEXUS AI Config Provider v10.2
// SECURITY: Returns only OAuth client IDs, NOT secret API keys
// All AI calls go through /api/ai.js server-side proxy
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // NEVER return raw API keys - they stay server-side in /api/ai.js
  res.status(200).json({
    gmail_key:        process.env.GMAIL_KEY         || '',
    roblox_client_id: process.env.ROBLOX_CLIENT_ID  || '',
    discord_invite:   process.env.DISCORD_INVITE    || 'HuGtbRvD',
    version:          '10.3',
    has_gemini:   !!(process.env.GEMINI_API_KEY),
    has_claude:   !!(process.env.CLAUDE_API_KEY),
    has_openai:   !!(process.env.OPENAI_API_KEY),
    has_openrouter: true,
  });
}
