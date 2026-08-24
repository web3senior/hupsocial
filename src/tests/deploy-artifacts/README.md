# Deploy artifacts

Init code for deploying through `../deploy.html` (the CREATE2 tool). Each contract in that page's
picker is labelled with its artifact's own file date and time (local, from the server's
`Last-Modified`), so what shows in the list is always the freshness of the bytes on disk — if a
`.sol` was edited after that stamp, recompile before deploying.

## HupDrops suite

Compiled with the same settings Remix uses: **solc 0.8.36, optimizer on / 200 runs, viaIR**. Remix
cannot compile the LUKSO satellites itself — the LSP stack pins OpenZeppelin 4.9 in nested
`node_modules` while the workspace top level is 5.4, so root-first resolution hands ERC725Y the
wrong `Ownable` — which is why the bytecode is precompiled here.

## Order matters

The satellites take the engine address as an **immutable** constructor argument, so a new engine
always means new satellites.

1. **Engine** — paste `HupDrops-4201.initcode.txt` into `deploy.html`. Constructor arguments for
   LUKSO Testnet (4201) are already appended: Hup core, HupChatForwarder, the admin EOA, and the
   canonical LSP26 follower registry.
2. **Satellites** — `node satellite-initcode.js 0x<newEngineAddress>` writes
   `HupDropsDeployerLSP7.paste-ready.txt` and `…LSP8.paste-ready.txt` next to itself; deploy both.
3. **Register** — on `/admin/contracts`, in the HupDrops card, set standard `3` to the LSP7
   satellite and standard `4` to the LSP8 satellite, signing **directly from the admin EOA**
   (`setDeployer` checks `msg.sender`, so a relayed call reverts). Re-set the mint and creation
   fees there too: a fresh engine starts at zero.
4. Fill the address into `src/config/contracts.js` (`chain4201.drops`) and register the new
   deployment in cidex's `scripts/add-hupdrops-contracts.sql`.

`artifacts/` holds the raw compiler output the two scripts read; `../../abis/HupDrops.json` is the
ABI the app uses and is generated from the same compile.

## HupOffers

Escrow-backed offers / OTC deals — the buy-side complement of HupTrade and HupEditions. Built with
**foundry: solc 0.8.35, optimizer on / 200 runs, no viaIR** (OpenZeppelin 5.6.1 from
`src/contracts/node_modules`), which Remix can compile too; the artifact is here so a deploy needs
no toolchain at all. Runtime size is 14,182 bytes, comfortably inside EIP-170.

Unlike every other Hup contract, this one takes **no Hup core reference and no trusted forwarder** —
its only constructor argument is the admin. It has no ERC2771 support and no burner-session
resolution on purpose: both sides of an offer must already control value (the offerer's escrow is
pulled from the caller, the seller's asset leaves the caller's own holdings), so relaying buys no
convenience while handing some address the power to name any sender against standing approvals.
Every action is credited to `msg.sender`. Deploys made before 2026-08-16 have the old three-argument
constructor and a different ABI; they are retired, not upgradable.

1. Pick **HupOffers** in `../deploy.html`. The single admin argument prefills on LUKSO (42) and
   LUKSO Testnet (4201) — confirm it before signing, especially on mainnet.
2. Fill the deployed address into `src/config/contracts.js` (`chain<id>.offers`).
3. Register it in cidex's `scripts/add-hupoffers-contracts.sql` (address + exact creation block),
   run the script, and let cidex restart so `runOffersSync` picks it up.
4. Fees start at zero — set `setOfferFeeBps` if the deployment should charge. Whitelist any ERC677
   payment token (e.g. G$ on Celo) with `setErc677Token` before the one-transaction path works.

## HupCommunity

Single contract. Every PayToJoin fee — native coin, ERC20 or LSP7 — is pushed by `join()`
**straight to the community's payout destination** in the same transaction: the creator by
default, or any address the creator sets via `setPayoutDestination` (a wallet, a Safe, a DAO
treasury, a splitter contract with its own rules). The contract never holds fee money and there is
nothing to claim; the trade-off is that a destination that can't receive the payment asset makes
joins revert until the creator re-points it (self-inflicted, fixable in one tx).

