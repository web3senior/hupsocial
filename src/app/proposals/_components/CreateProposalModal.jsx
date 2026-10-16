'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import clsx from 'clsx'
import { parseEventLogs } from 'viem'
import { MAX_PROPOSAL_OPTIONS, MIN_PROPOSAL_OPTIONS, votesLabel } from '@/lib/dao'
import { uploadObjectToIPFS, withAuthor } from '@/lib/ipfs'
import daoAbi from '@/abis/HupDao.json'
import { toast } from '@/components/NextToast'
import { Spinner } from '@/components/Loading'
import NativeDialog from '@/components/ui/NativeDialog'
import { PlusIcon, TrashIcon, XIcon } from '@phosphor-icons/react'
import { useDaoWrite } from './useDao'
import styles from './DaoDialog.module.scss'

const MAX_TITLE_LENGTH = 140
const MAX_BODY_LENGTH = 10_000

/**
 * New proposal
 * A yes/no/abstain question or a multiple-choice one. Text goes to IPFS; voting power is
 * measured the moment it is created, so the proposer's power is checked against the DAO's
 * threshold at that same instant.
 * @param {Object} props
 * @param {number} props.chainId
 * @param {Object} props.dao Onchain DAO record.
 * @param {number} props.decimals Voting-power decimals (0 for Members mode).
 * @param {bigint} props.votes The viewer's current voting power.
 * @param {Function} props.onCreated Called with the new proposal id.
 */
const CreateProposalModal = forwardRef(function CreateProposalModal({ chainId, dao, decimals, votes = 0n, onCreated }, ref) {
  const dialogRef = useRef(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState('binary')
  const [options, setOptions] = useState(['', ''])
  const [isUploading, setIsUploading] = useState(false)
  const { send, busy, account } = useDaoWrite(chainId)
  const isBusy = isUploading || busy === 'propose'

  const threshold = BigInt(dao?.settings?.proposalThreshold ?? 0)
  const belowThreshold = votes < threshold

  useImperativeHandle(ref, () => ({
    open: () => dialogRef.current?.open(),
    close: () => dialogRef.current?.close(),
  }))

  const setOption = (index, value) => setOptions((current) => current.map((option, i) => (i === index ? value : option)))

  const handleSubmit = async (event) => {
    event.preventDefault()

    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      toast('Your proposal needs a title', 'error')
      return
    }

    const labels = options.map((option) => option.trim())
    if (kind === 'choice') {
      if (labels.some((label) => !label)) {
        toast('Every choice needs a label', 'error')
        return
      }
      if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) {
        toast('Two choices say the same thing', 'error')
        return
      }
    }

    setIsUploading(true)
    let cid
    try {
      cid = await uploadObjectToIPFS(
        withAuthor({ title: trimmedTitle, body: body.trim(), ...(kind === 'choice' ? { options: labels } : {}) }, account),
      )
    } catch (err) {
      toast(err.message || 'Failed to upload the proposal', 'error')
      setIsUploading(false)
      return
    }
    setIsUploading(false)

    const receipt = await send(
      'propose',
      { functionName: 'propose', args: [dao.id, cid, kind === 'choice' ? labels.length : 0] },
      { success: 'Proposal posted', failure: 'Could not post the proposal' },
    )
    if (!receipt) return

    const [created] = parseEventLogs({ abi: daoAbi, eventName: 'ProposalCreated', logs: receipt.logs })
    setTitle('')
    setBody('')
    setKind('binary')
    setOptions(['', ''])
    dialogRef.current?.close()
    onCreated?.(created?.args?.proposalId?.toString())
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.daoDialog}
      aria-label="New proposal"
      onCancel={(event) => {
        if (isBusy) event.preventDefault()
      }}
    >
      <div className={styles.daoDialog__body}>
        <header className={styles.daoDialog__header}>
          <h3>New proposal</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.daoDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        {belowThreshold && (
          <p className={clsx(styles.daoDialog__hint, styles['daoDialog__hint--error'])}>
            You need {votesLabel(threshold, decimals)} to post here and have {votesLabel(votes, decimals)}. Votes you just got count
            after a moment.
          </p>
        )}

        <form onSubmit={handleSubmit} className={styles.daoDialog__form}>
          <label className={styles.daoDialog__field}>
            <span className={styles.daoDialog__label}>Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Fund the community hackathon"
              maxLength={MAX_TITLE_LENGTH}
              disabled={isBusy}
              required
            />
          </label>

          <label className={styles.daoDialog__field}>
            <span className={styles.daoDialog__label}>Details</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What is being decided, and why?"
              maxLength={MAX_BODY_LENGTH}
              rows={6}
              disabled={isBusy}
            />
          </label>

          <div className={styles.daoDialog__tabs} role="tablist" aria-label="Proposal type">
            {[
              ['binary', 'Yes / No'],
              ['choice', 'Multiple choice'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={kind === key}
                className={clsx(styles.daoDialog__tab, kind === key && styles['daoDialog__tab--active'])}
                onClick={() => setKind(key)}
                disabled={isBusy}
              >
                {label}
              </button>
            ))}
          </div>

          {kind === 'binary' ? (
            <span className={styles.daoDialog__hint}>People vote Yes, No or Abstain. It passes when Yes beats No and enough people vote.</span>
          ) : (
            <div className={styles.daoDialog__options}>
              {options.map((option, index) => (
                <div key={index} className={styles.daoDialog__optionRow}>
                  <div className={styles.daoDialog__field} style={{ flex: 1 }}>
                    <input
                      type="text"
                      value={option}
                      onChange={(e) => setOption(index, e.target.value)}
                      placeholder={`Choice ${index + 1}`}
                      maxLength={80}
                      disabled={isBusy}
                      aria-label={`Choice ${index + 1}`}
                    />
                  </div>
                  <button
                    type="button"
                    className={styles.daoDialog__iconButton}
                    onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                    disabled={isBusy || options.length <= MIN_PROPOSAL_OPTIONS}
                    aria-label={`Remove choice ${index + 1}`}
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.daoDialog__linkButton}
                onClick={() => setOptions((current) => [...current, ''])}
                disabled={isBusy || options.length >= MAX_PROPOSAL_OPTIONS}
              >
                <PlusIcon size={14} weight="bold" />
                Add a choice
              </button>
              <span className={styles.daoDialog__hint}>The choice with the most votes wins, if enough people vote and there’s no tie.</span>
            </div>
          )}

          <button type="submit" className={styles.daoDialog__submit} disabled={isBusy || belowThreshold}>
            {isBusy && <Spinner size={16} color="currentColor" />}
            {isUploading ? 'Uploading…' : busy === 'propose' ? 'Posting…' : 'Post proposal'}
          </button>
        </form>
      </div>
    </NativeDialog>
  )
})

export default CreateProposalModal
