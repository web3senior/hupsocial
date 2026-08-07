'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { PlusIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import Profile from '@/components/Profile'
import NativeDialog from '@/components/ui/NativeDialog'
import RecipientField from '@/components/ui/RecipientField'
import { EMPTY_RECIPIENT } from '@/lib/recipientSearch'
import { toast } from '@/components/NextToast'
import styles from './EditJudgesDialog.module.scss'

const MAX_JUDGES = 8

/**
 * Edit Judges Dialog
 * Creator-only panel editor for a market that holds no stakes yet — the same window the
 * contract enforces (addJudge/removeJudge revert once the first bet lands). Added judges
 * arrive pending and must accept with their own wallet; removal keeps at least one judge.
 * @param {Object} props
 * @param {string[]} props.judges Current panel (lowercase addresses, from the indexer).
 * @param {string[]} props.judgesConfirmed Subset of the panel that has accepted.
 * @param {number} props.chainId The market's chain.
 * @param {string|number} props.marketId The market's onchain id.
 * @param {string} props.viewer The connected wallet (the creator, per the visibility gate).
 * @param {Function} props.onAction MarketDetail's submitTx — (functionName, args, label).
 * @param {boolean} props.isBusy True while any market transaction is in flight.
 */
const EditJudgesDialog = forwardRef(function EditJudgesDialog(
  { judges, judgesConfirmed, chainId, marketId, viewer, onAction, isBusy },
  ref,
) {
  const dialogRef = useRef(null)
  const [newJudge, setNewJudge] = useState(EMPTY_RECIPIENT)

  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.open(),
    close: () => dialogRef.current?.close(),
  }))

  const handleAdd = () => {
    const judge = newJudge.address
    if (!judge) {
      toast('Enter a valid judge address', 'error')
      return
    }
    if (judges.includes(judge.toLowerCase())) {
      toast('That address is already a judge', 'error')
      return
    }
    if (judges.length >= MAX_JUDGES) {
      toast(`At most ${MAX_JUDGES} judges per market`, 'error')
      return
    }

    onAction('addJudge', [viewer, BigInt(marketId), judge], 'Judge added')
    setNewJudge(EMPTY_RECIPIENT)
  }

  return (
    <NativeDialog ref={dialogRef} className={styles.editJudges} aria-label="Edit judges" onClick={(e) => e.stopPropagation()}>
      <header className={styles.editJudges__header}>
        <h3>Edit judges</h3>
        <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.editJudges__close}>
          <XIcon size={18} />
        </button>
      </header>

      <p className={styles.editJudges__hint}>
        Only you (the creator) can edit the panel, and only until the first bet — bettors stake under the panel they see.
        Added judges start pending and must accept with their own wallet. Changes appear once the indexer catches up.
      </p>

      <ul className={styles.editJudges__list}>
        {judges.map((judge) => (
          <li key={judge} className={styles.editJudges__row}>
            <Profile variant="fullWithoutTime" creator={judge} networkId={chainId} className={styles.editJudges__profile} />
            {!judgesConfirmed.includes(judge) && <span className={styles.editJudges__pending}>pending</span>}
            <button
              type="button"
              onClick={() => onAction('removeJudge', [viewer, BigInt(marketId), judge], 'Judge removed')}
              // The contract keeps at least one judge on the panel
              disabled={isBusy || judges.length <= 1}
              aria-label={`Remove judge ${judge}`}
              className={styles.editJudges__remove}
            >
              <TrashIcon size={15} />
            </button>
          </li>
        ))}
      </ul>

      <div className={styles.editJudges__add}>
        <RecipientField
          className={styles.editJudges__addField}
          label={null}
          value={newJudge}
          onChange={setNewJudge}
          viewer={viewer}
          exclude={judges}
          placeholder="Name, ENS, or 0x… judge address"
          disabled={isBusy}
        />
        <button type="button" onClick={handleAdd} disabled={isBusy || !newJudge.address || judges.length >= MAX_JUDGES}>
          <PlusIcon size={14} />
          Add
        </button>
      </div>
    </NativeDialog>
  )
})

export default EditJudgesDialog
