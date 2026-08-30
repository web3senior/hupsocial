import { cache } from 'react'
import PageTitle from '@/components/PageTitle'
import TokenPage from './_components/TokenPage'
import styles from './page.module.scss'

/**
 * One NFT's own page.
 *
 * Every token has a URL here, listed or not. That is the difference between this route and
 * /nfts/[networkId]/[listingId]: a listing is a HupTrade record that can be cancelled, sold and
 * replaced, while the token outlives all of them. Before this route existed an unlisted NFT could
 * only be opened as a dialog over the collection grid — nothing a reader could link anyone to,
 * which for the majority of tokens in any collection is most of them.
 *
 * The listing page keeps its own URL and its own job: the fee, the referral and the sale record
 * of one listing, which are facts about that row rather than about the NFT.
 */

// Server-side metadata read, mirroring the listing page. Hard-capped for the same reason: the
// token route can wait on a cold Universal Profile fulfillment, and that must cost the <title>
// its name rather than hold the whole navigation. The page body fetches its own data client-side.
const METADATA_FETCH_TIMEOUT_MS = 2500

const fetchTokenMetadata = cache(async (networkId, address, tokenId) => {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://localhost:3000'
  // The single-token read takes chainId (the batch sibling takes tokens[]) — see
  // api/v1/nfts/metadata. The standard isn't in the URL, so this asks as ERC721 and lets the
  // resolver fall through; the title is the only thing riding on it.
  const query = new URLSearchParams({ chainId: String(networkId), collection: address, tokenId })
  const response = await fetch(`${baseUrl}/api/v1/nfts/metadata?${query}`, {
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error('Token metadata fetch failed')
  return response.json()
})

export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent
  const { networkId, address, tokenId } = await params
  // Token ids are hex or decimal, so decoding is a no-op for all of them — done anyway because
  // the segment reaches here raw and an opaque LSP8 id needn't be
  const raw = decodeURIComponent(tokenId)
  const fallback = `NFT #${raw}`

  try {
    const res = await fetchTokenMetadata(networkId, address, raw)
    const token = res?.data ?? null
    const name = token?.name || fallback
    const collection = token?.collectionName ? ` · ${token.collectionName}` : ''

    return {
      title: `${name}${collection}`,
      description: token?.description || parentMetadata.description || 'Buy and sell NFTs inside posts on Hup.',
    }
  } catch {
    return {
      title: fallback,
      description: parentMetadata.description || 'Buy and sell NFTs inside posts on Hup.',
    }
  }
}

export default async function Page({ params }) {
  const { networkId, address, tokenId } = await params
  const raw = decodeURIComponent(tokenId)

  return (
    <>
      {/* Header clearance + initial title, like the listing page — the spacer must sit outside
          the rounded container. TokenPage re-titles with the NFT's name once metadata loads
          (its later effect wins), spacerless so the gap never doubles. */}
      <PageTitle name={`NFT #${raw}`} />
      <div className={styles.page}>
        <div className={`__container ${styles.page__container}`} data-width={`xlarge`}>
          <TokenPage networkId={networkId} collection={address} tokenId={raw} />
        </div>
      </div>
    </>
  )
}
