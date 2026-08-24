/* @file app/admin/deploy-lsp7/page.jsx */
'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  useBytecode,
  useConnection,
  useDeployContract,
  useReadContracts,
  useSimulateContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { formatUnits, hexToString, isAddress, parseUnits } from 'viem'
import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import RecipientField from '@/components/ui/RecipientField'
import { EMPTY_RECIPIENT } from '@/lib/recipientSearch'
import { config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import artifact from '@/abis/HupTestLSP7.deploy.json'
import styles from './page.module.scss'

// HupTestLSP7 is a throwaway faucet token: deploying one costs the caller their own gas and
// grants no authority anywhere in the app, so this tool gates on a connected wallet rather than
// the admin address. The deployer becomes the token's owner, which is rarely the admin wallet.
// The owner is a constructor argument rather than msg.sender (so tests/deploy.html can deploy
// the same bytecode through the CREATE2 factory without the factory ending up as owner); here
// it is always the connected wallet, so a direct deploy behaves exactly as it did before.

const DEFAULT_CHAIN_ID = 10143 // Monad testnet — where cidex actually indexes tips

// LSP7 has no symbol(); LSP4 metadata lives in ERC725Y storage under keccak256('LSP4TokenSymbol')
const LSP4_TOKEN_SYMBOL_KEY = '0x2f0a68ab07768e01943a599e73362a0e17a63a72e94dd2e384d2c1d4db932756'

const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 })

// viem buries the decoded custom error a few levels down the cause chain. Naming it matters here
// more than usual: every interesting LSP7 failure (LSP7NotifyTokenReceiverIsEOA,
// LSP7AmountExceedsBalance) is a custom error, so the generic message alone says nothing useful.
const revertName = (err) => {
  let cursor = err
  for (let depth = 0; depth < 6 && cursor; depth += 1) {
    if (cursor.data?.errorName) return cursor.data.errorName
    cursor = cursor.cause
  }
  return null
}

const errorMessage = (err) => {
  const name = revertName(err)
  if (name) return name
  return err?.shortMessage || err?.message || 'Transaction rejected or failed'
}

