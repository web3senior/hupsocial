'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import clsx from 'clsx'
import { formatUnits, parseUnits, zeroAddress } from 'viem'
import { MAX_BPS, VOTING_DELAYS, VOTING_PERIODS, isAddress, sameAddress, shortAddress } from '@/lib/dao'
import { uploadObjectToIPFS, withAuthor } from '@/lib/ipfs'
import { toast } from '@/components/NextToast'
import { Spinner } from '@/components/Loading'
import NativeDialog from '@/components/ui/NativeDialog'
import ImagePicker from '@/app/communities/_components/ImagePicker'
import { XIcon } from '@phosphor-icons/react'
import { useDaoWrite } from './useDao'
import styles from './DaoDialog.module.scss'

const MAX_NAME_LENGTH = 60
const MAX_DESCRIPTION_LENGTH = 1000

const TABS = [
  ['details', 'Details'],
  ['rules', 'Rules'],
  ['admin', 'Admin'],
]

// A rule set on creation (or by an older build) may not be one of today's presets — keep it
// selectable rather than silently snapping it to the nearest one
const withCurrent = (presets, seconds, describe) =>
  presets.some((option) => option.seconds === seconds) ? presets : [...presets, { label: describe(seconds), seconds }]

const describeSeconds = (seconds) =>
  seconds % 86400 === 0 ? `${seconds / 86400} days` : seconds % 3600 === 0 ? `${seconds / 3600} hours` : `${seconds} seconds`

/**
 * Edit group
 * The admin's controls for a group: its name and look (a new IPFS document), its voting rules
 * (apply to proposals posted afterwards — open ones keep the rules they started with), and
 * who runs it.
 * @param {Object} props
 * @param {number} props.chainId
 * @param {Object} props.dao Onchain DAO record.
 * @param {Object|null} props.metadata The group's current IPFS metadata.
 * @param {number} props.decimals Voting-power decimals (0 for Members mode).
 * @param {Function} props.onDone Called after a confirmed change.
 */
