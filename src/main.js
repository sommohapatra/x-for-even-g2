import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISPLAY_W = 576
const DISPLAY_H = 288
const PADDING = 16
const MAX_CHARS_PER_PAGE = 420   // safe within 2000-char container limit

// Numeric container IDs required by SDK
const CID_HEADER = 1
const CID_BODY = 2
const CID_FOOTER = 3

// Layout (derived from padding)
const INNER_W = DISPLAY_W - PADDING * 2   // 560
const HEADER_H = 32
const FOOTER_H = 16
const BODY_H = DISPLAY_H - PADDING * 2 - HEADER_H - FOOTER_H  // 224
const HEADER_Y = PADDING
const BODY_Y = PADDING + HEADER_H
const FOOTER_Y = DISPLAY_H - PADDING - FOOTER_H

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let bridge = null
let pages = []       // { handle, text, tweetNum, totalTweets, pageNum, totalPagesInTweet }
let currentPage = 0
let started = false  // tracks whether createStartUpPageContainer has been called
let pendingBoundary = null  // 'next' | 'prev' | null - tracks "scroll again to advance" state

// ---------------------------------------------------------------------------
// Text pagination
// ---------------------------------------------------------------------------

function paginateTweet(text) {
  const result = []
  let remaining = text.trim()
  while (remaining.length > MAX_CHARS_PER_PAGE) {
    let cut = remaining.lastIndexOf(' ', MAX_CHARS_PER_PAGE)
    if (cut <= 0) cut = MAX_CHARS_PER_PAGE  // no space found, hard cut
    result.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }
  if (remaining) result.push(remaining)
  return result
}

function buildPages(rawTweets) {
  pages = []
  for (let i = 0; i < rawTweets.length; i++) {
    const t = rawTweets[i]
    const chunks = paginateTweet(t.text)
    chunks.forEach((chunk, j) => {
      pages.push({
        handle: `@${t.author}`,
        text: chunk,
        tweetNum: i + 1,
        totalTweets: rawTweets.length,
        pageNum: j + 1,
        totalPagesInTweet: chunks.length,
      })
    })
  }
}

// ---------------------------------------------------------------------------
// Container builders (plain objects - SDK accepts these directly)
// ---------------------------------------------------------------------------

