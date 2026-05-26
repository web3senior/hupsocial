## Hup Account Links

`HupAccountLinks` is an optional extension contract for wallet migration and account continuity on Hup.

It does **not** transfer content ownership in the core `Hup` contract. Old posts, comments, reposts, and likes remain owned by the wallet that created them.

Instead, this extension records an on-chain signal that one wallet continues at another wallet.

```txt
old wallet -> new wallet
```

Indexers and frontends can use this signal to display account continuity.

### Why This Is An Extension

Wallet migration is intentionally kept outside the core Hup protocol.

This keeps the core contract cheaper and simpler because normal actions like posting, commenting, liking, and reposting do not need extra account-link checks.

### What It Does

The contract supports:

- requesting a wallet link
- accepting a wallet link
- cancelling a pending request
- removing an active link
- resolving a wallet through successor links
- pausing/unpausing by admin
- meta-transaction support through `ERC2771Context`

### What It Does Not Do

The contract does not:

- transfer old posts
- rewrite `creator` addresses
- move likes, comments, or reposts
- merge on-chain balances
- recover a lost wallet after the private key is gone

Both wallets must participate in the linking flow.

### Two-Step Link Flow

The old wallet starts the process:

```solidity
requestWalletLink(newWallet)
```

Then the new wallet accepts:

```solidity
acceptWalletLink(oldWallet)
```

After acceptance, the active mapping becomes:

```solidity
successorWallet[oldWallet] = newWallet
```

### Example

If Alice used this wallet:

```txt
0xOldAlice
```

and wants to continue at:

```txt
0xNewAlice
```

Then:

```txt
0xOldAlice calls requestWalletLink(0xNewAlice)
0xNewAlice calls acceptWalletLink(0xOldAlice)
```

The frontend can now display:

```txt
This account continues at 0xNewAlice
```

### Removing A Link

An active link can be removed by either:

- the old wallet
- the accepted successor wallet

```solidity
removeWalletLink(oldWallet)
```

This deletes:

```solidity
successorWallet[oldWallet]
```

### Cancelling A Pending Request

If the old wallet requested a link but the new wallet has not accepted yet, the old wallet can cancel:

```solidity
cancelWalletLinkRequest()
```

### Resolving Wallets

The contract can resolve successor chains:

```solidity
resolveWallet(wallet, maxHops)
```

Example chain:

```txt
0xA -> 0xB -> 0xC
```

Calling:

```solidity
resolveWallet(0xA, 10)
```

returns:

```txt
0xC
```

The contract caps resolution depth with `MAX_LINK_DEPTH` to avoid unbounded loops.

### Cycle Protection

The contract prevents circular links.

Invalid example:

```txt
0xA -> 0xB
0xB -> 0xA
```

This would create a loop, so the transaction reverts with:

```solidity
LinkCycle()
```

### Events

Indexers should listen to:

```solidity
event WalletLinkRequested(address indexed oldWallet, address indexed newWallet);
event WalletLinkAccepted(address indexed oldWallet, address indexed newWallet, address indexed previousSuccessor);
event WalletLinkRequestCancelled(address indexed oldWallet, address indexed pendingNewWallet);
event WalletLinkRemoved(address indexed oldWallet, address indexed oldSuccessor, address indexed removedBy);
```

### Suggested Indexer Table

```txt
account_links
- id
- network_id
- contract_address
- old_wallet
- new_wallet
- active
- requested_tx_hash
- accepted_tx_hash
- removed_tx_hash
- block_number
- created_at
- updated_at
```

### Frontend Usage

The frontend can use account links to show:

- “continued at” banners
- linked account history
- combined profile display
- account migration notices

Example UI behavior:

```txt
Posts are still owned by 0xOldAlice.
Profile now shows: Continued at 0xNewAlice.
```

### Design Rule

`HupAccountLinks` is a social/account-continuity signal, not an ownership transfer system.

Core content ownership stays immutable. Account continuity is interpreted by the app, indexer, and frontend.