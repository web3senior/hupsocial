import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import solc from 'solc'
import ganache from 'ganache'
import { AbiCoder, BrowserProvider, Contract, ContractFactory, MaxUint256, Signature, Wallet, ZeroAddress, hexlify, keccak256, solidityPacked, toUtf8Bytes } from 'ethers'

const roots = [resolve('node_modules'), ...readdirSync('node_modules/.pnpm').map((name) => resolve('node_modules/.pnpm', name, 'node_modules'))]
const sources = Object.fromEntries(['HupBridge.sol', 'TestMocks.sol'].map((name) => [name, { content: readFileSync(name, 'utf8') }]))
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources,
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } },
}), { import: (name) => {
  const path = roots.map((root) => resolve(root, name)).find(existsSync)
  return path ? { contents: readFileSync(path, 'utf8') } : { error: `Missing ${name}` }
} }))
const errors = (output.errors || []).filter((error) => error.severity === 'error')
assert.equal(errors.length, 0, errors.map((error) => error.formattedMessage).join('\n'))
const transport = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' }, miner: { blockGasLimit: 60_000_000 }, wallet: { deterministic: true } })
const provider = new BrowserProvider(transport, undefined, { cacheTimeout: -1 })
provider.pollingInterval = 10
const owner = await provider.getSigner(0)
const other = await provider.getSigner(1)
const address = await owner.getAddress()
const otherAddress = await other.getAddress()
// Ganache's eth_signTypedData_v4 rejects ethers' payload, so typed data is signed locally.
const ownerKey = new Wallet('0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d')
assert.equal(ownerKey.address, address)
const signerKey = Wallet.createRandom()
const chainId = (await provider.getNetwork()).chainId
const artifact = (name) => Object.values(output.contracts).map((file) => file[name]).find(Boolean)
const sizes = {}
async function deploy(name, args = []) {
  const item = artifact(name)
  sizes[name] = item.evm.deployedBytecode.object.length / 2
  assert.ok(sizes[name] <= 24576, `${name} exceeds deployment size`)
  const contract = await new ContractFactory(item.abi, item.evm.bytecode.object, owner).deploy(...args)
  await contract.waitForDeployment()
  return contract
}
const done = async (tx) => (await tx).wait()
const reject = async (operation) => assert.rejects(async () => { await done(operation()) })
const coder = AbiCoder.defaultAbiCoder()
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 3600)
const NATIVE = ZeroAddress
const SOURCE = 8453n
const FEE = 10n ** 14n // 0.0001 ETH per deposit
const BURN_FEE = 10n ** 18n // 1 LYX per burn
const LSP4_METADATA_KEY = '0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e'
const CLAIM_TYPES = { Claim: [
  { name: 'sourceChainId', type: 'uint256' }, { name: 'vault', type: 'address' }, { name: 'depositNonce', type: 'uint256' },
  { name: 'sourceToken', type: 'address' }, { name: 'decimals', type: 'uint8' }, { name: 'name', type: 'string' }, { name: 'symbol', type: 'string' },
  { name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'metadata', type: 'bytes' },
] }
const RELEASE_TYPES = { Release: [{ name: 'burnId', type: 'bytes32' }, { name: 'token', type: 'address' }, { name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }] }

