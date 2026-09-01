import { getViewerId } from './viewer'
import { normalizeAddress } from './address'

export const getProfile= async (address) => {
  // Determine the base URL based on the environment
  const isServer = typeof window === 'undefined'
  const baseUrl = isServer ? process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000' : ''
  const url = `${baseUrl}/api/v1/users/profile/${normalizeAddress(address)}`

  // Server-side (generateMetadata) hits the Next data cache so repeat navigations
  // to the same profile skip the DB + LUKSO round-trip; browsers ignore `next`.
  const response = await fetch(url, { next: { revalidate: 60 } })
  if (response.status === 404) return null
  if (!response.ok) throw new Error('Profile fetch failed')
  const data = await response.json()
  return data
}

/**
 * The community tags this wallet may wear, for the profile editor's badge picker.
 * @param {string} address
 * @returns {Promise<object[]>} Eligible badges, or an empty list if the read fails — an
 *   unreachable picker should leave the rest of the edit form usable.
 */
export const getUserBadges = async (address) => {
  try {
    const response = await fetch(`/api/v1/users/${normalizeAddress(address)}/badges`)
    if (!response.ok) return []
    const data = await response.json()
    return Array.isArray(data?.data) ? data.data : []
  } catch (error) {
    console.error('Badge fetch failed:', error)
    return []
  }
}

/**
 * Every country the profile editor's origin picker may offer, straight from the `countries`
 * table the save then validates against — so the picker can never offer one the setter rejects.
 *
 * Memoised for the page's lifetime, on the promise rather than the result, so opening the editor
 * twice (or twice at once) is a single request. A failed load is not cached: it resolves empty,
 * leaves the promise slot clear, and the next open tries again.
 * @returns {Promise<Array<{name: string, iso_code: string}>>}
 */
let countriesPromise = null
export const getCountries = () => {
  if (!countriesPromise) {
    countriesPromise = fetch('/api/v1/countries')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => (Array.isArray(data?.data) ? data.data : []))
      .catch((error) => {
        console.error('Country fetch failed:', error)
        return []
      })
      .then((list) => {
        if (list.length === 0) countriesPromise = null
        return list
      })
  }

  return countriesPromise
}

/**
 * Get Universal Profile via internal API proxy
 * @param {string} addr
 * @returns {Promise<Object>}
 */
export async function getUniversalProfile(addr) {
  /* Call your internal Next.js API route */
  const response = await fetch('/api/universal-profile/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ addr }),
  })

  if (!response.ok) {
    throw new Error('Failed to fetch profile through proxy')
  }

  /* The response now comes from your own domain, so no CORS error! */
  const result = await response.json()
  return result.data
}

