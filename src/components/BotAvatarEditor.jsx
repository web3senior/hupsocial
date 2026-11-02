'use client'

import clsx from 'clsx'
import { ArrowCounterClockwiseIcon, ShuffleIcon } from '@phosphor-icons/react'
import BotAvatar from '@/components/BotAvatar'
import { BOT_COLORS, BOT_TRAIT_LABELS, BOT_TRAITS, botTraitsFor, randomBotTraits } from '@/lib/botAvatar'
import styles from './BotAvatarEditor.module.scss'

const TRAIT_NAMES = { dome: 'Dome', ears: 'Ears', eyes: 'Eyes', mouth: 'Mouth', chest: 'Chest', cheeks: 'Cheeks' }

/**
 * Picks a robot's look (lib/botAvatar.js): a live preview, the colours, one row per trait, and
 * Shuffle / Reset. Controlled — `value` is a full set of traits, `onChange` gets the next one.
 * `seed` is what Reset returns to.
 */
export default function BotAvatarEditor({ seed, value, onChange, disabled = false }) {
  const set = (name, option) => onChange({ ...value, [name]: option })

  return (
    <div className={styles.editor}>
      <div className={styles.editor__preview}>
        <BotAvatar traits={value} size={144} className={styles.editor__robot} />
        <div className={styles.editor__actions}>
          <button type="button" className={styles.editor__action} onClick={() => onChange(randomBotTraits())} disabled={disabled}>
            <ShuffleIcon size={14} /> Shuffle
          </button>
          <button type="button" className={styles.editor__action} onClick={() => onChange(botTraitsFor(seed))} disabled={disabled}>
            <ArrowCounterClockwiseIcon size={14} /> Reset
          </button>
        </div>
      </div>

      <div className={styles.editor__controls}>
        <fieldset className={styles.editor__group} disabled={disabled}>
          <legend className={styles.editor__legend}>Color</legend>
          <div className={styles.editor__swatches}>
            {BOT_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                className={clsx(styles.editor__swatch, value.color === color.id && styles['editor__swatch--active'])}
                style={{ '--swatch': `hsl(${color.hue} ${Math.round(80 * color.sat)}% 66%)` }}
                onClick={() => set('color', color.id)}
                aria-label={color.label}
                aria-pressed={value.color === color.id}
                title={color.label}
              />
            ))}
          </div>
        </fieldset>

        {Object.entries(TRAIT_NAMES).map(([name, label]) => (
          <fieldset key={name} className={styles.editor__group} disabled={disabled}>
            <legend className={styles.editor__legend}>{label}</legend>
            <div className={styles.editor__options}>
              {BOT_TRAITS[name].map((option) => (
                <button
                  key={option}
                  type="button"
                  className={clsx(styles.editor__option, value[name] === option && styles['editor__option--active'])}
                  onClick={() => set(name, option)}
                  aria-pressed={value[name] === option}
                >
                  {BOT_TRAIT_LABELS[name][option]}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  )
}
