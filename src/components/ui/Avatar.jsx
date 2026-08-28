'use client'

import { useEffect, useState } from 'react'
import { resolveAvatarImageUrl, resolveStorageGatewayUrl } from '@/lib/storageHelper'
import { FALLBACK_AVATAR_SRC } from '@/lib/utils'

/* How long a retry may hang before the default PFP takes the slot.
 *
 * Only stages after the first are timed. The first is the sharp proxy, which answers within
 * its own fetch budget whatever happens, and a clock on it would fire against `loading="lazy"`
 * images the browser has deliberately not started yet. A retry talks to a gateway directly,
 * and that is the wait nothing else ends: a gateway holding a partially-pinned CID sends
 * headers, sends the part of the body it has, and then stalls forever — the `<img>` fires
 * neither `load` nor `error`, so the slot stays empty until the socket dies minutes later.
 * Reaching a retry also means the proxy stage already errored, so the picture is on screen
 * and actively loading by the time this clock is armed.
 *
 * A retry is also the one stage that pulls the original at full size, and an animated GIF
 * profile picture is the heaviest original the app has. At the old figure those were being
 * timed out mid-download and replaced with the default PFP — a real picture that was on its
 * way, thrown away. */
const RETRY_DEADLINE_MS = 12000

/* What fills the circle until the picture does.
 *
 * An `<img>` with nothing decoded yet paints nothing, so every avatar on a cold surface was a
 * hole in the layout for as long as the fetch took. The token is the one the skeletons already
 * use, and it is dropped the moment the picture loads so a transparent PNG is not tinted by it. */
const PLACEHOLDER_STYLE = { backgroundColor: 'var(--shimmer-bg)' }

/**
 * Avatar
 * The one way a profile picture is rendered. Chrome — size, radius, border, ring — comes from
 * the consumer's `className`; what lives here is only the resolve-and-fall-back behaviour,
 * which every surface got wrong in its own way while each one hand-rolled an `<img>`.
 *
 * `profile_image` arrives in whatever shape the row carries: `ipfs://` from our own DB, a full
 * api.universalprofile.cloud URL from the LUKSO indexer, an http avatar, or nothing. All of it
 * resolves through the sharp proxy at the ladder rung covering this slot, which matters twice
 * over. A 36px slot stops pulling a full-size original — UP pictures run to megabytes — and,
 * because the proxy always answers, a picture that cannot be fetched produces a real HTTP error
 * instead of an open socket, so the fallback below actually runs.
 *
 * Three stages, each tried only when the one before it failed: the proxy, then the configured
 * gateway direct (full size, but a real picture beats the default), then the bundled default.
 * @param {Object} props
 * @param {string|null} props.src Raw profile image reference.
 * @param {number} [props.size] Laid-out width in px; resolveAvatarImageUrl picks the rung.
 * @param {string} [props.alt] Alt text; empty for decorative avatars beside a visible name.
 * @param {string} [props.className] Avatar class from the consumer's module.
 * @param {'lazy'|'eager'} [props.loading] Native loading hint.
 * @param {string} [props.title] Native tooltip.
 */
const Avatar = ({ src, size = 36, alt = '', className, loading = 'lazy', title }) => {
  const proxied = resolveAvatarImageUrl(src, size)
  const gateway = resolveStorageGatewayUrl(src)

  /* Deduplicated because a reference that is neither IPFS nor a UP-cloud URL resolves to
     itself at both stages, and a repeated src is only a stage that fails the same way twice */
  const chain = [...new Set([proxied, gateway, FALLBACK_AVATAR_SRC].filter(Boolean))]
  const last = chain.length - 1

  /* The verdict is stamped with the reference it was reached for, not held as a bare stage
     number. A recycled element — a feed row scrolled onto a new author, a dialog reopened on
     someone else — then starts from the top on the render that hands it a new `src`, without
     an effect firing a reset one render late. */
  const [attempt, setAttempt] = useState({ src, stage: 0, settled: false })
  const { stage, settled } = attempt.src === src ? attempt : { stage: 0, settled: false }
  const current = chain[Math.min(stage, last)]

  useEffect(() => {
    if (settled || stage === 0 || stage >= last) return

    const timer = setTimeout(() => setAttempt({ src, stage: stage + 1, settled: false }), RETRY_DEADLINE_MS)
    return () => clearTimeout(timer)
  }, [settled, stage, last, src])

  return (
    <img
      /* Keyed so a stage change remounts the element: the pending request on the stage that
         just failed is dropped, and `load`/`error` fire cleanly for the new one */
      key={current}
      src={current}
      alt={alt}
      title={title}
      width={size}
      height={size}
      loading={loading}
      /* Off the main thread, so a page of avatars decoding at once cannot stall the feed */
      decoding="async"
      className={className}
      style={settled ? undefined : PLACEHOLDER_STYLE}
      /* SCSS hook for the surfaces that draw the default differently from a real picture */
      data-fallback={current === FALLBACK_AVATAR_SRC ? 'true' : undefined}
      onLoad={() => setAttempt({ src, stage, settled: true })}
      onError={() => setAttempt({ src, stage: Math.min(stage + 1, last), settled: false })}
    />
  )
}

export default Avatar
