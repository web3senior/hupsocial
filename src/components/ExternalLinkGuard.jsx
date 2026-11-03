'use client'

import { useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import { ArrowUpRightIcon, GlobeHemisphereWestIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from '@/components/ui/NativeDialog'
import styles from './ExternalLinkGuard.module.scss'

/** One confirmation for external anchors, including links inside rendered markdown. */
export default function ExternalLinkGuard() {
  const dialogRef = useRef(null)
  const [destination, setDestination] = useState(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const intercept = (event) => {
      if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!anchor || anchor.hasAttribute('download')) return
      let url
      try {
        url = new URL(anchor.href, window.location.href)
      } catch {
        return
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.origin === window.location.origin) return

      event.preventDefault()
      event.stopPropagation()
      setDestination({
        href: url.href,
        hostname: url.host,
        newTab: anchor.target === '_blank' || event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey,
      })
      dialogRef.current?.open()
    }
    document.addEventListener('click', intercept, true)
    document.addEventListener('auxclick', intercept, true)
    return () => {
      document.removeEventListener('click', intercept, true)
      document.removeEventListener('auxclick', intercept, true)
    }
  }, [])

  const proceed = () => {
    if (!destination) return
    dialogRef.current?.close()
    if (destination.newTab) window.open(destination.href, '_blank', 'noopener,noreferrer')
    else window.location.assign(destination.href)
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.externalLink}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      appear="zoom"
      lightDismiss
      onClose={(event) => event.stopPropagation()}
      onCancel={(event) => event.stopPropagation()}
    >
      <div className={styles.externalLink__header}>
        <span className={styles.externalLink__eyebrow}>EXTERNAL LINK</span>
        <button type="button" className={styles.externalLink__close} aria-label="Close" onClick={() => dialogRef.current?.close()}>
          <XIcon size={18} />
        </button>
      </div>
      <h2 id={titleId} className={styles.externalLink__title}>Heading somewhere new?</h2>
      <p id={descriptionId} className={styles.externalLink__message}>
        This link takes you outside Hup. Check the address before you go.
      </p>
      <div className={styles.externalLink__destination}>
        <span className={styles.externalLink__siteIcon}><GlobeHemisphereWestIcon size={24} aria-hidden="true" /></span>
        <div className={styles.externalLink__address}>
          <strong className={styles.externalLink__hostname}>{destination?.hostname}</strong>
          <span className={styles.externalLink__url}>{destination?.href}</span>
        </div>
      </div>
      <div className={styles.externalLink__actions}>
        <button type="button" className={styles.externalLink__button} onClick={() => dialogRef.current?.close()} autoFocus>
          Stay here
        </button>
        <button
          type="button"
          className={clsx(styles.externalLink__button, styles['externalLink__button--primary'])}
          onClick={proceed}
        >
          Open website <ArrowUpRightIcon size={18} aria-hidden="true" />
        </button>
      </div>
    </NativeDialog>
  )
}
