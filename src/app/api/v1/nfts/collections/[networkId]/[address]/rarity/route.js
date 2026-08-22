/**
 * @file api/v1/nfts/collections/[networkId]/[address]/rarity/route.js
 * @description Rarity ranks for one collection — the Rarity column on the collection page's
 * table view.
 *
 * Two sources, in this order:
 *
 * 1. The collection's own published rank. Plenty of collections ship a `Rank` (or
 *    `Rarity Rank`) attribute inside each token's metadata, computed over the whole supply by
 *    whoever minted it. When it's there it beats anything this route could derive, because it
 *    knows about tokens Hup has never seen. `meta.source` is 'published'.
 *
 * 2. Failing that, a trait-rarity score computed here: each distinct label/value pair a token
 *    carries contributes ranked/count, so a 1-of-50 trait is worth ten times a 1-of-500 one.
 *    `meta.source` is 'computed', and it comes with a caveat the client is expected to honour —
 *    see below.
 *
 * The caveat: attributes are not log-derived, so cidex has nothing to index here. They arrive
 * inside a token's metadata document and land in nft_metadata_cache the first time that token
 * is rendered anywhere. A computed rank is therefore a rank among the tokens Hup happens to
 * have resolved — with a thin cache the counts are sample noise, and the client suppresses the
 * column rather than print a number that would move every time somebody browses. `meta.ranked`
 * is that denominator. A published rank carries no such caveat.
 *
 * Labels whose values are nearly all distinct — serial numbers, dates, the collection's own
 * rarity score — are dropped from the scoring: a value only one token holds says nothing about
 * how rare that token is, it just says the label is an identifier. `meta.ignoredLabels` lists
 * what was dropped, so a surprising ranking can be explained rather than guessed at.
 *
 * The answer is the whole ranking rather than a page of it: ranks only mean anything relative
 * to every other token, so slicing server-side would recompute the same scan for every page
 * the reader scrolls. One cached response, and the client can rank any token it renders.
 */

import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

// Attributes are longtext, so this bounds how much one call reads. Past it the ranking is
// built from a sample and `meta.truncated` says so.
const SCAN_LIMIT = 8000

// What a collection calls the rank it publishes. Deliberately narrow: "Rarity" alone is a
// tier on plenty of collections ("Legendary"), not a position.
const RANK_LABEL = /^(rarity[\s_-]*)?rank$/i

// A label this many of whose values are unique is an identifier, not a trait. Scoring it would
// hand every token the same large number — or worse, reward the ones that happen to collide.
const IDENTIFIER_RATIO = 0.9

// A tab can't survive the trim below, so "a<TAB>b" + "c" can never collide with "a" + "b<TAB>c"
const PAIR_SEPARATOR = '\t'

// Ranks only move as new tokens resolve into the cache, which is slow and monotonic — this
// can sit still far longer than the facet counts do
const CACHE_CONTROL = 'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400'

/**
 * One cached document, read into the two things this route needs: the distinct label/value
 * pairs it carries, and the rank it publishes for itself, if any.
 * @param {string} raw The stored attributes JSON.
 * @returns {{pairs: Array<[string, string]>, published: number|null}}
 */
function readAttributes(raw) {
  let attributes
  try {
    attributes = JSON.parse(raw)
  } catch {
    // A malformed document is one token's problem, not the ranking's
    return { pairs: [], published: null }
  }
  if (!Array.isArray(attributes)) return { pairs: [], published: null }

  const seen = new Set()
  const pairs = []
  let published = null

  for (const attr of attributes) {
    const label = typeof attr?.label === 'string' ? attr.label.trim() : ''
    const value = attr?.value === null || attr?.value === undefined ? '' : String(attr.value).trim()
    if (!label || !value) continue

    if (RANK_LABEL.test(label)) {
      const rank = Number(value)
      // A rank of 0 or a non-number is a label collision, not a rank
      if (Number.isInteger(rank) && rank > 0) published = rank
      continue
    }

    const key = `${label}${PAIR_SEPARATOR}${value}`
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push([label, value])
  }

  return { pairs, published }
}

