'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckIcon, GlobeIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { getLanguageLabel, TRANSLATION_LANGUAGES } from '@/lib/languageHelper'
import { setPreferredLanguage, usePreferredLanguage } from '@/hooks/usePreferredLanguage'
import styles from './LanguagePreference.module.scss'
import clsx from 'clsx'

export default function LanguagePreference() {
  const preferred = usePreferredLanguage()
  const [query, setQuery] = useState('')

  const listRef = useRef(null)
  const selectedRef = useRef(null)
  const hasInteracted = useRef(false)

  const selectedLabel = getLanguageLabel(preferred)

  // The list opens on Afrikaans, so a reader who picked something far down would have to
  // hunt for their own choice. Centre it by scrolling the container directly rather than
  // with scrollIntoView, which would drag the whole settings page along with it. This
  // keys on the preference because the stored value only arrives on the render after
  // hydration — centring on mount alone would land on the server's English placeholder.
  // Once the reader searches or picks, the list is theirs and stops moving on its own.
  useEffect(() => {
    if (hasInteracted.current) return

    const list = listRef.current
    const option = selectedRef.current
    if (!list || !option) return

    list.scrollTop = option.offsetTop - list.clientHeight / 2 + option.clientHeight / 2
  }, [preferred])

  // Match on either name so a reader can search in English or in their own language
  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    if (!term) return TRANSLATION_LANGUAGES

    return TRANSLATION_LANGUAGES.filter(
      (language) =>
        language.name.toLocaleLowerCase().includes(term) ||
        language.nativeName.toLocaleLowerCase().includes(term) ||
        language.code.toLocaleLowerCase().startsWith(term)
    )
  }, [query])

  return (
    <div className={styles.language}>
      <header className={styles.language__header}>
        <span className={styles.language__icon}>
          <GlobeIcon size={22} />
        </span>
        <div>
          <h4 className={styles.language__title}>Language</h4>
          <p className={styles.language__subtitle}>Choose the language posts are translated into.</p>
        </div>
      </header>

      <section className={styles.language__panel}>
        <div className={styles.language__current}>
          <span className={styles.language__currentLabel}>Translate posts into</span>
          <strong className={styles.language__currentValue} lang={selectedLabel.code} dir="auto">
            {selectedLabel.nativeName}
          </strong>
        </div>

        <div className={styles.language__search}>
          <MagnifyingGlassIcon size={18} className={styles.language__searchIcon} />
          <input
            type="search"
            className={styles.language__searchInput}
            value={query}
            onChange={(event) => {
              hasInteracted.current = true
              setQuery(event.target.value)
            }}
            placeholder="Search languages"
            aria-label="Search languages"
          />
        </div>

        <ul className={styles.language__list} ref={listRef} role="radiogroup" aria-label="Translate posts into">
          {results.map((language) => {
            const isSelected = language.code === preferred

            return (
              <li key={language.code}>
                <button
                  type="button"
                  role="radio"
                  ref={isSelected ? selectedRef : null}
                  aria-checked={isSelected}
                  className={clsx(styles.language__option, isSelected && styles['language__option--selected'])}
                  onClick={() => {
                    hasInteracted.current = true
                    setPreferredLanguage(language.code)
                  }}
                >
                  <span className={styles.language__names}>
                    <span className={styles.language__native} lang={language.code} dir="auto">
                      {language.nativeName}
                    </span>
                    {language.nativeName !== language.name && <span className={styles.language__english}>{language.name}</span>}
                  </span>
                  {isSelected && <CheckIcon size={18} weight="bold" className={styles.language__check} />}
                </button>
              </li>
            )
          })}

          {results.length === 0 && <li className={styles.language__empty}>No language matches “{query}”.</li>}
        </ul>
      </section>

      <p className={styles.language__note}>
        Posts stay in the language they were written in. The Translate action under a post renders it in the language you pick here.
      </p>
    </div>
  )
}
