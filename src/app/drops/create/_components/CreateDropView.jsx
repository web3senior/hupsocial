'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CONTRACTS } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { setActiveChainId, useActiveChain } from '@/hooks/useActiveChain'
import { networkColorStyle } from '@/lib/networkColors'
import DropForm from '@/components/DropForm'
import DropsHero, { HeroChain } from '@/components/DropsHero'
import styles from './CreateDropView.module.scss'

/**
 * Create Drop View
 * The page around DropForm. The chain is the app's active chain — the form's first step picks it,
 * writing through to the same store the header switcher uses, so there is one answer to "which
 * network" on screen at any moment. A `?chain=` link seeds that store once and then gets out of
 * the way, or the picker would fight the link for the rest of the session.
 */
export default function CreateDropView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { chainId } = useActiveChain()

  const chainInfo = appChains.find((chain) => chain.id === chainId)
  const requested = Number(searchParams.get('chain'))
  const seededRef = useRef(false)

  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true

    // Only a chain that can actually carry a drop is worth seeding
    const linked = appChains.find((chain) => chain.id === requested && CONTRACTS[`chain${chain.id}`]?.drops)
    if (linked && linked.id !== chainId) setActiveChainId(linked.id)
  }, [requested, chainId])

  return (
    // Colours come from the chain the drop will deploy to, so the marks follow the network step
    <div className={styles.create} style={networkColorStyle(chainInfo)}>
      {/* No heading here — PageTitle already puts "Create a drop" in the fixed header */}
      <DropsHero
        chainId={chainId}
        title="A collection that is yours from its first block."
        action={<Link href="/drops">Browse drops</Link>}
      >
        Deploying on <HeroChain chainId={chainId} />
      </DropsHero>

      <DropForm
        chainId={chainId}
        onCreated={(drop) => {
          // The success step already links onward; this covers a creation that returned no reference
          if (!drop) router.push('/drops')
        }}
      />
    </div>
  )
}