export async function GET(request, { params }) {
  try {
    const { networkId, address } = await params

    if (!/^\d+$/.test(String(networkId)) || !/^0x[0-9a-fA-F]{40}$/.test(String(address))) {
      return NextResponse.json(
        { success: false, error: 'A numeric networkId and a collection address are required' },
        { status: 400 },
      )
    }

    const collection = String(address).toLowerCase()

    const [rows] = await pool.execute(
      `SELECT m.token_id, m.attributes
         FROM nft_metadata_cache m
        WHERE m.network_id = ? AND m.collection = ?
          AND m.attributes IS NOT NULL AND m.attributes <> '[]'
        ORDER BY LENGTH(m.token_id), m.token_id
        LIMIT ?`,
      [Number(networkId), collection, SCAN_LIMIT],
    )

    // One parse per token, kept for the passes below — re-reading the longtext would double
    // the only expensive part of this route
    const tokens = []
    for (const row of rows) {
      const { pairs, published } = readAttributes(row.attributes)
      if (pairs.length === 0 && published === null) continue
      tokens.push({ tokenId: row.token_id, pairs, published })
    }

    const ranked = tokens.length
    const publishedTokens = tokens.filter((token) => token.published !== null)

    // The collection's own answer, whenever it gives one. Partial coverage is fine here in a
    // way it never is for a computed rank: a published rank is a fact about the whole supply,
    // so a token that carries one is ranked and one that doesn't simply isn't.
    if (publishedTokens.length > 0) {
      return NextResponse.json(
        {
          success: true,
          data: {
            tokens: publishedTokens.map((token) => token.tokenId),
            ranks: publishedTokens.map((token) => token.published),
          },
          meta: {
            source: 'published',
            ranked: publishedTokens.length,
            // The largest rank seen is the collection's own count of what it ranked — a
            // better denominator to print than anything derived from the cache
            total: publishedTokens.reduce((max, token) => Math.max(max, token.published), 0),
            truncated: rows.length >= SCAN_LIMIT,
            ignoredLabels: [],
          },
        },
        { headers: { 'Cache-Control': CACHE_CONTROL } },
      )
    }

    // Nothing published: count the pairs, then drop the labels that turned out to be
    // identifiers before any of them reach a score
    const valuesByLabel = new Map()
    const tokensByLabel = new Map()
    const counts = new Map()

    for (const token of tokens) {
      for (const [label, value] of token.pairs) {
        const key = `${label}${PAIR_SEPARATOR}${value}`
        counts.set(key, (counts.get(key) || 0) + 1)
        tokensByLabel.set(label, (tokensByLabel.get(label) || 0) + 1)

        let values = valuesByLabel.get(label)
        if (!values) {
          values = new Set()
          valuesByLabel.set(label, values)
        }
        values.add(value)
      }
    }

    const ignoredLabels = [...valuesByLabel.entries()]
      .filter(([label, values]) => values.size / tokensByLabel.get(label) >= IDENTIFIER_RATIO)
      .map(([label]) => label)
    const ignored = new Set(ignoredLabels)

    // Score, then one sort. Descending score is descending rarity; the scan's own order breaks
    // ties, so two identical tokens rank in a stable, explainable order.
    const scored = tokens
      .map((token, index) => ({
        tokenId: token.tokenId,
        index,
        score: token.pairs.reduce(
          (total, [label, value]) =>
            ignored.has(label) ? total : total + ranked / counts.get(`${label}${PAIR_SEPARATOR}${value}`),
          0,
        ),
      }))
      .filter((token) => token.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)

    return NextResponse.json(
      {
        success: true,
        data: {
          tokens: scored.map((token) => token.tokenId),
          ranks: scored.map((_, index) => index + 1),
        },
        meta: {
          source: 'computed',
          ranked: scored.length,
          total: scored.length,
          truncated: rows.length >= SCAN_LIMIT,
          ignoredLabels,
        },
      },
      { headers: { 'Cache-Control': CACHE_CONTROL } },
    )
  } catch (error) {
    console.error('[GET_NFT_COLLECTION_RARITY_ERROR]:', error.message)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
