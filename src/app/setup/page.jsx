'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useCallback, useMemo, useEffect } from 'react'
import { useConnection,useSignMessage, useWaitForTransactionReceipt, usePublicClient, useWalletClient, useWriteContract, useReadContract } from 'wagmi'
import { ConnectWallet } from '@/components/ConnectWallet'
import logo from '@/../public/logo.svg'
import styles from './page.module.scss'
import { ethers } from 'ethers'
import ecies, { PrivateKey, decrypt, encrypt } from 'eciesjs'
import CryptoJS from 'crypto-js'

export default function Page() {
  const [agree, setAgree] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
const { address, isConnected } = useConnection()
const { signMessageAsync } = useSignMessage();
  const router = useRouter()


  const isPasswordValid = useCallback(() => {
    return password.length >= 8 && password === confirmPassword && agree
  }, [password, confirmPassword, agree])

  // ■■■ Logic Control ■■■

  const createAccountOld = async () => {
    if (!window.ethereum) return alert('Please install MetaMask')

    const provider = new ethers.BrowserProvider(window.ethereum)
    const signer = await provider.getSigner()

    // 1. Derive the ECIES Key via Signature
    const message = [
      'Tunnel Stealth Protocol - Identity Authorization',
      '',
      'By signing this message, you are generating a unique encryption key for this wallet.',
      '',
      'Safety Notice:',
      '• This signature does not authorize any token transfers.',
      '• This key is used locally to encrypt/decrypt your stealth messages.',
      '• Keep your password safe; it is required to unlock this key.',
      '',
      `Wallet: ${signer.address.toLowerCase()}`,
      `Nonce: ${ethers.keccak256(ethers.toUtf8Bytes(signer.address.toLowerCase())).slice(0, 12)}`,
      'Version: 1.0.0',
    ].join('\n')
    const signature = await signer.signMessage(message)

    const seed = ethers.keccak256(signature)
    const privKey = new ecies.PrivateKey(ethers.getBytes(seed))
    const pubKeyHex = privKey.publicKey.toHex()

    // We extract the secret hex to store it
    const rawPrivateKeyHex = privKey.toHex()

    try {
      // 2. Encrypt the Private Key Hex using CryptoJS and the User's Password
      // We use the user's password to encrypt the key before it hits storage
      const encryptedKey = CryptoJS.AES.encrypt(rawPrivateKeyHex, password).toString()

      // 3. Store in Local/Session Storage
      // localStorage persists after browser close, sessionStorage clears on tab close
      localStorage.setItem('encryptedAppKey', encryptedKey)

      // 4. Also store the encrypted password in sessionStorage (per your current flow)
      const secretKey = process.env.NEXT_PUBLIC_ENCRYPTION_KEY
      const cipherPassword = CryptoJS.AES.encrypt(password, secretKey).toString()
      sessionStorage.setItem('localPassword', cipherPassword)

      console.log(`Vault successfully encrypted and stored.`, { type: 'success' })

      // 5. Register on Smart Contract (if not already done)
      // await registerOnChain(pubKeyHex);

      router.push('/chat')
    } catch (error) {
      console.error('Encryption failed:', error)
      toast('Failed to secure vault.', { type: 'error' })
    }
  }




const createAccount = async () => {
  if (!isConnected || !address) return alert('Please connect your wallet first');
  if (!password) return alert('Please enter a password');

  try {
    const lowAddress = address.toLowerCase();

    // 1. Prepare the Signature Message
    const message = [
      'Hup Stealth Protocol - Identity Authorization',
      '',
      'By signing this message, you are generating a unique encryption key for this wallet.',
      '',
      'Safety Notice:',
      '• This signature does not authorize any token transfers.',
      '• This key is used locally to encrypt/decrypt your stealth messages.',
      '• Keep your password safe; it is required to unlock this key.',
      '',
      `Wallet: ${lowAddress}`,
      `Nonce: ${ethers.keccak256(ethers.toUtf8Bytes(lowAddress)).slice(0, 12)}`,
      'Version: 1.0.0',
    ].join('\n');

    // 2. Trigger the signature using the async mutation function
    // In Wagmi v2, this returns a Promise<`0x${string}`>
    const signature = await signMessageAsync({ message });

    // 3. Derive the ECIES Key from the signature
    const seed = ethers.keccak256(signature);
    const privKey = new ecies.PrivateKey(ethers.getBytes(seed));
    const rawPrivateKeyHex = privKey.toHex();
    const pubKeyHex = privKey.publicKey.toHex();

    // 4. Encrypt the Private Key Hex using CryptoJS and the User's Password
    const encryptedKey = CryptoJS.AES.encrypt(rawPrivateKeyHex, password).toString();

    // 5. Store in Local/Session Storage
    localStorage.setItem('encryptedAppKey', encryptedKey);

    const secretKey = process.env.NEXT_PUBLIC_ENCRYPTION_KEY;
    if (!secretKey) throw new Error("App secret key missing");
    
    const cipherPassword = CryptoJS.AES.encrypt(password, secretKey).toString();
    sessionStorage.setItem('localPassword', cipherPassword);

    console.log(`Vault successfully encrypted and stored for ${lowAddress}`);

    // 6. Register on Smart Contract
    // await registerOnChain(pubKeyHex);

    router.push('/register');
  } catch (error) {
    console.error('Account creation failed:', error);
    
    // Wagmi v2 error handling
    if (error.name === 'UserRejectedRequestError') {
      alert('Signature rejected. You must sign to generate your secure vault.');
    } else {
      alert('Failed to secure vault. Check console for details.');
    }
  }
};









  useEffect(() => {
    if (localStorage.getItem('encryptedWallet')) {
      console.log('A private key already exists in local storage. Please disconnect first.')

      // Redirect to the secure account page
      router.push('/secure-account')
      return
    }
  }, [])



  // useEffect(() => {
  //   if (document.cookie.includes('isTourSeen=true')) router.replace('/')
  // }, [router])

  return (
    <>
      <div className={`${styles.page} d-f-c`}>
        {isConnected ? (
          <>
            <div className={`__container ${styles.page__container} d-f-c flex-column`} data-width={`medium`}>
              {/* Tour Content */}
              <div className={`${styles.tour} flex flex-column align-items-center justify-content-center gap-025`}>
                <b className={`${styles.tour__title}`}>Create password</b>
                <p className={`${styles.tour__description}`}>
                  This password will unlock your {process.env.NEXT_PUBLIC_NAME} account only on this device. {process.env.NEXT_PUBLIC_NAME} can not recover this password.
                </p>
              </div>

              {/* Action buttons */}
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
                  {password !== confirmPassword && confirmPassword.length > 0 && <span className={`text-danger`}>Passwords do not match.</span>}
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
