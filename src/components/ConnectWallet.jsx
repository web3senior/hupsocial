'use client'

import Link from 'next/link'
import { useEffect, useState, useRef } from 'react'
import { useClientMounted } from '@/hooks/useClientMount'
import { config } from '@/config/wagmi'
import { useAccount, useDisconnect, Connector, useConnect, useSwitchChain, useConfig } from 'wagmi'
import { getActiveChain } from '@/util/communication'
import { getProfile, getUniversalProfile } from '@/util/api'
import Shimmer from '@/helper/Shimmer'
import styles from './ConnectWallet.module.scss'

export const ConnectWallet = () => {
  const [showModal, setShowModal] = useState(false)
  const [showNetworks, setShowNetworks] = useState(false)
  const { disconnect } = useDisconnect()
  const [activeChain, setActiveChain] = useState(getActiveChain())
  const mounted = useClientMounted()
  const { address, isConnected } = useAccount()
  const { switchChain } = useSwitchChain()

  // const handleDisconnect = async () => {
  //   try {
  //     await disconnect()
  //   } catch (error) {
  //     console.error('Failed to disconnect:', error)
  //   }
  // }

  const handleSwitchChain = (e, chain) => {
    console.log(`Switch network: `, chain.id)
    if (isConnected) {
      switchChain(
        { chainId: chain.id },
        {
          onSuccess: () => {
            localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`, chain.id)
            window.location.reload()
          },
          onError: (error) => {
            console.error('Switch chain failed:', error)
            // Error logic
          },
        }
      )
    } else {
      localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`, chain.id)
      window.location.reload()
    }
  }

  useEffect(() => console.log(`%c ░▒▓█ Hup █▓▒░`, 'font-size:1.5rem;color:#38bdf8'), [])

  return !mounted ? null : (
    <>
      {activeChain[0] && (
        <>
          <div className={`${styles.networks}`}>
            <button
              className={`${styles.btnNetwork}`}
              onMouseDown={(e) => {
                document.querySelector(`#networkDialog`).classList.add(`is-open`)
                document.querySelector(`#networkDialog`).showModal()
              }}
              title={`${activeChain[0].name}`}
            >
              <span className={`rounded`} dangerouslySetInnerHTML={{ __html: activeChain[0].icon }} />
            </button>

            <DefaultNetwork currentNetwork={activeChain[0].id} />
            {/* {showNetworks && (
              <div className={`${styles.dropdown} animate fade flex flex-column align-items-center justify-content-start gap-050`}>
                <ul>
                  {config.chains.map((chain, i) => (
                    <li key={i} onClick={(e) => handleSwitchChain(e, chain)} className={`flex flex-row align-items-center justify-content-start gap-050`}>
                      <figure className={`rounded`} dangerouslySetInnerHTML={{ __html: chain.icon }} />
                      <small>{chain.name}</small>
                    </li>
                  ))}
                </ul>
              </div>
            )} */}
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
{
  /* <Link href={`/networks`} title={`Networks`}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M8.4375 12.5625H9.5625V8.25H8.4375V12.5625ZM9 6.96637C9.17163 6.96637 9.3155 6.90831 9.43163 6.79219C9.54775 6.67606 9.60581 6.53219 9.60581 6.36056C9.60581 6.18894 9.54775 6.04506 9.43163 5.92894C9.3155 5.81294 9.17163 5.75494 9 5.75494C8.82838 5.75494 8.6845 5.81294 8.56838 5.92894C8.45225 6.04506 8.39419 6.18894 8.39419 6.36056C8.39419 6.53219 8.45225 6.67606 8.56838 6.79219C8.6845 6.90831 8.82838 6.96637 9 6.96637ZM9.00131 16.125C8.01581 16.125 7.0895 15.938 6.22237 15.564C5.35525 15.19 4.601 14.6824 3.95962 14.0413C3.31825 13.4002 2.81044 12.6463 2.43619 11.7795C2.06206 10.9128 1.875 9.98669 1.875 9.00131C1.875 8.01581 2.062 7.0895 2.436 6.22237C2.81 5.35525 3.31756 4.601 3.95869 3.95962C4.59981 3.31825 5.35375 2.81044 6.2205 2.43619C7.08725 2.06206 8.01331 1.875 8.99869 1.875C9.98419 1.875 10.9105 2.062 11.7776 2.436C12.6448 2.81 13.399 3.31756 14.0404 3.95869C14.6818 4.59981 15.1896 5.35375 15.5638 6.2205C15.9379 7.08725 16.125 8.01331 16.125 8.99869C16.125 9.98419 15.938 10.9105 15.564 11.7776C15.19 12.6448 14.6824 13.399 14.0413 14.0404C13.4002 14.6818 12.6463 15.1896 11.7795 15.5638C10.9128 15.9379 9.98669 16.125 9.00131 16.125ZM9 15C10.675 15 12.0938 14.4188 13.2563 13.2563C14.4188 12.0938 15 10.675 15 9C15 7.325 14.4188 5.90625 13.2563 4.74375C12.0938 3.58125 10.675 3 9 3C7.325 3 5.90625 3.58125 4.74375 4.74375C3.58125 5.90625 3 7.325 3 9C3 10.675 3.58125 12.0938 4.74375 13.2563C5.90625 14.4188 7.325 15 9 15Z"
                      fill="#1F1F1F"
                    />
                  </svg>
                </Link> */
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
          profileImage: res.data.Profile[0].profileImages.length > 0 ? res.data.Profile[0].profileImages[0].src : `${process.env.NEXT_PUBLIC_IPFS_GATEWAY}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`,
          profileHeader: '',
          tags: JSON.stringify(res.data.Profile[0].tags),
          links: JSON.stringify(res.data.Profile[0].links_),
          lastUpdate: '',
        })
      } else {
        getProfile(addr).then((res) => {
          //   console.log(res)
          if (res.wallet) {
            const profileImage = res.profileImage !== '' ? `${process.env.NEXT_PUBLIC_UPLOAD_URL}${res.profileImage}` : `${process.env.NEXT_PUBLIC_IPFS_GATEWAY}bafkreiatl2iuudjiq354ic567bxd7jzhrixf5fh5e6x6uhdvl7xfrwxwzm`
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
        <img alt={data.name} src={`${data.profileImage}`} className={`rounded`} />
      </figure>
    </Link>
  )
}

export default function DefaultNetwork({ currentNetwork, setShowNetworks }) {
  const networkDialog = useRef()
  const { address, isConnected } = useAccount()
  const { switchChain } = useSwitchChain()

  const handleSwitchChain = (chainId) => {
    console.log(`Switch network: `, chainId)
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
      if (returnValue === `close`) return
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
              onClick={(e) => {
                e.preventDefault()
                networkDialog.current.close(chain.id)
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
    </dialog>
  )
}
