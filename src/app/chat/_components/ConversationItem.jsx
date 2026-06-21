import { useProfile } from '@/hooks/useProfile'
import clsx from 'clsx'
import styles from './Chat.module.scss'
import { useLastMessage } from '@/hooks/useLastMessage'

export const ConversationItem = ({ chat, isActive, onSelect }) => {
  const { profile } = useProfile(chat.contactAddress)
  const { latestMessage, isLoading: isLastMessageLoading } = useLastMessage(chat.topic)

  const displayAddr = `${chat.contactAddress.slice(0, 6)}...${chat.contactAddress.slice(-4)}`
  const displayName = profile?.name || displayAddr

  return (
    <button
      className={clsx(styles['conversation-item'], {
        [styles['conversation-item--active']]: isActive,
      })}
      onClick={() => onSelect(chat.contactAddress)}
    >
      <div className={styles['conversation-item__content']}>
        <div className={styles['conversation-item__user']}>
          <img
            src={profile?.profileImage}
            alt={displayName}
            className={styles['conversation-item__avatar']}
          />
          <div className={styles['conversation-item__info']}>
            <div className="flex justify-between align-items-center">
              <strong className={styles['conversation-item__name']}>{displayName}</strong>
              <span className={styles['conversation-item__time']}>
                {latestMessage?.timestamp
                  ? new Date(latestMessage.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : chat.lastTimestamp
                  ? new Date(chat.lastTimestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : null}
              </span>
            </div>
            <p className={styles['conversation-item__preview']}>
              {isLastMessageLoading ? '...' : latestMessage?.message || 'No messages'}
            </p>
          </div>
        </div>
      </div>
    </button>
  )
}