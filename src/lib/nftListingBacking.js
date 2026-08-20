/**
 * @file lib/nftListingBacking.js
 * @description The one NFT-market clause no HupTrade event can express.
 *
 * Listings are non-custodial — the NFT stays in the seller's wallet — so a token can leave that
 * wallet without the contract emitting anything: a plain transfer, a sale on another
 * marketplace, a revoked approval. The listing row stays Active and keeps showing a price
 * nobody can pay, dragging the collection floor down with it.
 *
 * cidex's backing sweep (runListingBackingSweep) re-reads HupTrade's own isPurchasable() for
 * active listings and mirrors the answer into nft_listings.backed. Every query that presents
 * inventory — the grid, its facets, collection floors — filters on it through this constant, so
 * the definition of "still buyable" lives in one place.
 *
 * Written as "not active, or backed" rather than a bare `backed = 1` on purpose: the sweep only
 * ever visits Active rows, so a sold row keeps whatever backing it had when it sold and must not
 * be dropped from history views by a column that stopped applying to it.
 */
export const BACKED_LISTINGS_SQL = '(l.status <> 1 OR l.backed = 1)'
