# Building a Hup Mini App

You are building a **mini app** for Hup (https://hup.social) — a small web app that runs inside a
sandboxed iframe embedded in a social post, and transacts through the viewer's existing Hup wallet
session. This document is self-contained: everything needed to build, test, and list a mini app is
here.

## What a mini app is

- A normal web page, hosted anywhere, served over **https** (http only for localhost testing).
- Hup renders it inside `<iframe sandbox="allow-scripts allow-same-origin allow-forms allow-popups">`
  at a fixed aspect ratio chosen at registration.
- It gets a wallet **only** through the Hup SDK — a `postMessage` bridge to the host page. The
  viewer is already connected to Hup; the app inherits that session. Never bundle your own
  connector (wagmi connectors, WalletConnect, RainbowKit): a self-connecting app opens a second
  session, shows the wrong domain in the wallet prompt, and is dead on mobile, where wallets do
  not inject into third-party iframes.

## Quickstart

```html
<!doctype html>
<html>
  <body>
    <button id="mint" disabled>Mint</button>
    <script src="https://hup.social/miniapp-sdk.js"></script>
    <script>
      async function main() {
        // Resolves with viewer context once the host answers; rejects standalone or after 5s
        const ctx = await hup.ready()
        const provider = await hup.getProvider() // EIP-1193

        const [account] = await provider.request({ method: 'eth_requestAccounts' })
        if (!account) return // viewer hasn't connected a wallet to Hup

        document.getElementById('mint').disabled = false
        document.getElementById('mint').onclick = async () => {
          const hash = await provider.request({
            method: 'eth_sendTransaction',
            params: [{ from: account, to: '0xYourContract', data: '0xYourCalldata', value: '0x0' }],
          })
          console.log('mined-pending tx', hash)
        }

        // Fired when the viewer connects, disconnects, or switches chain
        hup.on('session', (s) => console.log('session', s.address, s.chainId))
      }
      main().catch((err) => document.body.append('Not inside Hup: ' + err.message))
    </script>
  </body>
</html>
```

## SDK surface

Load `https://hup.social/miniapp-sdk.js`. It defines two globals over one transport:

### `hup.*` (native)

| Member | Behavior |
| --- | --- |
| `hup.ready()` | Sends the handshake; resolves with context `{ user: { address } \| null, chainId, host: 'hup' }`. Rejects immediately if standalone, or after 5s if the parent is not a Hup host. |
| `hup.getProvider()` | Resolves an EIP-1193 provider. All `request()` calls relay to the host. |
| `hup.context` | Last received context (null before `ready()` resolves). |
| `hup.on('session', fn)` | Viewer connected / disconnected / switched chain: `{ address, chainId }`. |
| `hup.on('context', fn)` / `removeListener` | Standard listener management. |

### `sdk.*` (Farcaster Mini App compatible)

`sdk.actions.ready()`, `sdk.context`, `sdk.wallet.getEthereumProvider()`, `sdk.actions.openUrl(url)`,
`sdk.actions.close()`. Same transport as `hup.*`; `context.user` carries an `address` (wallet-based
identity), not an `fid`. Apps written for Farcaster/Base App generally run unmodified.

### LUKSO up-provider (Grid Mini App compatible)

The host also speaks the `@lukso/up-provider` wire protocol, so mini apps built for the Grid on
universaleverything.io run unmodified — `createClientUPProvider()` connects to the viewer's Hup
session exactly as it would to the Grid host. Semantics inside Hup:

- `accounts` — the viewer's connected wallet (EOA or Universal Profile; whatever they connected
  to Hup). Empty until they connect; listen for `accountsChanged`.
- `contextAccounts` / `up_contextAccounts` — the wallet of the **post author** hosting the embed,
  Hup's equivalent of the Grid owner.
- `chainId` — **LUKSO (42)**, the Grid's home chain, with LUKSO RPC URLs supplied so client-side
  `eth_call` short-circuiting works. Transactions submitted over this protocol are LUKSO-bound.
  (The Hup SDK surface, by contrast, serves the chain the app was registered on.)
- The same wallet method policy applies as for the Hup SDK: signatures and transactions are
  user-confirmed in Hup's UI, `eth_sign` is refused, `from` spoofing is rejected.

Note that Hup does not guarantee the connected account is a Universal Profile contract — apps
that unconditionally fetch LSP3 profile data should degrade gracefully for EOA viewers.

## Wallet method policy (enforced by the host)

