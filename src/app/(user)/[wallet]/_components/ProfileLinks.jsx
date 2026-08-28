'use client'

/**
 * Instagram-style links row for the profile header.
 *
 * A profile can carry any number of links, and a tab for them buried the one thing
 * a visitor most often wants to reach. So the header shows the first one inline —
 * `www.getlayers.ai and 1 more` — and the rest live one tap away in a modal.
 *
 * A lone link needs no modal: the row itself is the anchor.
 */

import { useMemo, useRef } from 'react'
import { LinkSimpleIcon, XIcon } from '@phosphor-icons/react'
import NativeDialog from '@/components/ui/NativeDialog'
import styles from './ProfileLinks.module.scss'

// Links arrive as a stringified JSON array on most reads and as a real array on some,
// and both shapes have historically held half-written entries like {"name":""}.
const parseLinks = (raw) => {
  if (!raw) return []

  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      console.error('Failed to parse profile links structure:', error)
      return []
    }
  }

  if (!Array.isArray(parsed)) return []

  return parsed
    .filter((link) => link && typeof link === 'object' && typeof link.url === 'string' && link.url.trim() !== '')
    .map((link) => ({
      label: (link.title || link.name || '').trim(),
      url: link.url.trim(),
    }))
}

// A bare `hup.social` in the profile is still meant as a URL, so anything without a
// scheme gets a protocol-relative one rather than resolving against the current route.
const toHref = (url) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `//${url}`)

// What the row reads as: the destination, not the plumbing around it.
const prettyUrl = (url) =>
  url
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '')

export default function ProfileLinks({ links: rawLinks }) {
  const links = useMemo(() => parseLinks(rawLinks), [rawLinks])
  const dialogRef = useRef(null)

  if (links.length === 0) return null

  const [first, ...rest] = links

  return (
    <>
      {rest.length === 0 ? (
        <a className={styles.profileLinks__row} href={toHref(first.url)} target="_blank" rel="noopener noreferrer">
          <LinkSimpleIcon size={14} weight="bold" />
          <span className={styles.profileLinks__primary}>{prettyUrl(first.url)}</span>
        </a>
      ) : (
        <button
          type="button"
          className={styles.profileLinks__row}
          aria-haspopup="dialog"
          onClick={() => dialogRef.current?.open()}
        >
          <LinkSimpleIcon size={14} weight="bold" />
          <span className={styles.profileLinks__primary}>{prettyUrl(first.url)}</span>
          <span className={styles.profileLinks__more}>and {rest.length} more</span>
        </button>
      )}

      {rest.length > 0 && (
        <NativeDialog ref={dialogRef} className={styles.dialog} lightDismiss aria-label="Links">
          <header className={styles.dialog__header}>
            <button type="button" className={styles.dialog__close} aria-label="Close" onClick={() => dialogRef.current?.close()}>
              <XIcon size={20} />
            </button>
            <h3 className={styles.dialog__title}>Links</h3>
          </header>

          <ul className={styles.dialog__list}>
            {links.map((link, index) => (
              <li key={`${link.url}-${index}`}>
                <a className={styles.dialog__link} href={toHref(link.url)} target="_blank" rel="noopener noreferrer">
                  <span className={styles.dialog__icon}>
                    <LinkSimpleIcon size={18} weight="bold" />
                  </span>
                  <span className={styles.dialog__text}>
                    <strong>{link.label || prettyUrl(link.url)}</strong>
                    {/* The name is only worth a second line when it is not just the URL again */}
                    {link.label && link.label !== prettyUrl(link.url) && <small>{prettyUrl(link.url)}</small>}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </NativeDialog>
      )}
    </>
  )
}
