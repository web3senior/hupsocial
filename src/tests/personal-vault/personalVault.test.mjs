import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { after, before, test } from 'node:test'
import { createPublicClient, createWalletClient, decodeFunctionData, encodeFunctionData, erc20Abi, http, keccak256, parseEther, zeroAddress } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import safeArtifact from '@safe-global/safe-contracts/build/artifacts/contracts/SafeL2.sol/SafeL2.json'
import proxyArtifact from '@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxy.sol/SafeProxy.json'
import factoryArtifact from '@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json'
import tokenArtifact from '@safe-global/safe-contracts/build/artifacts/contracts/test/ERC20Token.sol/ERC20Token.json'
import safe130 from 'safe-contracts-v130/build/artifacts/contracts/GnosisSafeL2.sol/GnosisSafeL2.json'
import proxy130 from 'safe-contracts-v130/build/artifacts/contracts/proxies/GnosisSafeProxy.sol/GnosisSafeProxy.json'
import factory130 from 'safe-contracts-v130/build/artifacts/contracts/proxies/GnosisSafeProxyFactory.sol/GnosisSafeProxyFactory.json'
import { personalVaultDeployment } from '@/lib/personalVaultDeployments'
import { approvalSignatures, factoryAbi, factoryAbiFor, historyEventsFor, normalizeProposal, proposalStatus, readToken, readVault, receiptEvent, safeAbi, safeAbiFor, simulateTransfer, transactionArgs, transferCall, vaultSetup, verifyDeployment } from '@/lib/personalVault'

const accounts = Array.from({ length: 5 }, (_, addressIndex) => mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex }))
let node
let client
let wallets
let deployment
let vault
const deployments = {}

before(async () => {
  const listener = createServer()
  await new Promise((done) => listener.listen(0, '127.0.0.1', done))
  const port = listener.address().port
  await new Promise((done) => listener.close(done))
  const bin = process.env.ANVIL_BIN || resolve('node_modules/@foundry-rs/anvil-win32-amd64/bin/anvil.exe')
  node = spawn(bin, ['--port', String(port), '--silent', '--chain-id', String(foundry.id)], { windowsHide: true, stdio: 'ignore' })
  let spawnError
  node.on('error', (error) => { spawnError = error })
  const transport = http(`http://127.0.0.1:${port}`, { retryCount: 0 })
  client = createPublicClient({ chain: foundry, transport, pollingInterval: 20 })
  wallets = accounts.map((account) => createWalletClient({ account, chain: foundry, transport }))
  for (let attempt = 0; ; attempt++) {
    if (spawnError) throw spawnError
    try { await client.getBlockNumber(); break } catch (error) {
      if (attempt === 40) throw error
      await new Promise((done) => setTimeout(done, 100))
    }
  }
  const deploy = async (artifact) => {
    const hash = await wallets[0].deployContract({ abi: artifact.abi, bytecode: artifact.bytecode })
    return (await client.waitForTransactionReceipt({ hash })).contractAddress
  }
  for (const [version, safe, factoryCode, proxy] of [['1.4.1', safeArtifact, factoryArtifact, proxyArtifact], ['1.3.0', safe130, factory130, proxy130]]) {
    const singleton = await deploy(safe)
    const factory = await deploy(factoryCode)
    deployments[version] = {
      version,
      singleton: { address: singleton, codeHash: keccak256(await client.getCode({ address: singleton })) },
      factory: { address: factory, codeHash: keccak256(await client.getCode({ address: factory })) },
      proxyCodeHash: keccak256(proxy.deployedBytecode),
    }
  }
})

after(() => { node?.kill() })

async function write(wallet, address, abi, functionName, args) {
  const hash = await wallet.writeContract({ address, abi, functionName, args })
  const receipt = await client.waitForTransactionReceipt({ hash })
  assert.equal(receipt.status, 'success')
  return receipt
}

async function create(owners, salt) {
  const setup = vaultSetup(owners, 2, accounts[0].address)
  const receipt = await write(wallets[0], deployment.factory.address, factoryAbi, 'createProxyWithNonce', [deployment.singleton.address, setup.initializer, salt])
  return receiptEvent(receipt, deployment.factory.address, factoryAbiFor(deployment), 'ProxyCreation').proxy
}

