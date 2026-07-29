'use client'

import { useCallback, useEffect, useState } from 'react'

const DISMISSED_KEY = 'hup:install-prompt-dismissed'

// Chromium fires `beforeinstallprompt` once, moments after load — long before the splash
// screen clears and any consumer mounts. Capture it at module scope (ClientLayout pulls
// this file into the initial client bundle) and hand it to whichever component asks later.
let deferredPrompt = null
const subscribers = new Set()

const publish = () => subscribers.forEach((notify) => notify())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress the mini-infobar so the app owns the moment the offer appears
    event.preventDefault()
    deferredPrompt = event
    publish()
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    publish()
  })
}

// iOS Safari and desktop Safari never fire the event, so they need their own copy
const readPlatform = () => {
  const ua = window.navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return 'ios'
  if (ua.includes('Macintosh') && ua.includes('Safari') && !ua.includes('Chrome')) return 'macSafari'
  return 'other'
}

const INITIAL_STATE = {
  isReady: false,
  canInstall: false,
  isStandalone: false,
  platform: 'other',
  // Assume dismissed until localStorage says otherwise — the offer must never flash
  // in front of someone who already turned it down
  isDismissed: true,
}

/**
 * Shared state for the PWA install offer: whether the browser will accept a prompt,
 * whether the app is already installed, and which manual fallback to show if not.
 */
export default function useInstallPrompt() {
  const [state, setState] = useState(INITIAL_STATE)

  useEffect(() => {
    const sync = () =>
      setState({
        isReady: true,
        canInstall: Boolean(deferredPrompt),
        // navigator.standalone is iOS Safari's equivalent of the display-mode query
        isStandalone: window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
        platform: readPlatform(),
        isDismissed: window.localStorage.getItem(DISMISSED_KEY) === '1',
      })

    sync()
    subscribers.add(sync)

    return () => {
      subscribers.delete(sync)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    const event = deferredPrompt
    if (!event) return null

    // The event is single-use — drop it before awaiting so a double click can't reuse it
    deferredPrompt = null
    publish()

    event.prompt()
    const { outcome } = await event.userChoice

    return outcome
  }, [])

  const dismiss = useCallback(() => {
    window.localStorage.setItem(DISMISSED_KEY, '1')
    setState((prev) => ({ ...prev, isDismissed: true }))
  }, [])

  return { ...state, promptInstall, dismiss }
}
