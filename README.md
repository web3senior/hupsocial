# Hup


# Hup Unified Protocol Architecture

By treating all social interactions as a single `Content` primitive, Hup operates through a single, highly efficient smart contract.

### The Unified Primitive
Every interaction on Hup is a "Content" object:
- **Type 0 (Post):** The root of a conversation.
- **Type 1 (Comment):** Content linked to a parent.
- **Type 2 (Repost):** A reference to existing content.

### Technical Advantages
1. **Reduced Overhead:** No cross-contract state synchronization.
2. **Indexer Optimization:** One contract to track; events are unified by Content ID.
3. **Recursive Threading:** Because comments are posts, a comment can have its own comments indefinitely using the same `postChildren` logic.

### Scalability with 0G
By moving the actual text and media to **0G Storage** and only keeping the `Content` struct on-chain, this single contract can handle millions of interactions across any EVM chain without hitting state bloat limits.


### One potential risk: The 24KB Limit
The only reason to keep them split would be if your code exceeds the **24KB limit**. However, since you are now using **one** struct and **one** set of logic to handle all three types, your code will actually be *shorter* than when you had two separate systems. You should have plenty of room.

**Verdict:** Merge them. It makes the Hup protocol much more "elegant" and easier to deploy across multiple chains. One contract, one protocol, any EVM.

Shall we draft the final unified contract structure?


# Contract

## Extensions
I can create another contract later for storage if i need right? it will act like attach data to posts but by the creator not owner of the contract

Yes, absolutely. You can 100% decouple additional data layers and build them as standalone contracts later. This is actually a highly recommended Web3 architectural pattern called Pluggable Storage or an Extension Registry.

## Interfaces
How it works architecturally
Your new contract will simply use an interface to talk to your deployed Hup contract. When someone tries to attach data to Post #42, the extension contract performs an external call to Hup.allContent(42) to verify who the actual creator is. If the msg.sender matches the creator address returned by Hup, it allows the write operation.

# Metadata

- IPFS://
- 0G://
- or plain text

if (metadata.startsWith('0G://')) trigger the 0G Storage proxy downloader.

if (metadata.startsWith('IPFS://')) route through your public IPFS gateway provider.

else render as a plain text string instantly.

## Contract Versioning & Public Post IDs

Hup contract post IDs are local to each deployed contract. If a new Hup contract is deployed on the same network, its internal `contentCount` starts again from `1`.

To keep public post URLs stable and clean, the app uses an off-chain public post ID system.

Example public URL:

```txt
/networks/4201/45
```

The `45` in the URL is treated as a public/global post ID by the backend, not necessarily the raw contract `contentCount` ID.

### Why This Is Off-Chain

The contract intentionally does not support a custom starting content ID. Keeping ID versioning off-chain avoids extra storage reads/checks and keeps gas costs lower for common actions like:

- creating posts
- commenting
- reposting
- liking
- unliking

It also prevents the new contract from exposing “phantom” IDs for posts that only exist in an older contract.

### Deployment Ranges

The backend/indexer stores each Hup deployment as a range:

```js
const hupDeployments = [
  {
    networkId: 4201,
    address: '0xOldHupContract',
    startPublicId: 1,
    endPublicId: 45,
    offset: 0,
  },
  {
    networkId: 4201,
    address: '0xNewHupContract',
    startPublicId: 46,
    endPublicId: null,
    offset: 45,
  },
]
```

### Resolving a Public Post ID

When a request comes in for:

```txt
/networks/4201/48
```

the backend finds the deployment range that contains public post ID `48`.

Then it converts the public ID into the contract-local ID:

```js
contractPostId = publicPostId - deployment.offset
```

Example:

```js
publicPostId = 48
deployment.offset = 45

contractPostId = 3
```

So the backend reads:

```txt
0xNewHupContract.getContent(3)
```

### Resolver Example

```js
function resolvePostDeployment(deployments, networkId, publicPostId) {
  return deployments.find((deployment) => {
    if (deployment.networkId !== networkId) return false

    const startsInRange = publicPostId >= deployment.startPublicId
    const endsInRange =
      deployment.endPublicId === null || publicPostId <= deployment.endPublicId

    return startsInRange && endsInRange
  })
}

function resolveContractPost(deployments, networkId, publicPostId) {
  const deployment = resolvePostDeployment(deployments, networkId, publicPostId)

  if (!deployment) {
    return null
  }

  return {
    contractAddress: deployment.address,
    contractPostId: publicPostId - deployment.offset,
  }
}
```

