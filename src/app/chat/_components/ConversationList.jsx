import { useEffect, useState } from 'react'
import { getProfile, getUniversalProfile } from '@/lib/api'
import { getActiveChain } from '@/lib/communication'
import clsx from 'clsx'
import styles from './Chat.module.scss'

export const ConversationList = ({ activeChat, onSelect, contacts = [], refreshKey = 0 }) => {
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(false)
  const activeChain = getActiveChain()

  useEffect(() => {
    let isMounted = true

    const fetchData = async () => {
      if (!contacts.length) {
        if (isMounted) {
          setConversations([])
          setLoading(false)
        }
        return
      }

      setLoading(true)

      try {
        const baselineContacts = contacts.map((item) => ({
          ...item,
          profileInfo: {
            name: null,
            image: `${process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL || process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL_FALLBACK || 'https://ipfs.io/ipfs/'}bafkreiebl75dg4kbwh2ekkaq5zorr6vgkaoaordng5w623wqe7nwojhei4`,
          },
        }))

        // Enrich profiles sequentially or via Promise.all
        const enrichedConversations = await Promise.all(
          baselineContacts.map(async (chat) => {
            try {
              const profileRes = await getUniversalProfile(chat.contactAddress)
              if (profileRes?.Profile?.[0]) {
                chat.profileInfo.name = profileRes.Profile[0].name
                chat.profileInfo.image = profileRes.Profile[0].profileImages?.[0]?.src || chat.profileInfo.image
              } else {
                const fallback = await getProfile(chat.contactAddress)
                if (fallback?.data?.name) {
                  chat.profileInfo.name = fallback.data.name
                  chat.profileInfo.image = fallback.data.profileImage || chat.profileInfo.image
                }
              }
            } catch (e) {
              console.warn(`Profile extraction stalled for ${chat.contactAddress}`)
            }
            return chat
          }),
        )

        if (isMounted) setConversations(enrichedConversations)
      } catch (err) {
        console.error('Sidebar sync loop processing crashed:', err)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    fetchData()

    return () => {
      isMounted = false
    }
  }, [contacts, refreshKey])

  return (
    <div className={styles['conversation-list']}>
      <div className={clsx(styles['conversation-list__container'], 'flex flex-column gap-1 mt-20')}>
        {loading && conversations.length === 0 && <p className={styles['conversation-list__loading']}>Scanning stealth rooms...</p>}

        {conversations.map((chat) => {
          const displayAddr = `${chat.contactAddress.slice(0, 6)}...${chat.contactAddress.slice(-4)}`
          const displayName = chat.profileInfo.name || displayAddr

          return (
            <button
              key={chat.topic}
              className={clsx(styles['conversation-item'], {
                [styles['conversation-item--active']]: activeChat?.toLowerCase() === chat.contactAddress.toLowerCase(),
              })}
              onClick={() => onSelect(chat.contactAddress)}
            >
              <div className={styles['conversation-item__content']}>
                <div className={styles['conversation-item__user']}>
                  <img src={chat.profileInfo.image} alt={displayName} className={styles['conversation-item__avatar']} />
                  <div className={clsx(styles['conversation-item__info'])}>
                    <div className={clsx('flex align-items-center gap-025')}>
                      <strong className={styles['conversation-item__name']}>{displayName}</strong>
                      {activeChain?.[0]?.icon && (
                        <span
                          className={styles['conversation-item__chain-icon']}
                          dangerouslySetInnerHTML={{ __html: activeChain[0].icon }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </button>
          )
        })}

        {!loading && conversations.length === 0 && <p className={styles['conversation-list__empty']}>No active conversations found.</p>}
      </div>
    </div>
  )
}