function makeTextContainers(headerText, bodyText, footerText) {
  return [
    {
      containerID: CID_HEADER,
      containerName: 'header',
      xPosition: PADDING,
      yPosition: HEADER_Y,
      width: INNER_W,
      height: HEADER_H,
      content: headerText,
      isEventCapture: 0,
    },
    {
      containerID: CID_BODY,
      containerName: 'body',
      xPosition: PADDING,
      yPosition: BODY_Y,
      width: INNER_W,
      height: BODY_H,
      content: bodyText,
      isEventCapture: 1,
    },
    {
      containerID: CID_FOOTER,
      containerName: 'footer',
      xPosition: PADDING,
      yPosition: FOOTER_Y,
      width: INNER_W,
      height: FOOTER_H,
      content: footerText,
      isEventCapture: 0,
    },
  ]
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function renderContainers(headerText, bodyText, footerText) {
  const textObject = makeTextContainers(headerText, bodyText, footerText)
  const payload = { containerTotalNum: 3, textObject }

  if (!started) {
    await bridge.createStartUpPageContainer(payload)
    started = true
  } else {
    await bridge.rebuildPageContainer(payload)
  }
}

async function renderPage(p, footerOverride) {
  const counter =
    p.totalPagesInTweet > 1
      ? `${p.tweetNum}/${p.totalTweets} p${p.pageNum}/${p.totalPagesInTweet}`
      : `${p.tweetNum}/${p.totalTweets}`

  const footer = footerOverride ?? '^ scroll  |  v scroll  |  tap: next'

  await renderContainers(
    `${p.handle}   ${counter}`,
    p.text,
    footer,
  )

  updateDom(`${p.handle}`, counter, p.text)
}

async function renderMessage(msg) {
  await renderContainers('', msg, '')
  updateDom('', '', msg)
}

// ---------------------------------------------------------------------------
// Browser DOM preview (dev mode only - ignored by G2 display)
// ---------------------------------------------------------------------------

function updateDom(handle, counter, body) {
  const elHandle = document.getElementById('handle')
  const elCounter = document.getElementById('counter')
  const elBody = document.getElementById('body')
  if (elHandle) elHandle.textContent = handle
  if (elCounter) elCounter.textContent = counter
  if (elBody) elBody.textContent = body
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchTweets() {
  await renderMessage('Loading...')

  try {
    const res = await fetch('https://x-for-even-g2.vercel.app/api/twitter-feed?count=20')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const { tweets } = await res.json()

    if (!tweets || tweets.length === 0) {
      await renderMessage('No tweets found.')
      return
    }

    buildPages(tweets)
    currentPage = 0
    await renderPage(pages[currentPage])
  } catch (err) {
    await renderMessage(`Error: ${err.message}`)
  }
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

function firstPageOfNextTweet() {
  const currentTweetNum = pages[currentPage].tweetNum
  for (let i = currentPage + 1; i < pages.length; i++) {
    if (pages[i].tweetNum !== currentTweetNum) return i
  }
  return -1
}

function firstPageOfPrevTweet() {
  const currentTweetNum = pages[currentPage].tweetNum
  // Scan back to find any page of the previous tweet
  for (let i = currentPage - 1; i >= 0; i--) {
    if (pages[i].tweetNum !== currentTweetNum && pages[i].pageNum === 1) return i
  }
  return -1
}

function isLastPageOfTweet() {
  const p = pages[currentPage]
  return p.pageNum === p.totalPagesInTweet
}

function isFirstPageOfTweet() {
  return pages[currentPage].pageNum === 1
}

// ---------------------------------------------------------------------------
// Input event handling
// ---------------------------------------------------------------------------

async function handleEvent(data) {
  // Scroll up: data.textEvent.eventType === 1
  // Scroll down: data.textEvent.eventType === 2
  // Single tap: data.sysEvent present, no eventType
  // Double tap: data.sysEvent.eventType === 3

  if (data.textEvent) {
    const type = data.textEvent.eventType

    if (type === 2) {
      // Scroll down
      if (pages.length === 0) return

      if (!isLastPageOfTweet()) {
        pendingBoundary = null
        currentPage++
        await renderPage(pages[currentPage])
        return
      }

      const nextIdx = firstPageOfNextTweet()
      if (nextIdx === -1) {
        await renderMessage('End of feed. Tap to refresh.')
        pendingBoundary = null
        return
      }

      if (pendingBoundary === 'next') {
        pendingBoundary = null
        currentPage = nextIdx
        await renderPage(pages[currentPage])
      } else {
        pendingBoundary = 'next'
        await renderPage(pages[currentPage], 'scroll again for next tweet')
      }
    }

    if (type === 1) {
      // Scroll up
      if (pages.length === 0) return

      if (!isFirstPageOfTweet()) {
        pendingBoundary = null
        currentPage--
        await renderPage(pages[currentPage])
        return
      }

      const prevIdx = firstPageOfPrevTweet()
      if (prevIdx === -1) {
        await renderMessage('Beginning of feed.')
        pendingBoundary = null
        return
      }

      if (pendingBoundary === 'prev') {
        pendingBoundary = null
        currentPage = prevIdx
        await renderPage(pages[currentPage])
      } else {
        pendingBoundary = 'prev'
        await renderPage(pages[currentPage], 'scroll again for prev tweet')
      }
    }
  }

  if (data.sysEvent) {
    const type = data.sysEvent.eventType

    if (!type) {
      // Single tap - jump to next tweet
      pendingBoundary = null
      if (pages.length === 0) return
      const nextIdx = firstPageOfNextTweet()
      if (nextIdx !== -1) {
        currentPage = nextIdx
        await renderPage(pages[currentPage])
      } else {
        await renderMessage('End of feed.')
      }
    }

    if (type === 3) {
      // Double tap - refresh feed
      await fetchTweets()
    }
  }
}

// ---------------------------------------------------------------------------
// Dev mode stub (waitForEvenAppBridge hangs outside Even Hub WebView)
// ---------------------------------------------------------------------------

function makeBrowserStub() {
  console.info('[G2 dev] Even Hub bridge not detected - using browser stub')
  console.info('[G2 dev] Trigger events via: window._g2Event({ textEvent: "SCROLL_BOTTOM_EVENT" })')
  return {
    createStartUpPageContainer: async (p) => { console.log('[bridge] createStartUpPageContainer', p); return 0 },
    rebuildPageContainer: async (p) => { console.log('[bridge] rebuildPageContainer', p); return true },
    textContainerUpgrade: async (p) => { console.log('[bridge] textContainerUpgrade', p); return true },
    onEvenHubEvent: (cb) => { window._g2Event = cb },
  }
}

async function getBridge() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(makeBrowserStub()), 2000)

    waitForEvenAppBridge()
      .then((b) => { clearTimeout(timeout); resolve(b) })
      .catch(() => { clearTimeout(timeout); resolve(makeBrowserStub()) })
  })
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  bridge = await getBridge()
  bridge.onEvenHubEvent(handleEvent)

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') handleEvent({ textEvent: { eventType: 2 } })
    if (e.key === 'ArrowUp')   handleEvent({ textEvent: { eventType: 1 } })
    if (e.key === 'Enter')     handleEvent({ sysEvent: { eventSource: 1 } })
    if (e.key === 'r')         handleEvent({ sysEvent: { eventType: 3, eventSource: 1 } })
  })

  await fetchTweets()
}

main().catch(console.error)
