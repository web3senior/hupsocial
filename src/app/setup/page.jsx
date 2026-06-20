'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useCallback, useEffect } from 'react'
import { useConnection, useSignMessage } from 'wagmi'
import { ConnectWallet } from '@/components/ConnectWallet'
import styles from './page.module.scss'
import { ethers } from 'ethers'
import ecies from 'eciesjs'
import { APP_PASSWORD_SESSION_STORAGE, ENCRYPTED_APP_KEY_STORAGE, lockAppPrivateKey } from '@/lib/appVault'

export default function Page() {
  const [agree, setAgree] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const { address, isConnected } = useConnection()
  const { signMessageAsync } = useSignMessage()
  const router = useRouter()

  const isPasswordValid = useCallback(() => {
    return password.length >= 8 && password === confirmPassword && agree
  }, [password, confirmPassword, agree])

  const createAccount = async () => {
    if (!isConnected || !address) return alert('Please connect your wallet first')
    if (!password) return alert('Please enter a password')

    try {
      const lowAddress = address.toLowerCase()
      const nonceBytes = window.crypto.getRandomValues(new Uint8Array(16))
      const nonce = ethers.hexlify(nonceBytes)

      const message = [
        'Hup Stealth Protocol - Identity Authorization',
        '',
        'By signing this message, you are generating a unique encryption key for this wallet.',
        '',
        'Safety Notice:',
        '- This signature does not authorize any token transfers.',
        '- This key is used locally to encrypt/decrypt your stealth messages.',
        '- Keep your password safe; it is required to unlock this key.',
        '',
        `Wallet: ${lowAddress}`,
        `Nonce: ${nonce}`,
        'Version: 1.0.0',
      ].join('\n')

      const signature = await signMessageAsync({ message })
      const signatureHash = ethers.keccak256(signature)
      const passwordHash = ethers.keccak256(ethers.toUtf8Bytes(password))
      const seed = ethers.solidityPackedKeccak256(['string', 'bytes32', 'bytes32'], ['HUP_STEALTH_V1', signatureHash, passwordHash])

      const privKey = new ecies.PrivateKey(ethers.getBytes(seed))
      const rawPrivateKeyHex = privKey.toHex()
      const pubKeyHex = privKey.publicKey.toHex()

      const encryptedKey = await lockAppPrivateKey(rawPrivateKeyHex, password)

      localStorage.setItem(ENCRYPTED_APP_KEY_STORAGE, encryptedKey)
      sessionStorage.setItem(APP_PASSWORD_SESSION_STORAGE, password)

      console.log(`Vault successfully encrypted and stored for ${lowAddress}`)

      // Register on Smart Contract
      // await registerOnChain(pubKeyHex)
      void pubKeyHex

      router.push('/register')
    } catch (error) {
      console.error('Account creation failed:', error)

      if (error?.name === 'UserRejectedRequestError') {
        alert('Signature rejected. You must sign to generate your secure vault.')
      } else {
        alert('Failed to secure vault. Check console for details.')
      }
    }
  }

  useEffect(() => {
    if (localStorage.getItem(ENCRYPTED_APP_KEY_STORAGE)) {
      console.log('A private key already exists in local storage. Please disconnect first.')

      router.push('/secure-account')
    }
  }, [router])

  return (
    <>
      <div className={`${styles.page} d-f-c`}>
        {isConnected ? (
          <>
            <div className={`__container ${styles.page__container} d-f-c flex-column`} data-width={`medium`}>
              <div className={`${styles.tour} flex flex-column align-items-center justify-content-center gap-025`}>
                <b className={`${styles.tour__title}`}>Create password</b>
                <p className={`${styles.tour__description}`}>
                  This password will unlock your {process.env.NEXT_PUBLIC_NAME} account only on this device. {process.env.NEXT_PUBLIC_NAME}{' '}
                  can not recover this password.
                </p>
              </div>

              <div className={`flex flex-column align-items-center gap-1 mt-30 w-100`}>
                <div className={`flex flex-column gap-025`}>
                  <div className={`flex flex-row gap-025`}>
                    <label htmlFor="password">Password (8 characters min)</label>

                    <span>Show</span>
                  </div>
                  <input type="password" name="password" id="password" onChange={(e) => setPassword(e.target.value)} />
                </div>

                <div className={`flex flex-column gap-025`}>
                  <label htmlFor="password">Confirm password</label>
                  <input type="password" name="confirmPassword" id="confirmPassword" onChange={(e) => setConfirmPassword(e.target.value)} />
                  {password !== confirmPassword && confirmPassword.length > 0 && (
                    <span className={`text-danger`}>Passwords do not match.</span>
                  )}
                </div>

                <div className={`flex gap-025`}>
                  <input type="checkbox" name="terms" id="terms" value={false} onChange={(e) => setAgree(e.target.checked)} />
                  <label htmlFor="terms">
                    I understand that {process.env.NEXT_PUBLIC_NAME} cannot recover this password for me. <Link href={`#`}>Learn more</Link>
                  </label>
                </div>

                <button className={`${styles.actionButton} ${styles.createButton}`} disabled={!isPasswordValid()} onClick={createAccount}>
                  Create a new account
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <ConnectWallet />
          </>
        )}
      </div>
    </>
  )
}