const EditGroupModal = forwardRef(function EditGroupModal({ chainId, dao, metadata, decimals, onDone }, ref) {
  const dialogRef = useRef(null)
  const { send, busy, account } = useDaoWrite(chainId)
  const [tab, setTab] = useState('details')
  const [isUploading, setIsUploading] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [image, setImage] = useState('')

  const [period, setPeriod] = useState(0)
  const [delay, setDelay] = useState(0)
  const [quorumPercent, setQuorumPercent] = useState('')
  const [threshold, setThreshold] = useState('')

  const [newAdmin, setNewAdmin] = useState('')
  const [confirmRenounce, setConfirmRenounce] = useState(false)

  const isBusy = isUploading || Boolean(busy)

  // Filled on open, from whatever the group holds now, so an edit starts from the live values
  useImperativeHandle(ref, () => ({
    open: (initialTab = 'details') => {
      setTab(initialTab)
      setName(metadata?.name ?? '')
      setDescription(metadata?.description ?? '')
      setImage(metadata?.image ?? '')
      setPeriod(Number(dao.settings.votingPeriod))
      setDelay(Number(dao.settings.votingDelay))
      setQuorumPercent(String(Number(dao.settings.quorumBps) / 100))
      setThreshold(formatUnits(BigInt(dao.settings.proposalThreshold), decimals))
      setNewAdmin('')
      setConfirmRenounce(false)
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  const finish = (receipt) => {
    if (!receipt) return
    dialogRef.current?.close()
    onDone?.()
  }

  const saveDetails = async (event) => {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast('Give your group a name', 'error')
      return
    }

    setIsUploading(true)
    let cid
    try {
      // The whole document is replaced, so carry over any field this form doesn't edit
      cid = await uploadObjectToIPFS(
        withAuthor({ ...(metadata ?? {}), name: trimmedName, description: description.trim(), image: image || undefined }, account),
      )
    } catch (err) {
      toast(err.message || 'Failed to upload the group details', 'error')
      setIsUploading(false)
      return
    }
    setIsUploading(false)

    finish(
      await send('details', { functionName: 'updateMetadata', args: [dao.id, cid] }, { success: 'Group details saved', failure: 'Could not save the details' }),
    )
  }

  const saveRules = async (event) => {
    event.preventDefault()
    const quorum = Number(quorumPercent)
    if (!Number.isFinite(quorum) || quorum < 0 || quorum > 100) {
      toast('Turnout must be between 0 and 100%', 'error')
      return
    }

    let thresholdUnits
    try {
      thresholdUnits = parseUnits(String(threshold || '0'), decimals)
    } catch {
      toast('Votes needed to post must be a number', 'error')
      return
    }

    const settings = {
      votingDelay: Number(delay),
      votingPeriod: Number(period),
      quorumBps: Math.round((quorum / 100) * MAX_BPS),
      proposalThreshold: thresholdUnits,
    }
    finish(
      await send('rules', { functionName: 'updateSettings', args: [dao.id, settings] }, { success: 'Voting rules saved', failure: 'Could not save the rules' }),
    )
  }

  const transferAdmin = async (event) => {
    event.preventDefault()
    if (!isAddress(newAdmin)) {
      toast('Paste the new admin’s wallet address', 'error')
      return
    }
    if (sameAddress(newAdmin, account)) {
      toast('That is already you', 'error')
      return
    }
    finish(
      await send(
        'admin',
        { functionName: 'transferDaoAdmin', args: [dao.id, newAdmin.trim()] },
        { success: `${shortAddress(newAdmin)} now runs this group`, failure: 'Could not hand over the group' },
      ),
    )
  }

  const renounce = async () => {
    finish(
      await send(
        'renounce',
        { functionName: 'transferDaoAdmin', args: [dao.id, zeroAddress] },
        { success: 'This group no longer has an admin', failure: 'Could not remove the admin' },
      ),
    )
  }

  const periodOptions = withCurrent(VOTING_PERIODS, period, describeSeconds)
  const delayOptions = withCurrent(VOTING_DELAYS, delay, (seconds) => `After ${describeSeconds(seconds)}`)

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.daoDialog}
      aria-label="Edit group"
      onCancel={(event) => {
        if (isBusy) event.preventDefault()
      }}
    >
      <div className={styles.daoDialog__body}>
        <header className={styles.daoDialog__header}>
          <h3>Edit group</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.daoDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        <div className={styles.daoDialog__tabs} role="tablist">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={clsx(styles.daoDialog__tab, tab === key && styles['daoDialog__tab--active'])}
              onClick={() => setTab(key)}
              disabled={isBusy}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'details' && (
          <form onSubmit={saveDetails} className={styles.daoDialog__form}>
            <label className={styles.daoDialog__field}>
              <span className={styles.daoDialog__label}>Name</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_NAME_LENGTH} disabled={isBusy} required />
            </label>

            <label className={styles.daoDialog__field}>
              <span className={styles.daoDialog__label}>Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What will this group vote on?"
                maxLength={MAX_DESCRIPTION_LENGTH}
                disabled={isBusy}
              />
            </label>

            <ImagePicker label="Image" value={image} onChange={setImage} fieldClassName={styles.daoDialog__field} labelClassName={styles.daoDialog__label} />

            <button type="submit" className={styles.daoDialog__submit} disabled={isBusy}>
              {(isUploading || busy === 'details') && <Spinner size={16} color="currentColor" />}
              {isUploading ? 'Uploading…' : busy === 'details' ? 'Saving…' : 'Save details'}
            </button>
          </form>
        )}

        {tab === 'rules' && (
          <form onSubmit={saveRules} className={styles.daoDialog__form}>
            <p className={styles.daoDialog__intro}>New rules apply to proposals posted after you save. Proposals already open keep the rules they started with.</p>

            <div className={styles.daoDialog__row}>
              <label className={styles.daoDialog__field}>
                <span className={styles.daoDialog__label}>Voting lasts</span>
                <select value={period} onChange={(e) => setPeriod(Number(e.target.value))} disabled={isBusy}>
                  {periodOptions.map((option) => (
                    <option key={option.seconds} value={option.seconds}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.daoDialog__field}>
                <span className={styles.daoDialog__label}>Voting opens</span>
                <select value={delay} onChange={(e) => setDelay(Number(e.target.value))} disabled={isBusy}>
                  {delayOptions.map((option) => (
                    <option key={option.seconds} value={option.seconds}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className={styles.daoDialog__row}>
              <label className={styles.daoDialog__field}>
                <span className={styles.daoDialog__label}>Must vote (%)</span>
                <input type="number" min="0" max="100" step="0.5" value={quorumPercent} onChange={(e) => setQuorumPercent(e.target.value)} disabled={isBusy} />
              </label>

              <label className={styles.daoDialog__field}>
                <span className={styles.daoDialog__label}>Votes needed to post</span>
                <input type="number" min="0" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={isBusy} />
              </label>
            </div>

            <button type="submit" className={styles.daoDialog__submit} disabled={isBusy}>
              {busy === 'rules' && <Spinner size={16} color="currentColor" />}
              {busy === 'rules' ? 'Saving…' : 'Save rules'}
            </button>
          </form>
        )}

        {tab === 'admin' && (
          <div className={styles.daoDialog__form}>
            <form onSubmit={transferAdmin} className={styles.daoDialog__form}>
              <p className={styles.daoDialog__intro}>
                The admin edits the details and rules{Number(dao?.mode) === 2 ? ', and adds or removes members' : ''}. Handing it over is
                immediate — you lose these controls.
              </p>
              <label className={styles.daoDialog__field}>
                <span className={styles.daoDialog__label}>New admin wallet</span>
                <input
                  type="text"
                  value={newAdmin}
                  onChange={(e) => setNewAdmin(e.target.value)}
                  placeholder="0x…"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={isBusy}
                />
              </label>
              <button type="submit" className={styles.daoDialog__submit} disabled={isBusy || !isAddress(newAdmin)}>
                {busy === 'admin' && <Spinner size={16} color="currentColor" />}
                {busy === 'admin' ? 'Handing over…' : 'Hand over the group'}
              </button>
            </form>

            <div className={styles.daoDialog__summary}>
              <strong>Remove the admin for good</strong>
              <span>
                Nobody will be able to change the details or rules again{Number(dao?.mode) === 2 ? ', or the member list' : ''}. Voting keeps
                working. This can&apos;t be undone.
              </span>
              <span className={styles.daoDialog__check}>
                <input id="dao-confirm-renounce" type="checkbox" checked={confirmRenounce} onChange={(e) => setConfirmRenounce(e.target.checked)} disabled={isBusy} />
                <label htmlFor="dao-confirm-renounce">I understand</label>
              </span>
              <button
                type="button"
                className={clsx(styles.daoDialog__linkButton, styles['daoDialog__linkButton--danger'])}
                onClick={renounce}
                disabled={isBusy || !confirmRenounce}
              >
                {busy === 'renounce' ? 'Removing…' : 'Remove admin'}
              </button>
            </div>
          </div>
        )}
      </div>
    </NativeDialog>
  )
})

export default EditGroupModal
