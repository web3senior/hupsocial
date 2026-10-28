'use client'

import { useRef, useState, useSyncExternalStore } from 'react'
import { useConfig } from 'wagmi'
import { getCapabilities, getConnection, signTypedData, switchChain } from 'wagmi/actions'
import useSWR from 'swr'
import clsx from 'clsx'
import { createPublicClient, decodeEventLog, domainSeparator, encodeAbiParameters, formatEther, formatUnits, isAddress, isHash, keccak256, maxUint256, parseEther, parseSignature, parseUnits, toHex, zeroAddress } from 'viem'
import { ArrowsDownUpIcon, BridgeIcon, GearIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { Spinner } from '@/components/Loading'
import DetailSection from '@/components/ui/DetailSection'
import EmptyState from '@/components/ui/EmptyState'
import OptionPicker from '@/components/ui/OptionPicker'
import StatusBadge from '@/components/ui/StatusBadge'
import TextField from '@/components/ui/TextField'
import ToggleSwitch from '@/components/ui/ToggleSwitch'
import TokenIcon from '@/components/ui/TokenIcon'
import { browserTransport } from '@/config/wagmi'
import { assetAbi, BRIDGE_DESTINATION as lukso, BRIDGE_SOURCES, BRIDGE_TOKENS, LUKSO_BRIDGE, luksoBridgeAbi, NATIVE_TOKEN, PERMIT2, vaultAbi } from '@/config/hupBridge'
import { openConnect } from '@/lib/connectDialog'
import { useEvmWallet } from '@/hooks/launchpad/useEvmWallet'
import { useSendTx } from '@/hooks/launchpad/useSendTx'
import { addPending, clearPending, parsePending, pendingServerSnapshot, pendingSnapshot, subscribePending } from './pendingTransfers'
import TransferRow from './TransferRow'
import BridgeAnimation from './BridgeAnimation'
import styles from './BridgePanel.module.scss'

const same = (left, right) => Boolean(left && right) && left.toLowerCase() === right.toLowerCase()
const validAddress = (value) => isAddress(value || '') && !same(value, zeroAddress)
const message = (error) => error?.shortMessage || error?.message || 'The request failed.'
// DAI-style permit(holder, spender, nonce, expiry, allowed) is not EIP-2612
const DAI_PERMIT_TYPEHASH = keccak256(toHex('Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)'))
const PERMIT_TYPES = { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] }
const PERMIT2_TYPES = {
  PermitTransferFrom: [{ name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
  TokenPermissions: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }],
}
const PLAN_LABELS = {
  native: 'One transaction, then a claim on LUKSO',
  direct: 'One transaction, then a claim on LUKSO',
  permit: 'One signature and one transaction, then a claim on LUKSO',
  batch: 'One confirmation, then a claim on LUKSO',
  permit2: 'One signature and one transaction, then a claim on LUKSO',
  approve: 'Approve and lock, then a claim on LUKSO',
  withdraw: 'One LUKSO transaction, then a release on the source chain',
}
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 3600)
const randomNonce = () => BigInt(toHex(crypto.getRandomValues(new Uint8Array(30))))
const clients = new Map()
const clientFor = (chain) => {
  if (!clients.has(chain.id)) clients.set(chain.id, createPublicClient({ chain, transport: browserTransport(chain.id) }))
  return clients.get(chain.id)
}

async function inspectRoute({ chain, vault }) {
  const source = clientFor(chain)
  const destination = clientFor(lukso)
  const read = (client, address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args })
  const [vaultVersion, bridgeVersion] = await Promise.all([
    read(source, vault, vaultAbi, 'bridgeVersion').catch(() => 0n),
    read(destination, LUKSO_BRIDGE, luksoBridgeAbi, 'bridgeVersion').catch(() => 0n),
  ])
  if (vaultVersion !== 1n || bridgeVersion !== 1n) return { compatible: false }
  const [releaseBps, bridgeFee, maxBridgeFee, vaultFees, burnFee, maxBurnFee, bridgeFees, vaultPaused, bridgePaused, vaultOwner, bridgeOwner, openVault] = await Promise.all([
    read(source, vault, vaultAbi, 'dailyReleaseBps'),
    read(source, vault, vaultAbi, 'bridgeFee'),
    read(source, vault, vaultAbi, 'maxBridgeFee'),
    read(source, vault, vaultAbi, 'feesAccrued'),
    read(destination, LUKSO_BRIDGE, luksoBridgeAbi, 'burnFee'),
    read(destination, LUKSO_BRIDGE, luksoBridgeAbi, 'maxBurnFee'),
    read(destination, LUKSO_BRIDGE, luksoBridgeAbi, 'feesAccrued'),
    read(source, vault, vaultAbi, 'paused'),
    read(destination, LUKSO_BRIDGE, luksoBridgeAbi, 'paused'),
    read(source, vault, vaultAbi, 'owner'),
    read(destination, LUKSO_BRIDGE, luksoBridgeAbi, 'owner'),
    read(destination, LUKSO_BRIDGE, luksoBridgeAbi, 'vaultOf', [BigInt(chain.id)]),
  ])
  return { compatible: true, releaseBps: Number(releaseBps), bridgeFee, maxBridgeFee, vaultFees, burnFee, maxBurnFee, bridgeFees, vaultPaused, bridgePaused, vaultOwner, bridgeOwner, open: same(openVault, vault) }
}

