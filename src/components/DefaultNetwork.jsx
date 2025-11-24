import { useEffect, useRef } from 'react'
import { config } from '@/config/wagmi'
import { useAccount, useDisconnect, Connector, useConnect, useSwitchChain, useConfig } from 'wagmi'
import styles from './DefaultNetwork.module.scss'

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
            window.location.href = '/'
          },
          onError: (error) => {
            console.error('Switch chain failed:', error)
            // Error logic
          },
        }
      )
    } else {
      localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`, chainId)
    }
  }

  useEffect(() => {
    networkDialog.current.showModal()

    networkDialog.current.addEventListener('close', (e) => {
      const returnValue = networkDialog.current.returnValue
      if (returnValue === `close`) return

      localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}active-chain`, returnValue)
      handleSwitchChain(returnValue)
      // setShowNetworks(false)

      // networkDialog.current.close()
    })
  }, [])

  return (
    <dialog ref={networkDialog} id={`networkDialog`} className={`${styles.networkDialog}`}>
      <h2>Select Your Hup Network</h2>
      <p>Your choice determines the content you see. Each network holds a separate, immutable history of posts, identities, and governance votes.</p>
      <form method={`dialog`} className={`mt-20`}>
        <div className={`${styles.networks} grid grid--fit gap-1`} style={{ '--data-width': `150px` }}>
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
        <button value={`close`} action="close">
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#1f1f1f">
            <path d="m322.15-293.08-29.07-29.07L450.92-480 293.08-636.85l29.07-29.07L480-508.08l156.85-157.84 29.07 29.07L508.08-480l157.84 157.85-29.07 29.07L480-450.92 322.15-293.08Z" />
          </svg>
        </button>
      </form>
    </dialog>
  )
}
