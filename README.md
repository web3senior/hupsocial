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