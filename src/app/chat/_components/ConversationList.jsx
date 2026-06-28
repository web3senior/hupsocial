// ConversationList.jsx
import { ConversationItem } from './ConversationItem'
import { getActiveChain } from '@/lib/communication'
import styles from './ConversationList.module.scss'

export const ConversationList = ({ activeChat, onSelect, onDelete, deletingContact, contacts = [] }) => {
  const activeChain = getActiveChain()
  const chainIcon = activeChain?.[0]?.icon

  return (
    <div className={styles['conversation-list']}>
      <div className={styles['conversation-list__container']}>
        {contacts.length === 0 ? (
          <p className={styles['conversation-list__empty']}>No messages yet.</p>
        ) : (
          contacts.map((chat) => (
            <ConversationItem
              key={chat.topic}
              chat={chat}
              isActive={activeChat?.toLowerCase() === chat.contactAddress.toLowerCase()}
              onSelect={onSelect}
              onDelete={onDelete}
              isDeleting={deletingContact?.toLowerCase() === chat.contactAddress.toLowerCase()}
              chainIcon={chainIcon}
            />
          ))
        )}
      </div>
    </div>
  )
}
