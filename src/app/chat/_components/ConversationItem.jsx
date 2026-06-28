import { useProfile } from '@/hooks/useProfile'
import clsx from 'clsx'
import styles from './Chat.module.scss'
import { useLastMessage } from '@/hooks/useLastMessage'
import { Trash2 } from 'lucide-react'
import { ContentSpinner } from '@/components/Loading'
import { useState } from 'react'
import { createPortal } from 'react-dom'

export const ConversationItem = ({ chat, isActive, onSelect, onDelete, isDeleting }) => {
  const { profile } = useProfile(chat.contactAddress)
  const { latestMessage, isLoading: isLastMessageLoading } = useLastMessage(chat.topic)
  const [showConfirm, setShowConfirm] = useState(false)

  const displayAddr = `${chat.contactAddress.slice(0, 6)}...${chat.contactAddress.slice(-4)}`
  const displayName = profile?.name || displayAddr

  const handleDeleteClick = (e) => {
    e.stopPropagation()
    setShowConfirm(true)
  }

  const handleConfirm = () => {
    setShowConfirm(false)
    onDelete?.(chat.contactAddress)
  }

  const handleCancel = () => {
    setShowConfirm(false)
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
          onClick={handleDeleteClick}
          disabled={isDeleting}
          title="Remove contact"
        >
          {isDeleting ? <ContentSpinner size="14px" /> : <Trash2 size={14} strokeWidth={1.5} />}
        </button>
      </div>

      {showConfirm && typeof document !== 'undefined' && createPortal(
        <div className={styles['delete-confirm__overlay']} onClick={handleCancel}>
          <div className={styles['delete-confirm']} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles['delete-confirm__title']}>Remove contact?</h3>
            <p className={styles['delete-confirm__body']}>
              This will remove the contact. Your chat history will not be deleted.
            </p>
            <div className={styles['delete-confirm__actions']}>
              <button
                type="button"
                className={styles['delete-confirm__btn--danger']}
                onClick={handleConfirm}
              >
                Remove
              </button>
              <button
                type="button"
                className={styles['delete-confirm__btn--cancel']}
                onClick={handleCancel}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
