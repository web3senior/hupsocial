'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useCallback, useMemo, useEffect } from 'react'
import { Wallet } from 'ethers'
import Web3 from 'web3'
import CryptoJS from 'crypto-js'
import { PrivateKey, decrypt, encrypt } from 'eciesjs'
import styles from './page.module.scss'
import { toast } from '@/components/NextToast'
import { getStoredBurner, localStorageBurnerAddress, localStorageBurnerKey, sessionStorageUnlockedKey } from '@/lib/burnerSession'
import { decryptData, isPrivateKeyEncrypted } from '@/lib/cryptoHelper'

export default function Page() {
  const [agree, setAgree] = useState(false)
  const [password, setPassword] = useState('')
  const router = useRouter()

  const unlock = async () => {
    const storedAddress = localStorage.getItem(localStorageBurnerAddress)
    const storedKey = localStorage.getItem(localStorageBurnerKey)

    if (!storedKey || !storedAddress) return null

    // 1. Check in-memory cache first
    let privateKey = sessionStorage.getItem(sessionStorageUnlockedKey)

    if (!privateKey) {
      // 2. Fallback to legacy unencrypted key
      if (!isPrivateKeyEncrypted(storedKey)) {
        privateKey = storedKey
      } else {
        // 3. Encrypted key requires password to decrypt
        if (!password) {
          // throw new Error('PASSWORD_REQUIRED')
          setPassword(prompt(`Please enter your password`))
        }
        privateKey = await decryptData(storedKey, password)

        // Cache decrypted key in sessionStorage for this tab session
        sessionStorage.setItem(sessionStorageUnlockedKey, privateKey)
      }
    }

    router.push('/chat')
    return
  }

  useEffect(() => {
    const storedBurner = getStoredBurner()
    console.log(storedBurner)
    if (storedBurner) {
      router.push('/chat')
      return
    }
  }, [])

  return (
    <>
      <div className={`${styles.page} d-f-c`}>
        <div className={`__container ${styles.page__container} d-f-c flex-column`} data-width={`medium`}>
          {/* Tour Content */}
          <div className={`${styles.tour} flex flex-column align-items-center justify-content-center gap-025`}>
            <b className={`${styles.tour__title}`}>Welcome back!</b>
            <p className={`${styles.tour__description}`}>
              This password will unlock your {process.env.NEXT_PUBLIC_NAME} account only on this device. {process.env.NEXT_PUBLIC_NAME} can
              not recover this password.
            </p>
          </div>

          {/* Action buttons */}
          <div className={`flex flex-column align-items-center gap-1 mt-30 w-100`}>
            <div className={`flex flex-column gap-025`}>
              <label htmlFor="password">Password</label>
              <input type="password" name="password" id="password" onChange={(e) => setPassword(e.target.value)} />
            </div>

            <button className={`${styles.actionButton} ${styles.createButton}`} disabled={!password} onClick={unlock}>
              Unlock
            </button>

            <span>Forgot password?</span>
          </div>
        </div>
      </div>
    </>
  )
}