Compiled with **solc 0.8.36, optimizer on / 200 runs, viaIR, cancun**, OpenZeppelin 5.6.1 from
`src/contracts/node_modules`, built with forge. Runtime 23,554 bytes (EIP-170 ok). Verification
input: `src/contracts/v2/for-verification/hupcommunity.json`.

After deploying: `setFollowerSystem` / `setFee` as for any fresh core, register it in cidex,
and swap `contracts.js`. Token-priced joins approve / `authorizeOperator` the community
contract. Deploys from 2026-08-23/24 (the separate-ledger era) and earlier are retired, not
upgradable.

## Test tokens

Four throwaway faucet assets — one per standard the app gates on — so any chain can exercise
`TokenBalance` / `NftBalance` requirements (polls, communities), Trade listings, Offers, tips,
and the Assets tab without waiting for a real token to exist there:

| Artifact | Standard | Constructor | Faucet |
| --- | --- | --- | --- |
| `HupTestToken.json` | ERC20 | name, symbol, decimals, owner | `faucet()` → 1,000 whole tokens |
| `HupTestERC721.json` | ERC721 | name, symbol, baseURI, owner | `faucet()` → next sequential id |
| `HupTestLSP7.json` | LSP7 | name, symbol, owner | `faucet()` → 1,000 whole tokens |
| `HupTestLSP8.json` | LSP8 | name, symbol, owner | `faucet()` → next sequential id (bytes32) |

All four: **solc 0.8.36, optimizer on / 200 runs, viaIR, cancun**, built with forge. The LSP pair
compiles against the OpenZeppelin 4.9.6 nested under `@lukso/lsp8-contracts` (the LSP stack
pins it), the ERC pair against the workspace 5.6.1 — two remapping sets, which is why they are
precompiled here rather than built in Remix. `src/contracts/v2/for-verification/huptest*.json`
are the matching standard-JSON inputs, checked to produce the same bytecode as these artifacts.

**Owner is explicit.** Through the CREATE2 factory, `msg.sender` inside a constructor is the
factory, so an `Ownable(msg.sender)` token would belong to `0x4e59…956C` and its initial supply
would be stranded there. Every test token therefore takes `owner_` as its last argument; the
picker prefills it with the connected wallet (the `signerArgs` flag in `deploy.html`). Name and
symbol prefill too, so a deploy is pick → Load bytecode → Deploy.

Because the arguments are part of the init code, identical defaults give the **same address on
every chain** — convenient for config — and also mean a second copy on one chain needs a
different salt. The faucets are open to anyone and uncapped; the owner additionally holds
`mint` (ERC20/ERC721) or `MINTER_ROLE` + `mintNext` (LSP7/LSP8), and `disableMinting()` on the
LSP pair switches the faucet off as well. Minting is `force: true` on LSP so plain EOAs receive.

**Mint and transfer from the page.** Once a test token exists on the connected chain, the last
panel of `deploy.html` drives it: pick it in the contract list (or paste any address and choose its
standard) and the panel reads name, symbol, supply, your balance — owned ids for the NFTs — and
whether the connected wallet may mint. **Faucet** calls `faucet()` as anyone; **Mint** calls
`mint(to, amount)` / `mint(to)` / `mint(to, amount, true, "")` / `mintNext(to)` for the owner or
minter; **Transfer** sends from the connected wallet (`transfer` / `transferFrom` / LSP `transfer`
with `force: true`). Amounts are whole tokens, scaled by the token's decimals; NFT ids are plain
numbers. The panel fills itself in after a deploy, or whenever the predicted address already holds
code — a hand-typed address is never overwritten.

The `/admin/deploy-lsp7` page deploys the same LSP7 source directly (no factory), reading
`src/abis/HupTestLSP7.deploy.json`; it passes the connected wallet as `owner_`, so its behaviour
is unchanged. Deploys made before 2026-08-23 have the two-argument constructor.
