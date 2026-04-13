// api/google-callback.js — Google OAuth Callback Handler
// Exchanges auth code for Google user info
// Required env var: GMAIL_KEY (Google OAuth Client ID) + GMAIL_CLIENT_SECRET

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { code, error } = req.query;

  if (error) return res.status(400).json({ error: 'OAuth error: ' + error });
  if (!code)  return res.status(400).json({ error: 'No code provided' });

  const clientId     = process.env.GMAIL_KEY;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      error: 'GMAIL_KEY or GMAIL_CLIENT_SECRET not configured in Vercel environment variables'
    });
  }

  try {
    const redirectUri = (process.env.VERCEL_URL
      ? 'https://' + process.env.VERCEL_URL
      : 'https://nexusai-com.vercel.app') + '/api/google-callback';

    // Step 1: Exchange code for tokens
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }).toString(),
    });

    if (!tokenResp.ok) {
      const errData = await tokenResp.json().catch(() => ({}));
      return res.status(400).json({ error: errData.error_description || 'Token exchange failed' });
    }

    const tokens = await tokenResp.json();

    // Step 2: Get user info
    const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token },
    });

    if (!userResp.ok) {
      return res.status(400).json({ error: 'Failed to get user info' });
    }

    const gUser = await userResp.json();

    return res.status(200).json({
      user: {
        id:      gUser.id,
        name:    gUser.name    || gUser.email,
        email:   gUser.email   || '',
        picture: gUser.picture || '',
      }
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
