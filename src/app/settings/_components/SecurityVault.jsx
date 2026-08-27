'use client'

// The home of the security PIN. Every PIN-protected feature (private communities, in-app wallet
// session keys, future features) derives its keys from the master secret unlocked here — pages
// never ask for the PIN themselves, they link to this tab. The only other surfaces that may ask
// are Hup's own unlock dialogs (VaultUnlockDialog, MiniAppVaultUnlockDialog), for an action
// already underway that a locked vault would otherwise dead-end.

import { useEffect, useState } from 'react'
import { useConnection, useSignMessage, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { EyeIcon, EyeSlashIcon, KeyIcon, LockIcon, LockOpenIcon, ShieldCheckIcon, ShieldWarningIcon } from '@phosphor-icons/react'
import { getActiveChain } from '@/lib/communication'
import { unlockMaster, getCachedMasterHex, clearMasterSecret } from '@/lib/securityVault'
import {
  deriveIdentityFromCachedMaster,
  cacheUnlockedIdentity,
  getCachedIdentityPrivKeyHex,
  clearCachedIdentity,
  pubKeyFromPrivKeyHex,
} from '@/lib/communityVault'
import { sessionStorageUnlockedKey } from '@/lib/burnerSession'
import HupCommunityABI from '@/abis/HupCommunity'
import clsx from 'clsx'
import styles from './SecurityVault.module.scss'

export default function SecurityVault() {
  const { address, isConnected } = useConnection()
  const { signMessageAsync } = useSignMessage()
  const [, activeChainContracts] = getActiveChain()
  const communityContractAddress = activeChainContracts?.community

  const [isUnlocked, setIsUnlocked] = useState(false)
  const [identityPubKey, setIdentityPubKey] = useState(null)
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [showPlainPin, setShowPlainPin] = useState(false)
  const [isWorking, setIsWorking] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // On-chain registration of the community identity pubkey — per chain, so switching networks
  // can show "not registered" for a vault that's registered elsewhere.
  const { data: registeredPubKey, refetch: refetchRegisteredPubKey } = useReadContract({
    address: communityContractAddress,
    abi: HupCommunityABI,
    functionName: 'communityIdentityKeys',
    args: [address],
    query: { enabled: !!address && !!communityContractAddress },
  })
  const { mutate: registerIdentityKey, data: registerHash, isPending: isRegisterPending } = useWriteContract()
  const { isLoading: isRegisterConfirming, isSuccess: isRegisterConfirmed } = useWaitForTransactionReceipt({ hash: registerHash })

  useEffect(() => {
    if (isRegisterConfirmed) refetchRegisteredPubKey()
  }, [isRegisterConfirmed, refetchRegisteredPubKey])

  // Restore session state on mount — the vault may already be unlocked from earlier this session
  useEffect(() => {
    setIsUnlocked(Boolean(getCachedMasterHex()))
    const cachedIdentity = getCachedIdentityPrivKeyHex()
    if (cachedIdentity) setIdentityPubKey(pubKeyFromPrivKeyHex(cachedIdentity))
  }, [address])

  const isRegisteredOnThisChain = Boolean(
    identityPubKey && registeredPubKey && registeredPubKey !== '0x' && registeredPubKey.toLowerCase() === identityPubKey.toLowerCase(),
  )

  const handleUnlock = async () => {
    if (!address) return
    if (pin.length < 6) {
      setErrorMsg('PIN must be at least 6 characters.')
      return
    }
    if (pin !== confirmPin) {
      setErrorMsg('PINs do not match.')
      return
    }

    setIsWorking(true)
    setErrorMsg('')
    try {
      await unlockMaster(address, pin, signMessageAsync)
      const identity = await deriveIdentityFromCachedMaster()
      cacheUnlockedIdentity(identity.privKeyHex)

      setIdentityPubKey(identity.pubKeyHex)
      setIsUnlocked(true)
      setPin('')
      setConfirmPin('')
    } catch (err) {
      setErrorMsg(err.shortMessage || err.message || 'Failed to unlock the security vault.')
    } finally {
      setIsWorking(false)
    }
  }

  const handleRegisterIdentity = () => {
    if (!identityPubKey || !communityContractAddress) return
    registerIdentityKey({
      address: communityContractAddress,
      abi: HupCommunityABI,
      functionName: 'registerIdentityKey',
      args: [identityPubKey],
    })
  }

  const handleLock = () => {
    clearMasterSecret()
    clearCachedIdentity()
    sessionStorage.removeItem(sessionStorageUnlockedKey)
    setIsUnlocked(false)
    setIdentityPubKey(null)
  }

  return (
    <div className={styles.vault}>
      <div className={styles.vault__header}>
        <h4 className={styles.vault__title}>
          <KeyIcon size={18} /> Security Vault
        </h4>
        <span className={clsx(styles.vault__status, isUnlocked && styles['vault__status--unlocked'])}>
          {isUnlocked ? (
            <>
              <LockOpenIcon size={14} /> Unlocked this session
            </>
          ) : (
            <>
              <LockIcon size={14} /> Locked
            </>
          )}
        </span>
      </div>

      <p className={styles.vault__intro}>
        One wallet signature and one PIN protect all of your encrypted Hup features — private communities and the
        in-app wallet. The same wallet + same PIN always reproduces the same keys on any device, so there is nothing
        to back up as long as you remember your PIN.
      </p>

      {!isConnected && <p className={styles.vault__muted}>Connect your wallet to activate the security vault.</p>}

      {isConnected && !isUnlocked && (
        <div className={styles.vault__form}>
          <input
            type={showPlainPin ? 'text' : 'password'}
            className={styles.vault__input}
            placeholder="Security PIN (min 6 characters)"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <input
            type={showPlainPin ? 'text' : 'password'}
            className={styles.vault__input}
            placeholder="Confirm PIN"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
          />
          <div className={styles.vault__formActions}>
            <button type="button" className={styles.vault__linkBtn} onClick={() => setShowPlainPin(!showPlainPin)}>
              {showPlainPin ? <EyeSlashIcon size={14} /> : <EyeIcon size={14} />} {showPlainPin ? 'Hide' : 'Show'}
            </button>
            <button
              type="button"
              className={styles.vault__primaryBtn}
              onClick={handleUnlock}
              disabled={isWorking || pin.length < 6}
            >
              {isWorking ? 'Waiting for signature...' : 'Activate / Unlock'}
            </button>
          </div>
          <p className={styles.vault__hint}>
            First time and returning are the same action: sign once, enter your PIN. Careful — a mistyped PIN
            silently creates a <em>different</em> set of keys, which is why it must be entered twice.
          </p>
        </div>
      )}

      {isConnected && isUnlocked && (
        <>
          <div className={styles.vault__section}>
            <h5 className={styles.vault__sectionTitle}>Community encryption identity</h5>
            <p className={styles.vault__muted}>
              Other members wrap community keys to this public key so only you can open them.
            </p>
            {identityPubKey && <code className={styles.vault__code}>{identityPubKey.slice(0, 24)}…{identityPubKey.slice(-12)}</code>}
            <div className={styles.vault__row}>
              {isRegisteredOnThisChain ? (
                <span className={clsx(styles.vault__badge, styles['vault__badge--ok'])}>
                  <ShieldCheckIcon size={14} /> Registered on this network
                </span>
              ) : (
                <>
                  <span className={styles.vault__badge}>
                    <ShieldWarningIcon size={14} /> Not registered on this network
                  </span>
                  <button
                    type="button"
                    className={styles.vault__primaryBtn}
                    onClick={handleRegisterIdentity}
                    disabled={isRegisterPending || isRegisterConfirming || !communityContractAddress}
                  >
                    {isRegisterPending ? 'Confirm Wallet...' : isRegisterConfirming ? 'Registering...' : 'Register'}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className={styles.vault__section}>
            <div className={styles.vault__row}>
              <div>
                <h5 className={styles.vault__sectionTitle}>Lock this session</h5>
                <p className={styles.vault__muted}>Clears the unlocked keys from this browser tab.</p>
              </div>
              <button type="button" className={styles.vault__dangerBtn} onClick={handleLock}>
                Lock Vault
              </button>
            </div>
          </div>
        </>
      )}

      <div className={styles.vault__section}>
        <h5 className={styles.vault__sectionTitle}>If you forget your PIN</h5>
        <ul className={styles.vault__list}>
          <li>
            <strong>Private communities:</strong> unlock with a new PIN and re-register — a community moderator must
            then re-grant you the community keys before you can read encrypted posts again.
          </li>
          <li>
            <strong>In-app wallet:</strong> a new PIN creates a <em>brand new wallet address</em>. Funds on the old
            one are unrecoverable — move funds out before changing your PIN.
          </li>
        </ul>
      </div>

      {errorMsg && (
        <div className={styles.vault__error}>
          <ShieldWarningIcon size={16} />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  )
}
