/**
 * @file config/communityCategories.js
 * @description Shape rules for community categories. The LIST itself is data, not config: it
 * lives in the `community_categories` table (sql/2026-08-20-community-categories.sql), is served
 * by GET /api/v1/communities/categories, and reaches components through
 * hooks/useCommunityCategories — so a row added or retired in the database shows up in the
 * picker and the directory chips without a deploy. cidex validates metadata slugs against the
 * same table, which is what keeps the picker and the indexer from ever disagreeing.
 *
 * What stays here is the part both sides must agree on regardless of data: what a slug looks
 * like, the fallback slug, and the pure helpers that resolve a stored slug against whatever list
 * the caller has. Dependency-free on purpose (the API route imports it).
 *
 * A category is a creator's self-description for browsing, so it lives in the community's
 * metadata JSON (the CID committed onchain by the creator's own tx) rather than in the contract
 * — nothing onchain ever reads it.
 */

/** The slug every unknown, missing, or retired category resolves to for display. */
export const DEFAULT_COMMUNITY_CATEGORY = 'other'

/** Longest slug the table stores — matches `community_categories.slug` / `communities.category`. */
export const MAX_CATEGORY_LENGTH = 32

/** Slugs are lowercase words, optionally hyphenated: the shape the table seeds and cidex stores. */
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

/** What a consumer renders before the list has loaded, or when a slug isn't in it. */
export const FALLBACK_CATEGORY = { slug: DEFAULT_COMMUNITY_CATEGORY, label: 'Other' }

/** Cheap shape check for a slug arriving from a request — not a membership test. */
export const isCategorySlugShaped = (value) => typeof value === 'string' && CATEGORY_SLUG_PATTERN.test(value)

/**
 * The category entry for a stored slug, resolved against a loaded list. Unknown or missing slugs
 * resolve to the list's own "other" row (or FALLBACK_CATEGORY before the list loads), so a
 * community filed under a slug this list no longer offers still renders something sensible.
 */
export const getCommunityCategory = (slug, categories = []) =>
  categories.find((category) => category.slug === slug) ??
  categories.find((category) => category.slug === DEFAULT_COMMUNITY_CATEGORY) ??
  FALLBACK_CATEGORY

/**
 * Normalizes a category value read from metadata JSON for a form: a slug the loaded list offers
 * stays, anything else (missing, retired, free text) becomes the default so the select always
 * shows a real option.
 */
export const normalizeCommunityCategory = (value, categories = []) => {
  if (typeof value !== 'string') return DEFAULT_COMMUNITY_CATEGORY
  const slug = value.trim().toLowerCase().slice(0, MAX_CATEGORY_LENGTH)
  return categories.some((category) => category.slug === slug) ? slug : DEFAULT_COMMUNITY_CATEGORY
}
