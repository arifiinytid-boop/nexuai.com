// api/auth.js — Roblox OAuth Callback Handler
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { code, error } = req.query;
  const isApiCall = req.headers['accept'] && req.headers['accept'].includes('application/json');

  if (error) {
    if (isApiCall) return res.status(400).json({ error: 'OAuth error: ' + error });
    return res.redirect(302, '/login?roblox_error=' + encodeURIComponent(error));
  }
  if (!code) {
    if (isApiCall) return res.status(400).json({ error: 'No code provided' });
    return res.redirect(302, '/login');
  }

  const clientId     = process.env.ROBLOX_CLIENT_ID;
  const clientSecret = process.env.ROBLOX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    if (isApiCall) return res.status(500).json({ error: 'ROBLOX_CLIENT_ID or ROBLOX_CLIENT_SECRET not configured' });
    return res.redirect(302, '/login?roblox_error=server_config');
  }

  try {
    const base = (process.env.PRODUCTION_URL || 'https://nexusai-roblox.vercel.app')
      .replace(/\/api\/auth\/?$/, '').replace(/\/$/, '');
    const redirectUri = base + '/api/auth';

    const tokenResp = await fetch('https://apis.roblox.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  redirectUri,
        client_id:     clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!tokenResp.ok) {
      const errData = await tokenResp.json().catch(() => ({}));
      const msg = errData.error_description || errData.error || 'Token exchange failed';
      if (isApiCall) return res.status(400).json({ error: msg });
      return res.redirect(302, '/login?roblox_error=' + encodeURIComponent(msg));
    }

    const tokenData  = await tokenResp.json();
    const accessToken = tokenData.access_token;

    const userInfoResp = await fetch('https://apis.roblox.com/oauth/v1/userinfo', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });

    if (!userInfoResp.ok) {
      if (isApiCall) return res.status(400).json({ error: 'Failed to get user info' });
      return res.redirect(302, '/login?roblox_error=userinfo_failed');
    }

    const userInfo = await userInfoResp.json();
    const userId   = userInfo.sub;
    const username = userInfo.preferred_username || userInfo.name;
    let avatarUrl  = userInfo.picture || '';

    if (!avatarUrl && userId) {
      try {
        const avResp = await fetch(
          `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png`
        );
        if (avResp.ok) {
          const avData = await avResp.json();
          if (avData.data && avData.data[0]) avatarUrl = avData.data[0].imageUrl || '';
        }
      } catch (_) {}
    }

    const userData = {
      id:          String(userId),
      username:    username,
      displayName: userInfo.name || username,
      avatar:      avatarUrl,
    };

    if (isApiCall) return res.status(200).json({ user: userData });

    // Browser redirect — kirim data ke /login via base64
    const encoded = Buffer.from(JSON.stringify(userData)).toString('base64');
    return res.redirect(302, '/login?roblox_user=' + encodeURIComponent(encoded));

  } catch (e) {
    if (isApiCall) return res.status(500).json({ error: e.message });
    return res.redirect(302, '/login?roblox_error=' + encodeURIComponent(e.message));
  }
}