/** The EIP-712 domain of an EIP-2612 token, found by matching its onchain DOMAIN_SEPARATOR. Null when unsupported. */
async function detectPermit(client, token, chainId, wallet) {
  try {
    const read = (functionName, args = []) => client.readContract({ address: token, abi: assetAbi, functionName, args })
    const [separator, nonce, typehash] = await Promise.all([read('DOMAIN_SEPARATOR'), read('nonces', [wallet]), read('PERMIT_TYPEHASH').catch(() => null)])
    if (typehash && same(typehash, DAI_PERMIT_TYPEHASH)) return null
    const [named, name, version] = await Promise.all([read('eip712Domain').catch(() => null), read('name'), read('version').catch(() => null)])
    const candidates = [named && { name: named[1], version: named[2] }, ...[version, '1', '2'].filter(Boolean).map((item) => ({ name, version: item }))].filter(Boolean)
    for (const candidate of candidates) {
      const domain = { ...candidate, chainId, verifyingContract: token }
      if (same(domainSeparator({ domain }), separator)) return { domain, nonce }
    }
  } catch { /* Not an EIP-2612 token. */ }
  return null
}

async function inspectToken({ chain, vault }, token, wallet) {
  const source = clientFor(chain)
  const destination = clientFor(lukso)
  const native = same(token, NATIVE_TOKEN)
  const [metadata, mirror, predicted, releaseFloor] = await Promise.all([
    source.readContract({ address: vault, abi: vaultAbi, functionName: 'metadataOf', args: [token] }).catch(() => {
      throw new Error('This token is not supported: it needs a standard name, symbol and decimals (at most 18).')
    }),
    destination.readContract({ address: LUKSO_BRIDGE, abi: luksoBridgeAbi, functionName: 'mirrors', args: [BigInt(chain.id), token] }),
    destination.readContract({ address: LUKSO_BRIDGE, abi: luksoBridgeAbi, functionName: 'predictMirror', args: [BigInt(chain.id), token] }),
    source.readContract({ address: vault, abi: vaultAbi, functionName: 'dailyReleaseFloor', args: [token] }),
  ])
  const [decimals, name, symbol] = metadata
  const created = validAddress(mirror[0])
  const info = { native, decimals, name, symbol, created, releaseFloor, mirror: created ? mirror[0] : predicted, scale: 10n ** BigInt(18 - decimals), sourceBalance: 0n, mirrorBalance: 0n, allowance: 0n, permit2Allowance: 0n, permit: null }
  if (!wallet) return info
  const balanceOf = (client, address) => client.readContract({ address, abi: assetAbi, functionName: 'balanceOf', args: [wallet] })
  const allowance = (spender) => source.readContract({ address: token, abi: assetAbi, functionName: 'allowance', args: [wallet, spender] })
  const [sourceBalance, mirrorBalance, vaultAllowance, permit2Allowance, permit] = await Promise.all([
    native ? source.getBalance({ address: wallet }) : balanceOf(source, token),
    created ? balanceOf(destination, info.mirror) : 0n,
    native ? 0n : allowance(vault),
    native ? 0n : allowance(PERMIT2).catch(() => 0n),
    native ? null : detectPermit(source, token, chain.id, wallet),
  ])
  return { ...info, sourceBalance, mirrorBalance, allowance: vaultAllowance, permit2Allowance, permit }
}

