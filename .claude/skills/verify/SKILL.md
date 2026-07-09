---
name: verify
description: Build/launch/drive recipe for verifying UI changes in the Hup Social Next.js app at its browser surface.
---

# Verifying Hup Social changes

## Server

`next dev` usually already runs as a detached node process on **https://localhost:3000** (self-signed cert — always use `ignoreHTTPSErrors` / `curl -k`; plain HTTP gets connection-closed). Check with:

```
netstat -ano | grep ':3000.*LISTENING'
```

and confirm the PID's command line points at `C:\xampp\htdocs\hupsocial\node_modules`. HMR is on, so file edits are live without restart. If nothing listens, `pnpm dev`.

Port 3001 is a different project (`c:\xampp\htdocs\tunnel`) — don't touch it.

## Browser driving

Playwright is NOT a project dependency. Install `playwright-core` in the scratchpad and launch the already-downloaded browser:

```js
const { chromium } = require('playwright-core')
const browser = await chromium.launch({
  executablePath: 'C:/Users/atenyun/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  headless: true,
})
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } })
```

Give the page ~4–5s after `domcontentloaded`; the feed hydrates slowly.

## Useful entry points (no wallet needed)

- New-post composer, desktop: sidebar `button[aria-label="New post"]`.
- New-post composer, mobile (≤640px): bottom tab bar `button[aria-label="New"]` (the desktop floating `Create new post` button is `display: none` below md; the AddTabMenu `Add tab` trigger is also hidden on mobile).
- Composer landmarks: `dialog[aria-label="New thread composer"]` / `"Reply composer"` / `"Quote composer"` (the composer root is a native `<dialog>` via `NativeDialog`).

## Wallet-gated paths

Comment/quote/tip/post-submit require a connected wallet (`isConnected` checks toast "Please connect wallet" otherwise). Headless runs can't exercise them — verify around them and say so in the report.

## Gotchas

- Menus/popovers use the native Popover API (`NativePopover`), true modals use `<dialog>.showModal()` (`NativeDialog`), both in `src/components/ui/` with a 0.18s scale/opacity transition — wait ~400ms before measuring bounding boxes or screenshotting, or you'll capture the 0.96-scale frame.
- The app has a global `* { margin: 0 }` reset — any new native `<dialog>` must restate `margin: auto` or it renders top-left (NativeDialog already does).
- In a modal dialog, one Tab press per focus cycle lands on BODY while wrapping through browser chrome — that's spec behavior, not a focus-trap failure.
- Toasts also render via popover in the top layer.
