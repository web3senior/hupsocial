import { useSyncExternalStore } from 'react'

/**
 * Volume and mute preference shared by every player in the app — feed galleries, the lightbox,
 * and the shorts rail. Muting a video in one place should stay muted in the next, so the
 * preference lives in one key rather than per-component state.
 */

const SOUND_PREFS_KEY = 'hup_media_sound'

/* Muted by default: browsers block autoplay with sound, and an inline feed video that grabs
   audio unprompted is hostile anyway. */
export const DEFAULT_SOUND_PREFS = { volume: 1, muted: true }

export const loadSoundPrefs = () => {
  if (typeof window === 'undefined') return DEFAULT_SOUND_PREFS
  try {
    const stored = JSON.parse(localStorage.getItem(SOUND_PREFS_KEY))
    return {
      volume: typeof stored?.volume === 'number' ? Math.min(1, Math.max(0, stored.volume)) : DEFAULT_SOUND_PREFS.volume,
      muted: typeof stored?.muted === 'boolean' ? stored.muted : DEFAULT_SOUND_PREFS.muted,
    }
  } catch {
    return DEFAULT_SOUND_PREFS
  }
}

/* localStorage fires `storage` only in OTHER tabs, so same-tab subscribers are notified here */
const listeners = new Set()

export const saveSoundPrefs = (prefs) => {
  try {
    localStorage.setItem(SOUND_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Storage may be unavailable (private mode / quota) — preference just won't persist
  }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener) => {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

/* Reading localStorage during render would desync hydration, and reading it in an effect means
   a setState-driven second render. useSyncExternalStore is the primitive built for exactly this:
   the server snapshot is the default, and the client re-reads on subscribe. */
export const useMutedPreference = () =>
  useSyncExternalStore(
    subscribe,
    () => loadSoundPrefs().muted,
    () => DEFAULT_SOUND_PREFS.muted
  )

export const setMutedPreference = (muted) => saveSoundPrefs({ ...loadSoundPrefs(), muted })
