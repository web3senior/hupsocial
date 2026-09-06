'use client'

import { InfoIcon } from '@phosphor-icons/react'
import Tooltip from './Tooltip'
import styles from './InfoHint.module.scss'

/**
 * Info Hint
 * A section's explanation, parked in a tooltip on a dot beside its label — so a form
 * stays a column of controls instead of a column of prose.
 *
 * @param {string} props.label Names the control the hint belongs to, for screen readers.
 */
const InfoHint = ({ label, children }) => (
  <Tooltip content={children}>
    <button type="button" className={styles.infoHint} aria-label={`About ${label}`}>
      <InfoIcon size={13} weight="fill" />
    </button>
  </Tooltip>
)

export default InfoHint
