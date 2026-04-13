# X for Even Realities G2

Scroll your X (Twitter) home timeline on your Even Realities G2 smart glasses.

Navigate with the temple touchpad or R1 ring:
- Scroll down/up - move through tweet pages
- Scroll again at the boundary - jump to next/previous tweet
- Single tap - jump to next tweet
- Double tap - refresh the feed

![screenshot](public/x_screenshot_576x288.png)

## Running in beta

This app isn't published to Even Hub yet, so you'll need to sideload it yourself.

### 1. Clone the repo

```bash
git clone https://github.com/sommohapatra/x-for-even-g2.git
cd x-for-even-g2
npm install
```

### 2. Set up Twitter API credentials

Go to [developer.twitter.com](https://developer.twitter.com) and create a project + app. You need **Read** permissions enabled.

From your app's "Keys and Tokens" page, grab:
- Consumer Key
- Consumer Secret
- Access Token
- Access Token Secret

Look up your numeric user ID (one-time):
```bash
curl -H "Authorization: Bearer YOUR_BEARER_TOKEN" \
  "https://api.twitter.com/2/users/by/username/YOUR_HANDLE"
```

Create a `.env` file in the project root:
```
TWITTER_API_KEY=your_consumer_key
TWITTER_API_SECRET=your_consumer_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_SECRET=your_access_secret
TWITTER_USER_ID=your_numeric_user_id
```

### 3. Deploy the backend to Vercel

The API function runs server-side to keep your credentials out of the app bundle.

```bash
npx vercel --prod
```

When prompted, add each env var:
```bash
npx vercel env add TWITTER_API_KEY
npx vercel env add TWITTER_API_SECRET
npx vercel env add TWITTER_ACCESS_TOKEN
npx vercel env add TWITTER_ACCESS_SECRET
npx vercel env add TWITTER_USER_ID
```

Then redeploy so the vars take effect:
```bash
npx vercel --prod
```

Update the API URL in `src/main.js` to point to your deployment:
```js
const res = await fetch('https://YOUR_PROJECT.vercel.app/api/twitter-feed?count=20')
```

### 4. Build and sideload onto your glasses

```bash
npm run build
npx @evenrealities/evenhub-cli pack dist/app.json dist
```

Drag the generated `out.ehpk` file into [hub.evenrealities.com](https://hub.evenrealities.com) to install it on your glasses.

### Local dev

```bash
npx vercel dev   # runs frontend + API on localhost:3000
```

Arrow keys scroll tweets, Enter jumps to next tweet, R refreshes.
