'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { erc20Abi, isAddress } from 'viem'
import { useConfig, useConnection } from 'wagmi'
import { readContract } from 'wagmi/actions'
import { appChains } from '@/config/contracts'
import { SOLANA_TRADE_CHAINS, isSolanaNetworkId } from '@/config/solana'
import { fetchSolanaTokenInfo, isMint } from '@/lib/solanaSwap'
import { MAX_FEE_BPS } from '@/lib/uniswap'
import { canSwapOn, probeRoute } from '@/hooks/useTokenSwap'
import { XIcon } from '@phosphor-icons/react'
import NativeDialog from './ui/NativeDialog'
import TokenIcon from './ui/TokenIcon'
import EmptyState from './ui/EmptyState'
import styles from './AttachTokenTradeDialog.module.scss'

// Past four the widget stops being a call to action and starts being a portfolio
const MAX_TOKENS = 4

// What a creator can ask per trade. 100 bips is not a policy choice — it is the ceiling the
// v3 router enforces in its own require(), so anything above it would simply revert.
const FEE_CHOICES = [
  { bps: 0, label: 'None' },
  { bps: 25, label: '0.25%' },
  { bps: 50, label: '0.5%' },
  { bps: MAX_FEE_BPS, label: '1%' },
]

/**
 * Attach Token Trade Dialog
 * The chooser behind the composer's "Tokens to trade" button.
 *
 * Only chains with a routable venue are offered, and every address is probed onchain before it
 * can be added — a token with no `decimals()` is not a token, and a token with no pool would
 * ship a card that can never quote. Catching both here is the difference between a dead widget
 * in someone's feed and an error the author sees while they can still fix it.
 *
 * @param {Object} props
 * @param {Object|null} props.value The `content.tokenTrade` payload already attached, if any.
 * @param {Function} props.onAttach Called with the new payload, or null to detach.
 */
