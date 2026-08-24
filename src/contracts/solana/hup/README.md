# Hup on Solana

The log-first Hup core for Solana. One `Config` PDA (admin, treasury, fee, metadata cap, post
id counter); every post, comment, repost, like and unlike is an event that cidex indexes into the
same `posts` / `post_likes` tables the EVM deployments use.

## Deployments

| Cluster | Program id | Config PDA | Admin / treasury | Since |
|---|---|---|---|---|
| devnet (503) | `9kNAEGDmFZ5iCrmPJRpcEjtFAfPUEhydLAm3YYEcDo5L` | `8LzRiPn5a37k6ruFcfKF7EPt8fLdHy4NxnotuPxWdsse` | `Hnc7f7aMcdkywotbgHZSH5ixGamkWt8CnWUvBkDtmaRY` (Playground wallet) | 2026-08-24 |

Deploy tx `v2YdzYQxcjPpN64DHXX2Uzhw1W9oNZRdUSKc8mNCXu2DY1t2VZXrmpbAkwtvfCVzNRfQyNtDK7Pqv86AS8W3BV1`
(slot 487430072). Registered in cidex as `contracts.id = 125`; smoke-tested end to end the same day
(posts 1–3 under `network_id = 503`).

- Program source: `programs/hup/src/lib.rs`
- IDL (checked in, regenerated on each build): `src/abis/HupSolana.idl.json`
- App-side network constants: `src/config/solana.js`
- Indexer: `cidex/lib/solanaHup.js` + `runSolanaHupSync` in `cidex/index.js`
- Smoke test: `cidex/tests/solana-smoke.js`

## Building and deploying (Solana Playground)

There is no local Rust/Anchor toolchain on the dev box, so builds run in the browser, the same
way Remix is used for the Solidity side.

1. Open <https://beta.solpg.io>, create a new **Anchor (Rust)** project named `hup`.
2. Replace its `src/lib.rs` with `programs/hup/src/lib.rs` from this folder.
3. **Build.** Playground rewrites `declare_id!` to the project's program keypair — copy that id
   back into `lib.rs`, `Anchor.toml` and `src/abis/HupSolana.idl.json` (`address`).
4. Connect the Playground wallet, switch to **devnet**, airdrop a few SOL (a deploy needs ~2 SOL).
5. **Deploy.** Note the deployment transaction signature and slot from the explorer link.
6. Export the IDL (Extra → IDL → Export) over `src/abis/HupSolana.idl.json`.
7. Export the Playground wallet keypair (wallet menu → Export) to a file **outside** the repo,
   e.g. `C:\xampp\solana-devnet-wallet.json`; the smoke test uses it as admin, payer and author.

## Registering with cidex

1. Fill the placeholders in `cidex/scripts/add-solana-devnet.sql` (program id, deploy signature
   and slot) and apply it to the `hup` database.
2. Restart cidex — it widens the identifier columns on startup and starts `runSolanaHupSync`
   for the `HupSolana` row.
3. `SOLANA_KEYPAIR=C:\xampp\solana-devnet-wallet.json node tests/solana-smoke.js <programId>`
   from `cidex/` initializes the config (first run), then posts, likes, unlikes, comments,
   reposts, edits and deletes once each. Rows appear under `network_id = 503`.

## App side (Phase B, 2026-08-24)

- Wallet: any Wallet Standard wallet (Phantom, Solflare, Backpack …) via `src/lib/solana/wallet.js`
  + `src/stores/useSolanaWalletStore.js`. There is **one Connect flow**: Solana wallets are rows in
  the same panel as the EVM connectors (`ConnectWallet.jsx`), and the network follows the wallet
  that just connected (a Solana wallet moves the app onto Solana Devnet; an EVM wallet picked while
  Solana was active moves it onto the wallet's chain).
- Identity: `hooks/useActiveWallet.js` — the Solana wallet on a Solana cluster, the EVM wallet
  everywhere else. The header chip, sidebar profile, notifications badge, bookmarks, feed viewer
  and post-owner checks all read it, so the profile you see is the one you sign as. Both wallets
  may stay connected underneath (Phantom exposes an EVM and a Solana account at once).
- Network picker / active chain: `config/solana.js` entries are chain-shaped and listed after the
  wagmi chains; a Solana pick is stored in the same `active-chain` key and outranks the EVM
  wallet's chain in `useActiveChain`.
- Write paths: `src/lib/solana/hup.js` (instruction encoding, send, confirm) and
  `src/lib/solana/relay.js` (`sendHupAction`: sponsored through `/api/v1/relay/solana` when the
  relayer serves the cluster, otherwise wallet-paid). Used by NewPost (post/comment/quote/edit),
  Like + the batch basket, Repost/undo, and delete.
- Relay: set `SOLANA_RELAYER_SECRET` (JSON array or base58 secret key) in `.env.local`; the route
  sponsors `create` (post, comment, repost), `like` and `unlike` only, insists the author is the
  program-fee payer, and throttles with the same `GASLESS_POLICY` buckets as the EVM relay.
- Wallet-paid sends (edits, deletes, relay fallback) ask the wallet to *sign only* and broadcast
  from the app: Phantom refuses to broadcast to devnet unless its "Testnet Mode" is on, while a
  plain signature works everywhere.
- Addresses: `src/lib/address.js` — hex lowercased, base58 verbatim. Use `normalizeAddress`,
  `sameAddress`, `shortAddress` instead of `.toLowerCase()` / `.slice()` on identities.

## Conventions

- Network ids: 501 = mainnet-beta, 503 = devnet (see `src/config/solana.js`).
- Post ids are sequential from 1; `parent_id = 0` means top-level. Kinds: 0 post, 1 comment,
  2 repost — the same `ContentType` values as `IHup.sol`.
- Ownership of `update`/`delete` and like de-duplication are enforced by the indexer, not the
  program; the program only guarantees the id exists and the caller signed.
- Addresses are base58 and case-sensitive: never lowercase them.
