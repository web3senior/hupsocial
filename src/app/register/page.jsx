'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import clsx from 'clsx'
import CryptoJS from 'crypto-js'
import ecies from 'eciesjs'
import styles from './page.module.scss'
import { ConnectWallet } from '@/components/ConnectWallet'

export default function Page() {
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const [isActivating, setIsActivating] = useState(false)
  const [isPkRegistered, setIsPkRegistered] = useState(false)

  // Verify if the user's public key exists in your database registry
  const checkStatus = async () => {
    if (!address) return
    try {
      const pkRes = await fetch(`/api/chat/join?address=${address.toLowerCase()}`)
      if (pkRes.ok) {
        const pkData = await pkRes.json()
        setIsPkRegistered(!!pkData.public_key)
      } else {
        setIsPkRegistered(false)
      }
    } catch (err) {
      console.error('Identity database registry check failed:', err)
    }
  }

  useEffect(() => {
    checkStatus()
    const interval = setInterval(checkStatus, 15000)
    return () => clearInterval(interval)
  }, [address])

  // Decrypts the app master key locally from storage
  const getUnlockedKey = () => {
    const encryptedKey = localStorage.getItem('encryptedAppKey')
    const storedPassCipher = sessionStorage.getItem('localPassword')
    if (!encryptedKey || !storedPassCipher) return null

    try {
      const bytesPass = CryptoJS.AES.decrypt(storedPassCipher, process.env.NEXT_PUBLIC_ENCRYPTION_KEY)
      const originalPassword = bytesPass.toString(CryptoJS.enc.Utf8)
      const bytesKey = CryptoJS.AES.decrypt(encryptedKey, originalPassword)
      const decryptedKeyHex = bytesKey.toString(CryptoJS.enc.Utf8)
      
      const cleanPrivateKey = decryptedKeyHex.startsWith('0x') ? decryptedKeyHex.slice(2) : decryptedKeyHex
      const privKey = new ecies.PrivateKey(Buffer.from(cleanPrivateKey, 'hex'))
      
      const pubKeyHex = privKey.publicKey.toHex(false)
      const formattedPubKey = pubKeyHex.startsWith('0x') ? pubKeyHex : `0x${pubKeyHex}`
      return { pubKey: formattedPubKey, privKey: privKey }
    } catch (error) {
      console.error('Decryption of stored application master key failed:', error)
      return null
    }
  }

  // Requests a one-off signature via wallet to sync your uncompressed stealth identity key to the DB
  const handleJoinChat = async () => {
    try {
      setIsActivating(true)
      const keys = getUnlockedKey()
      const pubKeyHex = keys?.pubKey
      if (!pubKeyHex) throw new Error('No public key found. Please complete setup.')

      const registrationMessage = `Join Chat Registry: ${pubKeyHex.toLowerCase()}`
      const signature = await signMessageAsync({ message: registrationMessage })

      const response = await fetch('/api/chat/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          public_key: pubKeyHex,
          signature: signature
        })
      })

      if (!response.ok) {
        const errorMsg = await response.json()
        throw new Error(errorMsg.error || 'Failed to submit registration payload.')
      }

      await checkStatus()
    } catch (err) {
      console.error('Public Key Registry processing crashed:', err)
      alert(err.message || 'Registration failed.')
    } finally {
      setIsActivating(false)
    }
  }

  return (
    <div className={clsx(styles.register)}>
      <div className={styles['register__card']}>
        <header className={styles['register__header']}>
          <div className="d-f-c flex-column">
            <small>Wallet connection:</small>
            <ConnectWallet />
          </div>
          <h1 className={styles['register__title']}>Identity Status</h1>
          <p className={styles['register__subtitle']}>
            {isPkRegistered ? 'Your identity registry is completely active.' : 'Register your cryptographic public identity key.'}
          </p>
        </header>

        <section className={styles['register__features']}>
          <div className={clsx(styles['register__feature-item'], isPkRegistered && styles['register__feature-item--active'])}>
            <div className={styles['register__icon']}>🛡️</div>
            <div className="flex-grow-1">
              <strong>Public Key Registry</strong>
              <p>{isPkRegistered ? 'Registered in DB' : 'Pending database registration'}</p>
            </div>
            <div className={clsx(styles['register__status'], isPkRegistered ? styles['register__status--ok'] : styles['register__status--pending'])}>
              {isPkRegistered ? '✓' : '!'}
            </div>
          </div>
        </section>

        <footer className={styles['register__footer']}>
          {isPkRegistered ? (
            <button className={clsx(styles['register__button'], 'btn')} onClick={() => router.push('/chat')}>
              Enter Chat Room
            </button>
          ) : (
            <button className={clsx(styles['register__button'], 'btn')} onClick={handleJoinChat} disabled={isActivating || !isConnected}>
              {isActivating ? 'Signing Identity...' : 'Register Public Key'}
            </button>
          )}
          {!isPkRegistered && <p className={styles['register__gas-note']}>* Free operation. Pure cryptographic signature verification.</p>}
        </footer>
      </div>
    </div>
  )
} 