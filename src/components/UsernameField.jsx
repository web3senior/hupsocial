'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useChainId, useSignMessage } from 'wagmi'
import { CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { checkUsername, claimUsername, requestAuthNonce } from '@/lib/api'
import { USERNAME_MAX_LENGTH, usernameClaimMessage, usernameKey, validateUsername } from '@/lib/username'
import { toast } from '@/components/NextToast'
import clsx from 'clsx'
import styles from './UsernameField.module.scss'

const CHECK_DEBOUNCE_MS = 400

/**
 * Username
 * Claiming a handle is its own transaction, not part of the profile form it sits in: it takes a
 * signature, and it either succeeds outright or leaves everything exactly as it was. So it saves
 * itself, through its own button, and never rides the form's submit.
 *
 * @param {Object} props
 * @param {string} props.address The wallet claiming — the only one that can sign for this handle.
 * @param {string|null} [props.username] The handle it already holds, if any.
 * @param {string} [props.suggestion] What to start the field with when there is no handle yet.
 * @param {boolean} [props.autoFocus] For a surface whose whole purpose is this field.
 * @param {string} [props.label] Overrides the field label, or '' to leave it off.
 * @param {(username: string) => void} [props.onClaimed] Called with the new handle once it is saved.
 */
export default function UsernameField({ address, username, suggestion = '', autoFocus = false, label = 'Username', onClaimed }) {
  const [value, setValue] = useState(username || suggestion || '')
  const [status, setStatus] = useState({ state: 'idle', message: null })
  const [isClaiming, setIsClaiming] = useState(false)
  const { signMessageAsync } = useSignMessage()
  const chainId = useChainId()
  const requestRef = useRef(0)

  // The claimed handle wins whenever there is one; a suggestion only ever fills an empty field.
  useEffect(() => setValue((current) => username || current || suggestion || ''), [username, suggestion])

  const held = usernameKey(username)
  const typed = usernameKey(value)
  const isUnchanged = Boolean(typed) && typed === held
  const canClaim = status.state === 'available' && !isUnchanged && !isClaiming

  useEffect(() => {
    if (!typed || isUnchanged) {
      setStatus({ state: 'idle', message: null })
      return
    }

    const shape = validateUsername(typed)
    if (!shape.ok) {
      setStatus({ state: 'invalid', message: shape.error })
      return
    }

    setStatus({ state: 'checking', message: 'Checking…' })
    // Every keystroke invalidates the answer in flight, so a slow early check can never
    // overwrite the verdict on what is in the field now.
    const ticket = ++requestRef.current
    const timer = setTimeout(async () => {
      const result = await checkUsername(typed, address)
      if (ticket !== requestRef.current) return
      setStatus(
        result.available
          ? { state: 'available', message: `@${typed} is available` }
          : { state: 'taken', message: result.error || 'That username is taken' },
      )
    }, CHECK_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [typed, isUnchanged, address])

  const handleClaim = useCallback(async () => {
    const shape = validateUsername(value)
    if (!shape.ok || !address) return

    setIsClaiming(true)
    try {
      const nonce = await requestAuthNonce(address)
      if (!nonce) throw new Error('Could not start the claim')

      const issuedAt = Date.now()
      const signature = await signMessageAsync({
        message: usernameClaimMessage({ username: shape.key, address, nonce, issuedAt }),
      })

      const saved = await claimUsername({ address, username: shape.display, nonce, issuedAt, signature, chainId })
      if (!saved.success) {
        setStatus({ state: 'taken', message: saved.error })
        return
      }

      setStatus({ state: 'idle', message: null })
      toast(`You are @${usernameKey(saved.username)}`, 'success')
      onClaimed?.(saved.username)
    } catch (error) {
      /* A rejected signature is a decision, not a failure — it needs no error shouted at it. */
      const rejected = /rejected|denied|User rejected/i.test(error?.shortMessage || error?.message || '')
      if (!rejected) {
        console.error('Username claim error:', error)
        toast(error?.message || 'Could not claim that username', 'error')
      }
    } finally {
      setIsClaiming(false)
    }
  }, [value, address, chainId, signMessageAsync, onClaimed])

  return (
    <div className={styles.username}>
      {label && (
        <label className={styles.username__label} htmlFor="pm-username">
          {label}
        </label>
      )}

      <div className={styles.username__row}>
        <div className={clsx(styles.username__inputWrap, status.state !== 'idle' && styles[`username__inputWrap--${status.state}`])}>
          <span className={styles.username__prefix} aria-hidden="true">
            @
          </span>
          <input
            id="pm-username"
            className={styles.username__input}
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/^@+/, ''))}
            placeholder="yourname"
            maxLength={USERNAME_MAX_LENGTH}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus={autoFocus}
            /* Enter claims rather than submitting the form this field may be sitting inside */
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              if (canClaim) handleClaim()
            }}
          />
        </div>

        <button type="button" className={styles.username__claim} onClick={handleClaim} disabled={!canClaim}>
          {isClaiming ? 'Signing…' : held ? 'Change' : 'Claim'}
        </button>
      </div>

      <p
        className={clsx(styles.username__hint, status.state !== 'idle' && styles[`username__hint--${status.state}`])}
        role={status.state === 'taken' || status.state === 'invalid' ? 'alert' : 'status'}
      >
        {status.state === 'available' && <CheckCircleIcon size={14} weight="fill" aria-hidden="true" />}
        {(status.state === 'taken' || status.state === 'invalid') && <WarningCircleIcon size={14} weight="fill" aria-hidden="true" />}
        {status.message || (held ? `hup.social/@${held}` : 'Letters, numbers and underscores.')}
      </p>
    </div>
  )
}
