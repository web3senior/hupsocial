'use client'

import { useMemo, useState } from 'react'
import { useConnection, useReadContracts } from 'wagmi'
import { isAddress, zeroAddress } from 'viem'
import clsx from 'clsx'
import { CheckCircleIcon, PlusIcon, XCircleIcon, XIcon } from '@phosphor-icons/react'
import { CONTRACTS } from '@/config/wagmi'
import { DROP_GATES, gateLabel } from '@/lib/drops'
import dropsAbi from '@/abis/HupDrops.json'
import { toast } from '@/components/NextToast'
import styles from './DropEligibility.module.scss'

// One list per viewer, shared across every drop — the whole point is answering "which of my
// wallets can mint this" without re-typing them on each one. Viewer-local by necessity: Hup
// has no server-side notion of one person owning several addresses (HupAccountLinks models
// wallet SUCCESSION, which is a different claim), and nothing here is worth asking someone to
// prove — a wrong address only ever costs them a wasted eligibility row.
const getWalletsKey = () => `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}my-wallets`

const MAX_WALLETS = 10

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '')

const loadWallets = () => {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(getWalletsKey()) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry) => typeof entry === 'string' && isAddress(entry)).slice(0, MAX_WALLETS)
  } catch {
    return []
  }
}

const saveWallets = (wallets) => {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(getWalletsKey(), JSON.stringify(wallets))
  } catch (error) {
    console.error('Failed to save wallet list:', error)
  }
}

/**
 * Drop Eligibility
 * "Which of my wallets can mint this?" — the question a gated drop makes people ask, and which
 * they otherwise answer by connecting each wallet in turn and reading the mint button.
 *
 * The engine already answers it exactly: `isMintable` runs every check `mint` itself runs —
 * window, supply, allocation, per-wallet cap, and the gate — so a row here can never disagree
 * with what happens on submit. When a wallet fails, the specific reason is derived from the
 * cheaper reads beside it rather than guessed at.
 *
 * Only rendered for gated phases: on an open drop every address is eligible and the panel is
 * noise.
 *
 * @param {Object} props
 * @param {number} props.chainId
 * @param {string|number} props.dropId
 * @param {number} props.phaseIndex Which phase to test against — the one the card is minting.
 * @param {Object} props.phase The live phase struct (gate, perWallet, allocation, minted).
 * @param {string} props.creator The drop's creator, excluded from its own eligibility list.
 */
