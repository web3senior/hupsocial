'use client'

import { ArrowSquareOutIcon, DiscordLogoIcon, GlobeIcon, LinkSimpleIcon, TelegramLogoIcon, XLogoIcon } from '@phosphor-icons/react'
import { SOCIAL_URLS } from '@/lib/tokenPage'
import styles from './TokenPageBody.module.scss'

/** The named socials, in the order they are shown, with the icon each one wears. */
const SOCIALS = [
  { key: 'website', label: 'Website', icon: GlobeIcon, href: (value) => value },
  { key: 'x_handle', label: 'X', icon: XLogoIcon, href: SOCIAL_URLS.x_handle },
  { key: 'telegram', label: 'Telegram', icon: TelegramLogoIcon, href: SOCIAL_URLS.telegram },
  { key: 'discord', label: 'Discord', icon: DiscordLogoIcon, href: SOCIAL_URLS.discord },
  { key: 'farcaster', label: 'Farcaster', icon: LinkSimpleIcon, href: SOCIAL_URLS.farcaster },
]

/**
 * Token Page Body
 * The author-written half of a token page — the part a person wrote rather than the part the
 * chain reports.
 *
 * Shared by both kinds of page so a token launched on Hup and a token that merely has an owner
 * present their words identically; only who is allowed to write them differs. Renders nothing at
 * all when nothing has been written, so an unclaimed token is a page of facts rather than a page
 * of empty headings.
 *
 * @param {Object} props
 * @param {Object|null} props.page The stored page.
 * @param {string} props.name Token name, for the About heading.
 */
export default function TokenPageBody({ page, name }) {
  const socialLinks = SOCIALS.map((social) => ({ ...social, value: page?.[social.key] })).filter(
    (social) => social.value,
  )
  const customLinks = page?.links ?? []
  const hasLinks = socialLinks.length > 0 || customLinks.length > 0

  if (!page?.about && !hasLinks) return null

  return (
    <div className={styles.body}>
      {page?.about && (
        <section className={styles.about} aria-labelledby="token-about-heading">
          <h2 className={styles.about__heading} id="token-about-heading">
            About {name}
          </h2>
          <div className={styles.about__copy}>
            {page.about.split(/\n{2,}/).map((paragraph, index) => (
              // Paragraphs of one immutable body of text — index is the only stable identity they
              // have, and the list is never reordered
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </section>
      )}

      {hasLinks && (
        <section className={styles.links} aria-labelledby="token-links-heading">
          <h2 className={styles.links__heading} id="token-links-heading">
            Links
          </h2>
          <ul className={styles.links__list}>
            {socialLinks.map((social) => (
              <li key={social.key}>
                <a className={styles.links__link} href={social.href(social.value)} target="_blank" rel="noopener noreferrer nofollow">
                  <social.icon size={16} aria-hidden="true" />
                  <span className={styles.links__label}>{social.label}</span>
                  <ArrowSquareOutIcon size={13} aria-hidden="true" />
                </a>
              </li>
            ))}
            {customLinks.map((link) => (
              <li key={link.url}>
                <a className={styles.links__link} href={link.url} target="_blank" rel="noopener noreferrer nofollow">
                  <LinkSimpleIcon size={16} aria-hidden="true" />
                  <span className={styles.links__label}>{link.title}</span>
                  <ArrowSquareOutIcon size={13} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
