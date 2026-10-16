'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { parseEventLogs, parseUnits } from 'viem'
import { useConnection } from 'wagmi'
import {
  MAX_BPS,
  MAX_MEMBER_BATCH,
  VOTING_DELAYS,
  VOTING_MODE,
  VOTING_MODE_OPTIONS,
  VOTING_PERIODS,
  daoChains,
  isAddress,
  parseAddressList,
} from '@/lib/dao'
import { uploadObjectToIPFS, withAuthor } from '@/lib/ipfs'
import { usePaymentToken } from '@/hooks/usePaymentToken'
import daoAbi from '@/abis/HupDao.json'
import { toast } from '@/components/NextToast'
import { Spinner } from '@/components/Loading'
import NativeDialog from '@/components/ui/NativeDialog'
import ImagePicker from '@/app/communities/_components/ImagePicker'
import { XIcon } from '@phosphor-icons/react'
import { useDaoWrite } from './useDao'
import styles from './DaoDialog.module.scss'

const MAX_NAME_LENGTH = 60
const MAX_DESCRIPTION_LENGTH = 1000

/**
 * Create DAO
 * Opens a standalone DAO: who votes (staked tokens, a votes token, or members), how long a vote
 * runs, and how much of the electorate has to take part. Name and description go to IPFS; the
 * contract stores only the CID.
 * @param {Object} props
 * @param {Function} props.onCreated Called with { daoId, chainId } once confirmed.
 */
