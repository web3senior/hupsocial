'use client'

import { useEffect, useState } from 'react'
import { formatUnits, hexToString } from 'viem'
import { usePublicClient } from 'wagmi'
import Profile from '@/components/Profile'
import styles from './PostTippers.module.scss'

// LSP7 has no symbol() — LSP4 metadata lives in ERC725Y storage, read via getData
// with the keccak256('LSP4TokenSymbol') data key
const LSP4_TOKEN_SYMBOL_KEY = '0x2f0a68ab07768e01943a599e73362a0e17a63a72e94dd2e384d2c1d4db932756'
const erc725yAbi = [
  {
    type: 'function',
    name: 'getData',
    stateMutability: 'view',
    inputs: [{ name: 'dataKey', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
]

// Compact ("1.2K") for large amounts, but sub-1 amounts keep their significant digits —
// compact's 2-fraction-digit rounding would collapse e.g. 0.00005 ETH to "0 ETH".
const formatTokenAmount = (n) =>
  new Intl.NumberFormat(undefined, n > 0 && n < 1 ? { maximumSignificantDigits: 4 } : { notation: 'compact', maximumFractionDigits: 2 }).format(n)

/**
 * Supporters strip on the post detail page — lists a post's tips (newest first) from the
 * cidex-indexed tips table via the post's tips API. Renders nothing until the post has at
 * least one tip.
 * @param {Object} props
 * @param {string|number} props.networkId The post's network id.
 * @param {string|number} props.postId The post's id.
 */
export default function PostTippers({ networkId, postId }) {
  const [tips, setTips] = useState(null)
  const [meta, setMeta] = useState(null)
  const [lsp4Symbols, setLsp4Symbols] = useState({})
  const publicClient = usePublicClient({ chainId: Number(networkId) })

  useEffect(() => {
    let cancelled = false

    fetch(`/api/v1/networks/${networkId}/${postId}/tips`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled || !body?.success) return
        setTips(body.data)
        setMeta(body.meta)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [networkId, postId])

  // Fallback for LSP7 tips the indexer cached under the generic 'tokens' label (rows
  // written before it learned to read LSP4 metadata): resolve the real symbol onchain
  // from ERC725Y storage, one read per distinct token
  useEffect(() => {
    if (!tips || !publicClient) return
    const targets = [
      ...new Set(tips.filter((t) => t.is_lsp7 && (!t.symbol || t.symbol === 'tokens')).map((t) => t.token)),
    ]
    if (targets.length === 0) return

    let cancelled = false
    Promise.all(
      targets.map(async (token) => {
        try {
          const data = await publicClient.readContract({
            address: token,
            abi: erc725yAbi,
            functionName: 'getData',
            args: [LSP4_TOKEN_SYMBOL_KEY],
          })
          if (data && data !== '0x') {
            const symbol = hexToString(data).trim()
            if (symbol) return [token, symbol]
          }
        } catch {}
        return null
      }),
    ).then((entries) => {
      if (!cancelled) setLsp4Symbols(Object.fromEntries(entries.filter(Boolean)))
    })

    return () => {
      cancelled = true
    }
  }, [tips, publicClient])

  if (!tips || tips.length === 0) return null

  const displaySymbol = (tip) =>
    tip.symbol && tip.symbol !== 'tokens' ? tip.symbol : lsp4Symbols[tip.token] ?? tip.symbol ?? ''

  return (
    <section className={`${styles.tippers} animate fade`}>
      <header className={styles.tippers__header}>
        <h3>Supporters</h3>
        <span className={styles.tippers__total}>
          {new Intl.NumberFormat('en', { notation: 'compact' }).format(meta.total)}{' '}
          {meta.total === 1 ? 'tip' : 'tips'}
        </span>
      </header>

      <ul className={styles.tippers__list}>
        {tips.map((tip) => (
          <li key={`${tip.tx_hash}-${tip.tipped_at}`} className={styles.tippers__item}>
            <Profile variant="fullWithoutTime" creator={tip.wallet_address} networkId={networkId} />
            <span className={styles.tippers__amount}>
              +{formatTokenAmount(Number(formatUnits(BigInt(tip.amount), tip.decimals ?? 18)))} {displaySymbol(tip)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
