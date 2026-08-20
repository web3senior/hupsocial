/**
 * @file communities/communityTag.js
 * @description The shape of a community's wearable tag, shared by the create and edit forms so
 * both write the same thing into the metadata JSON.
 *
 * The tag is authored here and nowhere else: cidex projects whatever lands in `metadata.tag`
 * into the indexed `communities.tag` column, and every badge a member wears reads from that
 * column. A tag that disagrees between the two forms would quietly change meaning the first
 * time a creator edited their community.
 */

/** What the indexed `communities.tag` column holds — and what fits beside a name. */
export const MAX_TAG_LENGTH = 8

/**
 * Trims a typed tag to what a badge can render: no inner whitespace (it would show as a hole in
 * the pill) and no more characters than the column stores. Casing is left to the author — "GM"
 * and "gm" are both legitimate looks for a community.
 * @param {string} value
 * @returns {string}
 */
export const normalizeTag = (value) => String(value ?? '').replace(/\s+/g, '').slice(0, MAX_TAG_LENGTH)
