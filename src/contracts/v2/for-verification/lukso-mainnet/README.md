# LUKSO mainnet verification files

One standard-JSON input per deployed contract, each trimmed to that contract's own sources and
compiled back to bytes identical to the deploy artifacts. `manifest.json` lists, per contract, the
address, the contract name to pick, the compiler settings and the ABI-encoded constructor arguments.

## On the explorer

1. Open the contract's page on https://explorer.execution.mainnet.lukso.network, then **Contract**,
   then **Verify & publish**.
2. Method: **Solidity (Standard JSON input)**. Compiler: **v0.8.36+commit.8a079791**. Optimizer,
   runs and EVM version are inside the JSON and the form takes them from there.
3. Upload the contract's file and pick its name from the list the explorer builds — it is the
   `contractName` in the manifest.
4. Constructor arguments: the explorer usually recovers them from the creation transaction. If it
   asks, paste `constructorArgs` from the manifest (drop the leading `0x` if the field says so).
   HupSplits and HupNativeBalance take none.

## Contracts created by contracts

HupSplitter (by HupSplits) and the drop collections (by the satellites) are deployed many times.
Verify one instance of each with its file; the explorer marks later instances with the same
bytecode as verified by similarity. Their constructor arguments are what the creating contract
passed — read them from the creation transaction's input when the auto-detection does not.

## Regenerating

The files come from `build-verification-per-contract.mjs` (this session's scratchpad), which walks
imports with the same remappings as `src/contracts/foundry.toml`, compiles each trimmed input with
the raw solc 0.8.36 binary and refuses to write a file whose bytecode differs from the suite compile.