const CreateDaoModal = forwardRef(function CreateDaoModal({ onCreated }, ref) {
  const dialogRef = useRef(null)
  const { address, chain: walletChain } = useConnection()
  const chains = useMemo(() => daoChains(), [])
  const [chainId, setChainId] = useState(() => chains[0]?.id ?? null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [image, setImage] = useState('')
  const [mode, setMode] = useState(VOTING_MODE.Staked)
  const [tokenAddress, setTokenAddress] = useState('')
  const [members, setMembers] = useState('')
  const [includeSelf, setIncludeSelf] = useState(true)
  const [period, setPeriod] = useState(VOTING_PERIODS[1].seconds)
  const [delay, setDelay] = useState(VOTING_DELAYS[0].seconds)
  const [quorumPercent, setQuorumPercent] = useState('10')
  const [threshold, setThreshold] = useState('1')
  const [isUploading, setIsUploading] = useState(false)

  const { send, busy } = useDaoWrite(chainId)
  const isBusy = isUploading || busy === 'create'
  const needsToken = mode !== VOTING_MODE.Members
  const token = usePaymentToken(chainId, needsToken ? tokenAddress.trim() : undefined)

  const memberList = useMemo(() => {
    const list = parseAddressList(members)
    const self = address?.toLowerCase()
    if (includeSelf && self && !list.includes(self)) list.unshift(self)
    return list
  }, [members, includeSelf, address])

  useImperativeHandle(ref, () => ({
    open: () => {
      // Follow the wallet when it already sits on a chain with DAOs
      if (walletChain?.id && chains.some((chain) => chain.id === walletChain.id)) setChainId(walletChain.id)
      dialogRef.current?.open()
    },
    close: () => dialogRef.current?.close(),
  }))

  const resetForm = () => {
    setName('')
    setDescription('')
    setImage('')
    setMode(VOTING_MODE.Staked)
    setTokenAddress('')
    setMembers('')
    setIncludeSelf(true)
    setPeriod(VOTING_PERIODS[1].seconds)
    setDelay(VOTING_DELAYS[0].seconds)
    setQuorumPercent('10')
    setThreshold('1')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      toast('Give your group a name', 'error')
      return
    }

    const quorum = Number(quorumPercent)
    if (!Number.isFinite(quorum) || quorum < 0 || quorum > 100) {
      toast('Turnout must be between 0 and 100%', 'error')
      return
    }

    if (needsToken) {
      if (!isAddress(tokenAddress)) {
        toast('Paste the token contract address', 'error')
        return
      }
      if (!token.exists) {
        toast('No token found at that address on this network', 'error')
        return
      }
    } else if (memberList.length === 0) {
      toast('Add at least one member', 'error')
      return
    } else if (memberList.length > MAX_MEMBER_BATCH) {
      toast(`Start with up to ${MAX_MEMBER_BATCH} members — you can add more later`, 'error')
      return
    }

    const decimals = needsToken ? token.decimals ?? 18 : 0
    let thresholdUnits
    try {
      thresholdUnits = parseUnits(String(threshold || '0'), decimals)
    } catch {
      toast('Votes needed to post must be a number', 'error')
      return
    }

    setIsUploading(true)
    let cid
    try {
      cid = await uploadObjectToIPFS(
        withAuthor({ name: trimmedName, description: description.trim(), ...(image ? { image } : {}) }, address),
      )
    } catch (err) {
      toast(err.message || 'Failed to upload the group details', 'error')
      setIsUploading(false)
      return
    }
    setIsUploading(false)

    const settings = {
      votingDelay: Number(delay),
      votingPeriod: Number(period),
      quorumBps: Math.round((quorum / 100) * MAX_BPS),
      proposalThreshold: thresholdUnits,
    }

    const receipt = await send(
      'create',
      {
        functionName: 'createDao',
        args: [
          mode,
          needsToken ? tokenAddress.trim() : '0x0000000000000000000000000000000000000000',
          mode === VOTING_MODE.Staked && token.looksLsp7,
          settings,
          cid,
          mode === VOTING_MODE.Members ? memberList : [],
        ],
      },
      { success: 'Your group is live', failure: 'Could not create the group' },
    )
    if (!receipt) return

    const [created] = parseEventLogs({ abi: daoAbi, eventName: 'DaoCreated', logs: receipt.logs })
    resetForm()
    dialogRef.current?.close()
    onCreated?.(created ? { daoId: created.args.daoId.toString(), chainId } : undefined)
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.daoDialog}
      aria-label="Start a group"
      onCancel={(event) => {
        // Esc must not drop the form while the upload or transaction is in flight
        if (isBusy) event.preventDefault()
      }}
    >
      <div className={styles.daoDialog__body}>
        <header className={styles.daoDialog__header}>
          <h3>New group</h3>
          <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close" className={styles.daoDialog__close}>
            <XIcon size={18} />
          </button>
        </header>

        {chains.length === 0 && <p className={styles.daoDialog__intro}>Proposals aren&apos;t available on any network yet.</p>}

        <form onSubmit={handleSubmit} className={styles.daoDialog__form}>
          {chains.length > 1 && (
            <label className={styles.daoDialog__field}>
              <span className={styles.daoDialog__label}>Network</span>
              <select value={chainId ?? ''} onChange={(e) => setChainId(Number(e.target.value))} disabled={isBusy}>
                {chains.map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className={styles.daoDialog__field}>
            <span className={styles.daoDialog__label}>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Builders Collective"
              maxLength={MAX_NAME_LENGTH}
              disabled={isBusy}
              required
            />
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

          <ImagePicker
            label="Image"
            value={image}
            onChange={setImage}
            fieldClassName={styles.daoDialog__field}
            labelClassName={styles.daoDialog__label}
          />

          <fieldset className={styles.daoDialog__modes} disabled={isBusy}>
            <legend className={styles.daoDialog__label}>Who votes</legend>
            {VOTING_MODE_OPTIONS.map((option) => (
              <label key={option.value} className={clsx(styles.daoDialog__mode, mode === option.value && styles['daoDialog__mode--selected'])}>
                <input type="radio" name="dao-mode" checked={mode === option.value} onChange={() => setMode(option.value)} />
                <span className={styles.daoDialog__modeText}>
                  <strong>{option.label}</strong>
                  <span>{option.note}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {needsToken && (
            <label className={styles.daoDialog__field}>
              <span className={styles.daoDialog__label}>Token address</span>
              <input
                type="text"
                value={tokenAddress}
                onChange={(e) => setTokenAddress(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
                disabled={isBusy}
              />
              {isAddress(tokenAddress) && (
                <span
                  className={clsx(
                    styles.daoDialog__hint,
                    token.exists && styles['daoDialog__hint--ok'],
                    !token.exists && !token.isLoading && styles['daoDialog__hint--error'],
                  )}
                >
                  {token.isLoading
                    ? 'Checking token…'
                    : token.exists
                      ? `${token.symbol || 'Token'} · ${token.decimals} decimals${token.looksLsp7 ? ' · LSP7' : ''}`
                      : 'No token found at this address on this network'}
                </span>
              )}
              {mode === VOTING_MODE.VotesToken && (
                <span className={styles.daoDialog__hint}>Only works with tokens that count votes (ERC20Votes or LSP7Votes).</span>
              )}
            </label>
          )}

          {mode === VOTING_MODE.Members && (
            <label className={styles.daoDialog__field}>
              <span className={styles.daoDialog__label}>Members</span>
              <textarea
                value={members}
                onChange={(e) => setMembers(e.target.value)}
                placeholder="One address per line"
                spellCheck={false}
                disabled={isBusy}
              />
              <span className={styles.daoDialog__hint}>
                {memberList.length} {memberList.length === 1 ? 'member' : 'members'} · up to {MAX_MEMBER_BATCH} now, more later
              </span>
              <span className={styles.daoDialog__check}>
                <input id="dao-include-self" type="checkbox" checked={includeSelf} onChange={(e) => setIncludeSelf(e.target.checked)} disabled={isBusy} />
                <label htmlFor="dao-include-self">Include me as a member</label>
              </span>
            </label>
          )}

          <div className={styles.daoDialog__row}>
            <label className={styles.daoDialog__field}>
              <span className={styles.daoDialog__label}>Voting lasts</span>
              <select value={period} onChange={(e) => setPeriod(Number(e.target.value))} disabled={isBusy}>
                {VOTING_PERIODS.map((option) => (
                  <option key={option.seconds} value={option.seconds}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.daoDialog__field}>
              <span className={styles.daoDialog__label}>Voting opens</span>
              <select value={delay} onChange={(e) => setDelay(Number(e.target.value))} disabled={isBusy}>
                {VOTING_DELAYS.map((option) => (
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
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={quorumPercent}
                onChange={(e) => setQuorumPercent(e.target.value)}
                disabled={isBusy}
              />
            </label>

            <label className={styles.daoDialog__field}>
              <span className={styles.daoDialog__label}>Votes needed to post</span>
              <input type="number" min="0" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={isBusy} />
            </label>
          </div>
          <span className={styles.daoDialog__hint}>
            How much of all votes must be cast for a result to count. These rules apply to new proposals, and you can change
            them later.
          </span>

          <button type="submit" className={styles.daoDialog__submit} disabled={isBusy || !chainId || !address}>
            {isBusy && <Spinner size={16} color="currentColor" />}
            {isUploading ? 'Uploading…' : busy === 'create' ? 'Creating…' : address ? 'Create group' : 'Connect a wallet'}
          </button>
        </form>
      </div>
    </NativeDialog>
  )
})

export default CreateDaoModal
