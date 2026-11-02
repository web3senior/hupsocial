'use client'

// The home of the security PIN. Every PIN-protected feature (private communities, in-app wallet
// session keys, future features) derives its keys from the master secret unlocked here — pages
// never ask for the PIN themselves, they link to this tab. The only other surfaces that may ask
// are Hup's own unlock dialogs (VaultUnlockDialog, MiniAppVaultUnlockDialog), for an action
// already underway that a locked vault would otherwise dead-end.

import { useEffect, useState } from 'react'
import { useConnection, useSignMessage, useSignTypedData, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { EyeIcon, EyeSlashIcon, KeyIcon, LockIcon, LockOpenIcon, ShieldCheckIcon, ShieldWarningIcon } from '@phosphor-icons/react'
import { getActiveChain } from '@/lib/communication'
import { unlockMaster, getCachedMasterHex, clearMasterSecret } from '@/lib/securityVault'
import {
  clearMasterV2,
  forgetDeviceCheck,
  generatePassphrase,
  getCachedMasterV2,
  hasDeviceCheck,
  hasLegacyWrap,
  unlockMasterV2,
  wrapLegacyMaster,
} from '@/lib/keyVaultV2'
import { PASSPHRASE_MIN_LENGTH, passphraseProblem } from '@/lib/keyDerivationV2.mjs'
import {
  deriveIdentityFromCachedMaster,
  cacheUnlockedIdentity,
  getCachedIdentityPrivKeyHex,
  clearCachedIdentity,
  pubKeyFromPrivKeyHex,
} from '@/lib/communityVault'
import { clearUnlockedBurners } from '@/lib/burnerStorage'
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

  // Key Vault v2 — agents and the in-app wallet. Kept apart from the v1 form below it so the two
  // rules (a 6-character PIN vs a 12-character screened passphrase) never share an input.
  const { signTypedDataAsync } = useSignTypedData()
  const [isV2Unlocked, setIsV2Unlocked] = useState(false)
  const [isV2FirstOnDevice, setIsV2FirstOnDevice] = useState(false)
  const [v2Pin, setV2Pin] = useState('')
  const [v2ConfirmPin, setV2ConfirmPin] = useState('')
  const [shownPassphrase, setShownPassphrase] = useState('')
  // A first setup waits for the owner to say the passphrase is saved: nothing can recover it
  const [hasSavedV2, setHasSavedV2] = useState(false)
  const [isV2Working, setIsV2Working] = useState(false)
  const [v2Message, setV2Message] = useState('')
  const [isConfirmingReset, setIsConfirmingReset] = useState(false)

  // Both read browser storage, so they settle after mount rather than during the server render
  useEffect(() => {
    let live = true
    const sync = async () => {
      await Promise.resolve()
      if (!live) return
      setIsV2Unlocked(Boolean(getCachedMasterV2()))
      setIsV2FirstOnDevice(!hasDeviceCheck(address))
    }
    sync()
    return () => {
      live = false
    }
  }, [address])

  // A v1 master restored by the v2 unlock still needs its community identity cached, exactly as
  // the v1 form does after its own unlock
  const adoptLegacyMaster = async () => {
    if (!getCachedMasterHex()) return
    const identity = await deriveIdentityFromCachedMaster()
    cacheUnlockedIdentity(identity.privKeyHex)
    setIdentityPubKey(identity.pubKeyHex)
    setIsUnlocked(true)
  }

  // Only a new passphrase is screened: one already in use must keep opening its keys
  const v2Weakness = isV2FirstOnDevice && v2Pin.length > 0 ? passphraseProblem(v2Pin) : null

  const handleUnlockV2 = async () => {
    if (!address) return
    if (v2Pin.length < PASSPHRASE_MIN_LENGTH || v2Weakness) {
      setV2Message(v2Weakness || `Your passphrase is at least ${PASSPHRASE_MIN_LENGTH} characters.`)
      return
    }
    if (isV2FirstOnDevice && v2Pin !== v2ConfirmPin) {
      setV2Message('The passphrases do not match.')
      return
    }

    setIsV2Working(true)
    setV2Message('')
    try {
      await unlockMasterV2({ address, passphrase: v2Pin, signTypedDataAsync, signMessageAsync })
      // Both vaults open and not linked on this device yet: link them, so one v2 unlock opens communities too
      if (getCachedMasterHex() && !hasLegacyWrap(address)) await wrapLegacyMaster(address).catch(() => false)
      await adoptLegacyMaster()
      setIsV2Unlocked(true)
      setIsV2FirstOnDevice(false)
      setV2Pin('')
      setV2ConfirmPin('')
      setShownPassphrase('')
    } catch (err) {
      if (err?.code !== 4001 && err?.name !== 'UserRejectedRequestError') setV2Message(err.shortMessage || err.message)
    } finally {
      setIsV2Working(false)
    }
  }

  const suggestPassphrase = () => {
    const generated = generatePassphrase()
    setV2Pin(generated)
    setV2ConfirmPin('')
    setShownPassphrase(generated)
  }

  // Nothing to reset anywhere: forgetting this device's check is all "start over" can mean
  const handleStartOverV2 = () => {
    forgetDeviceCheck(address)
    setIsV2Unlocked(false)
    setIsV2FirstOnDevice(true)
    setIsConfirmingReset(false)
    setV2Message('Choose a new passphrase. It creates a new set of keys.')
  }

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
    clearMasterV2()
    clearCachedIdentity()
    clearUnlockedBurners()
    setIsUnlocked(false)
    setIsV2Unlocked(false)
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

      {isConnected && (
        <div className={styles.vault__section}>
          <div className={styles.vault__row}>
            <h5 className={styles.vault__sectionTitle}>Key Vault v2 · agents and in-app wallet</h5>
            <span className={clsx(styles.vault__status, isV2Unlocked && styles['vault__status--unlocked'])}>
              {isV2Unlocked ? <LockOpenIcon size={14} /> : <LockIcon size={14} />} {isV2Unlocked ? 'Unlocked' : 'Locked'}
            </span>
          </div>
          <p className={styles.vault__muted}>
            Your wallet signature and a passphrase are the whole key. Hup stores neither, so it can never lose your keys or be made
            to hand them over, and the same wallet and passphrase bring them back on any device.
          </p>
          <div className={styles.vault__warning} role="note">
            <ShieldWarningIcon size={18} weight="fill" aria-hidden="true" />
            <span>
              <strong>We can&rsquo;t recover a lost passphrase.</strong> Nobody can reset it, Hup included. Lose it and your agents, their
              wallets and anything they hold are gone for good. Write it down and keep it somewhere safe.
            </span>
          </div>

          {!isV2Unlocked && (
            <div className={styles.vault__form}>
              <input
                type={showPlainPin ? 'text' : 'password'}
                className={styles.vault__input}
                placeholder={`Key Vault passphrase (min ${PASSPHRASE_MIN_LENGTH} characters)`}
                value={v2Pin}
                onChange={(e) => {
                  setV2Pin(e.target.value)
                  setShownPassphrase('')
                }}
              />
              {isV2FirstOnDevice && (
                <input
                  type={showPlainPin ? 'text' : 'password'}
                  className={styles.vault__input}
                  placeholder="Confirm passphrase"
                  value={v2ConfirmPin}
                  onChange={(e) => setV2ConfirmPin(e.target.value)}
                />
              )}
              {shownPassphrase && (
                <p className={styles.vault__hint}>
                  <code>{shownPassphrase}</code> Write it down somewhere safe, then type it again to confirm.
                </p>
              )}
              {v2Weakness && <p className={styles.vault__hint}>{v2Weakness}</p>}
              {isV2FirstOnDevice && (
                <label className={styles.vault__ack}>
                  <input type="checkbox" checked={hasSavedV2} onChange={(e) => setHasSavedV2(e.target.checked)} disabled={isV2Working} />
                  I&rsquo;ve written my passphrase down somewhere safe
                </label>
              )}
              <div className={styles.vault__formActions}>
                {isV2FirstOnDevice ? (
                  <button type="button" className={styles.vault__linkBtn} onClick={suggestPassphrase} disabled={isV2Working}>
                    Generate one
                  </button>
                ) : (
                  <button type="button" className={styles.vault__linkBtn} onClick={() => setIsConfirmingReset(true)} disabled={isV2Working}>
                    Forgot passphrase?
                  </button>
                )}
                <button
                  type="button"
                  className={styles.vault__primaryBtn}
                  onClick={handleUnlockV2}
                  disabled={isV2Working || v2Pin.length < PASSPHRASE_MIN_LENGTH || Boolean(v2Weakness) || (isV2FirstOnDevice && !hasSavedV2)}
                >
                  {isV2Working ? 'Check your wallet…' : 'Unlock'}
                </button>
              </div>
              <p className={styles.vault__hint}>
                {isV2FirstOnDevice
                  ? 'First time on this device: enter your passphrase twice. Your wallet asks for the same signature twice, which cannot move funds.'
                  : 'One signature recreates your keys. It cannot move funds.'}
              </p>
            </div>
          )}

          {isConfirmingReset && (
            <div className={styles.vault__form}>
              <p className={styles.vault__muted}>
                <strong>A lost passphrase cannot be recovered, by Hup or anyone.</strong> Starting over creates a new set of keys.
                Agent wallets and the in-app wallet made with the old passphrase keep their funds on their old addresses, which only
                the old passphrase opens.
              </p>
              <div className={styles.vault__formActions}>
                <button type="button" className={styles.vault__linkBtn} onClick={() => setIsConfirmingReset(false)}>
                  Keep trying
                </button>
                <button type="button" className={styles.vault__dangerBtn} onClick={handleStartOverV2}>
                  Start over
                </button>
              </div>
            </div>
          )}

          {v2Message && <p className={styles.vault__muted}>{v2Message}</p>}
        </div>
      )}

      {isConnected && (
        <h5 className={styles.vault__sectionTitle}>Original vault · private communities</h5>
      )}

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
            <strong>In-app wallet and agents:</strong> a new PIN creates <em>brand new wallet addresses</em>. Funds on
            the old ones are unrecoverable — move funds out before changing your PIN.
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
