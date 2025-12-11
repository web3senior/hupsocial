'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import { useClientMounted } from '@/hooks/useClientMount'
import { config } from '@/config/wagmi'
import { useAccount, useDisconnect, Connector, useConnect, useSwitchChain, useConfig } from 'wagmi'
import { getActiveChain } from '@/lib/communication'
import { getProfile, getUniversalProfile } from '@/lib/api'
import Shimmer from '@/components/ui/Shimmer'
import styles from './ConnectWallet.module.scss'

import { ConnectButton } from '@rainbow-me/rainbowkit';

export const ConnectWallet = () => {
  const [showModal, setShowModal] = useState(false)
  const [showNetworks, setShowNetworks] = useState(false)
  const { disconnect } = useDisconnect()
  const [activeChain, setActiveChain] = useState(getActiveChain())
  const mounted = useClientMounted()
  const { address, isConnected } = useAccount()
  const { switchChain } = useSwitchChain()

  useEffect(() => console.log(`%c ░▒▓█ Hup █▓▒░`, 'font-size:1.5rem;color:#38bdf8'), [])

  return !mounted ? null : (
    <>
      {activeChain[0] && (
        <>
          <div className={`${styles.networks}`}>
            <button
              className={`${styles.btnNetwork}`}
              onClick={(e) => {
                document.querySelector(`#networkDialog`).classList.add(`is-open`)
                document.querySelector(`#networkDialog`).showModal()
              }}
              title={`${activeChain[0].name}`}
            >
              <span className={`rounded`} dangerouslySetInnerHTML={{ __html: activeChain[0].icon }} />
            </button>

            <DefaultNetwork currentNetwork={activeChain[0].id} />
          </div>
        </>
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
      {/* <WalletOptions /> */}
      <hr />
      <ConnectButton />
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

/**
 * Profile
 * @param {String} addr
 * @returns
 */
const Profile = ({ addr }) => {
  const [data, setData] = useState()

  useEffect(() => {
    getUniversalProfile(addr).then((res) => {
      //      console.log(res)
      if (res.data && Array.isArray(res.data.Profile) && res.data.Profile.length > 0) {
        setData({
          wallet: res.data.Profile[0].id,
          name: res.data.Profile[0].name,
          description: res.data.Profile[0].description,
          profileImage: res.data.Profile[0].profileImages.length > 0 ? res.data.Profile[0].profileImages[0].src : `${process.env.NEXT_PUBLIC_GATEWAY_URL}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`,
          profileHeader: '',
          tags: JSON.stringify(res.data.Profile[0].tags),
          links: JSON.stringify(res.data.Profile[0].links_),
          lastUpdate: '',
        })
      } else {
        getProfile(addr).then((res) => {
          //   console.log(res)
          if (res.wallet) {
            const profileImage = res.profileImage !== '' ? `${process.env.NEXT_PUBLIC_UPLOAD_URL}${res.profileImage}` : `${process.env.NEXT_PUBLIC_GATEWAY_URL}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`
            res.profileImage = profileImage
            setData(res)
          }
        })
      }
    })
  }, [])

  if (!data || data.profileImage === '') return <Shimmer style={{ width: `32px`, height: `32px`, borderRadius: `999px` }} />

  return (
    <Link href={`/u/${addr}`}>
      <figure className={`${styles.pfp} d-f-c flex-column grid--gap-050 rounded`} title={data.name}>
        <img alt={data.name || `PFP`} src={`${data.profileImage}`} className={`rounded`} />
      </figure>
    </Link>
  )
}

export default function DefaultNetwork({ currentNetwork, setShowNetworks }) {
  const networkDialog = useRef()
  const { address, isConnected } = useAccount()
  const { switchChain } = useSwitchChain()
  const router = useRouter()

  const handleSwitchChain = (selectedChain) => {
    const chain = JSON.parse(selectedChain)
    const chainId = chain.id

    if (isConnected) {
      switchChain(
        { chainId: parseInt(chainId) },
        {
          onSuccess: () => {
            localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`, chainId)
            window.location.href = `/`
          },
          onError: (error) => {
            console.error('Switch chain failed:', error)
          },
        }
      )
    } else {
      localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`, chainId)
      window.location.href = `/`
    }
  }

  useEffect(() => {
    // networkDialog.current.showModal()
    networkDialog.current.addEventListener('close', (e) => {
      const returnValue = networkDialog.current.returnValue
      if (returnValue === `close`) {
        return
      }
      handleSwitchChain(returnValue)
      // networkDialog.current.close()
    })
  }, [])

  return (
    <dialog ref={networkDialog} id={`networkDialog`} className={`dialog ${styles.networkDialog} `}>
      <h2>Select Your Network</h2>
      <p>Your choices shape the content you experience. Each network carries a unique, unalterable history of posts, identities, and governance votes.</p>

      <form method={`dialog`}>
        <div className={`${styles.networks} grid grid--fit gap-050`} style={{ '--data-width': `150px` }}>
          {config.chains.map((chain, i) => (
            <button
              key={i}
              onClick={() => {
                networkDialog.current.close(JSON.stringify(chain))
              }}
              data-current={chain.id.toString() === currentNetwork.toString()}
            >
              <div className={`rounded`} dangerouslySetInnerHTML={{ __html: chain.icon }} />
              <span>{chain.name}</span>
            </button>
          ))}
        </div>
        <button className={`close`} value={`close`}>
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f">
            <path d="m322.15-293.08-29.07-29.07L450.92-480 293.08-636.85l29.07-29.07L480-508.08l156.85-157.84 29.07 29.07L508.08-480l157.84 157.85-29.07 29.07L480-450.92 322.15-293.08Z" />
          </svg>
        </button>
      </form>

      <p
        className={`text-center mt-10 ${styles.link}`}
        onClick={() => {
          router.push(`/networks`)
          networkDialog.current.close(`close`)
        }}
      >
        View networks
      </p>
    </dialog>
  )
}
