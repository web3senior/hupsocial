'use client'

import Link from 'next/link'
import { toRelativeTimestamp } from '@/lib/dateHelper'
import { useProfile } from '@/hooks/useProfile'
import { profilePath } from '@/lib/username'
import { formatTokenAmount } from './formatTokenAmount'
import styles from './SaleCard.module.scss'

function excerptOf(content) {
  if (!content || typeof content !== 'object') return typeof content === 'string' ? content : ''
  const textElement = content.elements?.find((el) => el.type === 'text')
  return textElement?.data?.text || ''
}

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

// token_id arrives as bytes32 hex for both standards (ERC721 ids left-padded) —
// show the decimal id when it reads like one, shortened when astronomically large.
function shortTokenId(tokenId) {
  try {
    const id = BigInt(tokenId).toString()
    return id.length > 12 ? `${id.slice(0, 5)}…${id.slice(-4)}` : id
  } catch (e) {
    return shortAddress(tokenId)
  }
}

// Inline credit inside the meta line, so a text link rather than the Profile byline
// The row's name paints first — a cold profile fetch otherwise shows the bare address for seconds
function PayerName({ address, rowName, rowUsername }) {
  const fallback = rowName || rowUsername ? { wallet_address: address, name: rowName, username: rowUsername } : undefined
  const { profile } = useProfile(address, fallback)
  const name = profile?.username
    ? `@${profile.username}`
    : profile?.fullName || (profile?.name && profile.name !== 'new-user' ? profile.name : null)

  return (
    <Link href={profilePath(address, profile?.username)} title={address} className={styles.saleCard__payer}>
      {name || shortAddress(address)}
    </Link>
  )
}

export default function SaleCard({ sale }) {
  const isNft = sale.kind === 'nft'
  const isTip = sale.kind === 'tip'
  const excerpt = excerptOf(sale.content)

  return (
    <li className={styles.saleCard}>
      <span className={styles.saleCard__amount}>
        +{formatTokenAmount(sale.amount, sale.decimals)}
        <span className={styles.saleCard__symbol}>{sale.symbol}</span>
      </span>

      <span className={styles.saleCard__details}>
        {isNft ? (
          <span className={styles.saleCard__post}>
            NFT #{shortTokenId(sale.token_id)} · {shortAddress(sale.collection)}
          </span>
        ) : (
          <Link href={`/networks/${sale.network_id}/${sale.post_id}`} className={styles.saleCard__post}>
            {excerpt || `Post #${sale.post_id}`}
          </Link>
        )}
        <span className={styles.saleCard__meta}>
          {sale.quantity > 1 && <span className={styles.saleCard__quantity}>×{sale.quantity}</span>}
          <span>
            {isTip ? 'Tipped by ' : ''}
            <PayerName address={sale.payer} rowName={sale.payer_name} rowUsername={sale.payer_username} />
          </span>
          <span aria-hidden="true">·</span>
          <span>{toRelativeTimestamp(sale.at)}</span>
          {sale.network_name && <span className={styles.saleCard__network}>{sale.network_name}</span>}
        </span>
      </span>
    </li>
  )
}
