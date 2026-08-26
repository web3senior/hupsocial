'use client'

import { useState } from 'react'
import clsx from 'clsx'
import { CaretDownIcon } from '@phosphor-icons/react'
import styles from './DetailSection.module.scss'

/**
 * Detail Section
 * One collapsible block in a stack of them — the shape an NFT's record takes on a detail page,
 * where a reader wants the price open, the traits open, and the twenty-line activity log closed
 * until they ask for it.
 *
 * Native `<details>`/`<summary>`, not a div with a click handler and aria-expanded. The browser
 * already gives that pair keyboard operation, the right roles, and — the part that matters most
 * here — find-in-page: Ctrl+F for a trait value opens the section holding it and scrolls to the
 * match. A hand-rolled accordion silently loses all three, and these sections hold enough text
 * to make that loss real.
 *
 * State is mirrored in React rather than left to the DOM, because find-in-page and the caret both
 * move it and the two have to agree. Pass `open` with `onToggle` where something outside drives
 * it — the action card's "Top offer" button opening the offer book — and `defaultOpen` otherwise.
 *
 * `defaultOpen` keeps working after mount, up until the reader touches the section. Consumers
 * derive it from data that arrives late ("open Traits if this token has any"), and a plain
 * useState initialiser would freeze the answer at the first render, when the fetch hasn't landed
 * and every count is still zero — leaving a section shut on content it was meant to reveal. Once
 * the reader opens or closes it themselves, their choice wins and later data can't overrule it.
 *
 * The `count` beside the title is what makes a closed section worth opening: "Offers 4" invites a
 * click, a bare "Offers" doesn't.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.title Section heading.
 * @param {React.ReactNode} [props.icon] Leading glyph, decorative.
 * @param {number|string|null} [props.count] Row count shown beside the title; omitted when null.
 * @param {React.ReactNode} [props.aside] Rendered at the right of the summary, before the caret —
 * a floor figure, a currency, a "view all" link.
 * @param {boolean} [props.defaultOpen=false] Initial state when uncontrolled.
 * @param {boolean} [props.open] Controlled state. Pass with onToggle.
 * @param {Function} [props.onToggle] Receives the next open state.
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children
 */
export default function DetailSection({
  title,
  icon,
  count = null,
  aside,
  defaultOpen = false,
  open,
  onToggle,
  className,
  children,
}) {
  // Null until the reader touches this section — that is what lets a late `defaultOpen` still
  // take effect while never overriding a deliberate collapse
  const [readerChoice, setReaderChoice] = useState(null)
  const isControlled = open !== undefined
  const isOpen = isControlled ? open : (readerChoice ?? defaultOpen)

  return (
    <details
      className={clsx(styles.section, className)}
      open={isOpen}
      onToggle={(event) => {
        // <details> fires toggle on the element itself and React's synthetic version bubbles,
        // so a nested section would otherwise report its state to the one containing it
        if (event.target !== event.currentTarget) return

        const next = event.currentTarget.open
        if (!isControlled) setReaderChoice(next)
        onToggle?.(next)
      }}
    >
      <summary className={styles.section__summary}>
        <span className={styles.section__title}>
          {icon && (
            <span className={styles.section__icon} aria-hidden="true">
              {icon}
            </span>
          )}
          {title}
          {count !== null && count !== undefined && <span className={styles.section__count}>{count}</span>}
        </span>

        {aside && <span className={styles.section__aside}>{aside}</span>}

        <CaretDownIcon size={16} weight="bold" className={styles.section__caret} aria-hidden="true" />
      </summary>

      <div className={styles.section__body}>{children}</div>
    </details>
  )
}
