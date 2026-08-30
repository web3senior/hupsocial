'use client'

import clsx from 'clsx'
import { HeartIcon, SpinnerIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import NativePopover from '@/components/ui/NativePopover'
import { toast } from '@/components/NextToast'
import { useBatchLike } from '@/hooks/useBatchLike'
import styles from './BatchLikeTrigger.module.scss'

// Chains that get their own floating heart; anything beyond folds into one "more" heart
// that opens a list. Three keeps the stack shorter than a phone screen, and nobody queues
// likes on four chains in one sitting anyway.
const MAX_DIRECT_HEARTS = 3

const likesLabel = (count) => `${count} like${count === 1 ? '' : 's'}`
const compact = (count) => (count > 99 ? '99+' : count)

/**
 * The basket's surface: one floating heart per chain that has likes queued, and tapping a
 * heart sends that chain's queue straight away. The wallet prompt (or the relay's signature
 * request) is the confirmation — the same consent every other tap in the app relies on.
 * The old chooser panel confused people: they tapped the heart expecting to sign and got a
 * box to read instead.
 *
 * One chain per heart is the honest shape of a hard constraint, not decoration: batchLike
 * runs on a single Hup contract, so there is no "send all" that would not turn into a run
 * of switch-and-sign prompts. Each heart carries the chain's name with a "Send now" line
 * under it (so the tap reads as sending, not choosing), its queued count, and a small
 * clear chip — the only way to drop a queued like whose post has scrolled out of
 * reach.
 *
 * Hearts are ordered by chain id (the store keys the basket by id, and integer-like keys
 * enumerate ascending) rather than by count, so a tap target never jumps under the thumb
 * when another chain's count changes.
 *
 * @param {Object} props
 * @param {string} [props.className] Classes for each heart button, supplied by the host surface.
 * @param {string} [props.badgeClassName] Classes for the count badge.
 */
export default function BatchLikeTrigger({ className, badgeClassName }) {
  const { total, groups, pendingNetworkId, isProcessing, send, clear } = useBatchLike()

  if (total === 0) return null

  const direct = groups.slice(0, MAX_DIRECT_HEARTS)
  const folded = groups.slice(MAX_DIRECT_HEARTS)
  const foldedTotal = folded.reduce((sum, group) => sum + group.count, 0)

  const clearChain = (group) => {
    clear(group.networkId)
    toast(`Cleared ${likesLabel(group.count)} queued on ${group.name}`, 'info')
  }

  return (
    <>
      {direct.map((group) => {
        const isSending = pendingNetworkId === group.networkId

        return (
          <div key={group.networkId} className={styles.chainHeart}>
            <button
              type="button"
              className={clsx(className, styles.chainHeart__send)}
              disabled={isProcessing}
              aria-label={`Send ${likesLabel(group.count)} on ${group.name}`}
              onClick={() => send(group.networkId)}
            >
              {isSending ? (
                <SpinnerIcon className="animate spin" />
              ) : (
                <HeartIcon weight="fill" color="var(--batch-like-color, #facc15)" />
              )}
              <span className={styles.chainHeart__caption}>{group.name}</span>
              <span className={styles.chainHeart__cta}>{isSending ? 'Sending…' : 'Send now'}</span>
              <span className={badgeClassName}>{compact(group.count)}</span>
            </button>

            {/* A sibling rather than a child: buttons cannot nest */}
            <button
              type="button"
              className={styles.chainHeart__clear}
              disabled={isProcessing}
              aria-label={`Clear queued likes on ${group.name}`}
              onClick={() => clearChain(group)}
            >
              <XIcon size={10} weight="bold" />
            </button>
          </div>
        )
      })}

      {folded.length > 0 && (
        <NativePopover
          placement="top-end"
          className={styles.panel}
          trigger={
            <button
              type="button"
              className={clsx(className, styles.chainHeart__send)}
              disabled={isProcessing}
              aria-label={`Open ${folded.length} more networks with ${likesLabel(foldedTotal)} waiting`}
            >
              <HeartIcon weight="fill" color="var(--batch-like-color, #facc15)" />
              <span className={styles.chainHeart__caption}>+{folded.length} more</span>
              <span className={badgeClassName}>{compact(foldedTotal)}</span>
            </button>
          }
        >
          {({ close }) => (
            <div className={styles.basket}>
              <p className={styles.basket__title}>More pending likes</p>

              <ul className={styles.basket__list}>
                {folded.map((group) => (
                  <li key={group.networkId} className={styles.basket__item}>
                    <button
                      type="button"
                      className={styles.network}
                      disabled={isProcessing}
                      aria-label={`Send ${likesLabel(group.count)} on ${group.name}`}
                      onClick={() => {
                        close()
                        send(group.networkId)
                      }}
                    >
                      <span className={styles.network__name}>{group.name}</span>
                      <span className={styles.network__count}>
                        <HeartIcon size={11} weight="fill" />
                        {group.count}
                      </span>
                      {pendingNetworkId === group.networkId && <SpinnerIcon size={14} className="animate spin" />}
                    </button>

                    <button
                      type="button"
                      className={styles.network__clear}
                      disabled={isProcessing}
                      onClick={() => clearChain(group)}
                      aria-label={`Clear queued likes on ${group.name}`}
                    >
                      <TrashIcon size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </NativePopover>
      )}
    </>
  )
}