export async function ensureProfile(address) {
  const res = await fetch(`/api/v1/users/profile/${normalizeAddress(address)}`, {
    method: 'POST',
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error('Failed to ensure profile')
  }

  return res.json()
}
export const getPosts = async (page = 1, limit = 20, networkId = null, walletAddress = null, viewerAddress = null, communityId = null, feedType = null, excludeNft = false, postType = null) => {
  /* Construct the URL with query parameters */
  let url = `/api/v1/networks/posts?page=${page}&limit=${limit}`

  if (feedType) {
    url += `&feed_type=${feedType}`
  }

  /* 'original' drops repost rows, 'repost' keeps only them — the profile's Posts/Reposts split */
  if (postType) {
    url += `&post_type=${postType}`
  }

  if (excludeNft) {
    url += `&exclude_nft=1`
  }

  if (networkId) {
    url += `&network_id=${networkId}`
  }

  if (walletAddress) {
    url += `&wallet_address=${walletAddress}`
  }

  if (viewerAddress) {
    url += `&viewer_address=${viewerAddress}`
  }

  if (communityId) {
    url += `&community_id=${communityId}`
  }

  const response = await fetch(url)
  if (!response.ok) throw new Error('Failed to fetch posts')

  return response.json()
}

/**
 * Get NFT Listings
 * Lists HupTrade NFT listings straight from the indexed nft_listings table (not
 * posts) for the NFT Market grid. `filters` mirrors the API's own query params —
 * pass only the ones you want applied.
 * @param {number} page
 * @param {number} limit
 * @param {Object} [filters]
 * @param {number|string} [filters.networkId]
 * @param {string} [filters.collection] Collection contract address.
 * @param {'active'|'sold'|'active_sold'|'all'} [filters.status] Cancelled listings are never
 * served — 'all' means everything still on the market (active + sold).
 * @param {'lsp8'|'erc721'} [filters.standard]
 * @param {'native'|string} [filters.token] Payment token address, or 'native'.
 * @param {string} [filters.minPrice] Base units (decimal string).
 * @param {string} [filters.maxPrice] Base units (decimal string).
 * @param {string} [filters.seller] Wallet address or username fragment.
 * @param {'any'|'none'|string} [filters.referral] Referral share: 'any' (pays anything),
 * 'none' (pays nothing), or a minimum in basis points ('500' for 5%+).
 * @param {string} [filters.traits] JSON array of {label, value} trait pairs, e.g.
 * `[{"label":"Eyes","value":"Laser"}]`. Values sharing a label are ORed, labels are ANDed.
 * Matches against the cached token metadata, so tokens nobody has viewed yet are excluded —
 * getNftCollectionTraits reports that coverage alongside the options.
 * @param {'newest'|'oldest'|'price_asc'|'price_desc'|'referral_desc'|'recently_sold'} [filters.sort]
 */
export const getNftListings = async (page = 1, limit = 24, filters = {}) => {
  const params = new URLSearchParams({ page, limit })
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') params.set(key, value)
  })

  const response = await fetch(`/api/v1/nfts?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch NFT listings')

  return response.json()
}

/**
 * Get NFT Payment Tokens
 * The currencies sellers have actually listed in, for the NFT Market's payment-token filter.
 * Read off the indexed nft_listings table, so it covers tokens no curated config knows about.
 * Rows carry `is_native`, `symbol`/`decimals` (null until the indexer names the token) and a
 * `listing_count` — the client labels and orders the <select> from those.
 * @param {string|number} [networkId] Restrict to one chain; omitted returns every chain's.
 */
export const getNftPaymentTokens = async (networkId) => {
  const params = new URLSearchParams()
  if (networkId) params.set('networkId', networkId)

  const response = await fetch(`/api/v1/nfts/tokens?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch NFT payment tokens')

  return response.json()
}

/**
 * Get NFT Sellers
 * Seller suggestions for the NFT Market's "Seller" typeahead — wallets that actually have
 * listings, matched by display name or wallet-address prefix. An empty query returns the
 * most active sellers. Rows carry `wallet_address`, `display_name`, `profile_image` and
 * `listing_count`.
 * @param {string} [q] Name fragment or wallet-address prefix.
 * @param {string|number} [networkId] Restrict to one chain; omitted searches every chain.
 */
