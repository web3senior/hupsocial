'use client'

// Small display pieces that put an amount in the unit a human reads it in. Each resolves its own
// asset metadata, so a list of requirement rows can render one per row without the parent
// juggling a hook per address.

import { formatTokenDisplay, useTokenMeta } from '../tokenUnits'

/**
 * Card tag for an ERC-20/LSP7 balance requirement, in whole tokens ("min 100 USDC") instead of
 * the raw onchain integer.
 *
 * `resolvedMeta` ({ symbol, decimals }) short-circuits the reads. cidex resolves every gating
 * asset once at index time, so the directory hands them down rather than making each chip ask
 * the token for its own decimals and symbol — that was two eth_calls per requirement, per card.
 */
export function TokenRequirementTag({ address, chainId, minBalance, className, resolvedMeta = null }) {
  // A resolved asset passes a null address, which keeps the hook mounted (rules of hooks) while
  // giving it nothing to fetch
  const live = useTokenMeta(resolvedMeta ? null : address, chainId)
  const { decimals, symbol } = resolvedMeta ?? live
  const amount = formatTokenDisplay(minBalance, decimals)

  return (
    <span className={className} title={`Contract: ${address}`}>
      {symbol ? `min ${amount ?? '…'} ${symbol}` : `Token: min ${amount ?? '…'}`}
    </span>
  )
}

/**
 * Unit suffix for a token amount field. A blank asset is the chain's native coin (that is how a
 * "Token or coin balance" row spells NativeBalance), so it shows the coin's symbol; a half-typed
 * address stays silent until it resolves to a real token.
 */
export function TokenUnitHint({ address, chainId, className }) {
  const { symbol } = useTokenMeta(address, chainId)
  if (!symbol) return null
  return (
    <span className={className} style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
      {symbol}
    </span>
  )
}

/**
 * The unit an amount field is entered in, for its label — "(USDC)", or the chain's coin when the
 * address is blank (which is how the payment fields spell "native coin").
 */
export function AssetUnitLabel({ address, chainId }) {
  const { symbol, isNative } = useTokenMeta(address, chainId)
  if (symbol) return <>({symbol})</>
  // An unresolved symbol (half-typed address, or an LSP7 with no LSP4 metadata) still has to say
  // which scale the field is in — that's the part people get wrong
  return isNative ? null : <>(whole tokens)</>
}
