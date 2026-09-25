'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useChainId, useConnection, useSignMessage } from 'wagmi'
import { Morph, Rise } from 'cube-motion/react'
import { CheckCircleIcon, ListChecksIcon, PenNibIcon, UsersThreeIcon, WalletIcon } from '@phosphor-icons/react'
import Profile from '@/components/Profile'
import { ContentSpinner } from '@/components/Loading'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/NextToast'
import { useClientMounted } from '@/hooks/useClientMount'
import { getWhitelistStatus, joinWhitelist, requestAuthNonce } from '@/lib/api'
import { openConnect } from '@/lib/connectDialog'
import { whitelistJoinMessage } from '@/lib/whitelist'
import styles from './WhitelistJoin.module.scss'

const countFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

const STEPS = [
  { id: 'connect', icon: WalletIcon, title: 'Connect your wallet', description: 'The wallet you want $HUP to reach.' },
  { id: 'sign', icon: PenNibIcon, title: 'Sign one message', description: 'Free. No transaction, no gas.' },
  { id: 'listed', icon: ListChecksIcon, title: 'You’re on the list', description: 'One entry per wallet, kept until launch.' },
]

const isDeclined = (error) => /rejected|denied|User rejected/i.test(error?.shortMessage || error?.message || '')

export default function WhitelistJoin() {
  const mounted = useClientMounted()
  const { address, isConnected } = useConnection()
  const chainId = useChainId()
  const { signMessageAsync } = useSignMessage()
  const [isJoining, setIsJoining] = useState(false)

  const wallet = mounted && isConnected ? address : null
  const { data: status, isLoading, mutate } = useSWR(mounted ? ['whitelist', wallet] : null, () => getWhitelistStatus(wallet))

  const handleJoin = async () => {
    if (!wallet) return

    setIsJoining(true)
    try {
      const nonce = await requestAuthNonce(wallet)
      if (!nonce) throw new Error('Could not start the sign-up — try again')

      const issuedAt = Date.now()
      const signature = await signMessageAsync({ message: whitelistJoinMessage({ address: wallet, nonce, issuedAt }) })

      const result = await joinWhitelist({ address: wallet, nonce, issuedAt, signature, chainId })
      if (!result.success) throw new Error(result.error)

      mutate({ success: true, total: result.total, joined: true, joinedAt: result.joinedAt }, { revalidate: false })
      toast(result.alreadyJoined ? 'This wallet was already on the list' : 'You’re on the Mint Whitelist', 'success')
    } catch (error) {
      if (!isDeclined(error)) toast(error?.message || 'Could not join the whitelist', 'error')
    } finally {
      setIsJoining(false)
    }
  }

  const isClosed = status && !status.success
  const total = status?.success ? status.total : null

  return (
    <div className={styles.whitelist}>
      <Rise as="header" targets="children" className={styles.whitelist__hero}>
        <span className={styles.whitelist__mark} aria-hidden="true">
          <ListChecksIcon size={28} weight="fill" />
        </span>
        <h1 className={styles.whitelist__title}>Mint Whitelist</h1>
        <p className={styles.whitelist__lede}>Get your wallet on the list before $HUP launches. It takes one signature and costs nothing.</p>
        {total !== null && (
          <span className={styles.whitelist__count}>
            <UsersThreeIcon size={14} weight="bold" aria-hidden="true" />
            {countFormatter.format(total)} {total === 1 ? 'wallet has' : 'wallets have'} joined
          </span>
        )}
      </Rise>

      <ol className={styles.whitelist__steps}>
        {STEPS.map(({ id, icon: Icon, title, description }) => (
          <li key={id} className={styles.whitelist__step}>
            <Icon size={16} weight="bold" aria-hidden="true" />
            <div>
              <strong>{title}</strong>
              <span>{description}</span>
            </div>
          </li>
        ))}
      </ol>

      <div className={styles.whitelist__card}>
        {!mounted || isLoading ? (
          <ContentSpinner className={styles.whitelist__loading} />
        ) : isClosed ? (
          <EmptyState align="center" icon={ListChecksIcon}>
            {status.error || 'The whitelist is not open yet'}
          </EmptyState>
        ) : !wallet ? (
          <>
            <EmptyState align="center" icon={WalletIcon}>
              Connect the wallet you want on the list.
            </EmptyState>
            <button type="button" className={styles.whitelist__action} onClick={() => openConnect()}>
              <WalletIcon size={16} weight="bold" aria-hidden="true" />
              Connect wallet
            </button>
          </>
        ) : (
          <>
            <Profile creator={wallet} variant="fullWithoutTime" hoverCard={false} className={styles.whitelist__wallet} />

            {status?.joined ? (
              <Rise className={styles.whitelist__joined} role="status">
                <CheckCircleIcon size={22} weight="fill" aria-hidden="true" />
                <div>
                  <strong>You’re on the list</strong>
                  {status.joinedAt && <span>Joined {dateFormatter.format(new Date(status.joinedAt))}</span>}
                </div>
              </Rise>
            ) : (
              <button type="button" className={styles.whitelist__action} onClick={handleJoin} disabled={isJoining}>
                <PenNibIcon size={16} weight="bold" aria-hidden="true" />
                <Morph active={isJoining} off="Join the whitelist" on="Check your wallet…" />
              </button>
            )}
          </>
        )}
      </div>

      <p className={styles.whitelist__fineprint}>
        One entry per wallet, and only the wallet itself can add its address. To add another wallet, switch to it and sign again.
      </p>
    </div>
  )
}