export const getNftSellers = async (q, networkId) => {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (networkId) params.set('networkId', networkId)

  const response = await fetch(`/api/v1/nfts/sellers?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch NFT sellers')

  return response.json()
}

/**
 * Collections with live HupTrade listings, for the NFT Market hero. Names and artwork are
 * resolved client-side from the sample token ids each row carries — collection metadata
 * isn't indexed anywhere server-side.
 * @param {number} [limit=12] Collections to return (server caps at 24).
 * @param {string|number} [networkId] Restrict to one chain.
 */
export const getNftCollections = async (limit = 12, networkId) => {
  const params = new URLSearchParams({ limit })
  if (networkId) params.set('networkId', networkId)

  const response = await fetch(`/api/v1/nfts/collections?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch NFT collections')

  return response.json()
}

/**
 * The collections leaderboard — one row per collection with floor, best live offer, 24h
 * volume and its move against the previous 24h, 24h sales, lifetime volume, supply and
 * active listings. Ranked server-side, because a stat can only order the market if it was
 * computed across all of it (see the ranking route).
 *
 * Each row also carries what nft_collection_cache holds for the collection — name, icon,
 * banner, total supply — so the ranking table and the featured banner print identity from
 * the same response rather than reading it per row.
 *
 * Prices arrive as base-unit strings in each collection's dominant payment token, with the
 * symbol and decimals alongside — native-coin rows carry null for both and the caller fills
 * them from its chain config.
 * @param {Object} [options]
 * @param {number} [options.limit=50] Rows to return (server caps at 100).
 * @param {string|number} [options.networkId] Restrict to one chain.
 * @param {string} [options.sort='volume24h'] One of volume24h, volumeTotal, sales24h,
 * change24h, floor, bestOffer, marketCap, listed, supply. Anything else falls back to the
 * default rather than erroring.
 */
export const getNftCollectionRanking = async ({ limit = 50, networkId, sort } = {}) => {
  const params = new URLSearchParams({ limit })
  if (networkId) params.set('networkId', networkId)
  if (sort) params.set('sort', sort)

  const response = await fetch(`/api/v1/nfts/collections/ranking?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch the collections ranking')

  return response.json()
}

/**
 * Daily floor series for several collections at once, for the market rail's card sparklines.
 * Batched deliberately — a request per card would be a dozen round trips on every page load.
 *
 * Each row carries `points` (`[{date, floor}]`, floor null on days nothing was live) and
 * `change_pct` over the window, both quoted in the collection's dominant payment token. The
 * floor is reconstructed from listing lifetimes, not snapshotted — see lib/nftFloorHistory.
 * @param {Array<{network_id: number|string, collection: string}>} collections Rows as the
 * collections rollup returns them; server caps the batch at 24.
 * @param {number} [days=30] Window length (server clamps to 2–180).
 */
export const getNftCollectionsHistory = async (collections, days = 30) => {
  if (!collections?.length) return { success: true, data: [] }

  const params = new URLSearchParams({
    collections: collections.map((row) => `${row.network_id}:${row.collection.toLowerCase()}`).join(','),
    days,
  })

  const response = await fetch(`/api/v1/nfts/collections/history?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch NFT collection history')

  return response.json()
}

/**
 * One collection's daily floor series, for the collection page's floor chart. A row from
 * getNftCollectionsHistory plus what actually traded, over whatever window the range picker
 * is on: `sales` (`[{date, avg, low, high, count}]`, only days that had a trade) and
 * `last_sale` (`{date, sold_at, price}` or null). Sales are quoted in the same dominant token
 * as the floor — one in another currency is dropped rather than mixed into the axis.
 * @param {string|number} networkId Chain the collection lives on.
 * @param {string} address Collection contract address.
 * @param {number} [days=30] Window length (server clamps to 2–180).
 */
export const getNftCollectionHistory = async (networkId, address, days = 30) => {
  const params = new URLSearchParams({ days })

  const response = await fetch(`/api/v1/nfts/collections/${networkId}/${address.toLowerCase()}/history?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch collection floor history')

  return response.json()
}

/**
 * Get NFT Collection Stats
 * Lifetime HupTrade market stats for one collection — `volume` and `highest_sale` in base
 * units, `sale_count`, `items_sold` (distinct NFTs that changed hands) and `currencies`.
 * Volume and the high sale are quoted in the collection's dominant payment token, never
 * summed across currencies; `symbol`/`decimals` are null for the native coin, so fill both
 * in from the chain config like the floor chart does. Powers the collection header's stat row.
 * @param {string|number} networkId Chain the collection lives on.
 * @param {string} address Collection contract address.
 */
export const getNftCollectionStats = async (networkId, address) => {
  const response = await fetch(`/api/v1/nfts/collections/${networkId}/${address.toLowerCase()}/stats`)
  if (!response.ok) throw new Error('Failed to fetch collection stats')

  return response.json()
}

/**
 * Get NFT Collection Info
 * Collection-level display metadata for one contract — name, symbol, banner, icon,
 * description, LSP4Creators[] addresses and total supply — from the server-side
 * nft_collection_cache. Powers the collection page header and the listing page's
 * "about the collection" strip.
 * @param {string|number} networkId Chain the collection lives on.
 * @param {string} address Collection contract address.
 * @param {boolean} [isLsp8] Standard hint when the caller holds a listing row; omitted,
 * the server infers it from the listings index or an onchain probe.
 */
export const getNftCollectionInfo = async (networkId, address, isLsp8) => {
  const suffix = typeof isLsp8 === 'boolean' ? `?isLsp8=${isLsp8 ? '1' : '0'}` : ''

  const response = await fetch(`/api/v1/nfts/collections/${networkId}/${address.toLowerCase()}${suffix}`)
  if (!response.ok) throw new Error('Failed to fetch collection info')

  return response.json()
}

/**
 * Get NFT Collection Traits
 * The trait facets for one collection's listed tokens — `[{label, values: [{value, count}]}]`,
 * labels sorted alphabetically and values by how many tokens carry them. Powers the collection
 * page's attribute filter, whose selections go back to getNftListings as `filters.traits`.
 *
 * Traits come from the cached token metadata, which fills in as tokens are rendered, so the
 * response's `meta` carries `listed` (tokens the view can show) and `resolved` (of those, how
 * many have metadata cached) — the panel says so rather than implying the list is complete.
 * @param {string|number} networkId Chain the collection lives on.
 * @param {string} address Collection contract address.
 * @param {'active'|'sold'|'active_sold'|'all'} [status] Scope the counts to the same listing
 * status the grid is showing; defaults to active. Cancelled listings are never counted.
 * @param {Object} [options]
 * @param {'listed'|'collection'} [options.scope] 'listed' (default) counts only tokens the grid
 * can show — what a filter panel needs. 'collection' counts every cached token, listed or not,
 * which is the only honest denominator for a rarity share.
 * @param {boolean} [options.floor] Adds each value's lowest live ask (`floor`, base units) so a
 * trait card can price itself. `meta.floor` names the single currency they were taken in.
 */
export const getNftCollectionTraits = async (networkId, address, status, options = {}) => {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (options.scope) params.set('scope', options.scope)
  if (options.floor) params.set('floor', '1')
  const query = params.toString()

  const response = await fetch(`/api/v1/nfts/collections/${networkId}/${address.toLowerCase()}/traits${query ? `?${query}` : ''}`)
  if (!response.ok) throw new Error('Failed to fetch collection traits')

  return response.json()
}

/**
 * Get NFT Collection Top Offers
 * The best live offer on each token of one collection — one row per token that has one, in
 * the currency it was bid in. Active and unexpired only, so every number is one a seller
 * could accept right now. `symbol`/`decimals` are null for the native coin; fill both in
 * from the chain config like every other price.
 * @param {string|number} networkId Chain the collection lives on.
 * @param {string} address Collection contract address.
 */
export const getNftCollectionTopOffers = async (networkId, address) => {
  const response = await fetch(`/api/v1/nfts/collections/${networkId}/${address.toLowerCase()}/offers`)
  if (!response.ok) throw new Error('Failed to fetch collection offers')

  return response.json()
}

/**
 * Get NFT Collection Rarity
 * The collection's trait-rarity ranking as one array of token ids, best first — index + 1 is
 * a token's rank. Ranks cover only the tokens whose metadata Hup has resolved (`meta.ranked`),
 * never the full supply, so print that denominator rather than the collection's size.
 * @param {string|number} networkId Chain the collection lives on.
 * @param {string} address Collection contract address.
 */
export const getNftCollectionRarity = async (networkId, address) => {
  const response = await fetch(`/api/v1/nfts/collections/${networkId}/${address.toLowerCase()}/rarity`)
  if (!response.ok) throw new Error('Failed to fetch collection rarity')

  return response.json()
}

/**
 * Get NFT Collection Tokens
 * The tokens of one collection this app has seen (nft_metadata_cache rows), each with its live
 * listing when it has one — the whole-collection browse's fallback source for contracts that
 * can't enumerate themselves. `meta.total` counts every cached token, so the view can say how
 * much of the supply it covers.
 * @param {string|number} networkId Chain the collection lives on.
 * @param {string} address Collection contract address.
 * @param {number} [page] 1-based page.
 * @param {number} [limit] Tokens per page, capped server-side at 60.
 */
export const getNftCollectionTokens = async (networkId, address, page = 1, limit = 24) => {
  const params = new URLSearchParams({ page, limit })

  const response = await fetch(`/api/v1/nfts/collections/${networkId}/${address.toLowerCase()}/tokens?${params.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch collection tokens')

  return response.json()
}

/**
 * Get NFT Token Market
 * Everything the market knows about one token, in one request: its live listing (shaped like a
 * row of getNftListings, so TradeCard takes it directly), the best offer anyone could accept
 * right now, its whole activity timeline, and its sale series for the price chart.
 *
 * Every priced row carries its own `symbol`/`decimals` — both null for the native coin, filled
 * in from the chain config like every other price in the app — because one token can be listed
 * in one currency and bid on in another.
 * @param {string|number} networkId Chain the collection lives on.
 * @param {string} address Collection contract address.
 * @param {string} tokenId Raw token id — bytes32 hex for LSP8, decimal for ERC721. Either
 * dialect resolves; the route matches both forms.
 */
export const getNftTokenMarket = async (networkId, address, tokenId) => {
  const path = `/api/v1/nfts/collections/${networkId}/${address.toLowerCase()}/tokens/${encodeURIComponent(tokenId)}`

  const response = await fetch(path)
  if (!response.ok) throw new Error('Failed to fetch token market data')

  return response.json()
}

/**
 * Refresh Collection Metadata
 * Re-reads a batch of one collection's cached tokens from chain, for a collection that changed
 * its onchain metadata. One call does not necessarily finish the job — the returned
 * `remaining` says how many stale tokens are still queued, and the caller repeats until it is
 * zero. Use the useCollectionMetadataRefresh hook rather than calling this directly; it owns
 * the loop and the cache invalidation that has to follow.
 * @param {number|string} chainId
 * @param {string} collection NFT contract address.
 * @returns {Promise<{total: number, processed: number, refreshed: number, failed: number, remaining: number}>}
 */
export const refreshNftCollectionMetadata = async (chainId, collection) => {
  const response = await fetch('/api/v1/nfts/metadata/refresh/collection', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chainId: Number(chainId), collection }),
  })

  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.success) throw new Error(body?.error || `Collection refresh failed (${response.status})`)

  return body.data
}

