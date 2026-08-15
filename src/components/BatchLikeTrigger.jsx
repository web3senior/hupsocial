'use client'

import clsx from 'clsx'
import { HeartIcon, SpinnerIcon, TrashIcon } from '@phosphor-icons/react'
import NativePopover from '@/components/ui/NativePopover'
import { useBatchLike } from '@/hooks/useBatchLike'
import styles from './BatchLikeTrigger.module.scss'

/**
 * The basket's only surface now that /batch-like is gone: an orange heart carrying the
 * queued count, opening a panel that lists what is queued per chain.
 *
 * The panel opens even for a single queued chain rather than firing on tap. Sending costs
 * gas, so a floating button deserves a deliberate second tap, and it keeps clearing the
 * basket reachable in every state — otherwise a queued like nobody wants can never be
 * removed. There is deliberately no "send all" either: batchLike runs on one Hup contract
 * at a time and the wallet must switch networks for each, so a single tap across three
 * chains would be a run of switch-and-sign prompts, with a rejection halfway through
 * leaving the rest in an unexplained state.
 *
 * @param {Object} props
 * @param {string} [props.className] Classes for the trigger button, supplied by the host surface.
 * @param {string} [props.iconWrapperClassName] When set, icon and badge are wrapped in it (tab bars).
 * @param {string} [props.badgeClassName] Classes for the count/dot element.
 * @param {'count'|'dot'|'none'} [props.badge] How the queue size is shown.
 * @param {number} [props.iconSize] Heart size in px.
 * @param {string} [props.placement] NativePopover placement for the chain chooser.
 */
export default function BatchLikeTrigger({
  className,
  iconWrapperClassName,
  badgeClassName,
  badge = 'count',
  iconSize = 20,
  placement = 'top-end',
  caption,
}) {
  const { total, groups, pendingNetworkId, isProcessing, send, clear } = useBatchLike()

  if (total === 0) return null

  const badgeNode =
    badge === 'count' ? (
      <span className={badgeClassName ?? styles.badge}>{total > 99 ? '99+' : total}</span>
    ) : badge === 'dot' ? (
      <span className={badgeClassName} aria-hidden="true" />
    ) : null

  const face = (
    <>
      {isProcessing ? (
        <SpinnerIcon size={iconSize} className="animate spin" />
      ) : (
        <HeartIcon size={iconSize} weight="fill" color="var(--batch-like-color, #facc15)" />
      )}
      {badgeNode}
    </>
  )

  const content = iconWrapperClassName ? <span className={iconWrapperClassName}>{face}</span> : face

  const label = `Open pending likes, ${total} waiting to be sent`

  return (
    <NativePopover
      placement={placement}
      className={styles.panel}
      trigger={
        // A bare heart on a floating button reads as "like something", not "you have likes
        // waiting" — the caption is what tells a first-time user which one it is
        <button type="button" className={clsx(className, caption && styles.trigger)} disabled={isProcessing} aria-label={label}>
          {content}
          {caption && <span className={styles.caption}>{caption}</span>}
        </button>
      }
    >
      {({ close }) => (
        <div className={styles.basket}>
          <p className={styles.basket__title}>Pending likes</p>
          <p className={styles.basket__lede}>Hearts you tapped in the feed. Nothing is onchain until you send them.</p>

          <ul className={styles.basket__list}>
            {groups.map((group) => (
              <li key={group.networkId} className={styles.basket__item}>
                <button
                  type="button"
                  className={styles.network}
                  disabled={isProcessing}
                  aria-label={`Send ${group.count} like${group.count === 1 ? '' : 's'} on ${group.name}`}
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
                  {/* No send arrow: sitting beside the trash it turned the pair into a
                      guess, and the row itself is the send target */}
                  {pendingNetworkId === group.networkId && <SpinnerIcon size={14} className="animate spin" />}
                </button>

                <button
                  type="button"
                  className={styles.network__clear}
                  disabled={isProcessing}
                  onClick={() => clear(group.networkId)}
                  aria-label={`Clear queued likes on ${group.name}`}
                >
                  <TrashIcon size={14} />
                </button>
              </li>
            ))}
          </ul>

          {groups.length > 1 && (
            <p className={styles.basket__hint}>One transaction per network — your wallet switches between them.</p>
          )}

          <button
            type="button"
            className={styles.basket__clearAll}
            disabled={isProcessing}
            onClick={() => {
              clear()
              close()
            }}
          >
            <TrashIcon size={14} />
            <span>Clear all {total}</span>
          </button>
        </div>
      )}
    </NativePopover>
  )
}
