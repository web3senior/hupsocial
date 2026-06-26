// ConversationList.jsx
import { ConversationItem } from './ConversationItem'
import { getActiveChain } from '@/lib/communication'
import clsx from 'clsx'
import styles from './Chat.module.scss'

export const ConversationList = ({ activeChat, onSelect, onDelete, deletingContact, contacts = [] }) => {
  const activeChain = getActiveChain()
  const chainIcon = activeChain?.[0]?.icon

  return (
    <div className={styles['conversation-list']}>
      <div className={clsx(styles['conversation-list__container'], 'flex flex-column gap-1 mt-20')}>
        {contacts.length === 0 ? (
          <p className={styles['conversation-list__empty']}>No active conversations found.</p>
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
