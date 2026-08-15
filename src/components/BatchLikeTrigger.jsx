'use client'

import clsx from 'clsx'
import { ArrowRightIcon, HeartIcon, SpinnerIcon, TrashIcon } from '@phosphor-icons/react'
import NativePopover from '@/components/ui/NativePopover'
import { useBatchLike } from '@/hooks/useBatchLike'
import styles from './BatchLikeTrigger.module.scss'

/**
 * The basket's only surface now that /batch-like is gone: an orange heart carrying the
 * queued count.
 *
 * One queued chain sends straight away. Several open a chooser instead of firing everything,
 * because a batchLike is one transaction per chain and the wallet must switch networks
 * between them — a silent "send all" would be a run of switch-and-sign prompts, and a
 * rejection halfway through would leave the rest in an unexplained state.
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

  const label = `Send ${total} queued like${total === 1 ? '' : 's'}`

  if (groups.length === 1) {
    return (
      <button type="button" className={className} disabled={isProcessing} onClick={() => send(groups[0].networkId)} aria-label={label}>
        {content}
      </button>
    )
  }

  return (
    <NativePopover
      placement={placement}
      className={styles.panel}
      trigger={
        <button type="button" className={className} disabled={isProcessing} aria-label={`${label} across ${groups.length} networks`}>
          {content}
        </button>
      }
    >
      {({ close }) => (
        <div className={styles.basket}>
          <p className={styles.basket__title}>Queued likes</p>

          <ul className={styles.basket__list}>
            {groups.map((group) => (
              <li key={group.networkId} className={styles.basket__item}>
                <button
                  type="button"
                  className={styles.network}
                  disabled={isProcessing}
                  onClick={() => {
                    close()
                    send(group.networkId)
                  }}
                >
                  <span className={styles.network__name}>{group.name}</span>
                  <span className={styles.network__count}>{group.count}</span>
                  {pendingNetworkId === group.networkId ? (
                    <SpinnerIcon size={14} className="animate spin" />
                  ) : (
                    <ArrowRightIcon size={14} />
                  )}
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

          <p className={styles.basket__hint}>One transaction per network — your wallet switches between them.</p>

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
