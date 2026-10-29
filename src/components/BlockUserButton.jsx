'use client'

import clsx from 'clsx'
import { useBlockedUsers } from '@/hooks/useBlockedUsers'
import { sameAddress } from '@/lib/address'
import styles from './BlockUserButton.module.scss'

export default function BlockUserButton({ target }) {
  const { address, isBlocked, toggleBlock, isSaving, isLoading, error } = useBlockedUsers()
  if (!address || !target || sameAddress(address, target)) return null

  return (
    <button
      type="button"
      className={clsx(styles['block-user__button'])}
      title="Hide this user's posts in your feeds"
      disabled={isSaving || isLoading || Boolean(error)}
      onClick={(event) => {
        event.stopPropagation()
        toggleBlock(target)
      }}
    >
      {isSaving ? 'Saving…' : isBlocked(target) ? 'Unblock user' : 'Block user'}
    </button>
  )
}
