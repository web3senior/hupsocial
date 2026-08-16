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