export const getFollowingPosts = async (networkId, viewerAddress, page = 1, limit = 20) => {
  const url = `/api/v1/networks/posts?feed_type=following&page=${page}&limit=${limit}&network_id=${networkId}&viewer_address=${viewerAddress}`

  const response = await fetch(url)
  if (!response.ok) throw new Error('Failed to fetch following posts')

  return response.json()
}

export const getTrendingPosts = async (page = 1, limit = 20, networkId = null, viewerAddress = null) => {
  let url = `/api/v1/networks/posts?feed_type=trending&page=${page}&limit=${limit}`

  if (networkId) {
    url += `&network_id=${networkId}`
  }

  if (viewerAddress) {
    url += `&viewer_address=${viewerAddress}`
  }

  const response = await fetch(url)
  if (!response.ok) throw new Error('Failed to fetch trending posts')

  return response.json()
}

export const getStatuses = async (page = 1, limit = 20, networkId = null) => {
  let url = `/api/v1/networks/statuses?page=${page}&limit=${limit}`

  if (networkId) {
    url += `&network_id=${networkId}`
  }

  const response = await fetch(url)
  if (!response.ok) throw new Error('Failed to fetch statuses')

  return response.json()
}

export const getPostById = async (networkId, postId, viewerAddress = null) => {
  // Determine the base URL based on the environment
  const isServer = typeof window === 'undefined'
  const baseUrl = isServer ? process.env.NEXT_PUBLIC_BASE_URL || 'https://localhost:3000' : ''

  const path = viewerAddress
    ? `/api/v1/networks/${networkId}/${postId}?viewer_address=${viewerAddress}`
    : `/api/v1/networks/${networkId}/${postId}`

  const url = `${baseUrl}${path}`

  const response = await fetch(url, { next: { revalidate: 30 } })
  if (!response.ok) throw new Error('Post fetch failed')
  const data = await response.json()
  return data
}
// getCommunityById lived here and self-fetched /api/v1/networks/communities/[id] over HTTP. The
// only caller was the community detail page, which runs on the server next to the database and now
// calls fetchCommunityRow() in lib/communityRows directly instead.

