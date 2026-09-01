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

### Scalability with IPFS
By moving the actual text and media to **IPFS** and only keeping the `Content` struct onchain, this single contract can handle millions of interactions across any EVM chain without hitting state bloat limits.


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

# HupDrops standard ids

The drops engine does not know how to deploy a collection. It holds a registry of **deployer
satellites**, one per token standard, and calls whichever the creator asked for:

```solidity
mapping(uint256 => address) public deployers;   // standardId => satellite
```

| id | Standard | Shape | Chains |
| -- | -------- | ----- | ------ |
| 1 | ERC721 | numbered — unique sequential ids | every EVM chain |
| 2 | ERC1155 | editions — copies of one artwork | every EVM chain |
| 3 | LSP7 | editions | LUKSO only |
| 4 | LSP8 | numbered | LUKSO only |

These are Hup's own registry numbers, not anything from the ERC or LSP specs. They are
**append-only**: every drop ever created stores its `standardId`, and indexers key on it, so a
number is never reused or renumbered. A future standard claims id 5.

Defined in `src/lib/drops.js` (`DROP_STANDARDS`) and mirrored in `src/config/contracts.js`.

## Why satellites instead of one engine

Two reasons, both structural:

- **EIP-170.** The engine plus four collection bytecodes would blow past the 24,576-byte limit.
  Each satellite carries exactly one collection's creation code.
- **Adding a standard needs no engine redeploy.** `setDeployer(id, satellite)` is one admin
  transaction. That matters more than it sounds: a collection stores its engine as
  `address public immutable drops`, so **redeploying the engine strands every collection ever
  minted through it** — no new phases, no new mints, ever. Anything that can be done without
  touching the engine, should be.

A standard with no registered satellite is simply unavailable: `createDrop` reverts
`InvalidStandard`, and the composer reads `deployers(standardId)` first so the creator sees
"not enabled on this network yet" instead of a failed transaction. So a chain can launch with
one standard and gain the rest later.

## Deploying a chain

1. Deploy the engine. Its constructor takes `(hup, trustedForwarder, admin, followerSystem)`.
2. Deploy each satellite you want — each takes the **engine address**, immutably.
3. `setDeployer(id, satellite)` per standard. LUKSO registers 3 and 4; other EVM chains 1 and 2.
4. `setCommunitySystem` — it is not a constructor argument, and Community-gated phases fail
   closed until it is set. `setFollowerSystem` too if the chain has LSP26 and the constructor
   was passed `address(0)`.
5. Fill `drops` in `src/config/contracts.js`, then register the address in cidex.

Order matters: the satellites take the engine's address, so the engine must land first and be
confirmed before any satellite is deployed.

# Metadata

- IPFS://
- or plain text

if (metadata.startsWith('IPFS://')) route through your public IPFS gateway provider.

else render as a plain text string instantly.

## Contract Versioning & Public Post IDs

Hup contract post IDs are local to each deployed contract. If a new Hup contract is deployed on the same network, its internal `contentCount` starts again from `1`.

To keep public post URLs stable and clean, the app uses an off-chain public post ID system.

Example public URL:

```txt
/networks/42/45
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
    networkId: 42,
    address: '0xOldHupContract',
    startPublicId: 1,
    endPublicId: 45,
    offset: 0,
  },
  {
    networkId: 42,
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
/networks/42/48
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
/networks/42/45
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
            storage: 'IPFS',
            mimeType: 'image/jpeg',
            spoiler: false,
          },
          {
            type: 'video',
            cid: 'Qm5678...video-cid',
            alt: 'Video description',
            storage: 'IPFS',
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

## Encryption is a per-community toggle (orthogonal to admission)

A community's access model has three independent axes, which the retired `MembershipType` enum used to conflate:

1. **AdmissionMode** — how wallets get onto the roster: Open, Request Approval, Invite Only (consent handshake), Self-serve if eligible, Pay to Join.
2. **Requirements** — a composable list (up to 10 entries) of what wallets must hold or be: native/token/NFT balances, whitelist membership, following the creator — combined ALL-of or ANY-of, plus an optional `IHupEligibilityModule` contract for logic the list can't express. Checked inside `join()` for Self-serve mode and re-checked live in `canPost()` for everyone, so selling the gating asset suspends posting. "Invite-only but must hold 100 tokens" is just configuration.
3. **Encrypted content** — `keyVersion > 0` onchain, chosen at creation (atomic key init) or enabled later with one `initializeKey` tx. The composer's rule is exactly this flag.

The old constraint — "only approval-based types can be encrypted" — is solved by key-delivery timing instead of by forbidding combinations: approval/invite admissions hand the envelope over at the moment a moderator acts on the member; self-admit admissions (Open/Self-serve/Pay) admit instantly and the member's client files a key request that a moderator batch-delivers from the lazy grant queue. The honest cost is that new members of self-admit encrypted communities can't read until a moderator is next online — the UI says so at creation time.

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


# Microbounties (Community-Funded Work)

A microbounty is three things: escrow, a submission window, and a payout decision. "Design a logo, $500 to the winner." The obvious way to build it is a governance pipeline — a proposal contract, quorum rules, and an executor that releases the funds once a vote passes. That executor is the part that would have to be trusted, and it is the part Hup does not build.

## Funding is the greenlight

`HupCommunity` already resolves a community's money to a single address. `setPayoutDestination(id, destination)` points join fees at a wallet, a Safe, a DAO treasury, or a splitter contract, and `join()` pushes the fee straight there in the same transaction — nothing rests in the contract, there is no ledger to reconcile, and there is no withdraw call for anyone to authorize. Rules richer than "one address" (a co-founder split, a quorum, a vesting schedule) live inside the destination, not inside Hup. Under DAO mode the setter is reachable by the governor as well, since `onlyCreator` admits `governors[id]` alongside the creator.

A bounty funds from that same address, and that single fact removes the need for the pipeline:

- **Proposal and discussion** are a Hup Poll plus the thread under it. Non-binding by design — it is signal.
- **Second confirmation** is whoever controls the payout destination signing the bounty's `create` transaction. A Safe destination makes it literally the second signature. A Governor destination makes it a passed proposal executing a call. A single wallet makes it one person deciding — an honest reflection of what that community actually is.

The funding transaction *is* the execution of the vote. Nothing stands between the poll result and the money, so nothing there can be captured, bribed, or bugged. Hup operates no executor, no keeper, and no privileged role that can move a community's funds.

## What the bounty contract still owes

Escrow is not governance, so it stays small and unopinionated:

- **`create(token, amount, deadline, kind)`** — the funder deposits once. Native plus ERC20/LSP7, because a "$500 bounty" is a stablecoin, not gas coin.
- **`submit(bountyId, postId)`** — entries are ordinary posts. Post ids are per-network, so entries key on `network_id:id`.
- **`award(bountyId, winners[], splits[])`** — paid with `.call{value: ...}("")` so Universal Profiles with LSP1 delegates receive normally.
- **`refund()` after the deadline** when nothing was awarded. Non-negotiable: escrow without a timeout is a hostage, and a community that funds a bounty nobody wins has to be able to recover it.

One contract covers the variants. A JokeRace-style contest, a call for peer review, and a karmagap-style project application differ only in `kind` and in what the submission points at — a post, an article, a project. Forking the contract per use case would multiply the audit surface for no new mechanism.

## Honest limits

- **Judging is not trustless, and pretending otherwise is worse.** Somebody decides which logo wins. Creator-picks is fast and centralized; poll-picks is slow and only as sybil-resistant as the community's join cost. The refund deadline, not the judging rule, is what protects the funder.
- **Quality is offchain.** The contract can prove a payment happened; it cannot prove the work was good. Reputation for that lives in the thread and the leaderboard.
- **Sybil resistance is inherited, not added.** A poll-picked winner is only as meaningful as the membership rule behind the electorate — Public communities get Public-community results.

## Indexing

Bounty and entry events are cidex's, per the standing rule that the app reads the database and never scans chain itself: a `runBountySync` runner filling `bounties` and `bounty_entries`, surfaced at `/jobs` — today that route renders the leaderboard, which becomes one tab of it.

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

# Why HupOffers Is Not Gasless

Every other Hup extension accepts ERC2771 meta-transactions and resolves burner session keys to their primary wallet. HupOffers accepts neither. Its constructor takes one argument — the admin — with no Hup Core reference and no trusted forwarder, and there is no `setTrustedForwarder` to add one later. Every action is credited to `msg.sender` and nothing else. This is a deliberate departure, not an omission.

1. **Relaying would buy nothing.** Gasless exists so someone can act without holding the chain's coin. But both sides of an offer must already control value: the offerer's escrow is pulled from the caller (native `msg.value`, or an ERC20/LSP7 allowance the caller granted), and the seller's asset leaves the caller's own holdings. There is no useful action a third party could perform on someone's behalf, because every action spends something only the owner has.

2. **Relaying would cost a great deal.** An ERC2771 forwarder is, by construction, an address permitted to name any sender — `_msgSender()` reads the last 20 bytes of calldata on its word alone. This contract's entire job is spending standing approvals. Combine the two and a forwarder can forge `makeOffer` as a victim up to whatever allowance they granted, then fill it with a worthless asset; or forge `acceptOffer` as a victim against a lowball offer and take an approved NFT. Neither needs the victim's key. A rotatable forwarder makes this the admin's power too, since whitelisting one is an admin call — which would have quietly undone the reason `HupPredict` reads raw `msg.sender` for its market-control paths.

3. **Approvals here are collection-wide, which widens what an impersonation would reach.** Sellers grant ERC721 rights with `setApprovalForAll` rather than a per-token `approve`, because the per-token approval is exclusive and would silently revoke the one HupTrade holds for a live listing. That is the right trade — but it means one forged `acceptOffer` would reach an entire collection, not one token. Removing the forge is better than narrowing it.

4. **What an admin can still do.** Pause new offers and fills, move the fee within its hard 10% cap (snapshotted per offer at creation, so pending offers settle at the rate they were made under), whitelist ERC677 payment tokens, and withdraw `accruedFees`. It can never move a user's tokens, and it can never touch escrow: there is no whole-balance sweep, and `cancelOffer` carries no `whenNotPaused`, so an exit from escrow is never blockable.

The one place the contract credits anyone but its caller is ERC677's `onTokenTransfer`, which attributes the offer to the `_sender` the token reports. That is safe for the opposite reason: the caller there *is* the whitelisted token, and the whitelist is the only proof a real transfer preceded the callback. It is also the closest thing to a gasless convenience the contract keeps — whitelisted tokens (G$ on Celo, for instance) fund or fill an offer in a single `transferAndCall` with no prior approve.

The cost is real and worth naming: every offer action is a transaction the user pays for, including Universal Profile holders, who get the session-key skip when tipping or playing the miner game. Offers ask them to sign each action themselves. For a contract whose whole purpose is holding other people's money against other people's approvals, that is the correct side to err on.

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
