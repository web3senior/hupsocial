'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { formatUnits, zeroAddress } from 'viem'
import { ArrowRightIcon, LightningIcon } from '@phosphor-icons/react'
import { appChains } from '@/config/contracts'
import useCollectionDrop from '@/hooks/useCollectionDrop'
import { usePaymentToken } from '@/hooks/usePaymentToken'
import { PHASE_STATUS, phaseStatus } from '@/lib/drops'
import styles from './CollectionMintLink.module.scss'

const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 4 })

export default function CollectionMintLink({ chainId, collection }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const { dropId, drop, phases } = useCollectionDrop({ chainId, collection })
  const phase = phases.find((entry) => phaseStatus(entry, now) === PHASE_STATUS.LIVE &&
    (BigInt(entry.allocation ?? 0) === 0n || BigInt(entry.minted ?? 0) < BigInt(entry.allocation)))
  const token = phase?.token && phase.token !== zeroAddress ? phase.token : null
  const payment = usePaymentToken(chainId, token)
  const native = appChains.find((chain) => chain.id === chainId)?.nativeCurrency
  const decimals = token ? payment.decimals : native?.decimals
  const symbol = token ? payment.symbol : native?.symbol

  if (!dropId || !drop || drop.closed || !phase ||
    (BigInt(drop.maxSupply) > 0n && BigInt(drop.minted) >= BigInt(drop.maxSupply))) return null

  const price = BigInt(phase.price)
  const priceLabel = price === 0n ? 'Free' : decimals != null && symbol
    ? `${amountFormat.format(Number(formatUnits(price, decimals)))} ${symbol}`
    : null

  return (
    <Link href={`/drops/${chainId}/${dropId}`} className={styles['mint-link']}>
      <LightningIcon size={18} weight="fill" aria-hidden="true" />
      <span className={styles['mint-link__body']}>
        <strong>Mint available{priceLabel ? ` · ${priceLabel}` : ''}</strong>
        <span>Mint a new piece from this collection · View mint details and fees</span>
      </span>
      <ArrowRightIcon size={18} aria-hidden="true" />
    </Link>
  )
}
