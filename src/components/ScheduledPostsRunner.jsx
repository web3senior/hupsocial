'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useConnection, useSwitchChain, useWriteContract } from 'wagmi'
import { getPublicClient } from 'wagmi/actions'
import { CalendarDotsIcon } from '@phosphor-icons/react'
import abi from '@/abi/post.json'
import { CONTRACTS, config } from '@/config/wagmi'
import { appChains } from '@/config/contracts'
import { toast } from '@/components/NextToast'
import NativeDialog from '@/components/ui/NativeDialog'
import { trackPostPublication } from '@/lib/postPublication'
import { isBurnerUnlocked, isSessionActive } from '@/lib/burnerSession'
import { isGaslessEnabled, readForwarderNonce, relayHupAction } from '@/lib/relayGasless'
import {
  canPreSign,
  clearScheduleToken,
  createArgsFor,
  deliverDueScheduledPosts,
  formatWillSend,
  listScheduledPosts,
  preSignScheduledPost,
  readScheduleToken,
  SCHEDULE_POKE_EVENT,
  subscribeScheduleToken,
  updateScheduledPost,
} from '@/lib/scheduledPosts'
import styles from './ScheduledPostsRunner.module.scss'

const TICK_MS = 60_000
// How long a declined or dismissed prompt stays quiet before the post is offered again
const SNOOZE_MS = 10 * 60_000

