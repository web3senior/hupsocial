// components/ServiceWorkerRegistry.tsx
'use client'
import { useEffect } from 'react'

export default function ServiceWorkerRegistry() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('Service Worker registered successfully:', registration)
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error)
        })

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'NAVIGATE') {
          router.push(event.data.url)
        }
      })
    }
  }, [])

  return null
}
