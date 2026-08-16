'use client'

import { useState } from 'react'
import { CaretDownIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { SOCIAL_LINKS } from '@/lib/socialLinks'
import styles from '../page.module.scss'

// Optional website + socials panel, shared by the create modal and the Modify form (both feed
// the same `links` array in the community's IPFS metadata). Collapsed by default so the two
// already-long forms don't grow for the majority of communities that set none, and open on
// mount whenever the community being edited already has links to show.
export default function BrandingLinksFields({
  socials,
  onSocialsChange,
  extraLinks = [],
  onExtraLinksChange,
  disabled = false,
  fieldClassName,
  labelClassName,
  inputClassName,
}) {
  const hasValues = SOCIAL_LINKS.some(({ key }) => socials?.[key]?.trim()) || extraLinks.length > 0
  const [isOpen, setIsOpen] = useState(hasValues)

  const updateExtra = (index, patch) =>
    onExtraLinksChange(extraLinks.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  return (
    <div className={styles.branding}>
      <button
        type="button"
        className={styles.branding__toggle}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <CaretDownIcon size={13} className={clsx(isOpen && styles['branding__caret--open'])} />
        Branding &amp; links <em>optional — website, socials</em>
      </button>

      {isOpen && (
        <div className={styles.branding__panel}>
          {SOCIAL_LINKS.map(({ key, title, placeholder }) => (
            <div key={key} className={fieldClassName || styles.card__field}>
              <label className={labelClassName || styles.card__label}>{title}</label>
              <input
                className={inputClassName || styles.card__input}
                type="url"
                inputMode="url"
                placeholder={placeholder}
                value={socials?.[key] ?? ''}
                disabled={disabled}
                onChange={(e) => onSocialsChange({ ...socials, [key]: e.target.value })}
              />
            </div>
          ))}

          {/* Free-form rows: parseLinks routes anything it can't map to a dedicated field here,
              so editing a community keeps links written by other tools instead of dropping them */}
          {extraLinks.map((row, index) => (
            <div key={index} className={styles.branding__row}>
              <input
                className={inputClassName || styles.card__input}
                placeholder="Label"
                value={row.title}
                disabled={disabled}
                onChange={(e) => updateExtra(index, { title: e.target.value })}
              />
              <input
                className={inputClassName || styles.card__input}
                type="url"
                inputMode="url"
                placeholder="https://…"
                value={row.url}
                disabled={disabled}
                onChange={(e) => updateExtra(index, { url: e.target.value })}
              />
              <button
                type="button"
                className={styles.card__cancelBtn}
                aria-label={`Remove link ${index + 1}`}
                disabled={disabled}
                onClick={() => onExtraLinksChange(extraLinks.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            </div>
          ))}

          <button
            type="button"
            className={styles.card__editBtn}
            style={{ alignSelf: 'flex-start' }}
            disabled={disabled || extraLinks.length >= 5}
            onClick={() => onExtraLinksChange([...extraLinks, { title: '', url: '' }])}
          >
            + Add another link
          </button>

          <small className={styles.branding__hint}>
            Shown on the community page. Empty fields are dropped when the metadata is saved.
          </small>
        </div>
      )}
    </div>
  )
}