export const recordProfileView = async (address, walletAddress = null) => {
  try {
    const viewerId = getViewerId(walletAddress)
    const url = `/api/v1/users/${normalizeAddress(address)}/view`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ viewer_id: viewerId }),
    })

    return await response.json()
  } catch (error) {
    console.error('Profile view tracking failed:', error)
  }
}

export const recordPostView = async (networkId, postId, walletAddress = null) => {
  try {
    /* Resolve the identity (Wallet or Guest UUID) */
    const viewerId = getViewerId(walletAddress)

    /* Construct the dynamic URL using the database primary key */
    const url = `/api/v1/networks/${networkId}/${postId}/view`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ viewer_id: viewerId }),
    })

    return await response.json()
  } catch (error) {
    /* Fail silently to avoid interrupting the user's reading experience */
    console.error('View tracking failed:', error)
  }
}

/**
 * Get local token
 * @returns string
 */
const getLocalToken = () => {
  if (localStorage.getItem('token') === null) return
  return localStorage.getItem('token').slice(1, localStorage.getItem('token').length - 1)
}

/**
 * Sends updated profile details to the server backend.
 * @param {FormData} formData - The multi-part form data payload containing profile fields.
 * @param {string} address - The wallet address identifying the account to update.
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
export const updateProfile = async (formData, address) => {
  try {
    // Hits the Next.js API route you just created
    const response = await fetch(`/api/v1/users/profile/${address}`, {
      method: 'PUT',
      body: formData, // Passes the FormData object directly; content headers are set automatically
    })

    const data = await response.json()

    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to update profile' }
    }

    return { success: true, message: data.message }
  } catch (error) {
    console.error('API Client Error:', error)
    return { success: false, error: 'Network communication error' }
  }
}

export async function getViewPost(chainId, postId) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const params = new URLSearchParams({ chain_id: chainId, post_id: postId }).toString()
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}view/get?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function addViewPost(chainId, postId) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const params = new URLSearchParams({ chain_id: chainId, post_id: postId }).toString()
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}view/add?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return await response.json()
}

export async function getClaim() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}claim`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}
export async function getChillwhale() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}chillwhale`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}
export async function getCooking() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}cooking`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function getAllProduct() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}allProduct`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function getCategory() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}category`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function getProduct() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}product`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Product List
 * @param {Array} filter
 * @returns
 */
