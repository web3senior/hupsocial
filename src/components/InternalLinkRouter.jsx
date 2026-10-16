'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { routeInternalLinkClick } from '@/lib/internalLinks'

// Injected HTML (post bodies, comments, Hupi replies, articles) renders plain <a> tags with no
// Link behind them, so an internal link would reload the whole app. One document listener
// routes those clicks client-side; Next's own Links preventDefault first and are left alone.
export default function InternalLinkRouter() {
  const router = useRouter()

  useEffect(() => {
    const handleClick = (event) => routeInternalLinkClick(event, router)
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [router])

  return null
}
