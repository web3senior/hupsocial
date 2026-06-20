// ConversationItem.jsx
import { useProfile } from '@/hooks/useProfile' // Using your hook from the previous step
import clsx from 'clsx'
import styles from './Chat.module.scss'

export const ConversationItem = ({ chat, isActive, onSelect, chainIcon }) => {
  const { profile, isLoading } = useProfile(chat.contactAddress)

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
          {/* Avatar with fallback handling included in useProfile/Fetcher */}
          <img src={profile?.profileImage} alt={displayName} className={styles['conversation-item__avatar']} />
        <div className={styles['conversation-item__info']}>
          <div className="flex justify-between align-items-center">
            <strong className={styles['conversation-item__name']}>{profile?.name}</strong>
            <span className={styles['conversation-item__time']}>
              {chat.lastTimestamp && new Date(chat.lastTimestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            </span>
          </div>
          <p className={styles['conversation-item__preview']}>
            {chat.lastMessage || "No messages yet"}
          </p>
        </div>
        </div>
      </div>
    </button>
  )
}
