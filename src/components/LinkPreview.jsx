'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { EyeSlashIcon, PlayIcon, SealCheckIcon, XLogoIcon, YoutubeLogoIcon } from '@phosphor-icons/react'
import { useLinkPreview } from '@/hooks/useLinkPreview'
import { useAutoplayPreference } from '@/hooks/useAutoplayPreference'
import { PREVIEW_KINDS } from '@/lib/linkPreview'
import styles from './LinkPreview.module.scss'

const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const mediumDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

const dateLabel = (iso) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : mediumDate.format(date)
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const aspect = (item) => ({ aspectRatio: `${item.width || 16} / ${item.height || 9}` })

/**
 * Link Preview
 * The card under a post for the first link that earns one: an X post with its own media, a
 * YouTube player behind its poster, or an Open Graph card for any other page.
 *
 * Lives inside a card that opens the thread on click, so every pointer event stops here; the
 * links inside open their own targets.
 */
const LinkPreview = ({ text, hasMedia = false }) => {
  // A post with its own gallery keeps the row to one set of pictures, the way X does
  const { link, preview, isLoading } = useLinkPreview(text, { enabled: !hasMedia })

  if (!link) return null
  if (!preview) return isLoading ? <LinkPreviewSkeleton kind={link.kind} /> : null

  return (
    <div className={styles.linkPreview} onClick={(event) => event.stopPropagation()}>
      {preview.kind === PREVIEW_KINDS.X && <XPreview preview={preview} />}
      {preview.kind === PREVIEW_KINDS.YOUTUBE && <YouTubePreview preview={preview} />}
      {preview.kind === PREVIEW_KINDS.WEB && <WebPreview preview={preview} />}
    </div>
  )
}

/* A native player for the mp4 a tweet or a page exposes. Scrolling it out of view always pauses
   it; scrolling in starts it only under the reader's autoplay preference, muted, the same rule
   the post gallery follows. GIFs are silent loops and start on their own. */
const VideoPlayer = ({ item, className }) => {
  const ref = useRef(null)
  const autoplay = useAutoplayPreference()
  const isGif = item.type === 'gif'

  useEffect(() => {
    const video = ref.current
    if (!video) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (autoplay || isGif) video.play().catch(() => {})
        } else {
          video.pause()
        }
      },
      { threshold: 0.5 },
    )
    observer.observe(video)
    return () => observer.disconnect()
  }, [autoplay, isGif])

  return (
    <video
      ref={ref}
      className={clsx(styles.linkPreview__video, className)}
      src={item.url}
      poster={item.poster || undefined}
      style={aspect(item)}
      muted
      playsInline
      loop={isGif}
      controls={!isGif}
      preload={autoplay || isGif ? 'metadata' : 'none'}
    />
  )
}

