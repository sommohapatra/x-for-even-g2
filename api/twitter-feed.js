import crypto from 'crypto'

// OAuth 1.0a signing using Node's built-in crypto - no extra deps needed

function percentEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
}

function buildOAuthHeader(method, url, queryParams, oauthKeys) {
  const {
    apiKey,
    apiSecret,
    accessToken,
    accessSecret,
  } = oauthKeys

  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0',
  }

  // Combine oauth params + query params for signature base
  const allParams = { ...queryParams, ...oauthParams }
  const sortedParams = Object.keys(allParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join('&')

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(sortedParams),
  ].join('&')

  const signingKey = `${percentEncode(apiSecret)}&${percentEncode(accessSecret)}`
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64')

  oauthParams.oauth_signature = signature

  const headerValue =
    'OAuth ' +
    Object.keys(oauthParams)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
      .join(', ')

  return headerValue
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'x-twitter-api-key, x-twitter-api-secret, x-twitter-access-token, x-twitter-access-secret, x-twitter-user-id')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Accept creds from request headers (multi-user) or fall back to env vars (owner)
  const apiKey      = req.headers['x-twitter-api-key']      || process.env.TWITTER_API_KEY
  const apiSecret   = req.headers['x-twitter-api-secret']   || process.env.TWITTER_API_SECRET
  const accessToken = req.headers['x-twitter-access-token'] || process.env.TWITTER_ACCESS_TOKEN
  const accessSecret = req.headers['x-twitter-access-secret'] || process.env.TWITTER_ACCESS_SECRET
  const userId      = req.headers['x-twitter-user-id']      || process.env.TWITTER_USER_ID

  if (!apiKey || !apiSecret || !accessToken || !accessSecret || !userId) {
    return res.status(401).json({ error: 'Missing Twitter credentials. Set up the app first.' })
  }

  const count = Math.min(parseInt(req.query?.count ?? '20', 10), 100)

  const baseUrl = `https://api.twitter.com/2/users/${userId}/timelines/reverse_chronological`
  const queryParams = {
    max_results: count,
    'tweet.fields': 'created_at,author_id',
    expansions: 'author_id',
    'user.fields': 'username',
    exclude: 'retweets',
  }

  const queryString = Object.entries(queryParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const fullUrl = `${baseUrl}?${queryString}`

  const authHeader = buildOAuthHeader('GET', baseUrl, queryParams, {
    apiKey,
    apiSecret,
    accessToken,
    accessSecret,
  })

  try {
    const response = await fetch(fullUrl, {
      headers: {
        Authorization: authHeader,
        'User-Agent': 'x-for-even-g2/1.0',
      },
    })

    if (!response.ok) {
      const body = await response.text()
      console.error('X API error:', response.status, body)
      return res.status(502).json({ error: `X API returned ${response.status}` })
    }

    const data = await response.json()

    // Build a username lookup map from the expansions
    const userMap = {}
    if (data.includes?.users) {
      for (const user of data.includes.users) {
        userMap[user.id] = user.username
      }
    }

    const tweets = (data.data ?? []).map((t) => ({
      id: t.id,
      text: t.text,
      author: userMap[t.author_id] ?? 'unknown',
      created_at: t.created_at,
    }))

    // Only cache when using server-side env var creds (single owner)
    // Skip caching for user-supplied creds to avoid serving one person's feed to another
    if (!req.headers['x-twitter-api-key']) {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
    }
    return res.status(200).json({ tweets })
  } catch (err) {
    console.error('Fetch error:', err)
    return res.status(500).json({ error: 'Failed to fetch tweets' })
  }
}