const AttachTokenTradeDialog = forwardRef(function AttachTokenTradeDialog({ value, onAttach }, ref) {
  const dialogRef = useRef(null)
  const config = useConfig()
  const { chain: walletChain } = useConnection()

  // Solana sits alongside the EVM chains rather than behind its own control: to an author,
  // "which network is this token on" is one question
  const swappableChains = useMemo(() => [...appChains.filter((chain) => canSwapOn(chain.id)), ...SOLANA_TRADE_CHAINS], [])
  const defaultChainId = swappableChains.some((chain) => chain.id === walletChain?.id)
    ? walletChain.id
    : (swappableChains[0]?.id ?? null)

  const [chainId, setChainId] = useState(defaultChainId)
  const [address, setAddress] = useState('')
  const [tokens, setTokens] = useState([])
  const [feeBps, setFeeBps] = useState(FEE_CHOICES[2].bps)
  const [error, setError] = useState('')
  // A warning is not a refusal: an unverified mint can still be exactly the token the author
  // meant, so it is added and flagged rather than blocked
  const [warning, setWarning] = useState('')
  const [isChecking, setIsChecking] = useState(false)

  useImperativeHandle(ref, () => ({
    open: () => {
      // Re-open always reflects what is actually attached, not what was typed and abandoned
      setTokens(Array.isArray(value?.tokens) ? value.tokens : [])
      setFeeBps(Number.isFinite(Number(value?.feeBps)) ? Number(value.feeBps) : FEE_CHOICES[2].bps)
      setAddress('')
      setError('')
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  useEffect(() => {
    setError('')
    setWarning('')
  }, [chainId, address])

  const addToken = async (event) => {
    event.preventDefault()
    const trimmed = address.trim()
    const solana = isSolanaNetworkId(chainId)

    if (solana ? !isMint(trimmed) : !isAddress(trimmed)) {
      setError(solana ? "That isn't a valid Solana mint address." : "That isn't a valid token address.")
      return
    }
    if (tokens.some((token) => token.address.toLowerCase() === trimmed.toLowerCase() && Number(token.chainId) === Number(chainId))) {
      setError('That token is already on this post.')
      return
    }
    if (tokens.length >= MAX_TOKENS) {
      setError(`A post can carry ${MAX_TOKENS} tokens at most.`)
      return
    }

    setIsChecking(true)
    setWarning('')
    try {
      if (solana) {
        // A mint carries no symbol of its own, so Jupiter answers for identity — and a mint it
        // does not index is one it cannot route, which is the same refusal as "no pool"
        const info = await fetchSolanaTokenInfo(trimmed)
        if (!info) throw new Error('unindexed')
        setTokens((current) => [
          ...current,
          { chainId: Number(chainId), address: trimmed, symbol: info.symbol ?? null, decimals: info.decimals ?? null, logo: info.logo ?? null },
        ])
        // Every popular Solana ticker has spoof mints copying the symbol AND the name. The
        // author is the only person positioned to catch it, and only before the post goes out.
        if (!info.isVerified) {
          setWarning(`${info.symbol ?? 'That mint'} is not on Jupiter's verified list. Check the address — spoof mints copy real tickers.`)
        }
      } else {
        // decimals() shares its selector on ERC20 and LSP7, so one probe confirms either shape —
        // and a plain wallet or unrelated contract fails it, which is the point
        const [decimals, symbol] = await Promise.all([
          readContract(config, { address: trimmed, abi: erc20Abi, functionName: 'decimals', chainId: Number(chainId) }),
          readContract(config, { address: trimmed, abi: erc20Abi, functionName: 'symbol', chainId: Number(chainId) }).catch(() => null),
        ])

        // Being a real token is not the same as being a tradeable one. Most pools on the
        // launchpad chains sit behind hooks or non-standard tick spacings the hookless probe
        // cannot reach, so the only honest test is to ask for a quote — here, where the author
        // can still pick a different token, rather than in every reader's feed.
        const { route, feeCapable } = await probeRoute(config, { chainId: Number(chainId), token: trimmed })
        if (route === 'no-route') {
          setError(
            `${symbol ?? 'That token'} has no pool this app can route on ${chainName(chainId)}. It needs a pool paired with the chain's coin on Uniswap or a supported AMM.`,
          )
          return
        }

        setTokens((current) => [
          ...current,
          { chainId: Number(chainId), address: trimmed, symbol: symbol ?? null, decimals: Number(decimals), feeCapable },
        ])
        // Reached only when the chain answered nothing at all. The token is added rather than
        // refused — an endpoint being down is not evidence about the token — but the author is
        // told the check did not actually run.
        if (route === 'unknown') {
          setWarning(`Could not reach ${chainName(chainId)} to confirm ${symbol ?? 'this token'} is tradeable. Added anyway — check the card before you post.`)
        }
      }
      setAddress('')
    } catch {
      setError(
        solana
          ? 'Jupiter does not index that mint, so it cannot be traded.'
          : 'No token found at that address on this network.',
      )
    } finally {
      setIsChecking(false)
    }
  }

  const removeToken = (index) => setTokens((current) => current.filter((_, position) => position !== index))

  const save = () => {
    dialogRef.current?.close()
    onAttach?.(tokens.length > 0 ? { tokens, feeBps } : null)
  }

  const chainName = (id) => swappableChains.find((chain) => chain.id === Number(id))?.name ?? `Chain ${id}`

  // A post can mix families, so the fee note has to describe what each one actually does

  /* Which tokens can actually pay the author. Solana pays none of them (Jupiter needs a token
     account and no Solana address is linked), and an EVM token whose best route is a classic AMM
     pays none either, because those routers have no fee primitive. Naming them is the difference
     between a rate an author chose and a rate they will be paid. */
  const unpaid = tokens.filter((token) => isSolanaNetworkId(token.chainId) || token.feeCapable === false)
  const allUnpaid = tokens.length > 0 && unpaid.length === tokens.length

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.attachTrade}
      aria-label="Add tokens to trade"
      lightDismiss
      onClick={(event) => event.stopPropagation()}
      // Nested inside the composer's own dialog — React re-dispatches close/cancel up the
      // component tree, so both must stop here or closing this also closes the composer
      onClose={(event) => event.stopPropagation()}
      onCancel={(event) => event.stopPropagation()}
    >
      <div className={styles.attachTrade__body}>
        <header className={styles.attachTrade__header}>
          <h3>Tokens to trade</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.attachTrade__close}>
            <XIcon size={18} />
          </button>
        </header>

        <p className={styles.attachTrade__lede}>
          Readers get a one-tap buy button for each of these, right inside your post.
        </p>

        {swappableChains.length === 0 ? (
          <EmptyState>None of the configured networks has a swap venue yet.</EmptyState>
        ) : (
          <form className={styles.attachTrade__form} onSubmit={addToken}>
            <select
              className={styles.attachTrade__select}
              value={chainId ?? ''}
              onChange={(event) => setChainId(Number(event.target.value))}
              aria-label="Network"
            >
              {swappableChains.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>

            <input
              type="text"
              className={styles.attachTrade__input}
              placeholder={isSolanaNetworkId(chainId) ? 'Token mint address' : 'Token contract address'}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              aria-label={isSolanaNetworkId(chainId) ? 'Token mint address' : 'Token contract address'}
              spellCheck={false}
            />

            <button type="submit" className={styles.attachTrade__add} disabled={isChecking || tokens.length >= MAX_TOKENS}>
              {isChecking ? 'Checking…' : 'Add'}
            </button>
          </form>
        )}

        {error && (
          <p className={styles.attachTrade__error} role="alert">
            {error}
          </p>
        )}

        {warning && (
          <p className={styles.attachTrade__warning} role="status">
            {warning}
          </p>
        )}

        {tokens.length > 0 && (
          <ul className={styles.attachTrade__list}>
            {tokens.map((token, index) => (
              <li key={`${token.chainId}:${token.address}`} className={styles.attachTrade__row}>
                <TokenIcon token={{ logo: null, address: token.address }} chainId={Number(token.chainId)} size="md" />
                <span className={styles.attachTrade__rowIdentity}>
                  <span className={styles.attachTrade__rowSymbol}>{token.symbol ?? 'Token'}</span>
                  <span className={styles.attachTrade__rowChain}>{chainName(token.chainId)}</span>
                </span>
                <button
                  type="button"
                  className={styles.attachTrade__remove}
                  onClick={() => removeToken(index)}
                  aria-label={`Remove ${token.symbol ?? token.address}`}
                >
                  <XIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Offering a rate for tokens that cannot pay one is just a promise the post will break,
            so when none of them can the picker goes away and says why instead */}
        <fieldset className={styles.attachTrade__fees}>
          <legend className={styles.attachTrade__feesLegend}>
            {allUnpaid ? 'No cut on these tokens' : 'Your cut of each trade'}
          </legend>

          {!allUnpaid && (
            <div className={styles.attachTrade__feeRow}>
              {FEE_CHOICES.map((choice) => (
                <button
                  key={choice.bps}
                  type="button"
                  className={clsx(styles.attachTrade__fee, feeBps === choice.bps && styles['attachTrade__fee--active'])}
                  onClick={() => setFeeBps(choice.bps)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          )}

          {/* Said plainly because it is the one thing a reader will notice and an author will
              be asked about: the fee is taken in whatever the trade produced, not in cash */}
          <p className={styles.attachTrade__feeNote}>
            {!allUnpaid && 'Paid to your wallet by the router, in the token bought on a buy and in coin on a sell. Shown to readers on the card. '}
            {unpaid.length > 0 && (
              <>
                <strong className={styles.attachTrade__feeCaveat}>
                  {allUnpaid
                    ? `${unpaid.length === 1 ? 'This token pays' : 'These tokens pay'} you nothing per trade.`
                    : `${unpaid.map((token) => token.symbol ?? 'One token').join(', ')} ${unpaid.length === 1 ? 'pays' : 'pay'} you nothing.`}
                </strong>{' '}
                {unpaid.some((token) => isSolanaNetworkId(token.chainId)) &&
                  'Jupiter needs a Solana account to pay into, and your profile has no Solana address linked. '}
                {unpaid.some((token) => !isSolanaNetworkId(token.chainId)) &&
                  'A classic AMM is the best route available (PancakeSwap, SushiSwap), and those routers have no way to pay a fee. '}
                {unpaid.length === 1 ? 'It still trades normally.' : 'They still trade normally.'}
              </>
            )}
          </p>
        </fieldset>

        <div className={styles.attachTrade__actions}>
          {Array.isArray(value?.tokens) && value.tokens.length > 0 && (
            <button
              type="button"
              className={styles.attachTrade__detach}
              onClick={() => {
                setTokens([])
                dialogRef.current?.close()
                onAttach?.(null)
              }}
            >
              Remove from post
            </button>
          )}
          <button type="button" className={styles.attachTrade__save} onClick={save} disabled={tokens.length === 0}>
            {tokens.length === 0 ? 'Add a token' : `Attach ${tokens.length} ${tokens.length === 1 ? 'token' : 'tokens'}`}
          </button>
        </div>
      </div>
    </NativeDialog>
  )
})

export default AttachTokenTradeDialog
