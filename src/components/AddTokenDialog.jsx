'use client'

import { useEffect, useRef, useState } from 'react'
import { useConfig, useConnection } from 'wagmi'
import { readContract } from 'wagmi/actions'
import { erc20Abi } from 'viem'
import { appChains } from '@/config/contracts'
import { normalizeAddress } from '@/lib/walletAssets'
import NativeDialog from './ui/NativeDialog'
import styles from './AddTokenDialog.module.scss'

/**
 * AddTokenDialog
 * Pins a token address so the Assets tab probes it alongside the curated list. Only LUKSO can
 * enumerate a wallet's holdings outright, so on every other chain this is how an unlisted token
 * becomes visible at all.
 *
 * Mount = open / unmount = close, matching the other dialogs.
 */
export default function AddTokenDialog({ onPin, onClose }) {
  const dialogRef = useRef(null)
  const config = useConfig()
  const { chain: walletChain } = useConnection()

  const defaultChainId = appChains.some((chain) => chain.id === walletChain?.id) ? walletChain.id : appChains[0].id
  const [chainId, setChainId] = useState(defaultChainId)
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const [isChecking, setIsChecking] = useState(false)

  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    const tokenAddress = normalizeAddress(address)
    if (!tokenAddress) {
      setError("That isn't a valid token address.")
      return
    }

    setError('')
    setIsChecking(true)
    try {
      // decimals() shares its selector on ERC20 and LSP7, so one probe confirms either shape —
      // and a plain EOA or unrelated contract fails it, which is the point
      await readContract(config, { address: tokenAddress, abi: erc20Abi, functionName: 'decimals', chainId: Number(chainId) })
      onPin?.(Number(chainId), tokenAddress)
      dialogRef.current?.close()
    } catch {
      setError('No token found at that address on this network.')
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.addToken}
      aria-label="Add a token"
      onClick={(event) => event.stopPropagation()}
      onClose={(event) => {
        event.stopPropagation()
        onClose?.()
      }}
    >
      <header className={styles.addToken__header}>
        <button type="button" className={styles.addToken__cancel} onClick={() => dialogRef.current?.close()} disabled={isChecking}>
          Cancel
        </button>
        <h2 className={styles.addToken__title}>Add a token</h2>
      </header>

      <form className={styles.addToken__body} onSubmit={handleSubmit}>
        <div className={styles.addToken__field}>
          <label htmlFor="addTokenNetwork">Network</label>
          <select id="addTokenNetwork" value={chainId} onChange={(event) => setChainId(Number(event.target.value))} disabled={isChecking}>
            {appChains.map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.addToken__field}>
          <label htmlFor="addTokenAddress">Token contract address</label>
          <input
            type="text"
            id="addTokenAddress"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="0x..."
            autoComplete="off"
            spellCheck={false}
            disabled={isChecking}
          />
          {error && <span className={styles.addToken__error}>{error}</span>}
        </div>

        <p className={styles.addToken__hint}>Tracked in this browser only — it changes what gets checked, not the wallet itself.</p>

        <button type="submit" className={styles.addToken__submit} disabled={isChecking || !address.trim()}>
          {isChecking ? 'Checking…' : 'Add token'}
        </button>
      </form>
    </NativeDialog>
  )
}