### Notes

- Public post IDs are owned by the backend/indexer.
- Contract post IDs remain local to each Hup deployment.
- The backend should store the final `endPublicId` when replacing a contract.
- The latest active deployment can use `endPublicId: null`.
- URLs remain stable even if the core contract is redeployed.


## Off-Chain Features

Hup keeps the core social protocol on-chain while leaving some user-experience and indexing features off-chain. This keeps gas costs lower, avoids unnecessary public storage, and gives the app more flexibility.

### Stored On-Chain

The core contract stores protocol-level actions that should be publicly verifiable:

- posts
- comments
- reposts
- likes
- content ownership
- content timestamps
- edit/delete state
- session authorization
- protocol fees and admin configuration

These actions are emitted as events and indexed by the backend.

### Stored Off-Chain

The following features are intentionally handled by the backend/indexer instead of the core contract:

- bookmarks/saved posts
- post views
- public/global post IDs
- contract version routing
- feed ranking
- search
- notifications
- hydrated metadata from IPFS
- full liker lists
- full follower/following lists, when using an external follower system
- community feed grouping, when `communityId` is stored in metadata

### Why Bookmarks Are Off-Chain

Bookmarks are treated as a private user preference, not protocol state.

Keeping bookmarks off-chain avoids:

- gas costs for saving/unsaving
- public exposure of a user’s saved posts
- extra contract storage
- unnecessary contract complexity

Example table:

```txt
bookmarks
- id
- user_address
- network_id
- public_post_id
- created_at
```

### Why Views Are Off-Chain

Post views are high-frequency and easy to manipulate, so storing them on-chain would be expensive and not very meaningful as trustless protocol state.

Views are counted by the backend/API and can be rate-limited, filtered, or deduplicated off-chain.

Example table:

```txt
post_views
- id
- user_address nullable
- ip_hash nullable
- network_id
- public_post_id
- created_at
```

### Why Public Post IDs Are Off-Chain

Each Hup contract deployment has its own local `contentCount`. If a contract is upgraded or redeployed, IDs may restart from `1`.

To keep URLs stable, the backend owns public/global post IDs and maps them to the correct contract deployment.

Example:

```txt
/networks/4201/45
```

The `45` is a public post ID. The backend resolves it to:

```txt
network_id + contract_address + contract_post_id
```

### Why Lists Are Indexed Off-Chain

The contract stores mappings for cheap checks like:

```txt
has this user liked this post?
```

But mappings are not enumerable, so full lists are built from events by the indexer.

Examples:

- all users who liked a post
- all reposts of a post
- user activity history
- feed timelines
- follower/following lists

### Design Rule

If a feature must be publicly verifiable and affects protocol state, it belongs on-chain.

If a feature is private, high-frequency, expensive to store, or mainly needed for UI/querying, it belongs off-chain.


# Insider wallet
If the burner is later exfiltrated from the browser, the attacker has an indefinite write window over that wallet's posts/likes/reposts (though not over funds — sessions cannot move ETH).

# Fabian's BOT report

https://gist.github.com/emmet-bot/77f06e48e7c2aaf92aac20c73d61f299
https://gist.github.com/emmet-bot/a40ac3fc6a5f0f5b44c73ac6720581f2


# Full Post Content Structure
```js
const postContent = {
  version: '1',
  elements: [
    {
      type: 'text',
      data: {
        text: 'Post text here',
      },
    },
    {
      type: 'media',
      data: {
        items: [
          {
            type: 'image',
            cid: 'Qm1234...image-cid',
            alt: 'Image description',
            storage: '0G',
            mimeType: 'image/jpeg',
            spoiler: false,
          },
          {
            type: 'video',
            cid: 'Qm5678...video-cid',
            alt: 'Video description',
            storage: '0G',
            mimeType: 'video/mp4',
            duration: 45,
            spoiler: false,
          },
        ],
      },
    },
  ],
}
```
# Community Encryption (Private / Request-Based)

