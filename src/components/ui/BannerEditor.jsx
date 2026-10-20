'use client'

import { useRef, useState } from 'react'
import clsx from 'clsx'
import { ArrowsDownUpIcon, CameraIcon, ImageSquareIcon, TrashIcon } from '@phosphor-icons/react'
import { Spinner } from '@/components/Loading'
import { DEFAULT_COVER_POSITION, clampCoverPosition, coverObjectPosition } from '@/lib/coverPosition'
import styles from './BannerEditor.module.scss'

const KEYBOARD_STEP = 5

const DEFAULT_LABELS = {
  addCover: 'Add a cover image',
  addCoverHint: 'Wide images work best, about 3:1',
  changeCover: 'Change',
  removeCover: 'Remove cover',
  dragHint: 'Drag to reposition',
  slider: 'Cover position. Drag or use the arrow keys to adjust.',
  addAvatar: 'Add picture',
  changeAvatar: 'Change picture',
  removeAvatar: 'Remove',
}

/**
 * Banner Editor
 * A cover and its avatar edited in place on a live copy of the header they belong to, so the
 * owner sees the page people land on instead of bare file inputs. The cover drags vertically (or
 * moves with the arrow keys) to choose which part of it shows — see lib/coverPosition.js.
 *
 * Owns no storage: picked files go to the caller, which decides whether to upload now (communities)
 * or on save (profiles), and passes back what to show.
 * @param {Object} props
 * @param {string|null} props.coverSrc Displayable cover URL, or null for none.
 * @param {string|null} props.avatarSrc Displayable avatar URL, or null for none.
 * @param {number} props.coverPosition 0–100, the cover's vertical focal point.
 * @param {Function} props.onCoverPositionChange
 * @param {Function} props.onCoverPick Called with the picked File.
 * @param {Function} props.onAvatarPick Called with the picked File.
 * @param {Function} [props.onCoverRemove] Omit to offer no remove button.
 * @param {Function} [props.onAvatarRemove] Omit to offer no remove button.
 * @param {boolean} [props.coverBusy] Shows a spinner over the cover (an upload in flight).
 * @param {boolean} [props.avatarBusy]
 * @param {Function} [props.onCoverError] img onError for the cover, e.g. to show the empty state.
 * @param {Function} [props.onAvatarError] img onError for the avatar, e.g. a fallback picture.
 * @param {string} [props.title] Previewed beside the avatar.
 * @param {string} [props.subtitle]
 * @param {string} [props.titlePlaceholder]
 * @param {string} [props.subtitlePlaceholder]
 * @param {'rounded'|'circle'} [props.avatarShape='rounded']
 * @param {'start'|'end'} [props.avatarSide='start'] Which side of the text the avatar sits on.
 * @param {string} [props.label] Field label above the preview.
 * @param {Object} [props.labels] Overrides for any of DEFAULT_LABELS.
 * @param {string} [props.error]
 * @param {string} [props.accept='image/*']
 * @param {string} [props.fieldClassName] The host form's field wrapper class.
 * @param {string} [props.labelClassName] The host form's label class.
 */