export async function getProductList(filter) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const params = new URLSearchParams(filter).toString()
  console.log(params)
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}productList?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Product Detail
 * @returns
 */
export async function getProductDetail(id) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}productDetail/${id}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Comment
 * @returns
 */
export async function getComment(id) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}comment/get/${id}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function newComment(post, id) {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    body: JSON.stringify(post),
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}comment/new/${id}`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function invoiceUpdate(post, id) {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    body: JSON.stringify(post),
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}invoiceUpdate/${id}`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function paymentSMS(id) {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    body: JSON.stringify([]),
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}paymentSMS/${id}`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function getPages() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}pages`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function getBanner() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}banner`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Sign In
 * @param {json} post
 * @returns
 */
export async function signIn(post) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}signIn`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Sign Up
 * @param {json} post
 * @returns
 */
export async function signUp(post) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}signUp`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function forgotPassword(post) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}forgotPassword`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function getIsValidToken() {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}isValidToken`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function getDashboard() {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}dashboard`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function getTicket() {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'GET',
    headers: myHeaders,
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}ticket/get`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function newTicket(post) {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    body: JSON.stringify(post),
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}ticket/new`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function updateTicket(data, id) {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    body: JSON.stringify(data),
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}ticket/update/${id}`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

export async function getInvoice() {
  var myHeaders = new Headers()
  myHeaders.append('Authorization', `Bearer ${getLocalToken()}`)

  var requestOptions = {
    method: 'GET',
    headers: myHeaders,
    redirect: 'follow',
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}invoice`, requestOptions)
  if (!response.ok) {
    throw new Response('Failed to ', { status: 500 })
  }
  return response.json()
}

//================================================

/**
 * New record
 * @param {json} post
 * @returns
 */
export async function newRecord(post) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }

  const response = await fetch(`${import.meta.env.VITE_API_URL}newRecord`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * u
 * @returns
 */
export async function serverDate() {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }

  const response = await fetch(`${import.meta.env.VITE_API_URL}serverDate/`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function getTournamentList(filter = '') {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }
  const params = new URLSearchParams({ filter: filter }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}tournamentList?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Dashboard
 * @returns
 */
export async function getLeaderboard(tournamentId) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }
  const response = await fetch(`${import.meta.env.VITE_API_URL}leaderboard/${tournamentId}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

export async function getPlayer(tournamentId, walletAddr) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }
  const response = await fetch(`${import.meta.env.VITE_API_URL}player/${tournamentId}/${walletAddr}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Event
 * @returns
 */
export async function getEvent(wallet_addr) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }
  const params = new URLSearchParams({ wallet_addr: wallet_addr }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}event/get?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Event chart
 * @returns
 */
export async function getEventChart(wallet_addr) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }
  const params = new URLSearchParams({ wallet_addr: wallet_addr }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}event/chart?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * View
 * @returns
 */