export default function Page() {
  const { address, isConnected, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })
  const { mutateAsync: deployContractAsync, isPending: isDeployPending } = useDeployContract()
  const { mutateAsync: writeContractAsync, isPending: isFaucetPending } = useWriteContract()
  const { mutateAsync: writeTransferAsync, isPending: isTransferPending } = useWriteContract()

  const [chainId, setChainId] = useState(DEFAULT_CHAIN_ID)
  const [tokenName, setTokenName] = useState('Hup Test LSP7')
  const [tokenSymbol, setTokenSymbol] = useState('tLSP7')
  const [deployHash, setDeployHash] = useState(null)
  const [deployError, setDeployError] = useState(null)
  const [faucetHash, setFaucetHash] = useState(null)
  const [faucetError, setFaucetError] = useState(null)
  const [copied, setCopied] = useState(null)

  // The token this page operates on. A fresh deploy fills it in, but it stays editable so an
  // already-deployed token can be driven after a reload — the deploy receipt is session-only.
  // Derived rather than synced in an effect: null means "operator hasn't typed", so a deploy's
  // address shows through until they override it.
  const [tokenOverride, setTokenOverride] = useState(null)

  const [recipientValue, setRecipientValue] = useState(EMPTY_RECIPIENT)
  const [amountInput, setAmountInput] = useState('')
  const [force, setForce] = useState(true)
  const [transferHash, setTransferHash] = useState(null)
  const [transferError, setTransferError] = useState(null)

  const chainInfo = useMemo(() => appChains.find((chain) => chain.id === chainId), [chainId])
  const isWrongChain = Boolean(walletChain && chainId && walletChain.id !== chainId)
  const explorerUrl = chainInfo?.blockExplorers?.default?.url?.replace(/\/$/, '')

  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: deployHash ?? undefined, chainId })
  const { data: faucetReceipt, isLoading: isFaucetConfirming } = useWaitForTransactionReceipt({
    hash: faucetHash ?? undefined,
    chainId,
  })
  const { data: transferReceipt, isLoading: isTransferConfirming } = useWaitForTransactionReceipt({
    hash: transferHash ?? undefined,
    chainId,
  })

  // An RPC still reports contractAddress on a reverted creation, so without the status check a
  // failed deploy renders as a green card pointing at an address that holds no code
  const deployedAddress = receipt?.status === 'success' ? receipt.contractAddress ?? null : null
  const deployReverted = receipt?.status === 'reverted'

  const tokenInput = tokenOverride ?? deployedAddress ?? ''

  const tokenAddress = useMemo(() => {
    const raw = tokenInput.trim()
    return isAddress(raw, { strict: false }) ? raw : null
  }, [tokenInput])

  const recipient = recipientValue.address

  // Read the token back through the same accessors the app's LSP7 path uses, so a green card
  // here means TipModal and HupTipper can actually work with this token
  const readContracts = useMemo(() => {
    if (!tokenAddress || !address) return []
    const base = { address: tokenAddress, abi: artifact.abi, chainId }

    return [
      { ...base, functionName: 'decimals' },
      { ...base, functionName: 'totalSupply' },
      { ...base, functionName: 'owner' },
      { ...base, functionName: 'getData', args: [LSP4_TOKEN_SYMBOL_KEY] },
      { ...base, functionName: 'isMintable' },
      { ...base, functionName: 'FAUCET_DRIP' },
      { ...base, functionName: 'balanceOf', args: [address] },
    ]
  }, [address, chainId, tokenAddress])

  const {
    data: reads,
    isLoading: isReading,
    refetch: refetchState,
  } = useReadContracts({ contracts: readContracts, query: { enabled: readContracts.length > 0 } })

  const onchain = useMemo(() => {
    if (!reads) return null

    const [decimals, totalSupply, owner, symbolBytes, isMintable, faucetDrip, balance] = reads.map((entry) => entry?.result)
    if (decimals === undefined) return { error: reads.find((entry) => entry?.error)?.error?.shortMessage ?? 'Could not read the token state' }

    let lsp4Symbol = null
    if (symbolBytes && symbolBytes !== '0x') {
      try {
        lsp4Symbol = hexToString(symbolBytes).trim() || null
      } catch {
        lsp4Symbol = null
      }
    }

    return { decimals, totalSupply, owner, lsp4Symbol, isMintable, faucetDrip, balance }
  }, [reads])

  // Decimals come off the token, never assumed — LSP7 derives them from the divisibility flag
  const parsedAmount = useMemo(() => {
    if (!amountInput.trim() || onchain?.decimals === undefined) return null
    try {
      const value = parseUnits(amountInput.trim(), onchain.decimals)
      return value > 0n ? value : null
    } catch {
      return null
    }
  }, [amountInput, onchain])

  const exceedsBalance = Boolean(parsedAmount && onchain?.balance !== undefined && parsedAmount > onchain.balance)

  // The whole point of the force flag: LSP7 refuses to hand tokens to an address that cannot
  // acknowledge them, and a plain wallet never can. Probe the recipient so the consequence of
  // unticking force is visible before any gas is spent.
  const { data: recipientCode } = useBytecode({
    address: recipient ?? undefined,
    chainId,
    query: { enabled: Boolean(recipient) },
  })
  const recipientIsEoa = Boolean(recipient) && (!recipientCode || recipientCode === '0x')
  const forceWouldRevert = Boolean(recipient) && !force

  const transferArgs = useMemo(() => {
    if (!address || !recipient || !parsedAmount) return null
    return [address, recipient, parsedAmount, force, '0x']
  }, [address, force, parsedAmount, recipient])

  const { error: simulationError } = useSimulateContract({
    address: tokenAddress ?? undefined,
    abi: artifact.abi,
    functionName: 'transfer',
    args: transferArgs ?? undefined,
    chainId,
    query: { enabled: Boolean(tokenAddress && transferArgs && !isWrongChain && !exceedsBalance) },
  })

  const canTransfer = Boolean(tokenAddress && transferArgs && !isWrongChain && !exceedsBalance && !isTransferPending && !isTransferConfirming)

  // A confirmed faucet or transfer changes supply and balance, so pull the readback again
  useEffect(() => {
    if (faucetReceipt) refetchState()
  }, [faucetReceipt, refetchState])

  useEffect(() => {
    if (transferReceipt) refetchState()
  }, [transferReceipt, refetchState])

  const handleDeploy = async (e) => {
    e.preventDefault()
    if (!tokenName.trim() || !tokenSymbol.trim() || !address) return

    setDeployError(null)
    setDeployHash(null)
    setFaucetHash(null)
    setTokenOverride(null) // let the incoming deploy's address take over the token field

    try {
      const hash = await deployContractAsync({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args: [tokenName.trim(), tokenSymbol.trim(), address],
        chainId,
      })
      setDeployHash(hash)
    } catch (err) {
      console.error('Deployment failed:', err)
      setDeployError(errorMessage(err))
    }
  }

  const handleFaucet = async () => {
    if (!tokenAddress) return

    setFaucetError(null)
    setFaucetHash(null)

    try {
      const hash = await writeContractAsync({
        address: tokenAddress,
        abi: artifact.abi,
        functionName: 'faucet',
        chainId,
      })
      setFaucetHash(hash)
    } catch (err) {
      console.error('Faucet call failed:', err)
      setFaucetError(errorMessage(err))
    }
  }

  const handleTransfer = async (e) => {
    e.preventDefault()
    if (!canTransfer) return

    setTransferError(null)
    setTransferHash(null)

    try {
      const hash = await writeTransferAsync({
        address: tokenAddress,
        abi: artifact.abi,
        functionName: 'transfer',
        args: transferArgs,
        chainId,
      })
      setTransferHash(hash)
    } catch (err) {
      console.error('Transfer failed:', err)
      setTransferError(errorMessage(err))
    }
  }

  const handleMax = () => {
    if (onchain?.balance === undefined || onchain?.decimals === undefined) return
    setAmountInput(formatUnits(onchain.balance, onchain.decimals))
  }

  const handleCopy = (key, text) => {
    navigator.clipboard?.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const tokensSnippet = tokenAddress ? `{ symbol: '${tokenSymbol.trim()}', address: '${tokenAddress}', lsp7: true },` : ''

  if (!isConnected) {
    return (
      <>
        <PageTitle name="Deploy Test LSP7" />
        <div className={clsx(styles['deploy-lsp7'], 'ms-motion-slideDownIn')}>
          <div className={styles['deploy-lsp7__container']}>
            <p className={styles['deploy-lsp7__gate']}>Connect your wallet to deploy.</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle name="Deploy Test LSP7" />
      <div className={clsx(styles['deploy-lsp7'], 'ms-motion-slideDownIn')}>
        <div className={styles['deploy-lsp7__container']}>
          <header className={styles['deploy-lsp7__header']}>
            <h1 className={styles['deploy-lsp7__title']}>Deploy HupTestLSP7</h1>
            <p className={styles['deploy-lsp7__subtitle']}>
              A throwaway LSP7 Digital Asset with an open faucet, for exercising the authorizeOperator payment path off
              LUKSO. Your wallet signs the deployment and becomes the token owner.
            </p>
          </header>

          <div className={styles['deploy-lsp7__meta']}>
            <span>
              solc <code>{artifact.compiler.split('+')[0]}</code>
            </span>
            <span>
              lsp7-contracts <code>{artifact.dependencies['@lukso/lsp7-contracts']}</code>
            </span>
            <span>
              optimizer <code>{artifact.settings.optimizer.runs} runs</code>
              {artifact.settings.viaIR ? ' + viaIR' : ''}
            </span>
            <span>
              bytecode <code>{Math.round((artifact.bytecode.length - 2) / 2).toLocaleString()} bytes</code>
            </span>
          </div>

          <form className={styles['deploy-lsp7__card']} onSubmit={handleDeploy}>
            <div className={styles['deploy-lsp7__field']}>
              <label className={styles['deploy-lsp7__label']} htmlFor="network">
                Network
              </label>
              <select
                id="network"
                className={styles['deploy-lsp7__input']}
                value={chainId}
                onChange={(e) => setChainId(Number(e.target.value))}
                disabled={isDeployPending || isConfirming}
              >
                {appChains.map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name} ({chain.id})
                  </option>
                ))}
              </select>
            </div>

            <div className={styles['deploy-lsp7__row']}>
              <div className={styles['deploy-lsp7__field']}>
                <label className={styles['deploy-lsp7__label']} htmlFor="token-name">
                  Token name
                </label>
                <input
                  id="token-name"
                  type="text"
                  className={styles['deploy-lsp7__input']}
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  placeholder="Hup Test LSP7"
                  disabled={isDeployPending || isConfirming}
                />
              </div>

              <div className={styles['deploy-lsp7__field']}>
                <label className={styles['deploy-lsp7__label']} htmlFor="token-symbol">
                  Token symbol
                </label>
                <input
                  id="token-symbol"
                  type="text"
                  className={styles['deploy-lsp7__input']}
                  value={tokenSymbol}
                  onChange={(e) => setTokenSymbol(e.target.value)}
                  placeholder="tLSP7"
                  disabled={isDeployPending || isConfirming}
                />
              </div>
            </div>

            <p className={styles['deploy-lsp7__note']}>
              Mints 1,000,000 to you at deploy, 18 decimals. Anyone can then call <code>faucet()</code> for 1,000.
            </p>

            {isWrongChain && (
              <div className={clsx(styles['deploy-lsp7__validation'], styles['deploy-lsp7__validation--warning'])}>
                <span>Your wallet is on {walletChain?.name}. Switch to {chainInfo?.name} to deploy there.</span>
                <button
                  type="button"
                  onClick={() => switchChain.mutate({ chainId })}
                  disabled={switchChain.isPending}
                  className={clsx(styles['deploy-lsp7__button'], styles['deploy-lsp7__button--secondary'])}
                >
                  {switchChain.isPending ? 'Switching...' : 'Switch'}
                </button>
              </div>
            )}

            {deployError && (
              <div className={clsx(styles['deploy-lsp7__validation'], styles['deploy-lsp7__validation--error'])}>
                ❌ {deployError}
              </div>
            )}

            {deployReverted && (
              <div className={clsx(styles['deploy-lsp7__validation'], styles['deploy-lsp7__validation--error'])}>
                ❌ The deployment transaction reverted — no contract exists at the address in the receipt.
              </div>
            )}

            {deployHash && !deployedAddress && !deployReverted && (
              <div className={clsx(styles['deploy-lsp7__validation'], styles['deploy-lsp7__validation--warning'])}>
                {isConfirming ? 'Waiting for the deployment to confirm...' : 'Deployment broadcast.'}
              </div>
            )}

            <div className={styles['deploy-lsp7__actions']}>
              <button
                type="submit"
                disabled={!tokenName.trim() || !tokenSymbol.trim() || isWrongChain || isDeployPending || isConfirming}
                className={clsx(styles['deploy-lsp7__button'], styles['deploy-lsp7__button--primary'])}
              >
                {isDeployPending ? 'Confirm in wallet...' : isConfirming ? 'Deploying...' : 'Deploy'}
              </button>
            </div>
          </form>

          <div className={styles['deploy-lsp7__card']}>
            <div className={styles['deploy-lsp7__card-header']}>
              <h2 className={styles['deploy-lsp7__card-title']}>Token</h2>
              {tokenAddress && <span className={styles['deploy-lsp7__badge']}>{chainInfo?.name}</span>}
            </div>

            <div className={styles['deploy-lsp7__field']}>
              <label className={styles['deploy-lsp7__label']} htmlFor="token-address">
                Token address
              </label>
              <input
                id="token-address"
                type="text"
                className={clsx(styles['deploy-lsp7__input'], styles['deploy-lsp7__input--mono'])}
                value={tokenInput}
                onChange={(e) => setTokenOverride(e.target.value)}
                placeholder="0x… paste an already-deployed HupTestLSP7"
                spellCheck={false}
              />
              <p className={styles['deploy-lsp7__note']}>
                Filled in automatically after a deploy. Paste an existing one to drive a token from an earlier session.
              </p>
            </div>

            {tokenInput.trim() && !tokenAddress && (
              <div className={clsx(styles['deploy-lsp7__validation'], styles['deploy-lsp7__validation--error'])}>
                Not a valid address.
              </div>
            )}

            {tokenAddress && (
              <>
                {explorerUrl && (
                  <div className={styles['deploy-lsp7__detail-row']}>
                    <span className={styles['deploy-lsp7__detail-label']}>Explorer</span>
                    <span className={styles['deploy-lsp7__detail-value']}>
                      <a href={`${explorerUrl}/address/${tokenAddress}`} target="_blank" rel="noopener noreferrer">
                        <code>{tokenAddress}</code> ↗
                      </a>
                      <button
                        type="button"
                        onClick={() => handleCopy('address', tokenAddress)}
                        className={clsx(styles['deploy-lsp7__button'], styles['deploy-lsp7__button--ghost'])}
                      >
                        {copied === 'address' ? 'Copied' : 'Copy'}
                      </button>
                    </span>
                  </div>
                )}

                {deployHash && deployedAddress && (
                  <div className={styles['deploy-lsp7__detail-row']}>
                    <span className={styles['deploy-lsp7__detail-label']}>Deploy tx</span>
                    <span className={styles['deploy-lsp7__detail-value']}>
                      {explorerUrl ? (
                        <a href={`${explorerUrl}/tx/${deployHash}`} target="_blank" rel="noopener noreferrer">
                          <code>
                            {deployHash.slice(0, 10)}...{deployHash.slice(-8)}
                          </code>{' '}
                          ↗
                        </a>
                      ) : (
                        <code>{deployHash}</code>
                      )}
                    </span>
                  </div>
                )}

                <h3 className={styles['deploy-lsp7__section-title']}>Onchain readback</h3>

                {isReading && <p className={styles['deploy-lsp7__note']}>Reading state from {chainInfo?.name}...</p>}

                {onchain?.error && (
                  <div className={clsx(styles['deploy-lsp7__validation'], styles['deploy-lsp7__validation--error'])}>
                    {onchain.error}
                  </div>
                )}

                {onchain && !onchain.error && (
                  <>
                    <div className={styles['deploy-lsp7__detail-row']}>
                      <span className={styles['deploy-lsp7__detail-label']}>LSP4 symbol</span>
                      <span className={styles['deploy-lsp7__detail-value']}>
                        <strong>{onchain.lsp4Symbol ?? '—'}</strong>
                        <em className={styles['deploy-lsp7__hint']}>read via getData, the way TipModal reads it</em>
                      </span>
                    </div>

                    <div className={styles['deploy-lsp7__detail-row']}>
                      <span className={styles['deploy-lsp7__detail-label']}>Decimals</span>
                      <span className={styles['deploy-lsp7__detail-value']}>
                        <strong>{String(onchain.decimals)}</strong>
                      </span>
                    </div>

                    <div className={styles['deploy-lsp7__detail-row']}>
                      <span className={styles['deploy-lsp7__detail-label']}>Total supply</span>
                      <span className={styles['deploy-lsp7__detail-value']}>
                        <strong>{compactNumber.format(Number(formatUnits(onchain.totalSupply, onchain.decimals)))}</strong>
                      </span>
                    </div>

                    <div className={styles['deploy-lsp7__detail-row']}>
                      <span className={styles['deploy-lsp7__detail-label']}>Your balance</span>
                      <span className={styles['deploy-lsp7__detail-value']}>
                        <strong>
                          {onchain.balance === undefined
                            ? '—'
                            : compactNumber.format(Number(formatUnits(onchain.balance, onchain.decimals)))}
                        </strong>
                      </span>
                    </div>

                    <div className={styles['deploy-lsp7__detail-row']}>
                      <span className={styles['deploy-lsp7__detail-label']}>Owner</span>
                      <span className={styles['deploy-lsp7__detail-value']}>
                        <code>{onchain.owner}</code>
                        {onchain.owner?.toLowerCase() === address?.toLowerCase() && (
                          <em className={styles['deploy-lsp7__hint']}>you — holds MINTER_ROLE</em>
                        )}
                      </span>
                    </div>

                    <div className={styles['deploy-lsp7__detail-row']}>
                      <span className={styles['deploy-lsp7__detail-label']}>Minting</span>
                      <span className={styles['deploy-lsp7__detail-value']}>
                        <strong>{onchain.isMintable ? 'Enabled' : 'Disabled'}</strong>
                        <em className={styles['deploy-lsp7__hint']}>faucet drips {String(onchain.faucetDrip)} per call</em>
                      </span>
                    </div>
                  </>
                )}

                {faucetError && (
                  <div className={clsx(styles['deploy-lsp7__validation'], styles['deploy-lsp7__validation--error'])}>
                    ❌ {faucetError}
                  </div>
                )}

                {faucetHash && (
                  <div
                    className={clsx(
                      styles['deploy-lsp7__validation'],
                      isFaucetConfirming ? styles['deploy-lsp7__validation--warning'] : styles['deploy-lsp7__validation--success']
                    )}
                  >
                    {isFaucetConfirming ? 'Faucet call confirming...' : '✓ Faucet call confirmed — balance above is refreshed.'}
                  </div>
                )}

                <div className={styles['deploy-lsp7__actions']}>
                  <button
                    type="button"
                    onClick={handleFaucet}
                    disabled={isWrongChain || isFaucetPending || isFaucetConfirming}
                    className={clsx(styles['deploy-lsp7__button'], styles['deploy-lsp7__button--primary'])}
                  >
                    {isFaucetPending ? 'Confirm in wallet...' : isFaucetConfirming ? 'Dripping...' : 'Test faucet()'}
                  </button>

                  <button
                    type="button"
                    onClick={() => refetchState()}
                    disabled={isReading}
                    className={clsx(styles['deploy-lsp7__button'], styles['deploy-lsp7__button--secondary'])}
                  >
                    Re-read state
                  </button>
                </div>
              </>
            )}
          </div>

          {tokenAddress && (
            <form className={styles['deploy-lsp7__card']} onSubmit={handleTransfer}>
              <div className={styles['deploy-lsp7__card-header']}>
                <h2 className={styles['deploy-lsp7__card-title']}>Transfer</h2>
              </div>

              <p className={styles['deploy-lsp7__note']}>
                Calls <code>transfer(from, to, amount, force, data)</code> — LSP7&apos;s only transfer function. A wallet
                cannot do this: there is no <code>transfer(address,uint256)</code> on this contract for it to call.
              </p>

              <RecipientField
                id="recipient"
                label="Recipient"
                labelClassName={styles['deploy-lsp7__label']}
                inputClassName={clsx(styles['deploy-lsp7__input'], styles['deploy-lsp7__input--mono'])}
                value={recipientValue}
                onChange={setRecipientValue}
                viewer={address ?? null}
                placeholder="Name, ENS, or 0x… wallet or Universal Profile"
                disabled={isTransferPending || isTransferConfirming}
              />

              <div className={styles['deploy-lsp7__field']}>
                <label className={styles['deploy-lsp7__label']} htmlFor="amount">
                  Amount
                </label>
                <div className={styles['deploy-lsp7__input-group']}>
                  <input
                    id="amount"
                    type="text"
                    inputMode="decimal"
                    className={styles['deploy-lsp7__input']}
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    placeholder="1000"
                    disabled={isTransferPending || isTransferConfirming}
                  />
                  <button
                    type="button"
                    onClick={handleMax}
                    disabled={onchain?.balance === undefined}
                    className={clsx(styles['deploy-lsp7__button'], styles['deploy-lsp7__button--secondary'])}
                  >
                    Max
                  </button>
                </div>
                {onchain?.balance !== undefined && onchain?.decimals !== undefined && (
                  <p className={styles['deploy-lsp7__note']}>
                    Balance {formatUnits(onchain.balance, onchain.decimals)} {onchain.lsp4Symbol ?? ''}
                  </p>
                )}
              </div>

              <label className={styles['deploy-lsp7__toggle']}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                <span className={styles['deploy-lsp7__toggle-text']}>
                  <strong>force</strong>
                  <em className={styles['deploy-lsp7__hint']}>
                    Leave on to send to plain wallets. Off means the recipient must implement the LSP1 universal
                    receiver — otherwise the call reverts.
                  </em>
                </span>
              </label>

              {forceWouldRevert && (
                <div className={clsx(styles['deploy-lsp7__validation'], styles['deploy-lsp7__validation--warning'])}>
                  ⚠ With force off this will revert with{' '}
                  <code>{recipientIsEoa ? 'LSP7NotifyTokenReceiverIsEOA' : 'LSP7NotifyTokenReceiverContractMissingLSP1Interface'}</code>{' '}
                  unless the recipient implements LSP1. {recipientIsEoa ? 'This recipient has no contract code.' : ''}
                </div>
              )}

              {exceedsBalance && (
                <div className={clsx(styles['deploy-lsp7__validation'], styles['deploy-lsp7__validation--error'])}>
                  Amount exceeds your balance — this would revert with <code>LSP7AmountExceedsBalance</code>.
                </div>
              )}

              {simulationError && !exceedsBalance && (
                <div className={clsx(styles['deploy-lsp7__validation'], styles['deploy-lsp7__validation--error'])}>
                  Simulation failed: <code>{errorMessage(simulationError)}</code>
                </div>
              )}

              {transferError && (
                <div className={clsx(styles['deploy-lsp7__validation'], styles['deploy-lsp7__validation--error'])}>
                  ❌ {transferError}
                </div>
              )}

              {transferHash && (
                <div
                  className={clsx(
                    styles['deploy-lsp7__validation'],
                    isTransferConfirming ? styles['deploy-lsp7__validation--warning'] : styles['deploy-lsp7__validation--success']
                  )}
                >
                  {isTransferConfirming ? (
                    'Transfer confirming...'
                  ) : (
                    <>
                      ✓ Transfer confirmed.
                      {explorerUrl && (
                        <a href={`${explorerUrl}/tx/${transferHash}`} target="_blank" rel="noopener noreferrer">
                          View ↗
                        </a>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className={styles['deploy-lsp7__actions']}>
                <button
                  type="submit"
                  disabled={!canTransfer}
                  className={clsx(styles['deploy-lsp7__button'], styles['deploy-lsp7__button--primary'])}
                >
                  {isTransferPending ? 'Confirm in wallet...' : isTransferConfirming ? 'Transferring...' : 'Transfer'}
                </button>
              </div>
            </form>
          )}

          {tokenAddress && (
            <div className={styles['deploy-lsp7__card']}>
              <h3 className={styles['deploy-lsp7__section-title']}>Wire it into the app</h3>
              <p className={styles['deploy-lsp7__note']}>
                Add this to <code>TIP_TOKENS[{chainId}]</code> in <code>src/lib/tokens.js</code> — the <code>lsp7: true</code>{' '}
                flag is what routes tips through <code>authorizeOperator</code> instead of <code>approve</code>.
              </p>
              <pre className={styles['deploy-lsp7__snippet']}>
                <code>{tokensSnippet}</code>
                <button
                  type="button"
                  onClick={() => handleCopy('snippet', tokensSnippet)}
                  className={clsx(styles['deploy-lsp7__button'], styles['deploy-lsp7__button--ghost'])}
                >
                  {copied === 'snippet' ? 'Copied' : 'Copy'}
                </button>
              </pre>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
