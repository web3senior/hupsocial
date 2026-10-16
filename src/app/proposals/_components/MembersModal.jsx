'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { MAX_MEMBER_BATCH, parseAddressList } from '@/lib/dao'
import { toast } from '@/components/NextToast'
import { Spinner } from '@/components/Loading'
import NativeDialog from '@/components/ui/NativeDialog'
import { XIcon } from '@phosphor-icons/react'
import { useDaoWrite } from './useDao'
import styles from './DaoDialog.module.scss'

/**
 * Manage members
 * The DAO admin's roster editor for a Members DAO. Someone added now can vote on proposals
 * created after this; removing someone takes their vote out of future proposals only.
 * @param {Object} props
 * @param {number} props.chainId
 * @param {Object} props.dao Onchain DAO record.
 * @param {Function} props.onDone Called after a confirmed change.
 */
const MembersModal = forwardRef(function MembersModal({ chainId, dao, onDone }, ref) {
  const dialogRef = useRef(null)
  const [tab, setTab] = useState('add')
  const [text, setText] = useState('')
  const { send, busy } = useDaoWrite(chainId)
  const addresses = useMemo(() => parseAddressList(text), [text])

  useImperativeHandle(ref, () => ({
    open: (initialTab = 'add', prefill = '') => {
      setTab(initialTab)
      setText(prefill)
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (addresses.length === 0) {
      toast('Paste at least one address', 'error')
      return
    }
    if (addresses.length > MAX_MEMBER_BATCH) {
      toast(`Up to ${MAX_MEMBER_BATCH} addresses at a time`, 'error')
      return
    }

    const adding = tab === 'add'
    const noun = addresses.length === 1 ? 'member' : 'members'
    const receipt = await send(
      'members',
      { functionName: adding ? 'addMembers' : 'removeMembers', args: [dao.id, addresses] },
      {
        success: adding ? `Added ${addresses.length} ${noun}` : `Removed ${addresses.length} ${noun}`,
        // The whole batch reverts on one already-member (or non-member) address
        failure: adding ? 'Could not add — is someone already a member?' : 'Could not remove — is everyone a member?',
      },
    )
    if (receipt) {
      setText('')
      dialogRef.current?.close()
      onDone?.()
    }
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.daoDialog}
      aria-label="Manage members"
      onCancel={(event) => {
        if (busy) event.preventDefault()
      }}
    >
      <div className={styles.daoDialog__body}>
        <header className={styles.daoDialog__header}>
          <h3>Manage members</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.daoDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        <div className={styles.daoDialog__tabs} role="tablist">
          {['add', 'remove'].map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={clsx(styles.daoDialog__tab, tab === key && styles['daoDialog__tab--active'])}
              onClick={() => setTab(key)}
              disabled={Boolean(busy)}
            >
              {key === 'add' ? 'Add' : 'Remove'}
            </button>
          ))}
        </div>

        <p className={styles.daoDialog__intro}>
          {tab === 'add'
            ? 'New members can vote on proposals created after they join.'
            : 'Removed members keep the votes they already cast, and lose their vote on new proposals.'}
        </p>

        <form onSubmit={handleSubmit} className={styles.daoDialog__form}>
          <label className={styles.daoDialog__field}>
            <span className={styles.daoDialog__label}>Addresses</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="One address per line" spellCheck={false} disabled={Boolean(busy)} />
            <span className={styles.daoDialog__hint}>
              {addresses.length} valid {addresses.length === 1 ? 'address' : 'addresses'}
            </span>
          </label>

          <button type="submit" className={styles.daoDialog__submit} disabled={Boolean(busy) || addresses.length === 0}>
            {busy && <Spinner size={16} color="currentColor" />}
            {busy ? 'Saving…' : tab === 'add' ? 'Add members' : 'Remove members'}
          </button>
        </form>
      </div>
    </NativeDialog>
  )
})

export default MembersModal
