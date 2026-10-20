// Vertical focal point of a cover (0 = top edge, 100 = bottom edge). Covers render with
// object-fit: cover, so this is what the owner dragged into view in BannerEditor. A community
// keeps it in its IPFS metadata, a profile in users.profile_header_position. Anything saved
// before the field existed, or hand-edited out of range, falls back to centered.
export const DEFAULT_COVER_POSITION = 50

export function clampCoverPosition(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_COVER_POSITION
  return Math.min(100, Math.max(0, Math.round(number)))
}

/** A stored position as a usable one: missing (never set) reads as centered. */
export function readCoverPosition(raw) {
  return raw === undefined || raw === null || raw === '' ? DEFAULT_COVER_POSITION : clampCoverPosition(raw)
}

/** A community's position, kept in its IPFS metadata under `cover position`. */
export function coverPositionFrom(metadata) {
  return readCoverPosition(metadata?.['cover position'])
}

export function coverObjectPosition(position) {
  return `50% ${clampCoverPosition(position)}%`
}
