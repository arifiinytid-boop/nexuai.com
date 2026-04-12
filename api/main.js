// api/main.js — NEXUS AI Key Provider
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  res.status(200).json({
    gemini:   process.env.GEMINI_API_KEY  || '',
    claude:   process.env.CLAUDE_API_KEY  || '',
    openai:   process.env.OPENAI_API_KEY  || '',
    grok:     process.env.GROK_API_KEY    || '',
    gmail_key: process.env.GMAIL_KEY      || '',  // Google OAuth Client ID
    version:  '5.0',
  });
}
