'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { zeroAddress } from 'viem'
import { VOTING_MODE, isAddress, sameAddress, shortAddress } from '@/lib/dao'
import { toast } from '@/components/NextToast'
import { Spinner } from '@/components/Loading'
import NativeDialog from '@/components/ui/NativeDialog'
import { XIcon } from '@phosphor-icons/react'
import { useDaoWrite } from './useDao'
import styles from './DaoDialog.module.scss'

// ERC20Votes and LSP7Votes share this entry point
const votesTokenAbi = [
  { name: 'delegate', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'delegatee', type: 'address' }], outputs: [] },
]

/**
 * Delegate
 * Hands the viewer's voting power to someone else, or takes it back. Staked and Members DAOs
 * delegate on HupDao, per DAO. A votes-token DAO delegates on the token, which carries over to
 * every DAO that reads that token.
 * @param {Object} props
 * @param {number} props.chainId
 * @param {Object} props.dao Onchain DAO record.
 * @param {string} props.currentDelegate Who the viewer's power sits with now.
 * @param {Function} props.onDone Called after a confirmed change.
 */
const DelegateModal = forwardRef(function DelegateModal({ chainId, dao, currentDelegate, onDone }, ref) {
  const dialogRef = useRef(null)
  const [target, setTarget] = useState('')
  const { send, busy, account } = useDaoWrite(chainId)
  const onToken = Number(dao?.mode) === VOTING_MODE.VotesToken
  const delegatedAway = Boolean(currentDelegate) && !sameAddress(currentDelegate, account) && !sameAddress(currentDelegate, zeroAddress)

  useImperativeHandle(ref, () => ({
    open: (prefill = '') => {
      setTarget(prefill)
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  const submit = async (delegatee) => {
    const call = onToken
      ? { address: dao.token, abi: votesTokenAbi, functionName: 'delegate', args: [delegatee] }
      : { functionName: 'delegate', args: [dao.id, delegatee] }
    const toSelf = sameAddress(delegatee, account)
    const receipt = await send('delegate', call, {
      success: toSelf ? 'Your votes are back with you' : `${shortAddress(delegatee)} now votes for you`,
      failure: 'Could not save that',
    })
    if (receipt) {
      dialogRef.current?.close()
      onDone?.()
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!isAddress(target)) {
      toast('Paste a wallet address', 'error')
      return
    }
    submit(target.trim())
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.daoDialog}
      aria-label="Let someone vote for you"
      lightDismiss={!busy}
      onCancel={(event) => {
        if (busy) event.preventDefault()
      }}
    >
      <div className={styles.daoDialog__body}>
        <header className={styles.daoDialog__header}>
          <h3>Let someone vote for you</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.daoDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        <p className={styles.daoDialog__intro}>
          They vote with your votes on proposals posted after this. You can change who, or take your votes back, any time.
          {onToken && ' This group uses a voting token, so this is saved on the token and applies everywhere that token votes.'}
        </p>

        <div className={styles.daoDialog__summary}>
          <div>
            <span>Votes for you now</span>
            <strong>{delegatedAway ? shortAddress(currentDelegate) : onToken && !currentDelegate ? 'Nobody (votes off)' : 'You'}</strong>
          </div>
        </div>

        <form onSubmit={handleSubmit} className={styles.daoDialog__form}>
          <label className={styles.daoDialog__field}>
            <span className={styles.daoDialog__label}>Their wallet address</span>
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              disabled={Boolean(busy)}
            />
          </label>

          <button type="submit" className={styles.daoDialog__submit} disabled={Boolean(busy) || !isAddress(target)}>
            {busy && <Spinner size={16} color="currentColor" />}
            {busy ? 'Saving…' : 'Let them vote for me'}
          </button>

          {/* A votes token counts nothing until its holder delegates, even to themselves */}
          {(delegatedAway || onToken) && account && (
            <button type="button" className={styles.daoDialog__linkButton} onClick={() => submit(account)} disabled={Boolean(busy)}>
              {onToken && !delegatedAway ? 'Turn on my votes' : 'Take my votes back'}
            </button>
          )}
        </form>
      </div>
    </NativeDialog>
  )
})

export default DelegateModal