try {
  const permit2 = await deploy('MockPermit2')
  await reject(async () => deploy('HupBridgeVault', [signerKey.address, permit2.target, FEE * 11n, FEE * 10n, 10_000, 'Ether', 'ETH', address]))
  await reject(async () => deploy('HupLuksoBridge', [signerKey.address, BURN_FEE * 11n, BURN_FEE * 10n, address]))
  const vault = await deploy('HupBridgeVault', [signerKey.address, permit2.target, FEE, FEE * 10n, 10_000, 'Ether', 'ETH', address])
  const bridge = await deploy('HupLuksoBridge', [signerKey.address, BURN_FEE, BURN_FEE * 10n, address])
  assert.equal(await vault.bridgeVersion(), 1n)
  assert.equal(await bridge.bridgeVersion(), 1n)
  const lsp7 = (target, signer = owner) => new Contract(target, artifact('HupMirrorToken').abi, signer)
  const vaultDomain = { name: 'HupBridgeVault', version: '1', chainId, verifyingContract: vault.target }
  const bridgeDomain = { name: 'HupLuksoBridge', version: '1', chainId, verifyingContract: bridge.target }

  const depositedFrom = (receipt) => receipt.logs.map((entry) => { try { return vault.interface.parseLog(entry) } catch { return null } }).find((entry) => entry?.name === 'Deposited').args
  const claimFor = (event, metadata = '0x', overrides = {}) => ({
    sourceChainId: SOURCE, vault: vault.target, depositNonce: event.nonce, sourceToken: event.token, decimals: event.decimals,
    name: event.name, symbol: event.symbol, recipient: event.recipient, amount: event.amount, metadata, ...overrides,
  })
  const signClaim = (claim, key = signerKey) => key.signTypedData(bridgeDomain, CLAIM_TYPES, claim)
  const burnedFrom = (receipt) => receipt.logs.map((entry) => { try { return bridge.interface.parseLog(entry) } catch { return null } }).find((entry) => entry?.name === 'Burned').args
  const signRelease = (burn, token, key = signerKey) => key.signTypedData(vaultDomain, RELEASE_TYPES, { burnId: burn.burnId, token, recipient: burn.recipient, amount: burn.amount })

  // Chains open only through the owner, and never for LUKSO itself.
  await reject(async () => bridge.connect(other).setVault(SOURCE, vault.target))
  await reject(async () => bridge.setVault(chainId, vault.target))

  // An ERC20 deposit pays the flat native fee; the token amount crosses unchanged. Overpayment is refunded.
  const token = await deploy('MockToken')
  await done(token.approve(vault.target, MaxUint256))
  await reject(async () => vault.deposit(token.target, address, 1_000_000n))
  await reject(async () => vault.deposit(token.target, address, 1_000_000n, { value: FEE - 1n }))
  const first = depositedFrom(await done(vault.deposit(token.target, address, 1_000_000n, { value: FEE * 3n })))
  assert.equal(first.amount, 1_000_000n)
  assert.equal(first.fee, FEE)
  assert.equal(first.decimals, 6n)
  assert.equal(await vault.locked(token.target), 1_000_000n)
  assert.equal(await vault.feesAccrued(), FEE)
  assert.equal(await provider.getBalance(vault.target), FEE, 'Excess fee refunded')

  // Claims fail until the chain is open, with a wrong signer, or with altered fields.
  const metadata = hexlify(toUtf8Bytes('verifiable-uri-placeholder'))
  const firstClaim = claimFor(first, metadata)
  await reject(async () => bridge.claim(firstClaim, await signClaim(firstClaim)))
  await done(bridge.setVault(SOURCE, vault.target))
  await reject(async () => bridge.claim(firstClaim, await signClaim(firstClaim, Wallet.createRandom())))
  const signature = await signClaim(firstClaim)
  await reject(async () => bridge.claim({ ...firstClaim, recipient: otherAddress }, signature))
  await reject(async () => bridge.claim({ ...firstClaim, amount: first.amount + 1n }, signature))
  await reject(async () => bridge.claim({ ...firstClaim, metadata: '0x' }, signature))
  await reject(async () => bridge.claim({ ...firstClaim, vault: otherAddress }, signature))

  // Anyone may submit a valid claim for free; the first one creates the mirror at its predicted address with its icon metadata.
  const predicted = await bridge.predictMirror(SOURCE, token.target)
  const creation = await done(bridge.connect(other).claim(firstClaim, signature))
  const mirror = await bridge.mirrors(SOURCE, token.target)
  assert.equal(mirror.token, predicted)
  assert.equal(mirror.scale, 10n ** 12n)
  const usd = lsp7(mirror.token)
  assert.equal(await usd.balanceOf(address), 10n ** 18n)
  assert.equal(await usd.getData(LSP4_METADATA_KEY), metadata)
  assert.equal(await usd.sourceChainId(), SOURCE)
  assert.equal(await usd.sourceToken(), token.target)
  await reject(async () => bridge.claim(firstClaim, signature))
  await reject(async () => usd.mint(address, 1n))
  await reject(async () => usd.burnFrom(address, 1n))
  await reject(async () => usd.initialize('X', 'X', 1, address))
  const implementation = lsp7(await bridge.implementation())
  await reject(async () => implementation.initialize('X', 'X', 1, address))

  // Metadata can be rewritten by the owner or signer only, and only for existing mirrors.
  const icon = hexlify(toUtf8Bytes('new-icon'))
  await reject(async () => bridge.connect(other).setMirrorMetadata(SOURCE, token.target, icon))
  await reject(async () => bridge.setMirrorMetadata(SOURCE, otherAddress, icon))
  await done(bridge.setMirrorMetadata(SOURCE, token.target, icon))
  assert.equal(await usd.getData(LSP4_METADATA_KEY), icon)

  // Burn pays the flat LYX fee, needs no operator authorization, and refunds overpayment.
  await reject(async () => bridge.connect(other).burn(SOURCE, token.target, otherAddress, 1n, { value: BURN_FEE }))
  await reject(async () => bridge.burn(1n, token.target, address, 1n, { value: BURN_FEE }))
  await reject(async () => bridge.burn(SOURCE, token.target, otherAddress, 500_000n, { value: BURN_FEE - 1n }))
  const burned = burnedFrom(await done(bridge.burn(SOURCE, token.target, otherAddress, 500_000n, { value: BURN_FEE * 2n })))
  assert.equal(await usd.balanceOf(address), 5n * 10n ** 17n)
  assert.equal(await bridge.feesAccrued(), BURN_FEE)
  assert.equal(await provider.getBalance(bridge.target), BURN_FEE, 'Excess burn fee refunded')

  // Release pays the full amount, free; altered or foreign signatures are refused.
  const releaseSignature = await signRelease(burned, token.target)
  await reject(async () => vault.release(burned.burnId, token.target, address, burned.amount, releaseSignature))
  await reject(async () => vault.release(burned.burnId, token.target, otherAddress, burned.amount + 1n, releaseSignature))
  await reject(async () => vault.release(burned.burnId, token.target, otherAddress, burned.amount, await signRelease(burned, token.target, Wallet.createRandom())))
  const otherBefore = await token.balanceOf(otherAddress)
  await done(vault.connect(other).release(burned.burnId, token.target, otherAddress, burned.amount, releaseSignature))
  assert.equal(await token.balanceOf(otherAddress), otherBefore + 500_000n)
  assert.equal(await vault.locked(token.target), 500_000n)
  await reject(async () => vault.release(burned.burnId, token.target, otherAddress, burned.amount, releaseSignature))

  // A compromised signer still cannot pay out more than a token's escrow.
  const forged = { burnId: keccak256(toUtf8Bytes('forged')), recipient: otherAddress, amount: 500_001n }
  await reject(async () => vault.release(forged.burnId, token.target, otherAddress, forged.amount, await signRelease(forged, token.target)))

  // EIP-2612 permit deposit: one signature, one transaction (fee as msg.value).
  const permitToken = await deploy('MockPermitToken')
  const permitDomain = { name: 'Permit USD', version: '1', chainId, verifyingContract: permitToken.target }
  const permitTypes = { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] }
  const permitDeadline = deadline()
  const permit = Signature.from(await ownerKey.signTypedData(permitDomain, permitTypes, { owner: address, spender: vault.target, value: MaxUint256, nonce: 0n, deadline: permitDeadline }))
  const permitData = coder.encode(['uint256', 'uint256', 'uint8', 'bytes32', 'bytes32'], [MaxUint256, permitDeadline, permit.v, permit.r, permit.s])
  await reject(async () => vault.connect(other).depositWithPermit(permitToken.target, otherAddress, 1_000_000n, permitData, { value: FEE }))
  await done(permitToken.permit(address, vault.target, MaxUint256, permitDeadline, permit.v, permit.r, permit.s))
  await done(vault.depositWithPermit(permitToken.target, address, 1_000_000n, permitData, { value: FEE }))
  assert.equal(await vault.locked(permitToken.target), 1_000_000n)

  // Permit2 deposit, with nonce replay and a foreign signer refused.
  const permit2Token = await deploy('MockMetadataToken', ['Wrapped', 'WRAP', 18])
  await done(permit2Token.approve(permit2.target, MaxUint256))
  const permit2Data = (signer, nonce) => coder.encode(['uint256', 'uint256', 'bytes'], [nonce, deadline(), solidityPacked(['address', 'uint256'], [signer, nonce])])
  await done(vault.depositWithPermit2(permit2Token.target, address, 10n ** 18n, permit2Data(address, 5n), { value: FEE }))
  await reject(async () => vault.depositWithPermit2(permit2Token.target, address, 10n ** 18n, permit2Data(address, 5n), { value: FEE }))
  await reject(async () => vault.connect(other).depositWithPermit2(permit2Token.target, otherAddress, 10n ** 18n, permit2Data(address, 6n), { value: FEE }))

  // Native coin: amount plus fee in one payable call; escrow and fees are kept apart.
  await reject(async () => vault.deposit(NATIVE, address, 1n, { value: FEE }))
  await reject(async () => vault.depositNative(address, 10n ** 18n, { value: 10n ** 18n }))
  const nativeEvent = depositedFrom(await done(vault.depositNative(address, 10n ** 18n, { value: 10n ** 18n + FEE })))
  assert.equal(nativeEvent.name, 'Ether')
  assert.equal(nativeEvent.amount, 10n ** 18n)
  assert.equal(await vault.locked(NATIVE), 10n ** 18n)
  const nativeClaim = claimFor(nativeEvent)
  await done(bridge.claim(nativeClaim, await signClaim(nativeClaim)))
  const ether = lsp7((await bridge.mirrors(SOURCE, NATIVE)).token)
  assert.equal(await ether.balanceOf(address), 10n ** 18n)
  const fresh = Wallet.createRandom().address
  const nativeBurn = burnedFrom(await done(bridge.burn(SOURCE, NATIVE, fresh, 5n * 10n ** 17n, { value: BURN_FEE })))
  await done(vault.release(nativeBurn.burnId, NATIVE, fresh, nativeBurn.amount, await signRelease(nativeBurn, NATIVE)))
  assert.equal(await provider.getBalance(fresh), 5n * 10n ** 17n)
  // Releases can never reach the fees: native escrow is exactly what remains locked.
  const nativeForged = { burnId: keccak256(toUtf8Bytes('native-forged')), recipient: fresh, amount: 5n * 10n ** 17n + 1n }
  await reject(async () => vault.release(nativeForged.burnId, NATIVE, fresh, nativeForged.amount, await signRelease(nativeForged, NATIVE)))

  // Legacy bytes32 metadata.
  const maker = await deploy('MockBytes32Token')
  const makerMetadata = await vault.metadataOf(maker.target)
  assert.equal(makerMetadata[1], 'Maker')
  assert.equal(makerMetadata[2], 'MKR')

  // Smart accounts (Universal Profiles) deposit, claim, burn and receive refunds like EOAs.
  const account = await deploy('MockAccount')
  await done(token.transfer(account.target, 5_000_000n))
  await done(account.execute(token.target, token.interface.encodeFunctionData('approve', [vault.target, 5_000_000n])))
  const accountDeposit = depositedFrom(await done(account.execute(vault.target, vault.interface.encodeFunctionData('deposit', [token.target, account.target, 5_000_000n]), { value: FEE * 2n })))
  assert.equal(await provider.getBalance(account.target), FEE, 'Smart account refund')
  const accountClaim = claimFor(accountDeposit)
  await done(account.execute(bridge.target, bridge.interface.encodeFunctionData('claim', [accountClaim, await signClaim(accountClaim)])))
  assert.equal(await usd.balanceOf(account.target), 5n * 10n ** 18n)
  await done(account.execute(bridge.target, bridge.interface.encodeFunctionData('burn', [SOURCE, token.target, account.target, 5_000_000n]), { value: BURN_FEE }))

  // Rejections: taxed tokens, bad metadata, fee caps, pausing, fee withdrawal bounds.
  await done(token.setTaxed(true))
  await reject(async () => vault.deposit(token.target, address, 1_000_000n, { value: FEE }))
  await done(token.setTaxed(false))
  for (const [name, symbol, decimals] of [['USD', 'USD', 19], ['', 'USD', 6], ['USD', '', 6], ['X'.repeat(129), 'USD', 6]]) {
    const invalid = await deploy('MockMetadataToken', [name, symbol, decimals])
    await done(invalid.approve(vault.target, MaxUint256))
    await reject(async () => vault.deposit(invalid.target, address, 10n ** 6n, { value: FEE }))
  }
  await reject(async () => vault.deposit(token.target, address, 0n, { value: FEE }))
  await reject(async () => vault.setBridgeFee(FEE * 10n + 1n))
  await reject(async () => vault.connect(other).setBridgeFee(0n))
  await reject(async () => bridge.setBurnFee(BURN_FEE * 10n + 1n))
  await done(vault.setBridgeFee(0n))
  await done(vault.deposit(token.target, address, 1n))
  await done(vault.setBridgeFee(FEE))
  await reject(async () => vault.connect(other).pause())
  await done(vault.pause())
  await reject(async () => vault.deposit(token.target, address, 1_000_000n, { value: FEE }))
  await done(vault.unpause())
  await done(owner.sendTransaction({ to: signerKey.address, value: 10n ** 18n }))
  const vaultAsSigner = vault.connect(signerKey.connect(provider))
  await done(vaultAsSigner.pause())
  await reject(async () => vaultAsSigner.unpause())
  await done(vault.unpause())
  const vaultFees = await vault.feesAccrued()
  await reject(async () => vault.withdrawFees(otherAddress, vaultFees + 1n))
  await reject(async () => vault.connect(other).withdrawFees(otherAddress, vaultFees))
  const before = await provider.getBalance(fresh)
  await done(vault.withdrawFees(fresh, vaultFees))
  assert.equal(await provider.getBalance(fresh), before + vaultFees)
  const bridgeFees = await bridge.feesAccrued()
  assert.equal(bridgeFees, 3n * BURN_FEE)
  await reject(async () => bridge.connect(other).withdrawFees(otherAddress, bridgeFees))
  await done(bridge.withdrawFees(fresh, bridgeFees))
  assert.equal(await provider.getBalance(bridge.target), 0n)

  // Daily release caps: a share of each token's escrow per 24 hours, with an owner-set floor.
  await reject(async () => deploy('HupBridgeVault', [signerKey.address, permit2.target, FEE, FEE * 10n, 0, 'Ether', 'ETH', address]))
  await reject(async () => deploy('HupBridgeVault', [signerKey.address, permit2.target, FEE, FEE * 10n, 10_001, 'Ether', 'ETH', address]))
  const capped = await deploy('HupBridgeVault', [signerKey.address, permit2.target, FEE, FEE * 10n, 2_000, 'Ether', 'ETH', address])
  const cappedDomain = { name: 'HupBridgeVault', version: '1', chainId, verifyingContract: capped.target }
  let burnCount = 0
  const cappedRelease = async (amount) => {
    const release = { burnId: keccak256(toUtf8Bytes(`capped-${burnCount++}`)), token: token.target, recipient: otherAddress, amount }
    return capped.release(release.burnId, release.token, release.recipient, release.amount, await signerKey.signTypedData(cappedDomain, RELEASE_TYPES, release))
  }
  await done(token.approve(capped.target, MaxUint256))
  await done(capped.deposit(token.target, address, 1_000_000n, { value: FEE }))
  assert.equal((await capped.releasableToday(token.target))[0], 200_000n)
  await done(cappedRelease(150_000n))
  await reject(async () => cappedRelease(60_000n))
  assert.equal((await capped.releasableToday(token.target))[0], 50_000n)
  // Deposits inside a window do not raise what it allows.
  await done(capped.deposit(token.target, address, 1_000_000n, { value: FEE }))
  assert.equal((await capped.releasableToday(token.target))[0], 50_000n)
  await done(cappedRelease(50_000n))
  await reject(async () => capped.connect(other).setDailyReleaseFloor(token.target, 300_000n))
  await done(capped.setDailyReleaseFloor(token.target, 300_000n))
  assert.equal((await capped.releasableToday(token.target))[0], 100_000n)
  await done(cappedRelease(100_000n))
  await reject(async () => cappedRelease(1n))
  // A new window measures its share against the escrow at its start.
  await provider.send('evm_increaseTime', [86_400])
  await provider.send('evm_mine', [])
  const escrow = await capped.locked(token.target)
  assert.equal(escrow, 1_700_000n)
  assert.equal((await capped.releasableToday(token.target))[0], 340_000n)
  await done(cappedRelease(340_000n))
  await reject(async () => cappedRelease(1n))
  await reject(async () => capped.setDailyReleaseBps(0))
  await reject(async () => capped.setDailyReleaseBps(10_001))
  await reject(async () => capped.connect(other).setDailyReleaseBps(5_000))
  await done(capped.setDailyReleaseBps(5_000))
  assert.equal((await capped.releasableToday(token.target))[0], 850_000n - 340_000n)

  // Escrow equals mirror supply per asset (after the smart account's unreleased burn is paid).
  const pendingBurn = 5_000_000n
  assert.equal((await vault.locked(token.target)) - pendingBurn - 1n, (await usd.totalSupply()) / 10n ** 12n)
  assert.equal(await vault.locked(NATIVE), await ether.totalSupply())
  assert.equal(await provider.getBalance(vault.target), await vault.locked(NATIVE))

  console.log(`PASS: flat native fees (deposit in the source coin, burn in LYX, free claims and releases, refunds, caps, withdrawals), amounts cross unchanged, signed claims (mirror + LSP4 icon in the first claim, ${creation.gasUsed} gas), authorization-free burn, signed release, daily release caps (share of escrow, floor, window reset), forged/altered/replayed signatures refused, escrow-bounded releases, permit, Permit2, native round trip, bytes32 metadata, smart accounts, taxed/invalid tokens, guardian pause, escrow = supply`)
  console.log(`Runtime sizes: ${Object.entries(sizes).filter(([name]) => !name.startsWith('Mock')).map(([name, size]) => `${name} ${size}`).join(', ')}`)
} finally {
  await transport.disconnect()
}
