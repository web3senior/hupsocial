'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import clsx from 'clsx'
import { CheckCircleIcon } from '@phosphor-icons/react'
import { zeroAddress } from 'viem'
import { useConnection, usePublicClient, useReadContract, useSignTypedData, useWriteContract } from 'wagmi'
import { getPublicClient, waitForTransactionReceipt } from 'wagmi/actions'
import { CONTRACTS, config } from '@/config/wagmi'
import { POLLS_ENABLED } from '@/config/features'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { gaslessCooldown, isGaslessEnabled, relayHupAction } from '@/lib/relayGasless'
import { formatShare, formatVotes, hasTallies, isPollOpen, parseJsonArray, pollOptions, pollRequirements, pollStatus, requirementChips } from '@/lib/polls'
import { allowlistProofFor } from '@/lib/pollAllowlist'
import { shortTxError } from '@/lib/utils'
import pollsAbi from '@/abis/HupPolls.json'
import { toast } from '@/components/NextToast'
import PollTimer from '@/components/PollTimer'
import styles from './PollCard.module.scss'

const fetcher = (url) => fetch(url).then((res) => res.json())

/**
 * Poll Card
 * Compact poll rendered inside posts. The content JSON only carries a reference
 * ({ pollId, chainId }); the poll itself is resolved live from the indexed API so the tally,
 * the window, and the viewer's own ballot stay current wherever the post is shown.
 *
 * Results are revealed once the viewer has voted or the poll has closed — before that the
 * card shows options, not standings, so the running count can't steer the vote it is counting.
 * @param {Object} props
 * @param {Object} props.pollRef Reference payload from the post's content JSON.
 */