Gated community posts are end-to-end encrypted. Neither the server, the indexer, nor the chain can read them — only current members.

## The model in one line

Posts are locked with **one shared master key per community**; that master key travels between members as **chat-style sealed envelopes stored on-chain** instead of sent.

- **Master key** — a random AES-256 key. Every post in the community is encrypted once, with this key. It belongs to the community, not to any person.
- **Identity keypair** — each member derives an encryption keypair from ONE wallet signature + their Hup security PIN (`src/lib/securityVault.js` → `src/lib/communityVault.js`). Same wallet + same PIN reproduces it on any device. This exists only so the master key can be *delivered* to them — wallets can sign but not decrypt.
- **Wrapped key (envelope)** — the master key ECIES-encrypted to one member's public key, stored publicly in `HupCommunity.wrappedKeys[communityId][member][version]`. Visible to everyone, openable only by that member. This is exactly Chat's encrypt-to-pubkey operation, reused — the "message" is the master key, the "inbox" is the contract.

## Flow (Request-Based community)

1. **Create** — creator unlocks the security vault (signature + PIN), the browser generates the master key, wraps it to the creator's own pubkey, and `createCommunity(...)` stores community + envelope + `keyVersion = 1` in a single tx.
2. **Request** — Bob calls `join()` (sets `isPending`, no event) and the app records the request off-chain so moderators can discover it. Bob's vault unlock registers his pubkey on-chain — required before he can receive a key.
3. **Approve** — a moderator clicks Approve: `approveRequest` tx, then automatically in the browser — unwrap own envelope → re-wrap the *same* master key to Bob's pubkey → `grantKey` tx. Join is O(1): one envelope. Bob can now also read the history back to the last rotation (those posts used this same key) — but nothing before it: `grantKey` only ever grants the current version, so pre-rotation epochs stay locked to newcomers permanently.
4. **Post** — unwrap own envelope → AES-encrypt content → upload `{encrypted: true, keyVersion, iv, ciphertext, communityId}` to IPFS → ordinary `Hup.create(cid)`.
5. **Read** — each post says which `keyVersion` encrypted it. Fetch your envelope for that version, unwrap, decrypt. No envelope (`0x`) → 🔒 locked placeholder.
6. **Leave / ban → rotation (lazy)** — a moderator calls `bumpKeyVersion`, generates a *fresh* master key, and immediately re-grants **only the moderators** (one `grantKeyBatch` tx). Security is achieved at that instant — new posts use a key the departed member will never receive. Every other member picks the key up on demand: their client files a `grant` key request when it notices the missing envelope, and a moderator batch-clears the queue (`grantKeyBatch`, up to 100 per tx) from the members panel. Rotation cost is O(moderators) up front, then proportional to *active* members over time — dead accounts never cost anything. Voluntary leave can't rotate by itself (`bumpKeyVersion` is moderator-only), so it files a `rotation` request that moderators see as a pending banner. Envelopes are append-only: the departed member keeps opening old-version posts they legitimately had, but never receives the new version.

## History visibility (per-community policy)

By default every rotation is an epoch wall: new members receive only the current key, so posts from before the last rotation stay locked for them. Communities whose value *is* the archive can flip this: a moderator toggles **"New members can read history"**, and from then on each rotation also publishes a `keyBacklink` — the retiring key encrypted under the new one. Holding the current key plus an unbroken chain of backlinks yields every *older* key, but never a newer one, so a departed member still can't read anything after their removal. The links are write-once and can be **backfilled retroactively** (moderators hold envelopes for all versions), and toggling the policy off only affects future rotations — links already published are on-chain forever, and any member could have cached old keys anyway.

## Why only some membership types are encrypted

Encryption needs a moderator-approval moment to hook the key handover onto (`addMember`/`approveRequest`) — only someone who *holds* the master key can hand it out, and that requires their unlocked browser. Request-Based, Private, NFT/Token/NFT+Token-Gated, and Follower-Gated have that moment. Public, Whitelisted, and Pay-to-Join self-admit via `join()` with no moderator in the loop, so they stay plaintext.

## Honest limits at scale