const previewText = (row) => {
  const text = row?.content?.elements?.[0]?.data?.text ?? ''
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

const chainFor = (row) => appChains.find((item) => item.id === Number(row.networkId)) ?? null

const nowSeconds = () => Math.floor(Date.now() / 1000)

// The rows that must execute before `row` from the same signer on the same chain
const rowsAhead = (row, rows) =>
  rows.filter(
    (other) =>
      other.id !== row.id &&
      other.status === 'scheduled' &&
      other.signed &&
      !other.signatureStale &&
      Number(other.networkId) === Number(row.networkId) &&
      String(other.forwardFrom).toLowerCase() === String(row.forwardFrom).toLowerCase() &&
      (other.scheduledAt < row.scheduledAt || (other.scheduledAt === row.scheduledAt && other.id < row.id)),
  ).length

/**
 * The author's hand in publishing scheduled posts.
 *
 * Mounted once in the shell. Every minute while the author has Hup open (and the moment they
 * come back to the tab) it looks at their pending posts: a due post the relayer can send is
 * handed over right away; a due post only the author can publish goes out silently through the
 * session key, or is offered here for one wallet signature; and posts still waiting have their
 * relayer copy kept usable, so the cron finds something it can send when the author is gone.
 * Never prompts on its own for anything but a post that is already due.
 */
export default function ScheduledPostsRunner() {
  const { address, isConnected, chain: walletChain } = useConnection()
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain()
  const { writeContractAsync, isPending: isSigning } = useWriteContract()
  const token = useSyncExternalStore(
    subscribeScheduleToken,
    () => readScheduleToken(address),
    () => null,
  )

  // The one due post currently waiting on the wallet
  const [prompt, setPrompt] = useState(null)
  const dialogRef = useRef(null)
  const busyRef = useRef(false)
  const snoozedRef = useRef(new Map())
  const sentRef = useRef(new Set())

  const announce = useCallback(
    (row, txHash) => {
      sentRef.current.add(row.id)
      trackPostPublication({
        networkId: row.networkId,
        author: address,
        metadata: row.metadata,
        kind: 'post',
        txHash,
        recovery: { props: { actionType: 'post' }, state: { content: row.content, allowComments: row.allowComments } },
      })
    },
    [address],
  )

  /**
   * Keeps the relayer's copy of each pending post usable, where that costs no prompt: a post the
   * author never signed for (they had no session then), one the server marked stale, or one whose
   * nonce the forwarder has moved past. Rows are handled in due order and re-read after each
   * signature so the nonces come out consecutive.
   */
  const refreshSignatures = useCallback(
    async (initialRows) => {
      if (!isBurnerUnlocked()) return
      let rows = initialRows

      for (const snapshot of initialRows) {
        const row = rows.find((item) => item.id === snapshot.id)
        if (!row || row.status !== 'scheduled' || row.scheduledAt <= nowSeconds()) continue

        const chain = chainFor(row)
        if (!chain || !isGaslessEnabled(row.networkId)) continue
        const publicClient = getPublicClient(config, { chainId: chain.id })
        if (!publicClient) continue

        const ability = await canPreSign({ row, owner: address, publicClient })
        // The wallet path would open a prompt for a post that is not even due
        if (!ability.ok || !ability.useSessionKey) continue

        let needs = !row.signed || row.signatureStale
        if (!needs) {
          try {
            const base = await readForwarderNonce(publicClient, row.forwarderAddress, row.forwardFrom)
            needs = BigInt(row.forwardNonce) !== base + BigInt(rowsAhead(row, rows))
          } catch {
            continue
          }
        }
        if (!needs) continue

        try {
          await preSignScheduledPost({ row, pendingRows: rows, chain, publicClient, owner: address, useSessionKey: true, token })
          rows = await listScheduledPosts(token, 'pending')
        } catch (error) {
          console.warn('Could not refresh a scheduled signature:', error.message)
        }
      }
    },
    [address, token],
  )

  const tick = useCallback(async () => {
    if (!address || !token || busyRef.current || typeof document === 'undefined' || document.hidden) return
    busyRef.current = true

    try {
      let rows = await listScheduledPosts(token, 'pending')
      const isDue = (row) => row.status === 'scheduled' && row.scheduledAt <= nowSeconds()

      // 1. Due and pre-signed: the relayer sends it — no gas, no signature, no wait for the cron
      if (rows.some((row) => isDue(row) && row.signed && !row.signatureStale)) {
        const result = await deliverDueScheduledPosts(token)
        for (const sent of result?.sent ?? []) {
          const row = rows.find((item) => item.id === sent.id)
          if (row) announce(row, sent.txHash)
        }
        rows = await listScheduledPosts(token, 'pending')
      }

      // 2. Due but only the author can publish: silently with the session key, otherwise ask
      for (const row of rows) {
        if (!isDue(row) || (row.signed && !row.signatureStale)) continue
        if ((snoozedRef.current.get(row.id) ?? 0) > Date.now()) continue

        const chain = chainFor(row)
        const publicClient = chain ? getPublicClient(config, { chainId: chain.id }) : null

        if (chain && publicClient && isGaslessEnabled(row.networkId) && isBurnerUnlocked()) {
          const session = await isSessionActive({ userAddress: address, publicClient }).catch(() => ({ active: false }))
          if (session.active) {
            try {
              await updateScheduledPost(token, row.id, { action: 'claim' })
              const txHash = await relayHupAction({
                chain,
                publicClient,
                owner: address,
                functionName: 'create',
                args: createArgsFor(row, address),
                useSessionKey: true,
              })
              await updateScheduledPost(token, row.id, { action: 'sent', txHash })
              announce(row, txHash)
              continue
            } catch (error) {
              await updateScheduledPost(token, row.id, { action: 'release' }).catch(() => {})
              if (error.code === 'RELAY_COOLDOWN') {
                snoozedRef.current.set(row.id, Date.now() + (Number(error.retryAfter) || 60) * 1000)
                continue
              }
              console.warn('Silent scheduled publish failed:', error.message)
            }
          }
        }

        // One question at a time; the rest wait for the next look
        if (!prompt) setPrompt(row)
        break
      }

      // 3. Not due yet: keep the relayer's copy usable while the author is here
      await refreshSignatures(rows)
    } catch (error) {
      // A token the server no longer accepts is dropped so the next schedule signs in afresh
      if (error.status === 401) clearScheduleToken(address)
      else console.warn('Scheduled posts check failed:', error.message)
    } finally {
      busyRef.current = false
    }
  }, [address, token, announce, prompt, refreshSignatures])

  useEffect(() => {
    if (!isConnected || !address || !token) return

    tick()
    const interval = window.setInterval(tick, TICK_MS)
    const onWake = () => {
      if (!document.hidden) tick()
    }
    window.addEventListener(SCHEDULE_POKE_EVENT, onWake)
    document.addEventListener('visibilitychange', onWake)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener(SCHEDULE_POKE_EVENT, onWake)
      document.removeEventListener('visibilitychange', onWake)
    }
  }, [isConnected, address, token, tick])

  useEffect(() => {
    if (prompt) dialogRef.current?.open()
  }, [prompt])

  const onClosed = () => {
    // Dismissed without publishing: leave the author alone for a while
    if (prompt && !sentRef.current.has(prompt.id)) snoozedRef.current.set(prompt.id, Date.now() + SNOOZE_MS)
    setPrompt(null)
  }

  const publish = async () => {
    const row = prompt
    if (!row) return

    const chain = chainFor(row)
    const hup = CONTRACTS[`chain${row.networkId}`]?.hup
    if (!chain || !hup) {
      toast('This network is not configured for posting', 'error')
      return
    }

    try {
      if (walletChain?.id !== chain.id) await switchChainAsync({ chainId: chain.id })

      await updateScheduledPost(token, row.id, { action: 'claim' })
      let txHash
      try {
        txHash = await writeContractAsync({ abi, address: hup, functionName: 'create', args: createArgsFor(row, address), chainId: chain.id })
      } catch (error) {
        await updateScheduledPost(token, row.id, { action: 'release' }).catch(() => {})
        throw error
      }

      await updateScheduledPost(token, row.id, { action: 'sent', txHash })
      announce(row, txHash)
      dialogRef.current?.close()
    } catch (error) {
      toast(error.shortMessage || error.message || 'Could not publish the post', 'error')
    }
  }

  const chainName = prompt ? chainFor(prompt)?.name || 'this network' : ''

  return (
    <NativeDialog ref={dialogRef} className={styles.due} aria-label="Scheduled post due" onClick={(e) => e.stopPropagation()} onClose={onClosed}>
      {prompt && (
        <div className={styles.due__body}>
          <header className={styles.due__header}>
            <CalendarDotsIcon size={22} />
            <h3>Your scheduled post is due</h3>
          </header>

          <p className={styles.due__when}>
            Scheduled for {formatWillSend(prompt.scheduledAt)} on {chainName}
          </p>

          {previewText(prompt) && <blockquote className={styles.due__preview}>{previewText(prompt)}</blockquote>}

          <p className={styles.due__hint}>
            {prompt.signed
              ? 'The relayer could not send it for you, so it needs your signature to go onchain.'
              : 'It needs your signature to go onchain.'}
          </p>

          <footer className={styles.due__actions}>
            <button type="button" className={styles.due__later} onClick={() => dialogRef.current?.close()}>
              Later
            </button>
            <button type="button" className={styles.due__publish} onClick={publish} disabled={isSigning || isSwitching}>
              {isSwitching ? 'Switching…' : isSigning ? 'Signing…' : 'Publish now'}
            </button>
          </footer>
        </div>
      )}
    </NativeDialog>
  )
}