function proposal(overrides = {}) {
  return normalizeProposal({ version: 1, chainId: foundry.id, vault, kind: 'native', token: zeroAddress, recipient: accounts[4].address, amount: parseEther('1').toString(), nonce: '0', ...overrides }, foundry.id, vault)
}

test('rejects duplicate owners, invalid thresholds, and a missing connected signer', () => {
  const owners = accounts.slice(0, 3).map((account) => account.address)
  assert.throws(() => vaultSetup([owners[0], owners[0]], 2, owners[0]), /different/)
  assert.throws(() => vaultSetup(owners, 1, owners[0]), /at least 2/)
  assert.throws(() => vaultSetup(owners, 4, owners[0]), /at least 2/)
  assert.throws(() => vaultSetup(owners, 2, accounts[4].address), /Include/)
})

test('registry selects Safe 1.3.0 for LUKSO and prefers 1.4.1 where available', () => {
  assert.equal(personalVaultDeployment(42).version, '1.3.0')
  assert.equal(personalVaultDeployment(84532).version, '1.4.1')
  assert.equal(personalVaultDeployment(-1), null)
  assert.equal(personalVaultDeployment(42).proxyCodeHash, keccak256(proxy130.deployedBytecode))
})

for (const version of ['1.4.1', '1.3.0']) test(`Safe ${version} enforces approvals, execution, replay protection and contract owners`, async (t) => {
  deployment = deployments[version]
  vault = await create(accounts.slice(0, 3).map((account) => account.address), 1n)
  await t.test('verifies proxy, singleton and deployment bytecode', async () => {
    const state = await readVault(client, vault, deployment)
    assert.equal(state.threshold, 2)
    assert.equal(state.owners.length, 3)
    await assert.rejects(() => readVault(client, accounts[0].address, deployment), /not a supported/)
    await assert.rejects(() => verifyDeployment(client, { ...deployment, singleton: { ...deployment.singleton, codeHash: `0x${'00'.repeat(32)}` } }), /verification failed/)
  })
  const receipt = await client.waitForTransactionReceipt({ hash: await wallets[0].sendTransaction({ to: vault, value: parseEther('3') }) })
  assert.equal(receiptEvent(receipt, vault, safeAbi, 'SafeReceived').value, parseEther('3'))
  const p = proposal()
  let snapshot = await readVault(client, vault, deployment)
  let status = await proposalStatus(client, p, snapshot)
  await write(wallets[0], vault, safeAbi, 'approveHash', [status.hash])
  await t.test('one approval cannot spend from a 2-of-3 vault', async () => {
    await assert.rejects(() => client.simulateContract({ account: accounts[4], address: vault, abi: safeAbi, functionName: 'execTransaction', args: [...transactionArgs(p), approvalSignatures([accounts[0].address])] }))
    await assert.rejects(() => client.simulateContract({ account: accounts[4], address: vault, abi: safeAbi, functionName: 'approveHash', args: [status.hash] }))
  })
  await write(wallets[1], vault, safeAbi, 'approveHash', [status.hash])
  await t.test('two approvals execute and an old proposal cannot replay', async () => {
    status = await proposalStatus(client, p, snapshot)
    const beforeBalance = await client.getBalance({ address: accounts[4].address })
    const executed = await write(wallets[0], vault, safeAbi, 'execTransaction', [...transactionArgs(p), approvalSignatures(status.approvals.filter((entry) => entry.approved).map((entry) => entry.owner).reverse())])
    assert.ok(receiptEvent(executed, vault, safeAbiFor(deployment), 'ExecutionSuccess'))
    const logs = await client.getLogs({ address: vault, events: historyEventsFor(deployment), fromBlock: executed.blockNumber, toBlock: executed.blockNumber })
    assert.ok(logs.some((log) => log.eventName === 'ExecutionSuccess' && log.args.txHash === status.hash))
    assert.equal(await client.getBalance({ address: accounts[4].address }), beforeBalance + parseEther('1'))
    snapshot = await readVault(client, vault, deployment)
    const pinned = await readVault(client, vault, deployment, { blockNumber: receipt.blockNumber })
    assert.equal(pinned.balance, parseEther('3'))
    assert.equal(pinned.nonce, 0n)
    await assert.rejects(() => proposalStatus(client, p, snapshot), /stale/)
    await assert.rejects(() => client.simulateContract({ account: accounts[4], address: vault, abi: safeAbi, functionName: 'execTransaction', args: [...transactionArgs(p), approvalSignatures([accounts[0].address, accounts[1].address])] }))
  })
  await t.test('shared proposals cannot change network, vault or transfer type', () => {
    assert.throws(() => normalizeProposal({ ...p, chainId: 1 }, foundry.id, vault), /different/)
    assert.throws(() => normalizeProposal({ ...p, vault: accounts[0].address }, foundry.id, vault), /different/)
    assert.throws(() => normalizeProposal({ ...p, kind: 'delegatecall' }, foundry.id, vault), /Unsupported/)
    assert.throws(() => proposal({ amount: '-1' }), /Invalid/)
    assert.throws(() => proposal({ amount: '0' }), /Invalid/)
    assert.throws(() => proposal({ amount: (2n ** 256n).toString() }), /Invalid/)
    assert.throws(() => proposal({ recipient: vault }), /other than/)
    assert.equal(transferCall({ ...p, data: '0xdeadbeef', operation: 1 }).data, '0x')
  })
  await t.test('standard ERC20 balance, preflight and execution use real OpenZeppelin token code', async () => {
    const deployed = await client.waitForTransactionReceipt({ hash: await wallets[0].deployContract({ abi: tokenArtifact.abi, bytecode: tokenArtifact.bytecode }) })
    const token = deployed.contractAddress
    await write(wallets[0], token, erc20Abi, 'transfer', [vault, 1000n])
    assert.equal((await readToken(client, token, vault)).balance, 1000n)
    const transfer = proposal({ kind: 'erc20', token, amount: '200', nonce: '1' })
    await simulateTransfer(client, transfer)
    const state = await proposalStatus(client, transfer, await readVault(client, vault, deployment))
    for (const wallet of wallets.slice(0, 2)) await write(wallet, vault, safeAbi, 'approveHash', [state.hash])
    await write(wallets[0], vault, safeAbi, 'execTransaction', [...transactionArgs(transfer), approvalSignatures(accounts.slice(0, 2).map((account) => account.address))])
    assert.equal(await client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [accounts[4].address] }), 200n)
  })
  await t.test('a contract signer approves as itself through execute', async () => {
    const contractOwner = await create([accounts[0].address, accounts[1].address], 2n)
    const target = await create([accounts[0].address, contractOwner, accounts[2].address], 3n)
    const targetProposal = normalizeProposal({ ...p, vault: target }, foundry.id, target)
    const state = await proposalStatus(client, targetProposal, await readVault(client, target, deployment))
    const data = encodeFunctionData({ abi: safeAbi, functionName: 'approveHash', args: [state.hash] })
    const args = [target, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress]
    const hash = await client.readContract({ address: contractOwner, abi: safeAbi, functionName: 'getTransactionHash', args: [...args, 0n] })
    for (const wallet of wallets.slice(0, 2)) await write(wallet, contractOwner, safeAbi, 'approveHash', [hash])
    await write(wallets[0], contractOwner, safeAbi, 'execTransaction', [...args, approvalSignatures(accounts.slice(0, 2).map((account) => account.address))])
    const updated = await proposalStatus(client, targetProposal, await readVault(client, target, deployment))
    assert.equal(updated.approvals.find((entry) => entry.owner.toLowerCase() === contractOwner.toLowerCase()).approved, true)
  })
  await t.test('LSP7 calldata attributes the transfer to the vault', () => {
    const transfer = proposal({ kind: 'lsp7', token: accounts[3].address, amount: '2' })
    const call = transferCall(transfer)
    const decoded = decodeFunctionData({ abi: [{ type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'bool' }, { type: 'bytes' }], outputs: [] }], data: call.data })
    assert.equal(decoded.args[0].toLowerCase(), vault.toLowerCase())
    assert.equal(decoded.args[1].toLowerCase(), accounts[4].address.toLowerCase())
    assert.equal(decoded.args[3], true)
  })
})