export default function DropEligibility({ chainId, dropId, phaseIndex, phase, creator }) {
  const { address } = useConnection()
  const dropsAddress = CONTRACTS[`chain${chainId}`]?.drops
  // Lazy initializer rather than an effect: the panel renders nothing until `phase` arrives
  // from a chain read, so there is no server-rendered markup for a restored list to mismatch
  // against, and this keeps the first paint correct instead of empty-then-populated.
  const [extraWallets, setExtraWallets] = useState(loadWallets)
  const [draft, setDraft] = useState('')

  const gate = phase ? Number(phase.gate) : DROP_GATES.OPEN

  // The connected wallet always leads and is never stored — it is already known, and saving it
  // would strand a stale address in the list the next time someone connects a different one.
  const wallets = useMemo(() => {
    const seen = new Set()
    const list = []
    for (const entry of [address, ...extraWallets]) {
      if (!entry || !isAddress(entry)) continue
      const key = entry.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      list.push(entry)
    }
    return list
  }, [address, extraWallets])

  const enabled = Boolean(dropsAddress && dropId && phase && wallets.length > 0)

  // isMintable is the verdict; mintedInPhaseBy and allowlist only exist to explain a `false`.
  // Batched so a list of wallets costs one multicall where the chain has one.
  const { data: results, isLoading } = useReadContracts({
    contracts: wallets.flatMap((wallet) => [
      { abi: dropsAbi, address: dropsAddress, functionName: 'isMintable', args: [BigInt(dropId), BigInt(phaseIndex), wallet, 1n], chainId },
      { abi: dropsAbi, address: dropsAddress, functionName: 'mintedInPhaseBy', args: [BigInt(dropId), BigInt(phaseIndex), wallet], chainId },
      { abi: dropsAbi, address: dropsAddress, functionName: 'allowlist', args: [BigInt(dropId), wallet], chainId },
    ]),
    query: { enabled },
  })

  const addWallet = () => {
    const value = draft.trim()
    if (!isAddress(value)) {
      toast('That is not a valid address', 'error')
      return
    }
    if (wallets.some((wallet) => wallet.toLowerCase() === value.toLowerCase())) {
      toast('That wallet is already on the list', 'error')
      return
    }
    if (extraWallets.length >= MAX_WALLETS) {
      toast(`That is the ${MAX_WALLETS}-wallet maximum`, 'error')
      return
    }

    const next = [...extraWallets, value]
    setExtraWallets(next)
    saveWallets(next)
    setDraft('')
  }

  const removeWallet = (wallet) => {
    const next = extraWallets.filter((entry) => entry.toLowerCase() !== wallet.toLowerCase())
    setExtraWallets(next)
    saveWallets(next)
  }

  // Open drops gate nobody, so there is nothing to check
  if (!phase || gate === DROP_GATES.OPEN || !dropsAddress) return null

  const perWallet = Number(phase.perWallet ?? 0)

  /** Why a wallet can't mint — the cheapest true statement, most specific first. */
  const reasonFor = (index) => {
    const minted = Number(results?.[index * 3 + 1]?.result ?? 0)
    const onAllowlist = results?.[index * 3 + 2]?.result

    if (perWallet > 0 && minted >= perWallet) return `Already minted ${minted} of ${perWallet}`
    if (gate === DROP_GATES.ALLOWLIST && onAllowlist === false) return 'Not on the allowlist'
    if (gate === DROP_GATES.FOLLOWERS) return `Doesn${'’'}t follow the creator`
    if (gate === DROP_GATES.ASSET_HOLDERS || gate === DROP_GATES.ASSET_HOLDERS_1155) return `Doesn${'’'}t hold enough of the gate asset`
    // Every gate passed, so what is left is the phase itself — closed, sold out, or not open yet
    return `Can${'’'}t mint right now`
  }

  return (
    <section className={styles.eligibility}>
      <header className={styles.eligibility__head}>
        <h3>Which of your wallets can mint</h3>
        <small>{gateLabel(gate)} — add your other wallets to check them all at once.</small>
      </header>

      {wallets.length === 0 ? (
        <p className={styles.eligibility__empty}>Connect a wallet, or add an address below.</p>
      ) : (
        <ul className={styles.eligibility__list}>
          {wallets.map((wallet, index) => {
            const canMint = results?.[index * 3]?.result === true
            const minted = Number(results?.[index * 3 + 1]?.result ?? 0)
            const isConnected = address && wallet.toLowerCase() === address.toLowerCase()
            const isCreator = creator && wallet.toLowerCase() === creator.toLowerCase()

            return (
              <li key={wallet} className={clsx(canMint && styles['eligibility__row--eligible'])}>
                <span className={styles.eligibility__verdict} aria-hidden="true">
                  {isLoading ? '…' : canMint ? <CheckCircleIcon size={16} weight="fill" /> : <XCircleIcon size={16} />}
                </span>

                <span className={styles.eligibility__who}>
                  <code title={wallet}>{shortAddress(wallet)}</code>
                  {isConnected && <em>connected</em>}
                  {isCreator && <em>creator</em>}
                </span>

                <span className={styles.eligibility__reason}>
                  {isLoading ? 'Checking…' : canMint ? (perWallet > 0 ? `Can mint ${perWallet - minted} more` : 'Can mint') : reasonFor(index)}
                </span>

                {!isConnected && (
                  <button type="button" onClick={() => removeWallet(wallet)} aria-label={`Remove ${wallet} from the list`}>
                    <XIcon size={12} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className={styles.eligibility__add}>
        <input
          type="text"
          value={draft}
          placeholder="0x… another wallet"
          onChange={(event) => setDraft(event.target.value.trim())}
          onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), addWallet())}
          spellCheck={false}
        />
        <button type="button" onClick={addWallet} disabled={!isAddress(draft)}>
          <PlusIcon size={13} />
          Add
        </button>
      </div>

      <p className={styles.eligibility__note}>
        Checked against the drop itself, so this matches what minting would do. Your list is kept in this browser only —
        adding a wallet here proves nothing and grants nothing.
      </p>
    </section>
  )
}
