'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useClientMounted } from '@/hooks/useClientMount'
import { config } from '@/config/wagmi'
import { useDisconnect, useConnect, useSwitchChain, useAccount } from 'wagmi' // Updated useConnection to useAccount
import { getActiveChain } from '@/lib/communication'
import { ensureProfile } from '@/lib/api'
import { useProfile } from '@/hooks/useProfile'
import NativePopover from '@/components/ui/NativePopover'
import styles from './ConnectWallet.module.scss'

const DEFAULT_PFP = `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`

export const ConnectWallet = () => {
  const [showModal, setShowModal] = useState(false)
  const { disconnect } = useDisconnect()
  const mounted = useClientMounted()

  // Use useAccount to get the live chain directly from the wallet provider
  const { address, isConnected, chain: walletChain } = useAccount()

  const ensuredProfileRef = useRef(null)

  // Derive the active chain directly during render without any state.
  // If walletChain exists, it's used; otherwise getActiveChain falls back to localStorage/defaults.
  const [currentChainData] = getActiveChain()

  useEffect(() => {
    if (!isConnected || !address) return

    const walletAddress = address.toLowerCase()

    if (ensuredProfileRef.current === walletAddress) return
    ensuredProfileRef.current = walletAddress

    ensureProfile(walletAddress).catch((error) => {
      console.error('Failed to create user profile:', error.message)
      ensuredProfileRef.current = null
    })
  }, [isConnected, address])

  return !mounted ? null : (
    <>
      {currentChainData && (
        <div className={`${styles.networks}`}>
          <NativePopover
            placement="bottom-start"
            type="auto"
            trigger={
              <button type="button" className={`${styles.btnNetwork}`} title={`${currentChainData.name}`}>
                <span className={`rounded`} dangerouslySetInnerHTML={{ __html: currentChainData.icon }} />
              </button>
            }
          >
            {/* No callbacks needed anymore since rendering is fully reactive */}
            <DefaultNetwork currentNetwork={currentChainData.id} />
          </NativePopover>
        </div>
      )}

      {isConnected && <Profile addr={address} />}

      {!isConnected && (
        <button className={`${styles.btnConnect} flex align-items-center gap-025 `} onClick={() => setShowModal(true)}>
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#fff">
            <path d="M224.62-160q-27.62 0-46.12-18.5Q160-197 160-224.62v-510.76q0-27.62 18.5-46.12Q197-800 224.62-800h510.76q27.62 0 46.12 18.5Q800-763 800-735.38V-680H544.62q-47.93 0-76.27 28.35Q440-623.31 440-575.38v190.76q0 47.93 28.35 76.27Q496.69-280 544.62-280H800v55.38q0 27.62-18.5 46.12Q763-160 735.38-160H224.62Zm320-160q-27.62 0-46.12-18.5Q480-357 480-384.62v-190.76q0-27.62 18.5-46.12Q517-640 544.62-640h230.76q27.62 0 46.12 18.5Q840-603 840-575.38v190.76q0 27.62-18.5 46.12Q803-320 775.38-320H544.62ZM640-420q26 0 43-17t17-43q0-26-17-43t-43-17q-26 0-43 17t-17 43q0 26 17 43t43 17Z" />
          </svg>
          Connect
        </button>
      )}

      {showModal && <WalletConnectModal setShowModal={setShowModal} />}
    </>
  )
}

export function WalletConnectModal({ setShowModal }) {
  return (
    <div className={`${styles.walletConnectModal}`} onClick={() => setShowModal(false)}>
      <WalletOptions />
    </div>
  )
}

export function WalletOptions() {
  const { connectors, connect } = useConnect()

  return connectors.map((connector) => (
    <button className={`${styles['wallet']}`} key={connector.uid} onClick={() => connect({ connector })}>
      {connector.name}
    </button>
  ))
}


export function DefaultNetwork({ currentNetwork }) {
  const { isConnected } = useAccount()
  const switchChain = useSwitchChain({ config })
  const router = useRouter()

  const handleSwitchChain = (chain) => {
    const chainId = chain.id

    if (isConnected) {
      switchChain.mutate(
        { chainId: chainId },
        {
          onSuccess: () => {
            localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`, chainId)
          },
          onError: (error) => {
            console.error('Switch chain failed:', error)
          },
        },
      )
    } else {
      // Disconnected users instantly change local storage and route
      localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`, chainId)
    }
  }

  return (
    <div className={`${styles.networkDialogInner}`}>
      <h2>Select Your Network</h2>
      <p>
        Your choices shape the content you experience. Each network carries a unique, unalterable history of posts, identities, and
        governance votes.
      </p>

      <div className={`${styles.networks} grid grid--fit gap-050`} style={{ '--data-width': `150px` }}>
        {config.chains.map((chain, i) => (
          <button
            key={i}
            type="button"
            onClick={() => handleSwitchChain(chain)}
            data-current={chain.id.toString() === currentNetwork.toString()}
          >
            <div className={`rounded`} dangerouslySetInnerHTML={{ __html: chain.icon }} />
            <span>{chain.name}</span>
          </button>
        ))}
      </div>

      <p className={`text-center mt-10 ${styles.link}`} onClick={() => router.push(`/networks`)}>
        View networks
      </p>
    </div>
  )
}

export function Profile({ addr }) {
  const { profile, isLoading } = useProfile(addr)

  if (isLoading || !profile)
    return (
      <div className={`${styles.profileShimmer} flex align-items-center`}>
        <div className={`shimmer rounded`} style={{ width: `36px`, height: `36px` }} />
      </div>
    )

  return (
    <Link href={`/${addr}`}>
      <figure className={`${styles.pfp} relative d-f-c flex-column grid--gap-050 rounded`} title={profile.name}>
        <img alt={profile.name || `PFP`} src={profile.profileImage} className={`rounded`} />
      </figure>
    </Link>
  )
}
