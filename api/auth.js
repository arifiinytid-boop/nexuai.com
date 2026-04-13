// api/auth.js — Roblox OAuth Callback Handler
// Exchange auth code for user info
// Required env vars:
//   ROBLOX_CLIENT_ID     — from create.roblox.com/dashboard/credentials
//   ROBLOX_CLIENT_SECRET — from create.roblox.com/dashboard/credentials

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { code, error } = req.query;

  if (error) {
    return res.status(400).json({ error: 'OAuth error: ' + error });
  }

  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  const clientId     = process.env.ROBLOX_CLIENT_ID;
  const clientSecret = process.env.ROBLOX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      error: 'ROBLOX_CLIENT_ID or ROBLOX_CLIENT_SECRET not configured in Vercel environment variables'
    });
  }

  try {
    // Step 1: Exchange code for access token
    const redirectUri = (process.env.VERCEL_URL
      ? 'https://' + process.env.VERCEL_URL
      : 'https://nexusai-com.vercel.app') + '/api/auth';

    const tokenResp = await fetch('https://apis.roblox.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code:          code,
        redirect_uri:  redirectUri,
        client_id:     clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!tokenResp.ok) {
      const errData = await tokenResp.json().catch(() => ({}));
      return res.status(400).json({ error: errData.error_description || 'Token exchange failed' });
    }

    const tokenData = await tokenResp.json();
    const accessToken = tokenData.access_token;

    // Step 2: Get user info
    const userInfoResp = await fetch('https://apis.roblox.com/oauth/v1/userinfo', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });

    if (!userInfoResp.ok) {
      return res.status(400).json({ error: 'Failed to get user info' });
    }

    const userInfo = await userInfoResp.json();
    // userInfo has: sub (userId), name (displayName), preferred_username, picture

    const userId   = userInfo.sub;
    const username = userInfo.preferred_username || userInfo.name;
    const avatar   = userInfo.picture || '';

    // Step 3: Get full avatar if not in userinfo
    let avatarUrl = avatar;
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

    return res.status(200).json({
      user: {
        id:          String(userId),
        username:    username,
        displayName: userInfo.name || username,
        avatar:      avatarUrl,
      }
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
