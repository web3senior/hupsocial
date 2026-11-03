'use client'

import clsx from 'clsx'
import { DECORATION_SLOTS, findDecoration } from '@/config/decorations'
import { DECORATION_ART } from './Decorations'
import styles from './DecorationFrame.module.scss'

/** The decorations to draw at this size, in paint order. */
const layersFor = (decorations, size) =>
  DECORATION_SLOTS.flatMap((slot) => {
    const item = findDecoration(decorations?.[slot])
    return item?.slot === slot && size >= item.minSize && DECORATION_ART[item.id] ? [item] : []
  })

/**
 * DecorationFrame
 * Stacks a wallet's avatar decorations around a picture. The picture stays the only thing in flow,
 * so the frame is exactly its box and no consumer's layout moves; every layer is positioned off it
 * and spills past it. With nothing to draw — no decorations, or an avatar too small for them — the
 * picture is returned as it was, without the wrapper.
 * @param {Object} props
 * @param {Object} [props.decorations] `{ [slot]: decorationId }`, as profiles carry it.
 * @param {number} props.size Laid-out avatar width in px; decides which layers fit.
 * @param {boolean} [props.fill] Fill the parent instead of shrinking to the picture — for a
 *   picture sized in percent, which needs a definite box to resolve against.
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children The picture.
 */
const DecorationFrame = ({ decorations, size, fill = false, className, children }) => {
  const layers = layersFor(decorations, size)
  if (!layers.length) return children

  return (
    <span className={clsx(styles.frame, fill && styles['frame--fill'], className)}>
      {children}
      {layers.map(({ id, slot }) => {
        const Art = DECORATION_ART[id]
        return (
          <span key={slot} className={clsx(styles.frame__layer, styles[`frame__layer--${slot}`])}>
            <Art />
          </span>
        )
      })}
    </span>
  )
}

export default DecorationFrame
