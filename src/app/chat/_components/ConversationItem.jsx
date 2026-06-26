import { useProfile } from '@/hooks/useProfile'
import clsx from 'clsx'
import styles from './Chat.module.scss'
import { useLastMessage } from '@/hooks/useLastMessage'
import { Trash2 } from 'lucide-react'
import { ContentSpinner } from '@/components/Loading'

export const ConversationItem = ({ chat, isActive, onSelect, onDelete, isDeleting }) => {
  const { profile } = useProfile(chat.contactAddress)
  const { latestMessage, isLoading: isLastMessageLoading } = useLastMessage(chat.topic)

  const displayAddr = `${chat.contactAddress.slice(0, 6)}...${chat.contactAddress.slice(-4)}`
  const displayName = profile?.name || displayAddr

  const handleDelete = (e) => {
    e.stopPropagation()
    onDelete?.(chat.contactAddress)
  }

  return (
    <div
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
        <button
          type="button"
          className={styles['conversation-item__delete']}
          onClick={handleDelete}
          disabled={isDeleting}
          title="Remove contact"
        >
          {isDeleting ? <ContentSpinner size="14px" /> : <Trash2 size={14} strokeWidth={1.5} />}
        </button>
      </div>
    </div>
  )
}