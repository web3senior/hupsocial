import { useEffect, useRef } from 'react'
import { config } from '@/config/wagmi'
import { useAccount, useDisconnect, Connector, useConnect, useSwitchChain, useConfig } from 'wagmi'
import styles from './DefaultNetwork.module.scss'

export default function DefaultNetwork({ setShowNetworks }) {
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
            >
              <div className={`rounded`} dangerouslySetInnerHTML={{ __html: chain.icon }} />
              <b>{chain.name}</b>
            </button>
          ))}
        </div>
        <button value={`close`}>Close</button>
      </form>
    </dialog>
  )
}
