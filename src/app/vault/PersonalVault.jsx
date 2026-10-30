'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useConfig, useConnection } from 'wagmi'
import { getPublicClient } from 'wagmi/actions'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import clsx from 'clsx'
import { Rise } from 'cube-motion/react'
import { ArrowUpRightIcon, KeyIcon, ListChecksIcon, PlusIcon, ShieldCheckIcon, WalletIcon } from '@phosphor-icons/react'
import { formatUnits, isAddress, parseUnits, toHex } from 'viem'
import PageTitle from '@/components/PageTitle'
import { WalletConnectDialog } from '@/components/ConnectWallet'
import { Spinner } from '@/components/Loading'
import CopyButton from '@/components/ui/CopyButton'
import TokenIcon from '@/components/ui/TokenIcon'
import useTokenIcon from '@/hooks/useTokenIcon'
import { useClientMounted } from '@/hooks/useClientMount'
import { useVaultTransaction } from '@/hooks/useVaultTransaction'
import { approvalSignatures, factoryAbi, factoryAbiFor, historyEventsFor, normalizeProposal, proposalStatus, readToken, readVault, receiptEvent, safeAbi, safeAbiFor, simulateTransfer, transactionArgs, validAddress, vaultSetup, verifyDeployment } from '@/lib/personalVault'
import styles from './page.module.scss'
import VaultIllustration, { ChainLogo } from './VaultIllustration'
import CreateVaultDialog from './CreateVaultDialog'
import VaultAttribution from './VaultAttribution'
import ImportVaultDialog from './ImportVaultDialog'

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 })
const short = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`
const amountLabel = (value, decimals) => number.format(Number(formatUnits(value, decimals)))
const errorText = (error) => error?.shortMessage || error?.message || 'The request failed.'
const urlFor = (chainId, vault, proposal) => `/vault?${new URLSearchParams({ chain: String(chainId), address: vault, ...(proposal ? { proposal: JSON.stringify(proposal) } : {}) })}`
const vaultRequest = async (url, options) => {
  const response = await fetch(url, { cache: 'no-store', ...options })
  const json = await response.json().catch(() => null)
  if (!response.ok || !json?.success) throw new Error(json?.error || 'Vault records are unavailable. Please retry.')
  return json.data
}
const registerVault = (chainId, address) => vaultRequest('/api/v1/vaults', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chainId, address }) })

export default function PersonalVault({ deployments, initialChain, initialVault, initialProposal }) {
  const config = useConfig()
  const { address } = useConnection()
  const mounted = useClientMounted()
  const router = useRouter()
  const connectRef = useRef(null)
  const createRef = useRef(null)
  const importRef = useRef(null)
  const busyRef = useRef(false)
  const { send, pending } = useVaultTransaction()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [chainId] = useState(Number(initialChain) || config.chains.find((chain) => deployments[chain.id])?.id)
  const [createChainId, setCreateChainId] = useState(null)
  const [importChainId, setImportChainId] = useState(null)
  const [token, setToken] = useState('')
  const [kind, setKind] = useState('native')
  const [proposal, setProposal] = useState(null)
  const chain = config.chains.find((entry) => entry.id === chainId)
  const createChain = config.chains.find((entry) => entry.id === (createChainId ?? chainId))
  const deployment = deployments[chainId]
  const availableChains = config.chains.filter((entry) => deployments[entry.id])
  const defaultModalChainId = deployment ? chainId : availableChains[0]?.id
  const vault = isAddress(initialVault) ? initialVault : null
  const client = chain ? getPublicClient(config, { chainId }) : null
  const blocked = busy || Boolean(pending)
  const myVaults = useSWRInfinite((index, previous) => {
    if (!mounted || !address || (index > 0 && previous?.nextCursor == null)) return null
    return `/api/v1/vaults?wallet=${address}&cursor=${index === 0 ? 0 : previous.nextCursor}`
  }, vaultRequest, { shouldRetryOnError: false, revalidateOnFocus: true })
  const snapshot = useSWR(client && vault && deployment ? ['personal-vault', chainId, vault] : null, () => readVault(client, vault, deployment), { refreshInterval: 15_000, shouldRetryOnError: false })
  const imported = useSWR(initialProposal && vault ? ['personal-vault-import', initialProposal, chainId, vault] : null, () => {
    if (initialProposal.length > 2500) throw new Error('Proposal link is too long.')
    return normalizeProposal(JSON.parse(initialProposal), chainId, vault)
  }, { shouldRetryOnError: false })
  const current = proposal || imported.data
  const status = useSWR(snapshot.data && current ? ['personal-vault-proposal', chainId, vault, JSON.stringify(current), snapshot.data.nonce.toString()] : null, () => proposalStatus(client, current, snapshot.data), { refreshInterval: 10_000, shouldRetryOnError: false })
  const tokenAddress = current?.kind !== 'native' && current ? current.token : token
  const tokenInfo = useSWR(snapshot.data && isAddress(tokenAddress) ? ['personal-vault-token', chainId, vault, tokenAddress] : null, () => readToken(client, tokenAddress, vault), { refreshInterval: 15_000, shouldRetryOnError: false })
  // LSP4 artwork resolves from the token itself; plain ERC20s use TokenIcon's fallback.
  const tokenLogo = useTokenIcon({ chainId, token: tokenAddress, enabled: Boolean(tokenInfo.data && isAddress(tokenAddress)) })
  const isOwner = snapshot.data?.owners.some((owner) => owner.toLowerCase() === address?.toLowerCase())
  const registration = useSWR(snapshot.data && address ? ['personal-vault-registration', address, chainId, vault, snapshot.data.nonce.toString()] : null, async () => {
    const record = await registerVault(chainId, vault)
    await myVaults.mutate().catch(() => null)
    return record
  }, { shouldRetryOnError: false, revalidateOnFocus: false })
  const approved = status.data?.approvals.filter((item) => item.approved) || []
  const mine = status.data?.approvals.find((item) => item.owner.toLowerCase() === address?.toLowerCase())

  const act = async (task) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try { await task() } catch (caught) { setError(errorText(caught)) } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const copy = (text) => act(async () => {
    await navigator.clipboard.writeText(text)
    setMessage('Copied to clipboard.')
  })
  const write = (label, functionName, args) => send({ chainId, account: address, label, address: vault, abi: safeAbi, functionName, args })
  const fresh = async () => {
    const latest = await readVault(client, vault, deployment)
    if (!latest.owners.some((owner) => owner.toLowerCase() === address?.toLowerCase())) throw new Error('Connect one of this vault’s signing wallets.')
    const checked = normalizeProposal(current, chainId, vault)
    return { latest, checked, state: await proposalStatus(client, checked, latest) }
  }

  const create = (event) => {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    act(async () => {
      if (!address) throw new Error('Connect a signing wallet first.')
      const chainId = Number(fields.get('chainId'))
      const deployment = deployments[chainId]
      if (!deployment) throw new Error('Choose a supported vault network.')
      const client = getPublicClient(config, { chainId })
      const setup = vaultSetup(fields.getAll('owners').map((entry) => String(entry).trim()), Number(fields.get('threshold')), address)
      await verifyDeployment(client, deployment)
      const salt = BigInt(toHex(crypto.getRandomValues(new Uint8Array(32))))
      const args = [deployment.singleton.address, setup.initializer, salt]
      await client.simulateContract({ account: address, address: deployment.factory.address, abi: factoryAbi, functionName: 'createProxyWithNonce', args })
      const receipt = await send({ chainId, account: address, label: 'Create personal vault', address: deployment.factory.address, abi: factoryAbi, functionName: 'createProxyWithNonce', args })
      const created = receiptEvent(receipt, deployment.factory.address, factoryAbiFor(deployment), 'ProxyCreation')
      if (!created) throw new Error('Creation confirmed, but the vault address could not be read. Check the transaction before creating another vault.')
      await readVault(client, created.proxy, deployment)
      // A database outage must never turn a confirmed creation into a prompt to deploy again.
      // The opened vault page retries registration and exposes a retry action if needed.
      await registerVault(chainId, created.proxy).catch(() => null)
      createRef.current?.close()
      router.push(urlFor(chainId, created.proxy))
    })
  }

  const importVault = (event) => {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    act(async () => {
      const targetChainId = Number(fields.get('chainId'))
      const targetDeployment = deployments[targetChainId]
      if (!targetDeployment) throw new Error('Choose a supported vault network.')
      const target = validAddress(String(fields.get('address')).trim())
      const targetClient = getPublicClient(config, { chainId: targetChainId })
      await readVault(targetClient, target, targetDeployment)
      await registerVault(targetChainId, target)
      await myVaults.mutate().catch(() => null)
      importRef.current?.close()
      router.push(urlFor(targetChainId, target))
    })
  }

  const propose = (event) => {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    act(async () => {
      const latest = await readVault(client, vault, deployment)
      if (!latest.owners.some((owner) => owner.toLowerCase() === address?.toLowerCase())) throw new Error('Only a signing wallet can propose a transfer.')
      const selected = String(fields.get('kind'))
      const selectedToken = String(fields.get('token') || '').trim()
      const meta = selected === 'native' ? chain.nativeCurrency : await readToken(client, selectedToken, vault)
      const text = String(fields.get('amount')).trim()
      if (!/^\d+(\.\d+)?$/.test(text) || (text.split('.')[1]?.length || 0) > meta.decimals) throw new Error('Enter a positive amount within the asset’s decimal precision.')
      const units = parseUnits(text, meta.decimals)
      if (units > (selected === 'native' ? latest.balance : meta.balance)) throw new Error('The amount exceeds the vault balance.')
      const next = normalizeProposal({ version: 1, chainId, vault, nonce: latest.nonce.toString(), kind: selected, token: selectedToken, recipient: String(fields.get('recipient')).trim(), amount: units.toString() }, chainId, vault)
      await simulateTransfer(client, next)
      setProposal(next)
      setMessage('Proposal prepared. Review it below, then approve and share its link with your other signing wallets.')
      await snapshot.mutate()
    })
  }

  const approve = () => act(async () => {
    const { state } = await fresh()
    if (state.approvals.some((item) => item.owner.toLowerCase() === address?.toLowerCase() && item.approved)) throw new Error('This wallet has already approved.')
    await write('Approve vault transfer', 'approveHash', [state.hash])
    await status.mutate()
  })
  const execute = () => act(async () => {
    const { latest, checked, state } = await fresh()
    const confirmed = state.approvals.filter((item) => item.approved).map((item) => item.owner)
    if (confirmed.length < latest.threshold) throw new Error('More signing wallets must approve this transfer.')
    await simulateTransfer(client, checked)
    const args = [...transactionArgs(checked), approvalSignatures(confirmed.slice(0, latest.threshold))]
    const simulation = await client.simulateContract({ account: address, address: vault, abi: safeAbi, functionName: 'execTransaction', args })
    if (!simulation.result) throw new Error('Transfer simulation failed. Nothing was sent.')
    const receipt = await write('Execute vault transfer', 'execTransaction', args)
    if (!receiptEvent(receipt, vault, safeAbiFor(deployment), 'ExecutionSuccess')) throw new Error('The vault did not report a successful execution. Check the explorer before proposing again.')
    setMessage('Transfer executed. The transaction is available in history.')
    await Promise.all([snapshot.mutate(), status.mutate(), tokenInfo.mutate()])
  })

  return (
    <>
      <PageTitle name="Vault" containerWidth="medium" />
      {mounted && <WalletConnectDialog ref={connectRef} />}
      {mounted && <CreateVaultDialog ref={createRef} address={address} chain={createChain} chains={availableChains} deployments={deployments} deployment={deployments[createChain?.id]} busy={blocked} pending={pending} error={error} onSubmit={create} onNetworkChange={(next) => {
        setError('')
        setCreateChainId(next)
      }} onConnect={() => {
        createRef.current?.close()
        connectRef.current?.open()
      }} />}
      {mounted && <ImportVaultDialog ref={importRef} chainId={importChainId ?? defaultModalChainId} chains={availableChains} deployments={deployments} busy={blocked} error={error} onSubmit={importVault} onNetworkChange={(next) => {
        setError('')
        setImportChainId(next)
      }} />}
      <div className={styles.vault}>
        <div className={clsx('__container', styles.vault__container)} data-width="medium">
          <header className={styles.vault__hero}>
            <Rise className={styles.vault__heroCopy} targets="children">
              <span className={styles.vault__eyebrow}><ShieldCheckIcon size={15} /> PERSONAL CUSTODY</span>
              <h1>Your assets.<br /><span>Your approval.</span></h1>
              <p>A personal vault controlled by your signing wallets. A little more peace of mind for everything you hold.</p>
              <div className={styles.vault__heroActions}>{mounted && !address ? <button className={styles.vault__button} onClick={() => connectRef.current?.open()}><WalletIcon size={18} /> Connect wallet</button> : <span className={styles.vault__badge}><KeyIcon size={14} /> Multiple approvals</span>}</div>
            </Rise>
            <VaultIllustration threshold={snapshot.data?.threshold} />
          </header>
          <section className={styles.vault__features} aria-label="How your vault works">
            <div className={styles.vault__feature}>
              <span className={styles.vault__featureIcon}><WalletIcon size={23} weight="duotone" /></span>
              <div><strong>One vault address</strong><p>Receive funds in one place, on the network you choose.</p></div>
            </div>
            <div className={styles.vault__feature}>
              <span className={styles.vault__featureIcon}><ShieldCheckIcon size={23} weight="duotone" /></span>
              <div><strong>Your approval rules</strong><p>Choose your signing wallets and how many must approve.</p></div>
            </div>
            <div className={styles.vault__feature}>
              <span className={styles.vault__featureIcon}><ListChecksIcon size={23} weight="duotone" /></span>
              <div><strong>Review before sending</strong><p>Check the asset, amount and recipient for every transfer.</p></div>
            </div>
          </section>
          <section className={styles.vault__myVaults} aria-label="My vaults">
            <div className={styles.vault__listHeader}>
              <div className={styles.vault__listTitle}><h2>My vaults</h2><p>Vaults linked to your signing wallet, available on every device.</p></div>
              <div className={styles.vault__row} role="group" aria-label="Vault actions"><button type="button" className={styles.vault__button} disabled={!mounted || !defaultModalChainId || blocked} onClick={() => {
              setError('')
              setCreateChainId(defaultModalChainId)
              createRef.current?.open()
            }}><PlusIcon size={18} /> New vault</button><button type="button" className={styles.vault__secondary} disabled={!mounted || !defaultModalChainId || blocked} onClick={() => {
              setError('')
              setImportChainId(defaultModalChainId)
              importRef.current?.open()
            }}><WalletIcon size={18} /> Import vault</button></div>
            </div>
            {(!mounted || !address) ? <div className={styles.vault__empty}><WalletIcon size={26} /><p>Connect a signing wallet to find your vaults.</p><button type="button" className={styles.vault__secondary} disabled={!mounted} onClick={() => connectRef.current?.open()}>Connect wallet</button></div> : <>
              {myVaults.isLoading && <Spinner size={20} label="Loading your vaults" />}
              {myVaults.error && <p className={styles.vault__error} role="alert">{errorText(myVaults.error)} <button type="button" onClick={() => myVaults.mutate()}>Retry</button></p>}
              {registration.error && <div className={styles.vault__notice} role="alert"><p>Your vault exists onchain. {errorText(registration.error)}</p><button type="button" className={styles.vault__secondary} disabled={registration.isValidating} onClick={() => act(async () => {
                await registration.mutate()
                setMessage('Vault saved to My vaults.')
              })}>{registration.isValidating ? 'Saving…' : 'Save vault'}</button></div>}
              {myVaults.data && !myVaults.data.some((page) => page.vaults.length) && <p>No vaults recorded for this wallet yet. Choose New vault to create one, or open an existing vault to add it.</p>}
              <div className={styles.vault__savedGrid}>{myVaults.data?.flatMap((page) => page.vaults).map((item) => <SavedVaultCard key={`${item.chainId}-${item.address}`} item={item} active={item.chainId === chainId && item.address.toLowerCase() === vault?.toLowerCase()} />)}</div>
              {myVaults.data?.at(-1)?.nextCursor != null && <button type="button" className={styles.vault__secondary} disabled={myVaults.isValidating} onClick={() => myVaults.setSize(myVaults.size + 1)}>Load more vaults</button>}
            </>}
          </section>
          {error && <p className={styles.vault__error} role="alert">{error}</p>}
          {message && <p className={styles.vault__notice} role="status">{message}</p>}
          {blocked && <p className={styles.vault__row} role="status"><Spinner size={18} /> {pending || 'Checking vault…'}</p>}
          {!chain && <p role="alert" className={styles.vault__error}>This network is not configured in Hup. Choose a supported network.</p>}

          {initialVault && !vault && <p role="alert" className={styles.vault__error}>Invalid vault address.</p>}
          {snapshot.isLoading && <Spinner label="Loading vault" />}
          {snapshot.error && <p className={styles.vault__error} role="alert">{errorText(snapshot.error)} <button onClick={() => snapshot.mutate()}>Retry</button></p>}
          {snapshot.data && <>
            <section className={styles.vault__card}>
              <div className={styles.vault__row}><h2>Balance</h2><span className={styles.vault__badge}>{snapshot.data.threshold} of {snapshot.data.owners.length} approvals</span></div>
              <strong className={styles.vault__balance} title={formatUnits(snapshot.data.balance, chain.nativeCurrency.decimals)}>{amountLabel(snapshot.data.balance, chain.nativeCurrency.decimals)} {chain.nativeCurrency.symbol}</strong>
              <p>{chain.name} · Nonce {snapshot.data.nonce.toString()}</p>
              <label>Look up a token balance<input value={token} onChange={(event) => setToken(event.target.value.trim())} placeholder="ERC20 or LSP7 contract address" /></label>
              {tokenInfo.isLoading && <Spinner size={18} label="Loading token" />}
              {tokenInfo.error && <p role="alert" className={styles.vault__error}>{errorText(tokenInfo.error)}</p>}
              {tokenInfo.data && <p className={styles.vault__tokenBalance} title={formatUnits(tokenInfo.data.balance, tokenInfo.data.decimals)}><TokenIcon token={{ address: tokenAddress, logo: tokenLogo, symbol: tokenInfo.data.symbol }} chainId={chainId} size="md" /><span>{amountLabel(tokenInfo.data.balance, tokenInfo.data.decimals)} {tokenInfo.data.symbol} · {tokenInfo.data.decimals} decimals</span></p>}
              <h3>Receive</h3><p>Send assets on {chain.name} to this address. You can also use it in payout settings that accept a custom recipient. For LSP7, the sender must allow transfers to a contract without LSP1 receiver support.</p>
              <code className={styles.vault__address}>{vault}</code>
              <div className={styles.vault__row}><button className={styles.vault__secondary} disabled={blocked} onClick={() => copy(vault)}>Copy address</button><button className={styles.vault__secondary} disabled={blocked} onClick={() => copy(`${window.location.origin}${urlFor(chainId, vault)}`)}>Copy vault link</button>{chain.blockExplorers?.default && <a href={`${chain.blockExplorers.default.url}/address/${vault}`} target="_blank" rel="noreferrer">View in explorer</a>}</div>
              <h3>Signing wallets</h3><ul className={styles.vault__list}>{snapshot.data.owners.map((owner) => <li key={owner}><code>{owner}</code>{owner.toLowerCase() === address?.toLowerCase() ? ' · connected' : ''}</li>)}</ul>
              {!isOwner && <p>You can view this vault. Connect a signing wallet to approve and send.</p>}
            </section>
            <section className={styles.vault__card}>
              <h2>Propose a transfer</h2>
              <form className={styles.vault__form} onSubmit={propose}>
                <label>Asset type<select name="kind" value={kind} onChange={(event) => setKind(event.target.value)}><option value="native">{chain.nativeCurrency.symbol} · native currency</option><option value="erc20">ERC20 token</option><option value="lsp7">LSP7 token</option></select></label>
                {kind !== 'native' && <label>Token contract<input name="token" required pattern="0x[a-fA-F0-9]{40}" defaultValue={token} placeholder="0x…" /></label>}
                <label>Recipient<input name="recipient" required pattern="0x[a-fA-F0-9]{40}" placeholder="0x…" /></label>
                <label>Amount<input name="amount" required inputMode="decimal" placeholder="0.00" /></label>
                <button className={styles.vault__button} disabled={!mounted || !isOwner || blocked}>Review transfer</button>
              </form>
            </section>
            {imported.error && <p role="alert" className={styles.vault__error}>Invalid proposal: {errorText(imported.error)}</p>}
            {current && <section className={styles.vault__card}>
              <h2>Review and approve</h2>
              <dl className={styles.vault__details}>
                <dt>Network</dt><dd>{chain.name} ({chainId})</dd>
                <dt>Recipient</dt><dd><code>{current.recipient}</code></dd>
                <dt>Asset</dt><dd>{current.kind === 'native' ? chain.nativeCurrency.symbol : <code>{current.token}</code>} · {current.kind}</dd>
                <dt>Amount</dt><dd>{current.kind === 'native' ? `${formatUnits(BigInt(current.amount), chain.nativeCurrency.decimals)} ${chain.nativeCurrency.symbol}` : tokenInfo.data ? `${formatUnits(BigInt(current.amount), tokenInfo.data.decimals)} ${tokenInfo.data.symbol}` : `${current.amount} base units`}</dd>
                <dt>Nonce</dt><dd>{current.nonce}</dd>
                {status.data && <><dt>Transaction hash</dt><dd><code>{status.data.hash}</code></dd></>}
              </dl>
              <p>Approvals are permanent for this proposal. Once the threshold is met, it can be executed. Proposals using the same nonce compete; executing one makes the others stale.</p>
              {current.kind === 'lsp7' && <p>The LSP7 transfer allows delivery to contracts without an LSP1 receiver. Verify that the recipient can manage these tokens.</p>}
              {current.kind === 'erc20' && <p>Version one supports standard ERC20 tokens. Tokens that return false instead of reverting or charge transfer fees are unsupported.</p>}
              {status.isLoading && <Spinner size={18} label="Checking approvals" />}
              {status.error && <p role="alert" className={styles.vault__error}>{errorText(status.error)}</p>}
              {status.data && <><p>{approved.length} of {snapshot.data.threshold} approvals</p><ul className={styles.vault__list}>{status.data.approvals.map((item) => <li key={item.owner}>{short(item.owner)} · {item.approved ? 'Approved' : 'Awaiting approval'}</li>)}</ul></>}
              <div className={styles.vault__row}>
                <button className={styles.vault__secondary} disabled={blocked} onClick={() => copy(`${window.location.origin}${urlFor(chainId, vault, current)}`)}>Copy proposal link</button>
                <button className={styles.vault__button} disabled={blocked || !isOwner || !status.data || Boolean(status.error) || mine?.approved} onClick={approve}>{mine?.approved ? 'Approved by this wallet' : 'Approve transfer'}</button>
                <button className={styles.vault__button} disabled={blocked || !isOwner || !status.data || Boolean(status.error) || approved.length < snapshot.data.threshold} onClick={execute}>Execute transfer</button>
              </div>
            </section>}
            <VaultHistory key={`${chainId}-${vault}`} client={client} vault={vault} chain={chain} deployment={deployment} nonce={snapshot.data.nonce.toString()} />
          </>}
          <footer><VaultAttribution /></footer>
        </div>
      </div>
    </>
  )
}

function SavedVaultCard({ item, active }) {
  const config = useConfig()
  const chain = config.chains.find((entry) => entry.id === item.chainId)
  const balance = useSWR(chain ? ['personal-vault-native-balance', item.chainId, item.address] : null, () => getPublicClient(config, { chainId: item.chainId }).getBalance({ address: item.address }), { refreshInterval: 30_000, shouldRetryOnError: false })
  const currency = chain?.nativeCurrency
  const amount = balance.data == null || !currency ? null : formatUnits(balance.data, currency.decimals)
  const display = amount != null && balance.data > 0n && Number(amount) < 0.000001 ? '<0.000001' : amount != null ? amountLabel(balance.data, currency.decimals) : '—'

  return <article className={clsx(styles.vault__savedVault, active && styles['vault__savedVault--active'])}>
    <a className={styles.vault__savedLink} href={urlFor(item.chainId, item.address)} aria-label={`Open vault ${item.address}`} />
    <span className={styles.vault__savedHeading}><ChainLogo chainId={item.chainId} size={24} /><strong>{chain?.name || `Network ${item.chainId}`}</strong><ArrowUpRightIcon size={15} /></span>
    <span className={styles.vault__savedBalance} title={amount != null ? `${amount} ${currency.symbol}` : undefined}>
      {balance.isLoading ? <Spinner size={16} label="Loading native balance" /> : <strong>{balance.error ? '—' : display}</strong>}
      <span>{currency?.symbol || 'Native coin'}</span>
    </span>
    {balance.error && <small>Balance unavailable</small>}
    <span className={styles.vault__savedAddress}><code>{short(item.address)}</code><CopyButton value={item.address} title="Copy vault address" className={styles.vault__savedCopy} /></span>
    <small>{item.threshold} of {item.signerCount} approvals</small>
    <small>Safe {item.version}</small>
  </article>
}

function VaultHistory({ client, vault, chain, deployment, nonce }) {
  const [end, setEnd] = useState(null)
  const history = useSWR(['personal-vault-history', chain.id, vault, end?.toString(), nonce], async () => {
    const toBlock = end ?? await client.getBlockNumber()
    const fromBlock = toBlock > 1999n ? toBlock - 1999n : 0n
    const logs = await client.getLogs({ address: vault, events: historyEventsFor(deployment), fromBlock, toBlock })
    return { fromBlock, toBlock, logs: logs.sort((a, b) => a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber < b.blockNumber ? 1 : -1) }
  }, { shouldRetryOnError: false })
  return <section className={styles.vault__card}>
    <h2>Transaction history</h2><p>Native receipts and Safe executions, read directly from this vault. Token receipts can be viewed in the explorer.</p>
    {history.isLoading && <Spinner size={18} label="Loading history" />}
    {history.error && <p role="alert" className={styles.vault__error}>{errorText(history.error)} <button onClick={() => history.mutate()}>Retry</button></p>}
    {history.data && <>
      <p>Blocks {history.data.fromBlock.toString()}–{history.data.toBlock.toString()}</p>
      {!history.data.logs.length && <p>No vault transactions in this block range.</p>}
      <ul className={styles.vault__list}>{history.data.logs.map((log) => <li key={`${log.transactionHash}-${log.logIndex}`}>
        {log.eventName === 'SafeReceived' ? `Received ${formatUnits(log.args.value, chain.nativeCurrency.decimals)} ${chain.nativeCurrency.symbol} from ${short(log.args.sender)}` : log.eventName === 'ExecutionSuccess' ? 'Transfer executed' : 'Execution failed'}{' · '}
        {chain.blockExplorers?.default ? <a href={`${chain.blockExplorers.default.url}/tx/${log.transactionHash}`} target="_blank" rel="noreferrer">{short(log.transactionHash)}</a> : <code>{log.transactionHash}</code>}
      </li>)}</ul>
      <div className={styles.vault__row}><button className={styles.vault__secondary} onClick={() => { setEnd(null); history.mutate() }}>Latest</button><button className={styles.vault__secondary} disabled={history.data.fromBlock === 0n} onClick={() => setEnd(history.data.fromBlock - 1n)}>Older blocks</button></div>
    </>}
  </section>
}
