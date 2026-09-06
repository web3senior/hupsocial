'use client'

import clsx from 'clsx'
import { appChains } from '@/config/contracts'
import { networkColorStyle } from '@/lib/networkColors'
import { templateTokenName } from '@/lib/dropUploadPlan'
import HupMark from '@/components/ui/HupMark'
import ProgressBar from '@/components/ui/ProgressBar'
import { ImageIcon } from '@phosphor-icons/react'
import styles from './DropPreviewCard.module.scss'

const countFormat = new Intl.NumberFormat('en')
const amountFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 4 })

// wagmi's config stamps iconUrl onto the shared chain objects; the inline `icon` SVG is the fallback
const chainIconFor = (chain) => {
  if (!chain) return null
  if (chain.iconUrl) return chain.iconUrl
  return chain.icon ? `data:image/svg+xml,${encodeURIComponent(chain.icon)}` : null
}

/**
 * Drop Preview Card
 * What the drop will look like once it exists, drawn from the form rather than from chain.
 *
 * DropCard cannot stand in here: every number it shows is a live read keyed by a drop id, and a
 * drop being filled in has neither. So this renders the same anatomy — artwork, price, supply,
 * progress — from the fields as they are typed, and stays deliberately inert.
 *
 * @param {Object} props
 * @param {number} props.chainId The chain the drop will deploy to — its colours, its icon.
 * @param {string} [props.imageUrl] Resolved artwork URL, empty until the collection image is picked.
 * @param {string} [props.markerUrl] Resolved icon URL for the progress marker — the square logo reads
 *   at 16px where the artwork cannot, which is why it is passed separately.
 * @param {string} [props.price] The first phase's price, as typed. Empty or 0 reads as free.
 * @param {string} [props.priceSymbol] What that price is denominated in — a payment token's ticker
 *   when the stage names one, the network's coin otherwise.
 * @param {number} [props.supply] 0 for an open edition.
 * @param {string} [props.tokenBaseName] Set for a numbered drop with a template — previews token #1.
 */
export default function DropPreviewCard({
  chainId,
  name,
  symbol,
  description,
  imageUrl,
  markerUrl,
  price,
  priceSymbol,
  supply = 0,
  standardLabel,
  tokenBaseName = '',
  tokenDescription = '',
  className,
}) {
  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const nativeSymbol = chainInfo?.nativeCurrency?.symbol ?? 'ETH'
  const chainIcon = chainIconFor(chainInfo)

  const priceNumber = Number(price)
  const isFree = !Number.isFinite(priceNumber) || priceNumber <= 0
  const priceLabel = isFree ? 'Free' : `${amountFormat.format(priceNumber)} ${priceSymbol || nativeSymbol}`
  const isOpenEdition = !supply

  const tokenName = tokenBaseName.trim() ? templateTokenName(tokenBaseName, 1) : ''
  const tokenBlurb = tokenName ? tokenDescription.replaceAll('{name}', tokenName) : ''

  return (
    // Colours come from the drop's chain, not the connected wallet's
    <figure className={clsx(styles.dropPreview, className)} style={networkColorStyle(chainInfo)}>
      <span className={styles.dropPreview__media}>
        {imageUrl ? (
          <img src={imageUrl} alt="" />
        ) : (
          <span className={styles.dropPreview__placeholder}>
            <ImageIcon size={26} weight="light" />
            Your artwork
          </span>
        )}

        <span className={styles.dropPreview__price}>
          {chainIcon && <img src={chainIcon} alt="" />}
          {priceLabel}
        </span>
      </span>

      <figcaption className={styles.dropPreview__info}>
        <span className={styles.dropPreview__nameRow}>
          <strong className={styles.dropPreview__name}>{name.trim() || 'Untitled Drop'}</strong>
          <span className={styles.dropPreview__ticker}>{symbol || 'DROP'}</span>
        </span>

        {description.trim() && <p className={styles.dropPreview__description}>{description.trim()}</p>}

        <span className={styles.dropPreview__stats}>
          <b>{priceLabel}</b>
          <em>{isOpenEdition ? 'Open edition' : `0/${countFormat.format(supply)}`}</em>
        </span>

        {!isOpenEdition && (
          <ProgressBar
            className={styles.dropPreview__progress}
            value={0}
            max={supply}
            height={5}
            color={chainInfo?.primaryColor}
            marker={markerUrl ? <img src={markerUrl} alt="" /> : <HupMark size={8} />}
            ariaLabel={`0 of ${countFormat.format(supply)} minted`}
          />
        )}

        {standardLabel && <span className={styles.dropPreview__standard}>{standardLabel}</span>}
      </figcaption>

      {/* Only a numbered drop has a token to preview — editions are copies of the card above */}
      {tokenName && (
        <div className={styles.dropPreview__token}>
          <strong>{tokenName}</strong>
          {tokenBlurb && <p>{tokenBlurb}</p>}
        </div>
      )}
    </figure>
  )
}
