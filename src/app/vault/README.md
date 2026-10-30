# Personal vault v1

The page is available at `/vault` and through the Vault sidebar entry.

Choose New vault to open the shared DialogSheet creation modal, then select a network.
The modal uses Hup's TextField inputs, shared VaultNetworkPicker cards and NativeDialog behavior;
dismissal is disabled while creation is pending. Signers are individual address fields with
add/remove controls, bounded by the shared signer limits. The approval count cannot exceed
the number of fields. Changing the modal network preserves signer drafts and does not change
an opened vault or switch the wallet until creation is submitted. The matching Safe version
is shown from the selected deployment. Page and modal attribution link to Safe.

Import vault opens a separate DialogSheet with the same network cards and a public address
field. It verifies the deployed Safe, records its signers in the database, and opens the vault.
The import modal does not accept keys and makes no onchain transaction.

Open `/vault`, choose a network, connect a signing wallet, and create a Safe with 2–10
distinct owners and a threshold of at least two. The connected account must be one owner.
The default threshold is two. Include three addresses for a 2-of-3 vault.

Custody uses published Safe contracts without modification: SafeL2 1.4.1 where registered, or
GnosisSafeL2 1.3.0 with its matching proxy factory where 1.4.1 is unavailable, including LUKSO.
Addresses and expected deployment hashes come from `@safe-global/safe-deployments`, filtered
against Hup's configured chains. Proxy runtime verification uses Safe's official build artifact.
There are no Hup custody contracts, admin keys, signature servers, manually assigned deployment
addresses, or custom recovery contracts in this feature. An audit of Safe does not cover Hup's UI.

Creation verifies singleton and factory runtime hashes before simulating and sending the factory
call. Setup is atomic with proxy creation and installs no module, fallback handler, or payment.
Opening a vault checks proxy runtime, its singleton storage slot and runtime, and its threshold.
The selected version's official proxy artifact is used for runtime verification. A registry entry
is required and actual singleton/factory code must match; unlisted networks remain unavailable.
LUKSO's 1.3.0 singleton and factory runtime hashes were checked against mainnet RPC.

Receive native currency or tokens at the vault address on the selected network. Payout addresses
can be copied into existing recipient settings. This version does not change payout contracts or
redirect earnings automatically. Token balances are looked up by contract address; native balance
is shown automatically. LSP7 transfers to this Safe require the sender's force option because no
LSP1 receiver handler is installed. NFTs and automatic asset discovery are outside v1.

Transfers support native currency, standard ERC20 and LSP7. A proposal is a portable JSON
description carried in a shareable URL; it is not authority to spend. Imported calldata is never
used. Hup validates the chain, vault, nonce, asset type, addresses and integer amounts, rebuilds
the call and obtains its hash from Safe. All proposals use CALL, zero reimbursement and no
delegatecall. Token metadata and balances come from the selected chain. Token transfers are
simulated from the vault; ERC20 must return true. Fee-taking, rebasing and other nonstandard
tokens are unsupported. Preflight checks cannot guarantee a malicious token's future behavior.

Each owner calls Safe's `approveHash` onchain, so contract accounts can approve as themselves
without ECDSA signing or an EIP-1271 service. Each approval costs gas and cannot be revoked.
Execution rereads owners, threshold, nonce and approvals, builds sorted pre-approved signatures,
simulates the transfer and Safe execution, then checks the receipt for `ExecutionSuccess`.
Proposals with an already-consumed or future nonce cannot be executed from this interface.
Owners pay approval/execution gas from their signing wallets. The vault pays only the transfer.

My vaults is stored in MySQL (`personal_vaults` and `personal_vault_signers`), indexed by every
signing address and the vault's network/address pair. Connecting any recorded signer on another
device loads the same vaults. Creation and opening register vaults through `/api/v1/vaults`.
An existing vault can be registered by opening its address once. The vault page does not use
localStorage or browser-saved vault lists. Proposals live in page state and can be shared through
their proposal links; the page no longer persists proposal drafts in browser storage either.

Registration accepts only a network and vault address. The server verifies the Safe's deployment,
proxy and signer configuration at one pinned block; claimed ownership from a browser is ignored.
The records contain public onchain facts, so no additional message signature is required. Every
verified signer is linked transactionally, with older responses unable to overwrite newer signer
snapshots. Records are refreshed when an opened vault is verified, including after its nonce
changes. This is a registry of known vaults, not a historical chain-wide indexer; external owner
changes appear after a vault is reopened/refreshed. Execution always checks current onchain owners.

Tables are created on first use, matching Hup's database setup convention. Deployments
that apply SQL manually can use `deploy/migrations/20261030-personal-vaults.sql`. A database outage
does not undo a confirmed vault creation: the vault page shows its address and a save-retry action.
Ownership changes and cancellation transactions can be performed using a compatible Safe interface.
Hup cannot recover lost signers or bypass the threshold.

History reads native-receipt and execution events in 2,000-block pages, with explicit older/latest
controls. Full token receipt history and older activity are also available through the configured
explorer. Forced native transfers do not emit receiver events and are reflected only in balance.

Validation:

`pnpm vault:test`

Registry tests are in `src/tests/personal-vault/registry.test.mjs`. Set `PERSONAL_VAULT_DB_TEST=1`
and load the usual database environment to include real MySQL tests. These use connection-local
temporary tables, so no test records are written to user tables. They cover idempotent saves,
cross-device signer lookup, signer replacement, stale snapshots, network isolation, pagination
and transaction rollback.

The suite starts an isolated local Anvil and deploys upstream Safe 1.3.0 and 1.4.1, their matching
factories, and OpenZeppelin ERC20 artifacts. It checks setup validation, bytecode checks,
version-specific receipt/history decoding, insufficient approvals, unauthorized owners,
execution, replay protection, proposal validation, token transfers and approval through a contract
owner. LSP7 encoding is checked separately; live LUKSO transfers are not exercised. Mainnet
verification is read-only and creates no vault or financial transaction.

References: [Safe contracts](https://github.com/safe-global/safe-smart-account/tree/v1.4.1),
[deployment registry](https://github.com/safe-global/safe-deployments),
[onchain approval semantics](https://docs.safe.global/reference-smart-account/signatures/approveHash).