export default function BannerEditor({
  coverSrc,
  avatarSrc,
  coverPosition,
  onCoverPositionChange,
  onCoverPick,
  onAvatarPick,
  onCoverRemove,
  onAvatarRemove,
  coverBusy = false,
  avatarBusy = false,
  onCoverError,
  onAvatarError,
  title = '',
  subtitle = '',
  titlePlaceholder = '',
  subtitlePlaceholder = '',
  avatarShape = 'rounded',
  avatarSide = 'start',
  label,
  labels: labelOverrides,
  error,
  accept = 'image/*',
  fieldClassName,
  labelClassName,
}) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides }
  const coverInputRef = useRef(null)
  const avatarInputRef = useRef(null)
  const coverRef = useRef(null)
  const imageRef = useRef(null)
  const dragRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)

  const pick = (handler, onPicked) => (event) => {
    const file = event.target.files?.[0]
    // Cleared so picking the same file again still fires, and a refused file isn't left selected
    event.target.value = ''
    if (!file) return
    onPicked?.()
    handler(file)
  }

  // How many pixels of the image object-fit: cover crops off vertically — the distance a drag
  // from 0% to 100% travels. Zero when the image fits the frame's height exactly.
  const verticalOverflow = () => {
    const frame = coverRef.current?.getBoundingClientRect()
    const image = imageRef.current
    if (!frame || !image?.naturalWidth || !image?.naturalHeight) return 0
    const scale = Math.max(frame.width / image.naturalWidth, frame.height / image.naturalHeight)
    return Math.max(0, image.naturalHeight * scale - frame.height)
  }

  const handlePointerDown = (event) => {
    if (!coverSrc || event.button !== 0 || event.target.closest('button')) return
    const overflow = verticalOverflow()
    if (overflow < 1) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startY: event.clientY, startPosition: coverPosition, overflow }
    setIsDragging(true)
  }

  const handlePointerMove = (event) => {
    const drag = dragRef.current
    if (!drag) return
    // Dragging the image down reveals more of its top, which is a smaller position
    const delta = ((event.clientY - drag.startY) / drag.overflow) * 100
    onCoverPositionChange(clampCoverPosition(drag.startPosition - delta))
  }

  const endDrag = () => {
    dragRef.current = null
    setIsDragging(false)
  }

  const handleKeyDown = (event) => {
    if (!coverSrc) return
    const step = { ArrowUp: -KEYBOARD_STEP, ArrowDown: KEYBOARD_STEP }[event.key]
    if (step === undefined) return
    event.preventDefault()
    onCoverPositionChange(clampCoverPosition(coverPosition + step))
  }

  return (
    <div className={clsx(styles.bannerEditor, fieldClassName)}>
      {label && <span className={labelClassName}>{label}</span>}
      {/* A new cover starts centered rather than inheriting the old one's framing */}
      <input ref={coverInputRef} type="file" accept={accept} hidden onChange={pick(onCoverPick, () => onCoverPositionChange(DEFAULT_COVER_POSITION))} />
      <input ref={avatarInputRef} type="file" accept={accept} hidden onChange={pick(onAvatarPick)} />

      <div className={styles.bannerEditor__preview}>
        <div
          ref={coverRef}
          className={clsx(styles.bannerEditor__cover, {
            [styles['bannerEditor__cover--draggable']]: coverSrc,
            [styles['bannerEditor__cover--dragging']]: isDragging,
          })}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={handleKeyDown}
          {...(coverSrc
            ? {
                role: 'slider',
                tabIndex: 0,
                'aria-label': labels.slider,
                'aria-orientation': 'vertical',
                'aria-valuemin': 0,
                'aria-valuemax': 100,
                'aria-valuenow': coverPosition,
              }
            : {})}
        >
          {coverSrc ? (
            <img
              ref={imageRef}
              src={coverSrc}
              alt=""
              draggable={false}
              className={styles.bannerEditor__coverImage}
              style={{ objectPosition: coverObjectPosition(coverPosition) }}
              onError={onCoverError}
            />
          ) : (
            <button type="button" className={styles.bannerEditor__coverEmpty} onClick={() => coverInputRef.current?.click()} disabled={coverBusy}>
              <ImageSquareIcon size={28} />
              <span>{labels.addCover}</span>
              {labels.addCoverHint && <small>{labels.addCoverHint}</small>}
            </button>
          )}

          {coverSrc && !isDragging && (
            <span className={styles.bannerEditor__hint} aria-hidden="true">
              <ArrowsDownUpIcon size={14} />
              {labels.dragHint}
            </span>
          )}

          {coverSrc && (
            <div className={styles.bannerEditor__coverActions}>
              <button type="button" className={styles.bannerEditor__action} onClick={() => coverInputRef.current?.click()} disabled={coverBusy}>
                <CameraIcon size={14} />
                {labels.changeCover}
              </button>
              {onCoverRemove && (
                <button type="button" className={styles.bannerEditor__action} onClick={onCoverRemove} disabled={coverBusy} aria-label={labels.removeCover}>
                  <TrashIcon size={14} />
                </button>
              )}
            </div>
          )}

          {coverBusy && (
            <span className={styles.bannerEditor__busy}>
              <Spinner size={20} color="currentColor" />
            </span>
          )}
        </div>

        <div className={clsx(styles.bannerEditor__body, styles[`bannerEditor__body--avatar-${avatarSide}`])}>
          <div className={styles.bannerEditor__avatarWrap}>
            <button
              type="button"
              className={clsx(styles.bannerEditor__avatar, styles[`bannerEditor__avatar--${avatarShape}`])}
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarBusy}
              aria-label={avatarSrc ? labels.changeAvatar : labels.addAvatar}
            >
              {avatarSrc ? (
                <img src={avatarSrc} alt="" className={styles.bannerEditor__avatarImage} onError={onAvatarError} />
              ) : (
                <span className={styles.bannerEditor__avatarInitial}>{(title || titlePlaceholder || '#').charAt(0).toUpperCase()}</span>
              )}
              <span className={styles.bannerEditor__avatarOverlay}>
                {avatarBusy ? <Spinner size={18} color="currentColor" /> : <CameraIcon size={18} />}
              </span>
            </button>
            {avatarSrc && onAvatarRemove && !avatarBusy && (
              <button type="button" className={styles.bannerEditor__textButton} onClick={onAvatarRemove}>
                {labels.removeAvatar}
              </button>
            )}
          </div>

          <div className={styles.bannerEditor__titleGroup}>
            <strong className={clsx(styles.bannerEditor__title, { [styles['bannerEditor__title--empty']]: !title })}>
              {title || titlePlaceholder}
            </strong>
            {(subtitle || subtitlePlaceholder) && (
              <span className={clsx(styles.bannerEditor__subtitle, { [styles['bannerEditor__subtitle--empty']]: !subtitle })}>
                {subtitle || subtitlePlaceholder}
              </span>
            )}
          </div>
        </div>
      </div>

      {error && <small className={styles.bannerEditor__error}>{error}</small>}
    </div>
  )
}