const XPreview = ({ preview }) => {
  const { author, text, media = [], url, createdAt, sensitive, stats } = preview
  const [revealed, setRevealed] = useState(false)
  const veiled = sensitive && !revealed && media.length > 0

  return (
    <article className={clsx(styles.linkPreview__card, styles['linkPreview__card--x'])}>
      <header className={styles.linkPreview__author}>
        <a href={url} target="_blank" rel="noopener noreferrer" className={styles.linkPreview__authorLink}>
          {author.avatar ? (
            <img className={styles.linkPreview__avatar} src={author.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <span className={styles.linkPreview__avatar} aria-hidden="true" />
          )}
          <span className={styles.linkPreview__authorText}>
            <span className={styles.linkPreview__authorName}>
              {author.name}
              {author.verified && <SealCheckIcon size={14} weight="fill" className={styles.linkPreview__verified} />}
            </span>
            {author.handle && <span className={styles.linkPreview__authorHandle}>@{author.handle}</span>}
          </span>
        </a>
        <XLogoIcon size={18} weight="fill" className={styles.linkPreview__brand} aria-label="X" />
      </header>

      {text && (
        <p className={styles.linkPreview__text} dir="auto">
          {text}
        </p>
      )}

      {media.length > 0 && (
        <div className={clsx(styles.linkPreview__media, styles[`linkPreview__media--${Math.min(media.length, 4)}`], veiled && styles['linkPreview__media--veiled'])}>
          {media.map((item, index) =>
            item.type === 'photo' ? (
              <a key={item.url} href={url} target="_blank" rel="noopener noreferrer" className={styles.linkPreview__mediaLink} tabIndex={veiled ? -1 : 0}>
                <img
                  className={styles.linkPreview__mediaItem}
                  src={item.url}
                  alt={item.alt || `Image ${index + 1} from the post`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  style={media.length === 1 ? aspect(item) : undefined}
                />
              </a>
            ) : (
              <VideoPlayer key={item.url} item={item} className={styles.linkPreview__mediaItem} />
            ),
          )}

          {veiled && (
            <button type="button" className={styles.linkPreview__veil} onClick={() => setRevealed(true)}>
              <EyeSlashIcon size={18} weight="fill" />
              <span>Marked sensitive on X. Show</span>
            </button>
          )}
        </div>
      )}

      <footer className={styles.linkPreview__meta}>
        {createdAt && <time dateTime={createdAt}>{dateLabel(createdAt)}</time>}
        {Number.isFinite(stats?.likes) && <span>{compactNumber.format(stats.likes)} likes</span>}
        <a href={url} target="_blank" rel="noopener noreferrer">
          View on X
        </a>
      </footer>
    </article>
  )
}

const YouTubePreview = ({ preview }) => {
  const [playing, setPlaying] = useState(false)

  return (
    <article className={clsx(styles.linkPreview__card, styles['linkPreview__card--youtube'])}>
      <div className={styles.linkPreview__player}>
        {playing ? (
          // Not sandboxed: a sandboxed frame gets no storage, and YouTube answers that with its
          // "confirm you're not a bot" wall instead of the player
          <iframe
            className={styles.linkPreview__frame}
            src={preview.embedUrl}
            title={preview.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button type="button" className={styles.linkPreview__poster} onClick={() => setPlaying(true)} aria-label={`Play ${preview.title}`}>
            <img src={preview.thumbnail} alt="" loading="lazy" />
            <span className={styles.linkPreview__playBadge} aria-hidden="true">
              <PlayIcon size={22} weight="fill" />
            </span>
          </button>
        )}
      </div>

      <a href={preview.url} target="_blank" rel="noopener noreferrer" className={styles.linkPreview__caption}>
        <YoutubeLogoIcon size={20} weight="fill" className={clsx(styles.linkPreview__brand, styles['linkPreview__brand--youtube'])} aria-label="YouTube" />
        <span className={styles.linkPreview__captionText}>
          <strong className={styles.linkPreview__title}>{preview.title}</strong>
          <span className={styles.linkPreview__site}>{preview.author ? `${preview.author} · YouTube` : 'YouTube'}</span>
        </span>
      </a>
    </article>
  )
}

const WebPreview = ({ preview }) => {
  const [imageFailed, setImageFailed] = useState(false)
  const [faviconFailed, setFaviconFailed] = useState(false)
  const showImage = Boolean(preview.image) && !imageFailed
  const large = showImage && preview.large

  const body = (
    <span className={styles.linkPreview__body}>
      <span className={styles.linkPreview__site}>
        {preview.favicon && !faviconFailed && (
          <img className={styles.linkPreview__favicon} src={preview.favicon} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFaviconFailed(true)} />
        )}
        {preview.siteName || hostOf(preview.url)}
      </span>
      <strong className={styles.linkPreview__title}>{preview.title}</strong>
      {preview.description && <span className={styles.linkPreview__description}>{preview.description}</span>}
    </span>
  )

  // A page that exposes its own mp4 gets a player, and the words become the caption under it
  if (preview.video) {
    return (
      <article className={clsx(styles.linkPreview__card, styles['linkPreview__card--large'])}>
        <VideoPlayer item={preview.video} />
        <a href={preview.url} target="_blank" rel="noopener noreferrer" className={styles.linkPreview__caption}>
          {body}
        </a>
      </article>
    )
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(styles.linkPreview__card, styles['linkPreview__card--web'], large && styles['linkPreview__card--large'])}
    >
      {showImage && (
        <img
          className={clsx(styles.linkPreview__image, large ? styles['linkPreview__image--hero'] : styles['linkPreview__image--thumb'])}
          src={preview.image}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      )}
      {body}
    </a>
  )
}

/* Reserves roughly the room the card is about to take, per kind, so the feed does not jump
   when the answer lands. The kind is known synchronously from the text. */
export const LinkPreviewSkeleton = ({ kind }) => (
  <div className={clsx(styles.linkPreview, styles['linkPreview--skeleton'])} aria-hidden="true">
    <div className={styles.linkPreview__card}>
      {kind === PREVIEW_KINDS.X ? (
        <>
          <div className={styles.linkPreview__author}>
            <span className={clsx(styles.linkPreview__bar, styles.linkPreview__avatar)} />
            <span className={styles.linkPreview__authorText}>
              <span className={clsx(styles.linkPreview__bar, styles['linkPreview__bar--name'])} />
              <span className={clsx(styles.linkPreview__bar, styles['linkPreview__bar--handle'])} />
            </span>
          </div>
          <div className={styles.linkPreview__skeletonText}>
            <span className={clsx(styles.linkPreview__bar, styles['linkPreview__bar--line'])} />
            <span className={clsx(styles.linkPreview__bar, styles['linkPreview__bar--line'], styles['linkPreview__bar--short'])} />
          </div>
        </>
      ) : (
        <>
          <span className={clsx(styles.linkPreview__bar, kind === PREVIEW_KINDS.YOUTUBE ? styles['linkPreview__bar--player'] : styles['linkPreview__bar--hero'])} />
          <div className={styles.linkPreview__body}>
            <span className={clsx(styles.linkPreview__bar, styles['linkPreview__bar--handle'])} />
            <span className={clsx(styles.linkPreview__bar, styles['linkPreview__bar--line'])} />
          </div>
        </>
      )}
    </div>
  </div>
)

export default LinkPreview