E2EE in a huge community is security theater regardless of scheme — any one of 500k members can leak everything, and "request-based" at that scale is functionally public. Encryption genuinely protects small/medium groups. Rotation cost reflects this too: removals are inherently O(n) across all group-encryption designs (every remaining member needs fresh secret material the leaver can't compute) — batching and lazy on-demand re-grants compress the cost, but very large communities belong in the plaintext gated types.

## Cryptography: where it stands

An honest grading of the encryption stack, so future maintainers know what's a deliberate choice versus a TODO:

- **AES-256-GCM** (post content) — industry gold standard (TLS, Signal). No upgrade exists worth taking.
- **ECIES over secp256k1** (key envelopes, via `eciesjs`) — sound; secp256k1 chosen over the academically nicer X25519 because it's the wallet ecosystem's native curve.
- **PBKDF2-SHA256, 100k iterations** (PIN → vault master) — the dated piece. The vault's real protection is the wallet signature used as salt; if a signature ever leaks, PBKDF2 is what stands between it and a brute-forced 6-char PIN, and against GPUs it's a speed bump. Planned upgrade: **Argon2id** (memory-hard). Contained change in `cryptoHelper.js`, but it re-keys vaults — same coordination cost as a PIN change.
- **Not post-quantum** — the frontier is hybrid PQC (X25519+ML-KEM; Signal and iMessage adopted it in 2023–24). Our ECIES envelopes are classical-only: a future quantum computer could open recorded envelopes. But so is every wallet signature on every chain — the entire underlying blockchain breaks before community posts do. Not worth solving ahead of the ecosystem.
- **Group protocol** — envelope-per-member with lazy rotation, not MLS (RFC 9420). MLS offers O(log n) rotations and forward secrecy but assumes a delivery service and continuous sessions; adapting it to on-chain, offline-member, wallet-identity communities would be a research project. For small/medium private groups this design is the honest, auditable choice (see "Honest limits at scale").

In practice the weakest link is none of the above: it's a member leaking plaintext, which no cipher fixes.

## Member-list privacy

Member rosters are hidden from non-moderators: `getMembers`/`memberCount` (and the whitelist getters) are moderator-gated on the contract, the cidex-backed members API only serves the moderator list, and the Members panel in the UI is moderator-only. This is **best-effort hiding, not cryptographic privacy** — view-function gating can be bypassed by spoofing `from` in `eth_call`, contract storage is publicly readable, and every member's `join()` transaction and `MemberStatusUpdated` event is on-chain forever. It raises the bar from "one click" to "deliberate chain analysis." Genuinely hidden membership (ZK commitments in a Merkle tree, Semaphore-style, with relayed joins) is planned as a separate contract; per-address checks (`registry`, `canPost`) stay public because content gating and indexing depend on them.

# Membership Consent (Two-Step Invites)

Membership is a public, indexed, permanent signal (`MemberStatusUpdated` events live in the chain log forever), so being listed on a roster must be the wallet owner's own choice — otherwise a moderator could conscript any address into any community, including ones whose association is reputationally damaging.

The contract makes consent structural, not procedural:

- **`inviteMember` grants nothing.** It only records an invite and emits `MemberInvited`. Membership happens exclusively when the invitee calls **`acceptInvite`** themselves (`declineInvite` and the moderator's `cancelInvite` clean up unaccepted invites). Bans and archived status are re-checked at accept time, since either may have changed while the invite sat open.
- **`approveRequest` requires an actual request.** It reverts with `NoPendingRequest` unless the wallet itself filed a join request (`join()` set `isPending`) — without this guard, approving arbitrary addresses would have been a consentless `addMember` by another name. The old `addMember` is removed entirely.
- **Encrypted communities deliver keys only after acceptance.** The invite carries no key material; once the invitee accepts, their client files a key request through the existing lazy grant queue and a moderator delivers the envelope. Granting at invite time would hand content access to someone who never agreed to join.

The remaining self-service paths are unchanged because consent is inherent to them: `join()` for Public/Whitelisted/Pay-to-Join, and request-then-approve for the gated types.

# DAO-Governed Communities

Community authority in `HupCommunity` is just addresses — `onlyCreator` and moderator flags. DAO mode exploits that: nothing requires the creator to be a human wallet.

## The two modes

- **Soft DAO** — the creator calls `setGovernor(id, executor)`, pointing the community at a governance contract (an OpenZeppelin Governor + Timelock, a Safe, or any executor). The governor passes every `onlyCreator` and `onlyModerator` gate *alongside* the creator. The creator keeps their powers, including the power to remove the governor — good for trying governance without burning the ships.
- **Hard DAO** — power derives purely from governance, not from being creator: transfer the creator role itself to the governance contract via the existing two-step `transferCommunityOwnership` → `acceptCommunityOwnership` flow (the executor calls `accept` by proposal, mirroring Ownable2Step so a typo'd address can't strand the community). After that, every creator-level action — membership rule changes, archiving, moderator appointments, replacing the governor — requires a passed proposal.

`setGovernor` is callable by the creator *or the current governor*, so a DAO can replace or renounce itself by proposal. Setting `address(0)` clears DAO mode. Every change emits `CommunityGovernorUpdated` for the indexer.

## The operating pattern: two lanes

Voting on every ban is unusable — onchain governance is slow by design. The intended shape:

- **Slow lane (the DAO):** elects and removes moderators, changes the membership rule, archives/reactivates, replaces itself.
- **Fast lane (elected moderators):** ban/unban, approve requests, grant keys — instant, individual transactions, exactly as today.

Power then comes from the electorate rather than from being creator, while day-to-day moderation stays usable.

## Honest limits

- **Encryption doesn't decentralize.** A contract can never hold identity-key material, so it can't unwrap or re-wrap community content keys. Encrypted communities under DAO rule still need *human* key stewards — the moderators the DAO appoints — for key grants and rotations, and stewardship changes should trigger a key rotation. This is inherent to E2EE, not a gap in the governance design.
- **Sybil resistance is the electorate's problem.** One-member-one-vote only means something where joining costs something (Pay-to-Join, NFT/Token gates, Follower gate). Public communities wanting DAO rule should use token-weighted voting with snapshots (flash-loan-proof) on the governor side.
- **The voting mechanics are deliberately out of scope.** `HupCommunity` stays agnostic — the governor slot accepts anything that can send a transaction. Which Governor implementation, votes token, quorum, and timelock delay a community uses is its own business, and each chain's deployment is its own governance instance (no cross-chain voting).

## Indexing

`CommunityGovernorUpdated`, `CommunityOwnershipTransferStarted`, and `CommunityOwnershipTransferred` are cidex's to index (the app reads `governors(id)` live from chain in the meantime — pre-governor deployments simply revert the read, which the UI treats as "no governor"). A `governor` column on the indexed `communities` table unlocks a directory-level "DAO" filter later.

## 🏷️ Version Management (SemVer)

This project strictly adheres to [Semantic Versioning (SemVer)](https://semver.org/) via the `MAJOR.MINOR.PATCH` format to ensure predictable deployments and reliable cross-chain indexing.


# Monetization: Subscription NFT (Future)

The protocol is currently open and free. If monetization is introduced, the preferred approach is a **subscription NFT** — not an on-chain license key check.

## How it would work

A separate `HupSubscription` ERC-721 (or ERC-1155) contract is deployed independently of the core protocol. Users mint a subscription token with an expiry timestamp encoded in the token metadata or a contract mapping.

The **relayer/meta-transaction forwarder** checks subscription validity before forwarding a transaction. The core `Tunnel` contract itself stays unchanged — no license gate added to `sendMessage` or any other function.

```
User → Relayer → [check: does this wallet hold a valid subscription token?] → Tunnel contract
```

If the user has no valid subscription, the relayer rejects the request off-chain. Gas cost: zero.

## Why this approach

- **Zero gas overhead** — the check happens at the relay layer, not in the EVM
- **Protocol stays trustless** — anyone can call the contract directly without the relayer; subscription is a product-layer concern, not a protocol constraint
- **Non-custodial** — subscription NFTs can be transferred, gifted, or sold on secondary markets
- **Upgradeable without redeployment** — subscription tiers, pricing, and logic live in a separate contract; the core protocol is never touched
- **Avoids the alternative** — adding an on-chain `licenseOf[address]` check to every `sendMessage` call would add gas to every transaction and break permissionlessness

## What stays free

Direct contract interaction bypasses the relayer entirely, so technically the protocol always remains open. Subscription would gate the **app experience** (meta-tx relay, IPFS pinning, push notifications, etc.), not the raw protocol.
# HupPredict Security Model

HupPredict escrows real stakes, so its trust posture is stricter than the other Hup extensions:

1. **Escrow is not withdrawable — by anyone.** The contract has no `withdrawAll`. The admin can only sweep `accruedFees`, a ledger that grows exclusively from the platform fee at resolution. Market creators earn a separate creator fee into `creatorFees`, a per-creator pull-based ledger only they can claim (`claimCreatorFees`). Bettors' pools never enter either ledger, and the combined fee rate (platform + creator) is hard-capped at 10% and snapshotted per market at creation.

2. **The exits are pause-immune.** `claim()`, `claimCreatorFees()`, `enableRefunds()`, and `renounceJudge()` carry no `whenNotPaused`. Whatever happens — paused contract, vanished judges, compromised admin — once the resolve window lapses, anyone can flip an unresolved market to Refunding and every bettor reclaims their full stake, fee-free. No sequence of admin actions can strand escrowed money.

3. **Market-control actions require direct signatures.** `resolve`, `confirmJudging`, `closeBetting`, `cancelMarket`, and `renounceJudge` read raw `msg.sender` — burner sessions and ERC2771 meta-transactions are deliberately not honored. A compromised session source or trusted forwarder therefore cannot fake a verdict, consent, closure, or cancellation. Only the convenience paths (`createMarket`, `placeBet`, `claim`) support sessions, and each can only move funds to or from the rightful owner.

4. **Judges must consent onchain.** Being named a judge attaches a name but no power; only calling `confirmJudging` — with the judge's own key — grants the ability to act. Judges can step down at any time, and the last judge leaving a funded market opens refunds immediately.

Residual trust assumptions: the `ADMIN_ROLE` holder can pause new activity, change fees for future markets, adjust the resolve window within 1–90 days, and moderate market visibility. Holding that role with a multisig or timelock is the recommended posture.

# Web Share Target (PWA)

Installed on Android, Hup appears in the OS share sheet: share a photo from the gallery or a link from any browser, pick Hup, and the composer opens with it already attached.

## Why the payload never touches the server

The manifest declares a `POST`/`multipart-form-data` share target pointing at `/api/share`, but that endpoint is the fallback, not the main path. `public/sw.js` intercepts the POST before it leaves the device:

```txt
share sheet → POST /api/share → [service worker] → parks payload in Cache Storage → 303 → /share → composer
```

Two reasons the worker owns this:

- **Files cannot survive a redirect.** A share target must answer the POST with a redirect to a page — form data does not carry across it, so the files have to be stashed somewhere the landing page can read. Cache Storage is that place.
- **A share is not a publish.** Uploading to IPFS on arrival would pin media for every share the author then abandons. Nothing leaves the device until the composer's normal upload path runs.

The worker writes one JSON envelope (`/__share-payload`) plus one entry per file (`/__share-file-N`) into a `hup-share-v1` cache, listed in `CURRENT_CACHES` so `activate` does not sweep it. `src/lib/shareTarget.js` drains and deletes that cache in a single move — a refresh of `/share` must not re-attach media the author already dismissed. The cache name and keys are declared in both files because `sw.js` is served raw and cannot import from `src/`; changing one means changing the other.

## The fallback path

`src/app/api/share/route.js` only ever runs when no worker controls the client — the first launch after install, or service workers disabled. It cannot keep files, so it preserves the text half in the query string and redirects with `media=dropped`, which `/share` surfaces as a toast rather than silently losing attachments.

## Composer entry point

Shared files enter through the same `ingestFiles()` used by the composer's own file picker (`src/components/NewPost.jsx`), so size limits, the 8-item cap, dimension probing, and IPFS upload behave identically. The picker pins ingestion to the media type it asked for; a share passes `null` and each file is classified by its own MIME type instead.

## Limits

iOS has no Web Share Target support — this is Android/Chromium and desktop Chrome only. Accepted types are `image/*`, `video/*`, and `audio/*`.
