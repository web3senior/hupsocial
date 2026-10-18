'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import clsx from 'clsx'
import { chainNameFor, parseProposalLink, proposalPath } from '@/lib/communityProposal'
import { governanceAddressFor } from '@/lib/communityGovernance'
import NativeDialog from '@/components/ui/NativeDialog'
import ProposalEmbed from '@/components/ProposalEmbed'
import { XIcon } from '@phosphor-icons/react'
import styles from './CommunityDialog.module.scss'

/**
 * Attach proposal
 * Picks a proposal for the composer by its link — the one every proposal page shares, and what
 * "Share to feed" pre-fills. Shows the card exactly as the feed will before it is attached.
 * Rendered inside the composer's own dialog, so its close/cancel events stop here.
 * @param {Object} props
 * @param {Object|null} props.value The proposal currently attached, if any.
 * @param {Function} props.onAttach Called with the reference, or null to remove it.
 */
const AttachProposalDialog = forwardRef(function AttachProposalDialog({ value, onAttach }, ref) {
  const dialogRef = useRef(null)
  const [link, setLink] = useState('')

  useImperativeHandle(ref, () => ({
    open: () => {
      setLink(value ? proposalPath(value) : '')
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  const reference = parseProposalLink(link)
  const supported = reference && Boolean(governanceAddressFor(reference.chainId))

  const attach = () => {
    if (!supported) return
    onAttach?.(reference)
    dialogRef.current?.close()
  }

  const remove = () => {
    onAttach?.(null)
    dialogRef.current?.close()
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.communityDialog}
      aria-label="Attach a proposal"
      onClick={(event) => event.stopPropagation()}
      // React's synthetic close/cancel bubble up to the composer's dialog and would close it too
      onClose={(event) => event.stopPropagation()}
      onCancel={(event) => event.stopPropagation()}
    >
      <div className={styles.communityDialog__body}>
        <header className={styles.communityDialog__header}>
          <h3>Attach a proposal</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.communityDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        <p className={styles.communityDialog__intro}>
          Paste a proposal&apos;s link. Readers see its live results and can tap through to vote. Tip: “Share to feed” on any proposal does
          this for you.
        </p>

        <form
          className={styles.communityDialog__form}
          onSubmit={(event) => {
            event.preventDefault()
            attach()
          }}
        >
          <label className={styles.communityDialog__field}>
            <span className={styles.communityDialog__label}>Proposal link</span>
            <input
              type="text"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://hup.social/communities/42/1/proposals/1"
              spellCheck={false}
              autoComplete="off"
            />
            {link.trim() && !reference && (
              <span className={clsx(styles.communityDialog__hint, styles['communityDialog__hint--error'])}>That isn&apos;t a proposal link.</span>
            )}
            {reference && !supported && (
              <span className={clsx(styles.communityDialog__hint, styles['communityDialog__hint--error'])}>
                Proposals aren&apos;t available on {chainNameFor(reference.chainId)}.
              </span>
            )}
          </label>

          {/* Keyed by the reference so a new link remounts the card instead of flashing the old one */}
          {supported && <ProposalEmbed key={proposalPath(reference)} proposalRef={reference} preview />}

          <button type="submit" className={styles.communityDialog__submit} disabled={!supported}>
            Attach proposal
          </button>

          {value && (
            <button type="button" className={clsx(styles.communityDialog__linkButton, styles['communityDialog__linkButton--danger'])} onClick={remove}>
              Remove from post
            </button>
          )}
        </form>
      </div>
    </NativeDialog>
  )
})

export default AttachProposalDialog