export async function addEvent(username, event, name) {
  let requestOptions = {
    method: 'POST',
    redirect: 'follow',
  }
  const params = new URLSearchParams({ username: username, event: event, name: name }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}event/add?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * View chart
 * @returns
 */
export async function getViewChart(wallet_addr) {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }
  const params = new URLSearchParams({ wallet_addr: wallet_addr }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}view/chart?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * View chart
 * @returns
 */
export async function getConfig(username, addr = '') {
  let requestOptions = {
    method: 'GET',
    redirect: 'follow',
  }
  const params = new URLSearchParams({ username: username, wallet_addr: addr }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}config/get?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Link
 * @param {json} post
 * @returns
 */
export async function addUp(post) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }

  const response = await fetch(`${import.meta.env.VITE_API_URL}up/add`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Check username
 * @param {*} post
 * @param {*} wallet_addr
 * @returns
 */
export async function checkUser(post, wallet_addr) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }
  const params = new URLSearchParams({ wallet_addr: wallet_addr }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}user/check?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Update username
 * @param {*} post
 * @param {*} wallet_addr
 * @returns
 */
export async function updateUser(post, wallet_addr) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }
  const params = new URLSearchParams({ wallet_addr: wallet_addr }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}user/update?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Update username
 * @param {*} post
 * @param {*} wallet_addr
 * @returns
 */
export async function updateTelegramId(post, wallet_addr) {
  var requestOptions = {
    method: 'POST',
    body: JSON.stringify(post),
    redirect: 'follow',
  }
  const params = new URLSearchParams({ wallet_addr: wallet_addr }).toString()
  const response = await fetch(`${import.meta.env.VITE_API_URL}user/telegram?${params}`, requestOptions)
  if (!response.ok) throw new Response('Failed to get data', { status: 500 })
  return response.json()
}

/**
 * Get NFT Collection Audit
 * The permanence audit for one collection, plus where it sits in cidex's queue (`status`:
 * none | pending | running | refreshing | failed | done). `summary` leaves the report and
 * history out, for a chip that only needs the grade.
 * @param {number|string} networkId Chain the collection lives on.
 * @param {string} address Collection contract address.
 * @param {{summary?: boolean}} [options]
 */
export const getNftCollectionAudit = async (networkId, address, { summary = false } = {}) => {
  // Polled while an audit runs — the browser cache must not answer for the server
  const response = await fetch(`/api/v1/nfts/collections/${networkId}/${address.toLowerCase()}/audit${summary ? '?summary=1' : ''}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('Failed to fetch the collection audit')

  return response.json()
}

/**
 * Request NFT Collection Audit
 * Asks cidex to audit (or re-audit) a collection. Resolves to the queue state; throws with
 * the server's message when the collection was audited too recently.
 * @param {number|string} networkId Chain the collection lives on.
 * @param {string} address Collection contract address.
 */
export const requestNftCollectionAudit = async (networkId, address) => {
  const response = await fetch(`/api/v1/nfts/collections/${networkId}/${address.toLowerCase()}/audit`, { method: 'POST' })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.success) {
    const error = new Error(body?.error || `Audit request failed (${response.status})`)
    error.throttled = Boolean(body?.throttled)
    error.status = body?.status || null
    error.data = body?.data || null
    throw error
  }

  return body
}

/**
 * Get NFT Collection Audits
 * Audited collections as a board — most recent, best or worst scores.
 * @param {{networkId?: number|string, sort?: 'recent'|'top'|'bottom', limit?: number}} [options]
 */
export const getNftCollectionAudits = async ({ networkId, sort = 'recent', limit = 20 } = {}) => {
  const query = new URLSearchParams({ sort, limit: String(limit) })
  if (networkId) query.set('networkId', String(networkId))

  const response = await fetch(`/api/v1/nfts/audits?${query.toString()}`)
  if (!response.ok) throw new Error('Failed to fetch collection audits')

  return response.json()
}
