// components/ServiceWorkerRegistry.tsx
'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ServiceWorkerRegistry() {
  const router = useRouter()

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('Service Worker registered successfully:', registration)
      })
      .catch((error) => {
        console.error('Service Worker registration failed:', error)
      })

    // Sent by the worker's notificationclick handler when a Hup window is already open.
    const handleMessage = (event) => {
      if (event.data && event.data.type === 'NAVIGATE') {
        router.push(event.data.url)
      }
    }

    navigator.serviceWorker.addEventListener('message', handleMessage)
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage)
  }, [router])

  return null
}