| Method | Result |
| --- | --- |
| `eth_accounts`, `eth_chainId`, `eth_requestAccounts` | Answered from the viewer's Hup session — no popup. |
| Read-only RPC (`eth_call`, `eth_getBalance`, `eth_blockNumber`, …) | Proxied to the chain, no prompt. |
| `eth_sendTransaction` | Host shows the viewer a confirmation with decoded target, value, and calldata, then their wallet signs. Each call is one confirmation — batch your writes. |
| `personal_sign`, `eth_signTypedData_v4` | Confirmation dialog showing the full payload. |
| `eth_sign`, `eth_signTransaction`, `wallet_addEthereumChain` | **Refused always**, error code 4200. Do not retry. |
| `wallet_switchEthereumChain` | Host-mediated; only chains Hup supports. |
| `from` spoofing | Any `from` not matching the connected account is rejected with 4100. |
| `hup_sessionCall` | **Popup-free session-key call** — see below. Allowlisted apps only. |

## Gasless session calls (`hup_sessionCall`)

Apps approved for it can submit transactions signed by the viewer's **burner session key**
(Settings → In App Wallet) with no per-call confirmation — the pattern behind fully-onchain
games that play at tap speed:

```js
const hash = await provider.request({
  method: 'hup_sessionCall',
  params: [{ to: '0xYourApprovedContract', data: '0xYourCalldata' }],
})
```

Host-enforced policy — none of this is negotiable from inside the frame:

- `to` must be on Hup's per-app allowlist (requested during app review); anything else fails.
- Value is always zero. Session calls spend gas, never funds.
- The first call shows the viewer a one-time consent for your app; declining returns 4001.
- Calls are rate limited per embed.
- Failures carry a coded prefix in the message: `NO_SESSION_KEY` / `VAULT_LOCKED` (viewer needs
  to set up or unlock their in-app wallet — point them at Settings), `NOT_ALLOWED` (target not
  allowlisted). Handle them; don't retry blindly.

The returned hash is submitted, not mined — poll `eth_getTransactionReceipt` (auto-approved)
yourself. Your contract should resolve the acting player via Hup Core's `userSessions(owner)`
mapping, the way `HupMiner.play(owner)` does, so activity credits the viewer's primary wallet.

## Rules that differ from a normal dapp

1. **No connector code.** The provider from the SDK is the only wallet path.
2. **Design to your registered aspect ratio** — `1:1`, `4:3`, `16:9`, `3:4`, or `9:16`. The
   container is fixed; overflow scrolls inside your frame. Ratios wider than 3:1 are rejected.
3. **Your server must allow framing.** Remove `X-Frame-Options` and any `frame-ancestors`
   restriction, or the embed renders an empty box.
4. **Chain comes from context.** Read `ctx.chainId`; request `wallet_switchEthereumChain` if you
   need another. Do not assume mainnet.
5. **Nothing runs until the viewer presses Launch.** Boot fast; don't rely on preloading.
6. **The viewer may not be connected.** `eth_requestAccounts` returns `[]` then — render a
   "connect in Hup" state, don't crash.

## Testing

- **Standalone** (your dev server, Live Server, etc.): the SDK loads but `ready()` rejects with
  "not embedded in a host frame". Correct behavior — UI should degrade gracefully.
- **Inside Hup**: register the app (below), have a moderator grant embedding, attach it to a post.
- Reference implementations (live, view-source friendly):
  https://hup.social/examples/miniapp-demo.html — a diagnostic page that exercises connect, sign,
  send, and verifies `eth_sign` is refused; https://hup.social/examples/grid-demo.html — the same
  idea built on the real `@lukso/up-provider` client, for testing Grid app compatibility.

## Listing your app

1. On https://hup.social/apps press **List your app**.
2. Fill name, description, **App URL** (this exact URL is loaded in the frame — its origin is
   pinned; messages from any other origin are dropped), category, embed shape, icon, tags.
3. Pay the listing fee (if configured) — one onchain transaction on the registry chain
   (currently Monad Testnet). The listing appears in the directory as soon as the indexer syncs.
4. **Embedding is a separate, human step**: a Hup moderator reviews the app and grants
   `embeddable`. Until then the app is listed but cannot run inside posts.
5. **Every edit pauses embedding** until re-review — the onchain registry clears the grant when
   the metadata changes, so an approved URL cannot be silently swapped. Plan updates accordingly.
6. Owners can edit from their card on /apps (Edit appears when the registering wallet is
   connected).

## Common failures

| Symptom | Cause |
| --- | --- |
| `SDK: no host` / `ready()` rejects | Opened standalone, or the parent page is not Hup. |
| SDK script 404 | Load it from the host: `https://hup.social/miniapp-sdk.js`, not a relative path. |
| Empty embed box | Your server sends `X-Frame-Options` / `frame-ancestors` denying the frame. |
| Messages ignored, handshake times out | Frame URL origin doesn't match the registered App URL origin. |
| "App is not available for embedding" | Not yet granted `embeddable`, or paused by an edit — ask for (re-)review. |
| Error 4200 | You called a refused method (`eth_sign` etc.) — use `personal_sign` / typed data. |
| Error 4100 | `from` doesn't match the viewer's connected account. |