/** For each source token: whether it has a LUKSO mirror yet, and the wallet's mirror balance (18 decimals). */
async function readHoldings({ id }, tokens, wallet) {
  const destination = clientFor(lukso)
  const entries = await Promise.all(tokens.map(async (token) => {
    const [mirror] = await destination.readContract({ address: LUKSO_BRIDGE, abi: luksoBridgeAbi, functionName: 'mirrors', args: [BigInt(id), token] })
    const created = validAddress(mirror)
    const balance = created && wallet ? await destination.readContract({ address: mirror, abi: assetAbi, functionName: 'balanceOf', args: [wallet] }) : 0n
    return [token.toLowerCase(), { created, balance }]
  }))
  return Object.fromEntries(entries)
}

/** The fewest wallet prompts this deposit can be done in. */
function planDeposit(info, units, batchable) {
  if (info.native) return 'native'
  if (info.allowance >= units) return 'direct'
  if (info.permit) return 'permit'
  if (batchable) return 'batch'
  if (info.permit2Allowance >= units) return 'permit2'
  return 'approve'
}

/** One fee the owner sets and collects: shows it, its onchain cap, and what has been collected. */
function FeeControls({ title, symbol, fee, max, collected, busy, paused, pauseLabel, onSet, onWithdraw, onPause }) {
  const [draft, setDraft] = useState('')
  const value = (() => {
    try { return /^\d+(\.\d+)?$/.test(draft.trim()) ? parseEther(draft.trim()) : null } catch { return null }
  })()
  return (
    <>
      <p><strong>{title}:</strong> {formatEther(fee)} {symbol} (cap {formatEther(max)}) · {formatEther(collected)} {symbol} collected</p>
      {collected > 0n && <button type="button" className={styles.submit} disabled={busy} onClick={onWithdraw}>Withdraw {formatEther(collected)} {symbol}</button>}
      <TextField label={`New fee in ${symbol}`} placeholder={formatEther(fee)} value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} hint={value !== null && value > max ? `At most ${formatEther(max)} ${symbol}.` : undefined} />
      <button type="button" className={styles.secondary} disabled={busy || value === null || value > max} onClick={() => onSet(value)}>Set fee</button>
      <button type="button" className={styles.secondary} disabled={busy} onClick={onPause}>{paused ? 'Unpause' : 'Pause'} {pauseLabel}</button>
    </>
  )
}

/** The release safety limit: a share of each token's escrow per day, and a per-token floor. */
function CapControls({ route, info, busy, onShare, onFloor }) {
  const [share, setShare] = useState('')
  const [floor, setFloor] = useState('')
  const bps = /^\d+(\.\d{1,2})?$/.test(share.trim()) ? Math.round(Number(share) * 100) : null
  const floorUnits = (() => {
    try { return info && /^\d+(\.\d+)?$/.test(floor.trim()) ? parseUnits(floor.trim(), info.decimals) : null } catch { return null }
  })()
  return (
    <>
      <p><strong>Daily release limit:</strong> {route.releaseBps / 100}% of each token’s escrow{info ? ` · at least ${formatUnits(info.releaseFloor, info.decimals)} ${info.symbol} a day` : ''}</p>
      <TextField label="Share of escrow per day (%)" placeholder={String(route.releaseBps / 100)} value={share} disabled={busy} onChange={(event) => setShare(event.target.value)} />
      <button type="button" className={styles.secondary} disabled={busy || !bps || bps > 10_000} onClick={() => onShare(bps)}>Set daily share</button>
      {info && <>
        <TextField label={`Always releasable per day (${info.symbol})`} placeholder={formatUnits(info.releaseFloor, info.decimals)} value={floor} disabled={busy} onChange={(event) => setFloor(event.target.value)} />
        <button type="button" className={styles.secondary} disabled={busy || floorUnits === null} onClick={() => onFloor(floorUnits)}>Set {info.symbol} floor</button>
      </>}
    </>
  )
}

