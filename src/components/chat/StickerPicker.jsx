'use client'

import { useState } from 'react'
import { StickerIcon, XIcon } from '@phosphor-icons/react'
import NativePopover from '@/components/ui/NativePopover'
import { CHAT_STICKERS } from '@/lib/chatStickers'
import AnimatedSticker from './AnimatedSticker'
import styles from './Stickers.module.scss'

export default function StickerPicker({ onSelect, disabled }) {
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState(false)
  const stickers = CHAT_STICKERS.filter((sticker) => sticker.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

  return (
    <NativePopover
      placement="top-start"
      className={styles.picker}
      onToggle={(event) => setOpened(event.newState === 'open')}
      trigger={<button type="button" disabled={disabled} title="Animated stickers" aria-label="Add an animated sticker"><StickerIcon size={20} /></button>}
    >
      {({ close }) => (
        <div className={styles.picker__panel}>
          <div className={styles.picker__header}>
            <strong>Animated stickers</strong>
            <button type="button" onClick={close} aria-label="Close stickers"><XIcon size={18} /></button>
          </div>
          <input
            className={styles.picker__search}
            type="search"
            placeholder="Search stickers"
            aria-label="Search stickers"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }}
          />
          <div className={styles.picker__grid}>
            {opened && stickers.map((sticker) => (
              <button
                key={sticker.id}
                type="button"
                className={styles.picker__item}
                title={sticker.label}
                aria-label={`Select ${sticker.label} sticker`}
                disabled={disabled}
                onClick={() => { close(); onSelect(sticker) }}
              >
                <AnimatedSticker sticker={sticker} />
              </button>
            ))}
            {stickers.length === 0 && <p>No stickers found.</p>}
          </div>
        </div>
      )}
    </NativePopover>
  )
}