export default function PollCard({ pollRef }) {
  const chainId = Number(pollRef?.chainId)
  const pollId = pollRef?.pollId

  const { address, isConnected } = useConnection()
  const { signTypedDataAsync } = useSignTypedData()
  const publicClient = usePublicClient({ chainId })

  const key = chainId && pollId ? `/api/v1/polls/${pollId}?networkId=${chainId}${address ? `&voter=${address.toLowerCase()}` : ''}` : null
  const { data: detail, mutate } = useSWR(key, fetcher)

  const [pendingOption, setPendingOption] = useState(null)
  // The indexer needs a few seconds to catch up, so a confirmed ballot renders from here
  // until the API row carries it
  const [localBallot, setLocalBallot] = useState(null)

  const { writeContractAsync } = useWriteContract()

  const poll = detail?.data?.poll
  const ballot = detail?.data?.ballot ?? localBallot
  const pollsAddress = CONTRACTS[`chain${chainId}`]?.polls

  // Derived above the early returns because the eligibility read below is a hook
  const requirements = pollRequirements(poll)
  const gated = requirements.length > 0
  // Read out of `poll` first so the memo closes over the two values it actually depends on —
  // closing over `poll` itself would rebuild the tree on every unrelated tally refresh
  const allowlistRoot = poll?.allowlist_root
  const allowlistRaw = poll?.allowlist
  const proof = useMemo(
    () => (allowlistRoot && address ? allowlistProofFor(parseJsonArray(allowlistRaw), address) : []),
    [allowlistRoot, allowlistRaw, address],
  )

  // The contract is the authority on who may vote, so the card asks it rather than
  // re-implementing the rules against indexed columns that can be minutes stale. An ungated
  // poll skips the read entirely.
  const { data: onchainEligible } = useReadContract({
    abi: pollsAbi,
    address: pollsAddress,
    functionName: 'isEligibleToVote',
    args: [BigInt(pollId || 0), address ?? zeroAddress, proof],
    chainId,
    query: { enabled: Boolean(gated && address && pollsAddress && pollId) },
  })

  // Nothing renders while polls are dark, including a post that already carries one
  if (!POLLS_ENABLED || !poll) return null

  // A moderator's `hidden` flag is a display decision, never a change to the tally — the
  // contract keeps accepting and counting votes. Say so plainly rather than rendering
  // nothing, so a post that carries a poll doesn't silently lose its point.
  if (Number(poll.hidden) === 1) {
    return <p className={styles.pollCard__hidden}>This poll was hidden by a moderator. Its result is still onchain.</p>
  }

  const status = pollStatus(poll)
  const options = pollOptions(poll)
  const isOpen = isPollOpen(poll)
  const hasVoted = ballot !== null && ballot !== undefined
  // Two conditions, not one: the viewer has earned the standings *and* the server actually
  // sent them. Between casting a ballot and the indexer counting it, the second is false —
  // painting bars then would show a flat 0% for every option and read as a broken poll.
  const showResults = (hasVoted || status.key === 'closed') && hasTallies(poll)
  const isCounting = hasVoted && !showResults && status.key !== 'closed'
  const isBusy = pendingOption !== null
  // `undefined` while the read is in flight — treated as eligible so a slow RPC greys out
  // nothing; the contract still has the last word when the ballot is sent
  const isBlocked = gated && isConnected && onchainEligible === false
  const nativeSymbol = config.chains.find((item) => item.id === chainId)?.nativeCurrency?.symbol ?? ''

  /**
   * Sends the ballot sponsored when the trial covers this chain, and falls back to the
   * viewer's own wallet otherwise. Same three-path shape as a like: relayer, session key,
   * plain transaction.
   */
  const castVote = async (optionIndex) => {
    if (!isConnected || !address) {
      toast('Connect your wallet to vote', 'error')
      return
    }
    if (!pollsAddress) {
      toast("Polls aren't available on this network", 'error')
      return
    }
    if (!isOpen || hasVoted || isBusy) return
    // Refuse here what the contract would refuse anyway, so a gated poll never spends a
    // signature prompt — or a sponsored transaction — on a ballot that cannot land
    if (gated && onchainEligible === false) {
      toast('You don’t meet this poll’s requirements', 'error')
      return
    }

    const chainDefinition = config.chains.find((item) => item.id === chainId)
    if (!chainDefinition) return

    setPendingOption(optionIndex)
    const args = [address, BigInt(pollId), optionIndex, proof]
    // Pinned to the poll's own chain: reads and the relay's nonce lookup happen there,
    // whatever network the wallet is connected to
    const targetPublicClient = getPublicClient(config, { chainId }) ?? publicClient

    try {
      const session = await isSessionActive({ userAddress: address, publicClient: targetPublicClient }).catch(() => ({ active: false }))

      if (isGaslessEnabled(chainId) && gaslessCooldown('vote', chainId, address) === 0) {
        try {
          await relayHupAction({
            chain: chainDefinition,
            publicClient: targetPublicClient,
            owner: address,
            functionName: 'vote',
            args,
            signTypedDataAsync,
            useSessionKey: session.active,
            contract: 'polls',
          })

          setLocalBallot({ option_index: optionIndex })
          setPendingOption(null)
          mutate()
          return
        } catch (err) {
          if (err.code === 'RELAY_COOLDOWN') {
            toast('Free-vote allowance is used up for now — using your wallet instead.', 'info')
          } else {
            console.warn('Gasless vote unavailable:', err.message)
          }
        }
      }

      if (session.active) {
        const tx = await writeWithBurnerSession({
          chain: chainDefinition,
          contractAddress: pollsAddress,
          abi: pollsAbi,
          functionName: 'vote',
          args,
        })
        await tx.wait().catch(() => null)

        setLocalBallot({ option_index: optionIndex })
        setPendingOption(null)
        mutate()
        return
      }

      const txHash = await writeContractAsync({ abi: pollsAbi, address: pollsAddress, functionName: 'vote', args, chainId })
      // Awaited here rather than watched in an effect: the ballot is only real once it is
      // mined, and the card has to keep showing "Voting…" until then
      await waitForTransactionReceipt(config, { hash: txHash, chainId })

      setLocalBallot({ option_index: optionIndex })
      setPendingOption(null)
      mutate()
    } catch (err) {
      setPendingOption(null)
      toast(shortTxError(err, 'Vote failed'), 'error')
    }
  }

  const chips = requirementChips(poll, nativeSymbol)

  return (
    <section className={styles.pollCard} onClick={(e) => e.stopPropagation()}>
      {poll.question && <p className={styles.pollCard__question}>{poll.question}</p>}

      {chips.length > 0 && (
        <div className={styles.pollCard__chips}>
          {chips.map((chip, index) => (
            <span key={index} className={clsx(styles.pollCard__chip, styles[`pollCard__chip--${chip.tone}`])}>
              {chip.label}
            </span>
          ))}
        </div>
      )}

      <ul className={styles.pollCard__options}>
        {options.map((option) => {
          const isChosen = hasVoted && Number(ballot.option_index) === option.index
          const isPendingThis = pendingOption === option.index
          // The leader is styled as the winner only once the poll is settled — a live poll's
          // front-runner is a running score, not a result
          const isWinner = showResults && option.isLeader && status.key === 'closed'

          return (
            <li key={option.index}>
              <button
                type="button"
                className={clsx(styles.pollCard__option, {
                  [styles['pollCard__option--result']]: showResults,
                  [styles['pollCard__option--chosen']]: isChosen,
                  [styles['pollCard__option--winner']]: isWinner,
                })}
                onClick={() => castVote(option.index)}
                disabled={!isOpen || hasVoted || isBusy || isBlocked}
                aria-label={showResults ? `${option.label}, ${formatShare(option.share)}` : `Vote for ${option.label}`}
              >
                <span className={styles.pollCard__optionHead}>
                  <span className={styles.pollCard__optionLabel}>
                    {option.emoji ? `${option.emoji} ` : ''}
                    {option.label}
                    {isChosen && <CheckCircleIcon size={13} weight="fill" />}
                  </span>
                  {showResults && <span className={styles.pollCard__optionShare}>{formatShare(option.share)}</span>}
                  {isPendingThis && <span className={styles.pollCard__optionShare}>Voting…</span>}
                </span>

                {showResults && (
                  <>
                    <span className={styles.pollCard__bar} aria-hidden>
                      <span className={styles.pollCard__barFill} style={{ width: `${option.share}%` }} />
                    </span>
                    <span className={styles.pollCard__optionVotes}>
                      {formatVotes(option.votes)} {option.votes === 1 ? 'vote' : 'votes'}
                    </span>
                  </>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      <footer className={styles.pollCard__footer}>
        {showResults ? (
          <Link href={`/polls/${chainId}/${pollId}`} className={styles.pollCard__total}>
            {formatVotes(poll.total_votes)} total {Number(poll.total_votes) === 1 ? 'vote' : 'votes'}
          </Link>
        ) : (
          <span className={styles.pollCard__meta}>
            {isCounting ? (
              'Counting your vote…'
            ) : (
              <PollTimer opensAt={poll.opens_at} closesAt={Number(poll.closed_at) > 0 ? poll.closed_at : poll.closes_at} />
            )}
          </span>
        )}

        {/* Only while it still matters: after a poll closes, why someone couldn't vote is
            no longer actionable and the footer belongs to the result */}
        {isBlocked && isOpen && <span className={styles.pollCard__blocked}>You don’t meet the requirements</span>}

        {showResults && status.key !== 'closed' && (
          <span className={styles.pollCard__meta}>
            <PollTimer opensAt={poll.opens_at} closesAt={poll.closes_at} />
          </span>
        )}
      </footer>
    </section>
  )
}