export default function BridgePanel() {
  const config = useConfig()
  const { address, isConnected } = useEvmWallet()
  const { send, sendBatch, pending } = useSendTx()
  const lock = useRef(false)
  const [chainId, setChainId] = useState(BRIDGE_SOURCES[0]?.chain.id)
  const [direction, setDirection] = useState('deposit')
  const [token, setToken] = useState(NATIVE_TOKEN)
  const [amount, setAmount] = useState('')
  const [recipientDraft, setRecipient] = useState('')
  const [remember, setRemember] = useState(true)
  const [lookup, setLookup] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const transfers = parsePending(useSyncExternalStore(subscribePending, pendingSnapshot, pendingServerSnapshot))

  const source = BRIDGE_SOURCES.find((item) => item.chain.id === chainId)
  const chain = source?.chain
  const depositing = direction === 'deposit'
  const from = depositing ? chain : lukso
  const to = depositing ? lukso : chain
  const recipient = recipientDraft || address || ''
  const configured = Boolean(source) && validAddress(LUKSO_BRIDGE)

  const { data: route, error: routeError, mutate: refreshRoute } = useSWR(configured ? ['hup-bridge-route', chainId] : null, () => inspectRoute(source), { refreshInterval: 30_000 })
  const routeReady = route?.compatible && route.open && !route.vaultPaused && !route.bridgePaused
  const { data: info, error: tokenError, isLoading: tokenLoading, mutate: refreshToken } = useSWR(routeReady && isAddress(token) ? ['hup-bridge-token', chainId, token, address] : null, () => inspectToken(source, token, address), { refreshInterval: 15_000 })
  const { data: batchable } = useSWR(isConnected && chain ? ['hup-bridge-atomic', address, chainId] : null, async () => {
    try {
      const capabilities = await getCapabilities(config, { account: address, chainId })
      return ['supported', 'ready'].includes(capabilities?.atomic?.status)
    } catch { return false }
  })

  // Parsed in source-token units; null while the input is incomplete.
  const units = (() => {
    if (!info || !/^\d+(\.\d+)?$/.test(amount.trim())) return null
    if ((amount.trim().split('.')[1] || '').length > info.decimals) return null
    const value = parseUnits(amount.trim(), info.decimals)
    return value > 0n ? value : null
  })()
  // The flat Hup fee, in the native coin of the chain the user sends from
  const fee = route?.compatible ? (depositing ? route.bridgeFee : route.burnFee) : 0n
  const plan = !info || !units ? null : depositing ? planDeposit(info, units, batchable) : 'withdraw'
  const available = !info ? 0n : depositing ? info.sourceBalance : info.mirrorBalance / info.scale
  const busyNow = busy || Boolean(pending)

  function pickToken(value) {
    setToken(value)
    setAmount('')
    setError('')
  }

  async function run(action) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try { await action() } catch (err) { setError(message(err)) } finally { lock.current = false; setBusy(false) }
  }

  async function bridge() {
    const wallet = address
    const checkWallet = () => {
      if (!same(getConnection(config).address, wallet)) throw new Error('Your wallet changed. Review the transfer again.')
    }
    const current = await inspectToken(source, token, wallet)
    if (!routeReady) throw new Error('This route is not open yet.')
    if (!validAddress(recipient)) throw new Error('Enter a valid recipient address.')
    if (!units) throw new Error(`Enter a positive amount with at most ${current.decimals} decimal places.`)
    if (units > (depositing ? current.sourceBalance : current.mirrorBalance / current.scale)) throw new Error('The amount exceeds your balance.')
    // Read fresh: the owner can change it, and the contract refuses anything below it.
    const freshRoute = await inspectRoute(source)
    const freshFee = depositing ? freshRoute.bridgeFee : freshRoute.burnFee
    if (freshFee > fee) { await refreshRoute(); throw new Error('The Hup fee changed. Review it and try again.') }
    if (depositing && current.native && units + freshFee > current.sourceBalance) throw new Error(`The amount plus the Hup fee exceeds your ${chain.nativeCurrency.symbol} balance.`)
    checkWallet()

    const label = `${depositing ? 'Bridge' : 'Withdraw'} ${current.symbol}`
    const remembered = { kind: depositing ? 'deposit' : 'burn', chainId, symbol: current.symbol, amount: amount.trim() }
    if (!depositing) {
      const receipt = await send({ account: wallet, chainId: lukso.id, label, address: LUKSO_BRIDGE, abi: luksoBridgeAbi, functionName: 'burn', args: [BigInt(chainId), token, recipient, units], value: freshFee })
      addPending({ ...remembered, txHash: receipt.transactionHash })
      setAmount('')
      await refreshToken()
      return
    }

    // Every deposit pays the fee as msg.value; a native deposit adds the amount on top.
    const tx = (functionName, args, value = freshFee) => ({ account: wallet, chainId: chain.id, address: source.vault, abi: vaultAbi, functionName, args, value })
    const approval = (amountValue) => ({ account: wallet, chainId: chain.id, address: token, abi: assetAbi, functionName: 'approve', args: [source.vault, amountValue] })
    const approveAmount = remember ? maxUint256 : units
    const signOnChain = async (request) => {
      if (getConnection(config).chainId !== chain.id) await switchChain(config, { chainId: chain.id })
      checkWallet()
      return signTypedData(config, { account: wallet, ...request })
    }
    // USDT-style tokens refuse to change a non-zero allowance; only then reset it first.
    const needsReset = async () => {
      if (current.allowance === 0n) return false
      try {
        await clientFor(chain).simulateContract(approval(approveAmount))
        return false
      } catch { return true }
    }

    const strategy = planDeposit(current, units, batchable)
    let receipt
    if (strategy === 'native') {
      receipt = await send({ ...tx('depositNative', [recipient, units], units + freshFee), label })
    } else if (strategy === 'direct') {
      receipt = await send({ ...tx('deposit', [token, recipient, units]), label })
    } else if (strategy === 'permit') {
      const permitValue = remember ? maxUint256 : units
      const expiry = deadline()
      const signature = await signOnChain({ domain: current.permit.domain, types: PERMIT_TYPES, primaryType: 'Permit', message: { owner: wallet, spender: source.vault, value: permitValue, nonce: current.permit.nonce, deadline: expiry } })
      const { r, s, v, yParity } = parseSignature(signature)
      const permitData = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'bytes32' }, { type: 'bytes32' }], [permitValue, expiry, v === undefined ? yParity + 27 : Number(v), r, s])
      checkWallet()
      receipt = await send({ ...tx('depositWithPermit', [token, recipient, units, permitData]), label })
    } else if (strategy === 'batch') {
      const reset = await needsReset()
      const call = ({ address: target, abi, functionName, args, value }) => ({ to: target, abi, functionName, args, value })
      const calls = [...(reset ? [call(approval(0n))] : []), call(approval(approveAmount)), call(tx('deposit', [token, recipient, units]))]
      receipt = await sendBatch({ chainId: chain.id, label, calls })
    } else if (strategy === 'permit2') {
      const expiry = deadline()
      const nonce = randomNonce()
      const signature = await signOnChain({ domain: { name: 'Permit2', chainId: chain.id, verifyingContract: PERMIT2 }, types: PERMIT2_TYPES, primaryType: 'PermitTransferFrom', message: { permitted: { token, amount: units }, spender: source.vault, nonce, deadline: expiry } })
      const permitData = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }], [nonce, expiry, signature])
      checkWallet()
      receipt = await send({ ...tx('depositWithPermit2', [token, recipient, units, permitData]), label })
    } else {
      if (await needsReset()) { await send({ ...approval(0n), label: 'Reset approval' }); checkWallet() }
      await send({ ...approval(approveAmount), label: `Approve ${current.symbol}` })
      checkWallet()
      receipt = await send({ ...tx('deposit', [token, recipient, units]), label })
    }

    const deposited = receipt.logs.filter((log) => same(log.address, source.vault)).some((log) => {
      try { return decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics }).eventName === 'Deposited' } catch { return false }
    })
    if (!deposited) throw new Error(`Transaction confirmed, but its deposit could not be read. Resume it below with ${receipt.transactionHash}.`)
    addPending({ ...remembered, txHash: receipt.transactionHash })
    setAmount('')
    await refreshToken()
  }

  function resume() {
    const hash = lookup.trim()
    if (!isHash(hash)) { setError('Paste a transaction hash (0x… 66 characters).'); return }
    // A hash alone cannot say which chain it is on: a deposit is looked up on the chain picked above.
    addPending({ kind: depositing ? 'deposit' : 'burn', chainId, symbol: info?.symbol || '', amount: '', txHash: hash })
    setLookup('')
  }

  async function adminWrite(side, functionName, args) {
    await send({ account: address, chainId: side === 'source' ? chain.id : lukso.id, label: 'Configure the bridge', address: side === 'source' ? source.vault : LUKSO_BRIDGE, abi: side === 'source' ? vaultAbi : luksoBridgeAbi, functionName, args })
    await Promise.all([refreshRoute(), refreshToken()])
  }

  const quickPicks = chain ? [{ symbol: chain.nativeCurrency.symbol, address: NATIVE_TOKEN, logo: chain.iconUrl }, ...(BRIDGE_TOKENS[chain.id] || [])] : []
  const pickedQuick = quickPicks.some((item) => same(item.address, token))
  const showRemember = depositing && plan && ['permit', 'batch', 'approve'].includes(plan)
  const luksoBadge = { url: lukso.iconUrl, label: 'On LUKSO' }
  const chainArt = (item) => item.iconUrl ? <img src={item.iconUrl} alt="" /> : <span className={styles.chainInitial}>{item.name.charAt(0)}</span>
  const chainOptions = BRIDGE_SOURCES.map((item) => ({ value: String(item.chain.id), label: item.chain.name, icon: chainArt(item.chain) }))
  const customToken = !pickedQuick && info ? { address: token, symbol: info.symbol } : null
  // Going back, what leaves LUKSO is the bridged LSP7, so the picker shows those: badged, with what
  // the wallet holds, and unbridged tokens greyed out.
  const { data: holdings } = useSWR(!depositing && routeReady && chain ? ['hup-bridge-holdings', chainId, address, quickPicks.map((item) => item.address).join()] : null, () => readHoldings(chain, quickPicks.map((item) => item.address), address))
  const badge = depositing ? undefined : luksoBadge
  const tokenOptions = [
    ...quickPicks.map((item) => {
      const held = holdings?.[item.address.toLowerCase()]
      return {
        value: item.address,
        label: item.symbol,
        icon: <TokenIcon token={item} chainId={chainId} size="sm" badge={badge} />,
        note: !depositing && held?.created ? `Bridged from ${chain.name}${address ? ` · you hold ${formatEther(held.balance)}` : ''}` : undefined,
        disabled: !depositing && Boolean(holdings) && !held?.created,
        disabledNote: 'Not bridged to LUKSO yet',
      }
    }),
    {
      value: 'custom',
      label: customToken ? customToken.symbol : 'Other token',
      note: depositing ? `Paste any ERC20 address on ${chain?.name}` : `Paste the ${chain?.name} address of a token you bridged`,
      icon: customToken ? <TokenIcon token={customToken} chainId={chainId} size="sm" badge={badge} /> : <MagnifyingGlassIcon size={16} />,
    },
  ]
  const chainControl = (
    <div className={styles.slot}>
      <OptionPicker ariaLabel={depositing ? 'Source chain' : 'Destination chain'} value={String(chainId)} options={chainOptions} triggerClassName={styles.picker} panelClassName={styles.pickerPanel} placement="bottom-end"
        onChange={(value) => { setChainId(Number(value)); pickToken(NATIVE_TOKEN) }} />
    </div>
  )
  const luksoPill = <span className={styles.chainPill}>{chainArt(lukso)}{lukso.name}</span>
  const canMax = info && address && !(depositing && info.native) && available > 0n
  const status = !route ? null : !route.compatible ? 'These addresses are not Hup bridge contracts.' : route.vaultPaused || route.bridgePaused ? 'The bridge is paused.' : !route.open ? `${chain.name} is not open on the LUKSO side yet.` : null
  const receivedToken = info && (info.native ? { logo: chain.iconUrl, symbol: info.symbol } : { address: token, symbol: info.symbol })
  const received = units ? formatUnits(units, info.decimals) : '0'
  const feeLabel = route?.compatible ? `${formatEther(fee)} ${from.nativeCurrency.symbol}` : '—'

  return (
    <div className={`${styles.page} animate fade`}>
      <div className={`__container ${styles.page__container}`} data-width="small">
        <header className={styles.hero}>
          <div className={styles.hero__row}>
            <h1 className={styles.hero__title}>Bridge to LUKSO</h1>
            <StatusBadge tone="review">Beta</StatusBadge>
          </div>
          <p className={styles.hero__body}>Bring any ERC20, or your chain’s native coin, to LUKSO as an LSP7 your Universal Profile can hold, and take it back whenever you like.</p>
          <BridgeAnimation />
          <ol className={styles.steps}>
            <li><strong>Lock</strong><span>Your tokens are locked in the Hup vault on their chain.</span></li>
            <li><strong>Attest</strong><span>Hup checks the lock onchain and signs a receipt. It never holds your funds.</span></li>
            <li><strong>Claim</strong><span>You claim the LSP7 on LUKSO, backed 1:1. Burn it to unlock the original.</span></li>
          </ol>
        </header>

        {!configured ? <EmptyState icon={BridgeIcon}>The bridge is not live yet. Its contracts have not been deployed and configured.</EmptyState> : <>
          <form className={styles.bridge} aria-label="Bridge" onSubmit={(event) => { event.preventDefault(); run(bridge) }}>
            <div className={styles.legs}>
              <div className={styles.leg}>
                <div className={styles.leg__head}>
                  <span className={styles.leg__label}>From</span>
                  {depositing ? chainControl : luksoPill}
                </div>
                <div className={styles.leg__body}>
                  <label className={styles.leg__amount}>
                    <span className="sr-only">Amount</span>
                    <input inputMode="decimal" autoComplete="off" placeholder="0" value={amount} disabled={busyNow} onChange={(event) => { setAmount(event.target.value.replace(',', '.')); setError('') }} />
                  </label>
                  <div className={clsx(styles.slot, styles['slot--token'])}>
                    <OptionPicker ariaLabel="Token" value={pickedQuick ? quickPicks.find((item) => same(item.address, token)).address : 'custom'} options={tokenOptions} triggerClassName={styles.picker} panelClassName={styles.pickerPanel} placement="bottom-end"
                      onChange={(value) => pickToken(value === 'custom' ? '' : value)} />
                  </div>
                </div>
                <div className={styles.leg__foot}>
                  <span>{info && address ? `Balance ${formatUnits(available, info.decimals)} ${info.symbol}` : ' '}</span>
                  {canMax && <button type="button" className={styles.leg__max} disabled={busyNow} onClick={() => setAmount(formatUnits(available, info.decimals))}>Max</button>}
                </div>
              </div>

              <button type="button" className={styles.flip} aria-label="Switch direction" title="Switch direction" disabled={busyNow} onClick={() => { setDirection(depositing ? 'withdraw' : 'deposit'); setAmount(''); setError('') }}>
                <ArrowsDownUpIcon size={18} weight="bold" />
              </button>

              <div className={styles.leg}>
                <div className={styles.leg__head}>
                  <span className={styles.leg__label}>To</span>
                  {depositing ? luksoPill : chainControl}
                </div>
                <div className={styles.leg__body}>
                  <span className={clsx(styles.leg__amount, styles['leg__amount--readonly'])}>{received}</span>
                  {receivedToken && <span className={styles.leg__token}><TokenIcon token={receivedToken} chainId={chainId} size="sm" badge={depositing ? luksoBadge : undefined} />{info.symbol}</span>}
                </div>
              </div>
            </div>

            {!depositing && <p className={styles.footnote}>Sends tokens you bridged from {chain.name} back to it. LYX and LUKSO-native tokens can’t leave LUKSO through this bridge.</p>}
            {!pickedQuick && <TextField label={depositing ? `Token address on ${chain.name}` : `Original token address on ${chain.name}`} placeholder="0x…" value={token} disabled={busyNow} spellCheck={false} onChange={(event) => pickToken(event.target.value.trim())} />}
            <TextField label={`Recipient on ${to.name}`} placeholder={address || '0x…'} value={recipientDraft} disabled={busyNow} spellCheck={false} onChange={(event) => setRecipient(event.target.value.trim())} hint={depositing ? 'Defaults to your connected address. Paste your Universal Profile to receive there.' : `Defaults to your connected address. Use a wallet you control on ${to.name}.`} />

            {status && <p className={styles.notice} role="status">{status}</p>}
            {routeError && <p className={clsx(styles.notice, styles['notice--error'])} role="alert">Could not read the bridge: {message(routeError)}</p>}
            {tokenError && <p className={clsx(styles.notice, styles['notice--error'])} role="alert">{message(tokenError)}</p>}
            {(tokenLoading || (routeReady && !info && !tokenError && isAddress(token))) && <Spinner size={18} label="Checking token" />}

            {info && <dl className={styles.summary}>
              <div className={styles.summary__row}><dt>Hup fee</dt><dd>{feeLabel}</dd></div>
              <div className={styles.summary__row}><dt>You receive</dt><dd>{units ? `${received} ${info.symbol}` : '—'}</dd></div>
              <div className={styles.summary__row}><dt>Wallet steps</dt><dd>{plan ? PLAN_LABELS[plan] : '—'}</dd></div>
              <div className={styles.summary__row}>
                <dt>On LUKSO as</dt>
                <dd>{info.created ? <a href={`${lukso.blockExplorers.default.url}/address/${info.mirror}`} target="_blank" rel="noopener noreferrer">LSP7 {info.mirror.slice(0, 6)}…{info.mirror.slice(-4)}</a> : depositing ? 'Created by your claim' : 'Not bridged yet'}</dd>
              </div>
            </dl>}

            {showRemember && <label className={styles.remember} htmlFor="hup-bridge-remember">
              <span>Skip approval for future {info.symbol} bridges<small>Your next bridge is one transaction</small></span>
              <ToggleSwitch id="hup-bridge-remember" checked={remember} disabled={busyNow} onChange={(event) => setRemember(event.target.checked)} />
            </label>}

            {error && <p className={clsx(styles.notice, styles['notice--error'])} role="alert">{error}</p>}
            {isConnected
              ? <button className={styles.submit} disabled={busyNow || !routeReady || !info || !units} type="submit">{busyNow ? <><Spinner size={16} /> {pending || 'Checking…'}</> : units ? `${depositing ? 'Bridge' : 'Withdraw'} ${info.symbol}` : 'Enter an amount'}</button>
              : <button className={styles.submit} type="button" onClick={() => openConnect()}>Connect wallet</button>}
            {info && !info.native && <p className={styles.footnote}>Name and symbol come from the token contract and do not prove it is authentic.</p>}
          </form>

          {transfers.length > 0 && <section className={styles.transfers} aria-label="Your transfers">
            <div className={styles.transfers__head}>
              <h2 className={styles.transfers__title}>Your transfers</h2>
              <button type="button" className={styles.transfers__clear} title="Remove every transfer from this list. Unfinished ones can be resumed with their transaction hash." onClick={clearPending}>Clear all</button>
            </div>
            <ul className={styles.transfers__list}>
              {[...transfers].reverse().map((item) => <TransferRow key={item.txHash} item={item} address={address} send={send} busy={busyNow} />)}
            </ul>
          </section>}

          <DetailSection title="Resume a transfer" icon={<MagnifyingGlassIcon size={16} />}>
            <div className={styles.admin}>
              <p className={styles.footnote}>Started on another device, or closed the page before claiming? Paste the {depositing ? `${chain.name} deposit` : 'LUKSO withdrawal'} transaction hash. Switch direction above to resume the other kind.</p>
              <TextField label="Transaction hash" placeholder="0x…" value={lookup} spellCheck={false} onChange={(event) => setLookup(event.target.value.trim())} />
              <button type="button" className={styles.secondary} disabled={!lookup} onClick={resume}>Find transfer</button>
            </div>
          </DetailSection>

          {route?.compatible && (same(address, route.vaultOwner) || same(address, route.bridgeOwner)) && <DetailSection title={`Bridge administration · ${chain.name}`} icon={<GearIcon size={16} />}>
            <div className={styles.admin}>
              <p>{route.open ? '✓' : '○'} {chain.name} vault open on the LUKSO side</p>
              {same(address, route.bridgeOwner) && !route.open && <button type="button" className={styles.submit} disabled={busyNow} onClick={() => run(() => adminWrite('lukso', 'setVault', [BigInt(chainId), source.vault]))}>Open {chain.name} on LUKSO</button>}
              {same(address, route.vaultOwner) && <FeeControls
                title={`${chain.name} deposit fee`} symbol={chain.nativeCurrency.symbol} fee={route.bridgeFee} max={route.maxBridgeFee} collected={route.vaultFees} busy={busyNow}
                onSet={(value) => run(() => adminWrite('source', 'setBridgeFee', [value]))}
                onWithdraw={() => run(() => adminWrite('source', 'withdrawFees', [address, route.vaultFees]))}
                onPause={() => run(() => adminWrite('source', route.vaultPaused ? 'unpause' : 'pause', []))} paused={route.vaultPaused} pauseLabel={`the ${chain.name} vault`}
              />}
              {same(address, route.vaultOwner) && <CapControls route={route} info={info} busy={busyNow}
                onShare={(bps) => run(() => adminWrite('source', 'setDailyReleaseBps', [bps]))}
                onFloor={(amount) => run(() => adminWrite('source', 'setDailyReleaseFloor', [token, amount]))}
              />}
              {same(address, route.bridgeOwner) && <FeeControls
                title="LUKSO withdrawal fee" symbol={lukso.nativeCurrency.symbol} fee={route.burnFee} max={route.maxBurnFee} collected={route.bridgeFees} busy={busyNow}
                onSet={(value) => run(() => adminWrite('lukso', 'setBurnFee', [value]))}
                onWithdraw={() => run(() => adminWrite('lukso', 'withdrawFees', [address, route.bridgeFees]))}
                onPause={() => run(() => adminWrite('lukso', route.bridgePaused ? 'unpause' : 'pause', []))} paused={route.bridgePaused} pauseLabel="the LUKSO bridge"
              />}
            </div>
          </DetailSection>}
        </>}

        <p className={styles.footnote}>
          Hup attests each transfer and you submit it, so you pay the gas on each side plus a small flat Hup fee in the native coin when you lock or burn. Amounts cross unchanged, and every LSP7 is backed 1:1 by tokens locked in the Hup vault. Beta: start with a small amount.
        </p>
      </div>
    </div>
  )
}
