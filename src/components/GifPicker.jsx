'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import { ContentSpinner } from '@/components/Loading'
import NativeDialog from '@/components/ui/NativeDialog'
import styles from '@/components/GifPicker.module.scss'

const SEARCH_DEBOUNCE_MS = 400

/**
 * Modal Giphy picker layered over the composer dialog (nested showModal stacks
 * in the top layer). Results come from /api/giphy so the API key stays
 * server-side; selecting a GIF hands the trimmed Giphy item to `onSelect`.
 */
const GifPicker = forwardRef(function GifPicker({ onSelect }, ref) {
  const dialogRef = useRef(null)
  const searchInputRef = useRef(null)
  const hasLoadedRef = useRef(false)

  const [query, setQuery] = useState('')
  const [items, setItems] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchGifs = async (searchTerm) => {
    setIsLoading(true)
    setError(null)
    try {
      const params = searchTerm ? `?q=${encodeURIComponent(searchTerm)}` : ''
      const res = await fetch(`/api/giphy${params}`)
      if (!res.ok) throw new Error('Giphy request failed')
      const data = await res.json()
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch (err) {
      console.error('Failed to load GIFs:', err)
      setError('Unable to load GIFs. Try again.')
    } finally {
      setIsLoading(false)
    }
  }

  // Debounced search; trending is only fetched lazily on first open (see open())
  useEffect(() => {
    if (!hasLoadedRef.current) return
    const timer = setTimeout(() => fetchGifs(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        dialogRef.current?.open()
        searchInputRef.current?.focus()
        if (!hasLoadedRef.current) {
          hasLoadedRef.current = true
          fetchGifs('')
        }
      },
      close: () => dialogRef.current?.close(),
    }),
    []
  )

  const handlePick = (gif) => {
    dialogRef.current?.close()
    onSelect?.(gif)
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.gifPicker}
      aria-label="GIF picker"
      lightDismiss
      // Native close/cancel don't bubble, but React's synthetic versions do — without
      // these stops, closing the picker also fires the composer dialog's onClose
      onClose={(event) => event.stopPropagation()}
      onCancel={(event) => event.stopPropagation()}
    >
      <header className={styles.gifPicker__header}>
        <div className={styles.gifPicker__search}>
          <MagnifyingGlassIcon size={18} />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            placeholder="Search GIPHY"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault()
            }}
          />
        </div>
        <button type="button" className={styles.gifPicker__close} onClick={() => dialogRef.current?.close()} aria-label="Close GIF picker">
          <XIcon size={20} />
        </button>
      </header>

      <div className={styles.gifPicker__results}>
        {error && <p className={styles.gifPicker__message}>{error}</p>}
        {!error && !isLoading && items.length === 0 && <p className={styles.gifPicker__message}>No GIFs found</p>}
        {!error && items.length > 0 && (
          <div className={styles.gifPicker__grid}>
            {items.map((gif) => (
              <button key={gif.id} type="button" className={styles.gifPicker__item} onClick={() => handlePick(gif)} title={gif.title}>
                <img src={gif.preview.url} width={gif.preview.width} height={gif.preview.height} alt={gif.title} loading="lazy" />
              </button>
            ))}
          </div>
        )}
        {isLoading && (
          <div className={styles.gifPicker__loading}>
            <ContentSpinner />
          </div>
        )}
      </div>

      {/* Attribution required by Giphy's API terms */}
      <footer className={styles.gifPicker__footer}>Powered by 
      <a href="https://giphy.com/">
        <img src="/giphy.svg" alt="Giphy" />
      </a>
      </footer>
    </NativeDialog>
  )
})

export default GifPicker
