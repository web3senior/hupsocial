'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { erc20Abi, getAddress } from 'viem'
import { useReadContracts } from 'wagmi'
import { SWAP_TOKENS } from '@/lib/tokens'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import NativeDialog from '@/components/ui/NativeDialog'
import TokenIcon from '@/components/ui/TokenIcon'
import { MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import styles from './TokenSelectDialog.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

const shortAddress = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '')

/**
 * Token Select Dialog
 * The swap form's token picker: the chain's native coin, the curated SWAP_TOKENS majors, and
 * every token launched on Hup (straight from the launches API — those pools are exactly what
 * the swap routes against). Pasting an address into the search reads its symbol/name onchain
 * and offers it as a custom entry, so nothing tradable is out of reach.
 *
 * Selection hands back either `{ native: true }` or `{ address, symbol, logo? }`.
 */
const TokenSelectDialog = forwardRef(function TokenSelectDialog({ chainId, chain, nativeEntry, onSelect }, ref) {
  const dialogRef = useRef(null)
  const [query, setQuery] = useState('')

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setQuery('')
        dialogRef.current?.open()
      },
      close: () => dialogRef.current?.close(),
    }),
    [],
  )

  const { data: launchData } = useSWR(
    chainId ? `/api/v1/launches?scope=trending&networkId=${chainId}&limit=30` : null,
    fetcher,
  )

  const trimmed = query.trim()
  // Any casing accepted (getAddress from lowercase skips EIP-55 checking): the onchain symbol
  // read below is the real validation, so a paste with a mangled checksum still resolves
  const isFullAddress = /^0x[0-9a-fA-F]{40}$/.test(trimmed)
  const customAddress = isFullAddress ? getAddress(trimmed.toLowerCase()) : null
  // A 0x… string of the wrong length is a mis-paste — say so instead of showing nothing
  const isPartialAddress = !isFullAddress && /^0x[0-9a-fA-F]{2,}$/.test(trimmed)

  const { data: customMeta } = useReadContracts({
    contracts: [
      { abi: erc20Abi, address: customAddress ?? undefined, functionName: 'symbol', chainId },
      { abi: erc20Abi, address: customAddress ?? undefined, functionName: 'name', chainId },
    ],
    query: { enabled: Boolean(customAddress && chainId) },
  })
  const customSymbol = customMeta?.[0]?.status === 'success' ? customMeta[0].result : null
  const customName = customMeta?.[1]?.status === 'success' ? customMeta[1].result : null
  // Lookup finished but symbol() never answered → whatever lives there, it isn't an ERC20
  const customFailed = Boolean(customAddress && customMeta && customMeta[0]?.status !== 'success')

  const rows = useMemo(() => {
    const curated = (SWAP_TOKENS[chainId] ?? []).map((token) => ({ ...token }))
    const launched = (launchData?.data ?? []).map((launch) => ({
      address: launch.token,
      symbol: launch.symbol,
      name: launch.name,
      logo: launch.image_cid ? resolveStorageImageUrl(launch.image_cid) : null,
      isLaunch: true,
    }))

    const seen = new Set()
    // The "chain's own coin" row comes from the form: {native:true} normally, the CELO-style
    // native ERC20 on chains where the coin is a token
    const nativeRow = nativeEntry ?? { native: true }
    const all = [
      {
        ...nativeRow,
        symbol: nativeRow.symbol ?? chain?.nativeCurrency?.symbol ?? 'ETH',
        name: nativeRow.name ?? chain?.nativeCurrency?.name ?? 'Native coin',
        logo: nativeRow.logo ?? chain?.iconUrl ?? null,
      },
      ...curated,
      ...launched,
    ].filter((token) => {
      const key = token.native ? 'native' : token.address?.toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })

    if (!trimmed || customAddress) return all

    const needle = trimmed.toLowerCase()
    return all.filter(
      (token) => token.symbol?.toLowerCase().includes(needle) || token.name?.toLowerCase().includes(needle),
    )
  }, [chainId, chain, nativeEntry, launchData, trimmed, customAddress])

  const customKnown = Boolean(
    customAddress && rows.some((token) => token.address?.toLowerCase() === customAddress.toLowerCase()),
  )

  const pick = (token) => {
    onSelect?.(token)
    dialogRef.current?.close()
  }

  return (
    <NativeDialog ref={dialogRef} className={styles.tokenDialog} lightDismiss>
      <header className={styles.tokenDialog__header}>
        <h3>Select a token</h3>
        <button
          type="button"
          className={styles.tokenDialog__close}
          aria-label="Close"
          onClick={() => dialogRef.current?.close()}
        >
          <XIcon size={18} />
        </button>
      </header>

      <label className={styles.tokenDialog__search}>
        <MagnifyingGlassIcon size={15} />
        <input
          type="search"
          value={query}
          placeholder="Search name or paste address"
          aria-label="Search tokens"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <ul className={styles.tokenDialog__list}>
        {isPartialAddress && (
          <li className={styles.tokenDialog__empty}>
            That looks like a cut-off address — a full token address is 0x plus 40 characters ({trimmed.length}/42).
          </li>
        )}

        {customAddress && !customKnown && customFailed && (
          <li className={styles.tokenDialog__empty}>No token found at this address on {chain?.name ?? 'this network'}.</li>
        )}

        {customAddress && !customKnown && !customFailed && (
          <li>
            <button
              type="button"
              className={styles.tokenDialog__row}
              disabled={!customSymbol}
              onClick={() => pick({ address: customAddress, symbol: customSymbol })}
            >
              <TokenIcon token={{ address: customAddress }} chainId={chainId} />
              <span className={styles.tokenDialog__identity}>
                <strong>{customSymbol ?? 'Reading token…'}</strong>
                <small>{customSymbol ? `${customName} · ${shortAddress(customAddress)}` : shortAddress(customAddress)}</small>
              </span>
            </button>
          </li>
        )}

        {rows.map((token) => (
          <li key={token.native ? 'native' : token.address}>
            <button type="button" className={styles.tokenDialog__row} onClick={() => pick(token)}>
              <TokenIcon token={token} chainId={chainId} />
              <span className={styles.tokenDialog__identity}>
                <strong>{token.symbol}</strong>
                <small>{token.name ?? shortAddress(token.address)}</small>
              </span>
              {token.isLaunch && <em className={styles.tokenDialog__badge}>Hup launch</em>}
            </button>
          </li>
        ))}

        {rows.length === 0 && !customAddress && !isPartialAddress && (
          <li className={styles.tokenDialog__empty}>No tokens match.</li>
        )}
      </ul>
    </NativeDialog>
  )
})

export default TokenSelectDialog
