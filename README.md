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