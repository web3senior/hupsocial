'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowSquareOutIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from '@/components/ui/NativeDialog'
import useMediaZoom from '@/hooks/useMediaZoom'
import styles from './ImageViewer.module.scss'

/**
 * One chat picture at its full size, over the whole page. Wheel, pinch and double-tap zoom in;
 * a click anywhere off the picture, the X or Escape closes it.
 * @param {{image: {src: string, alt?: string, name?: string, href?: string}|null, onClose: () => void}} props
 *   `href` is where the original opens in a tab of its own.
 */
export default function ImageViewer({ image, onClose }) {
  const dialogRef = useRef(null)
  const stageRef = useRef(null)
  // The picture stays drawn while the dialog fades out after `image` has gone
  const [shown, setShown] = useState(image)
  if (image && image !== shown) setShown(image)

  const { targetRef, style, isZoomed } = useMediaZoom({ containerRef: stageRef, enabled: Boolean(image), resetKey: image?.src ?? null })

  useEffect(() => {
    if (image) dialogRef.current?.open()
    else dialogRef.current?.close()
  }, [image])

  const close = () => dialogRef.current?.close()

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.viewer}
      aria-label={shown?.name || 'Image'}
      onClose={(event) => {
        event.stopPropagation()
        onClose()
      }}
      onCancel={(event) => event.stopPropagation()}
    >
      <div
        ref={stageRef}
        className={styles.viewer__stage}
        data-zoomed={isZoomed ? '' : undefined}
        onClick={(event) => {
          if (!event.target.closest('img, a, button')) close()
        }}
      >
        {shown && (
          // The original through the proxy, or the local copy of a line still sending
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={shown.src}
            ref={targetRef}
            className={styles.viewer__image}
            src={shown.src}
            alt={shown.alt || shown.name || ''}
            style={style}
            draggable={false}
          />
        )}
      </div>
      <div className={styles.viewer__bar}>
        {shown?.name && <span className={styles.viewer__name}>{shown.name}</span>}
        <span className={styles.viewer__actions}>
          {shown?.href && (
            <a
              className={styles.viewer__button}
              href={shown.href}
              target="_blank"
              rel="nofollow noopener noreferrer"
              aria-label="Open the original"
              title="Open the original"
            >
              <ArrowSquareOutIcon size={20} />
            </a>
          )}
          <button type="button" className={styles.viewer__button} onClick={close} aria-label="Close" title="Close">
            <XIcon size={20} weight="bold" />
          </button>
        </span>
      </div>
    </NativeDialog>
  )
}
