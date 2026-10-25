'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeftIcon } from '@phosphor-icons/react'
import { useCanGoBack } from '@/hooks/useCanGoBack'

/**
 * The round back arrow. Returns to the page the reader came from; the href is only for the first
 * page of a visit (a shared URL, where stepping back would leave the site) and for a new-tab click.
 * Chrome comes from the consumer's `className`.
 * @param {Object} props
 * @param {string} props.href Where to go when there is no in-app page behind this one.
 * @param {string} [props.label] Accessible name for that fallback, e.g. "Back to feed".
 * @param {string} [props.className]
 */
export default function BackLink({ href, label = 'Back', className }) {
  const pathname = usePathname()
  const router = useRouter()
  const canGoBack = useCanGoBack(pathname)
  const accessibleLabel = canGoBack ? 'Back' : label

  const handleClick = (event) => {
    if (!canGoBack || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    router.back()
  }

  return (
    <Link href={href} className={className} aria-label={accessibleLabel} title={accessibleLabel} onClick={handleClick}>
      <ArrowLeftIcon size={20} aria-hidden="true" />
    </Link>
  )
}
