'use client'

import { useEffect, useRef, useState } from 'react'
import { erc20Abi, isAddress, parseEventLogs, parseUnits, zeroAddress } from 'viem'
import { usePaymentToken } from '@/hooks/usePaymentToken'
import { appChains } from '@/config/contracts'
import { EMPTY_PAYMENT } from '@/lib/communityGovernance'
import { uploadObjectToIPFS, withAuthor } from '@/lib/ipfs'
import governanceAbi from '@/abis/HupCommunityGovernance.json'
import NativeDialog from '@/components/ui/NativeDialog'
import { Spinner } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import TokenAssetInput from '@/app/communities/_components/TokenAssetInput'
import styles from './CommunityGovernance.module.scss'
import dialogStyles from './CommunityDialog.module.scss'

const lsp7OperatorAbi = [{ type: 'function', name: 'authorizeOperator', stateMutability: 'nonpayable', inputs: [{ name: 'operator', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'data', type: 'bytes' }], outputs: [] }]

export default function CommunityVotingDialogs({ kind, chainId, communityId, rules, writer, onDone, onExited }) {
  const dialogRef = useRef(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [proposalType, setProposalType] = useState('signal')
  const [choices, setChoices] = useState('')
  const [asset, setAsset] = useState('')
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [uploading, setUploading] = useState(false)
  const minPeriod = Number(rules?.minVotingPeriod ?? 3600)
  const maxPeriod = Number(rules?.maxVotingPeriod ?? 7776000)
  const [votingPeriod, setVotingPeriod] = useState(() => String(Math.max(minPeriod, Math.min(259200, maxPeriod)) / 3600))
  const [minVotingPeriod, setMinVotingPeriod] = useState(String(minPeriod / 3600))
  const [maxVotingPeriod, setMaxVotingPeriod] = useState(String(maxPeriod / 3600))
  const initialDelay = Number(rules?.votingDelay ?? 0)
  const [delayUnit, setDelayUnit] = useState(initialDelay % 86400 === 0 ? 'days' : 'hours')
  const [votingDelay, setVotingDelay] = useState(String(initialDelay / (initialDelay % 86400 === 0 ? 86400 : 3600)))
  const [executionDelay, setExecutionDelay] = useState(String(Number(rules?.executionDelay ?? 172800) / 3600))
  const [minimumVotes, setMinimumVotes] = useState(String(rules?.minimumVotes ?? 1))
  const [approval, setApproval] = useState(String(Number(rules?.approvalBps ?? 5001) / 100))
  const native = !asset.trim()
  const token = usePaymentToken(chainId, native ? undefined : asset.trim())
  const currency = appChains.find((chain) => chain.id === chainId)?.nativeCurrency
  const decimals = native ? currency?.decimals ?? 18 : token.decimals
  const symbol = native ? currency?.symbol : token.symbol
  const busy = uploading || Boolean(writer.busy)
  const titles = { propose: 'New community proposal', rules: 'Voting rules', deposit: 'Fund community treasury' }
  const id = BigInt(communityId)

  useEffect(() => { dialogRef.current?.open() }, [])

  const paymentAmount = () => {
    if (!native && (!isAddress(asset.trim()) || !token.exists || decimals === null)) throw new Error('Choose a valid token')
    const value = parseUnits(amount, decimals)
    if (value <= 0n) throw new Error('Enter an amount greater than zero')
    return value
  }

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    try {
      let receipt
      if (kind === 'rules') {
        const hours = [Number(votingDelay) * (delayUnit === 'days' ? 24 : 1), minVotingPeriod, maxVotingPeriod, executionDelay].map(Number)
        if (hours.some((value) => !Number.isFinite(value) || !Number.isInteger(value * 3600))) throw new Error('Enter valid durations')
        if (hours[0] < 0 || hours[0] > 720) throw new Error('The reading period must be between 0 and 30 days')
        if (hours[1] < 1 || hours[2] > 2160 || hours[1] > hours[2]) throw new Error('Voting duration limits must be ordered between 1 and 2160 hours')
        const turnout = Number(minimumVotes)
        if (!Number.isInteger(turnout) || turnout < 1 || turnout > 4294967295) throw new Error('Minimum turnout must be a positive whole number')
        const nextRules = { votingDelay: hours[0] * 3600, minVotingPeriod: hours[1] * 3600, maxVotingPeriod: hours[2] * 3600, executionDelay: hours[3] * 3600, minimumVotes: turnout, approvalBps: Math.round(Number(approval) * 100) }
        receipt = await writer.send('rules', { functionName: 'updateRules', args: [id, nextRules] }, 'Voting rules saved')
      } else if (kind === 'deposit') {
        const value = paymentAmount()
        if (native) {
          receipt = await writer.send('deposit', { functionName: 'depositNative', args: [id], value }, 'Treasury funded')
        } else {
          const authorized = await writer.send('authorize', {
            address: asset.trim(),
            abi: token.looksLsp7 ? lsp7OperatorAbi : erc20Abi,
            functionName: token.looksLsp7 ? 'authorizeOperator' : 'approve',
            args: token.looksLsp7 ? [writer.address, value, '0x'] : [writer.address, value],
          }, 'Token spending authorized')
          if (!authorized) return
          receipt = await writer.send('deposit', { functionName: 'depositToken', args: [id, asset.trim(), value, token.looksLsp7] }, 'Treasury funded')
        }
      } else {
        if (!title.trim()) throw new Error('Enter a proposal title')
        const period = Number(votingPeriod) * 3600
        if (!Number.isInteger(period) || period < minPeriod || period > maxPeriod) throw new Error(`Choose a voting duration between ${minPeriod / 3600} and ${maxPeriod / 3600} hours`)
        const labels = choices.split('\n').map((value) => value.trim()).filter(Boolean)
        const multipleChoice = proposalType === 'choice'
        if (multipleChoice && (labels.length < 2 || labels.length > 8 || new Set(labels.map((label) => label.toLowerCase())).size !== labels.length)) throw new Error('Enter 2–8 different choices, one per line')
        let payment = EMPTY_PAYMENT
        if (proposalType === 'spending') {
          if (!isAddress(recipient.trim()) || recipient.trim().toLowerCase() === zeroAddress) throw new Error('Enter a valid recipient wallet')
          payment = { asset: native ? zeroAddress : asset.trim(), recipient: recipient.trim(), amount: paymentAmount(), isLsp7: !native && token.looksLsp7 }
        }
        setUploading(true)
        const cid = await uploadObjectToIPFS(withAuthor({ title: title.trim(), body: body.trim(), ...(multipleChoice ? { options: labels } : {}) }, writer.account))
        setUploading(false)
        receipt = await writer.send('propose', { functionName: 'propose', args: [id, cid, multipleChoice ? labels.length : 0, period, payment] }, 'Proposal created')
      }
      if (!receipt) return
      const created = kind === 'propose' ? parseEventLogs({ abi: governanceAbi, eventName: 'ProposalCreated', logs: receipt.logs }).find((log) => log.address.toLowerCase() === writer.address.toLowerCase()) : null
      dialogRef.current?.close()
      onDone?.(created?.args?.proposalId?.toString())
    } catch (error) {
      toast(error.message || 'Could not complete the action', 'error')
    } finally {
      setUploading(false)
    }
  }

  const assetFields = (
    <>
      <div className={styles.governance__field}>
        <span>Asset (blank for {currency?.symbol || 'native currency'})</span>
        <TokenAssetInput chainId={chainId} value={asset} onChange={setAsset} />
        {!native && <span>{token.isLoading ? 'Checking token…' : token.exists ? `${token.looksLsp7 ? 'LSP7' : 'ERC20'} · ${token.symbol}` : 'Choose a valid token'}</span>}
      </div>
      <label className={styles.governance__field}>Amount {symbol && `(${symbol})`}<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required disabled={busy} /></label>
    </>
  )

  return (
    <NativeDialog ref={dialogRef} className={dialogStyles.communityDialog} aria-label={titles[kind]} onExited={onExited} onClose={(event) => event.stopPropagation()} onCancel={(event) => { event.stopPropagation(); if (busy) event.preventDefault() }}>
      <div className={dialogStyles.communityDialog__body}>
        <header className={dialogStyles.communityDialog__header}><h3>{titles[kind]}</h3><button type="button" className={dialogStyles.communityDialog__close} disabled={busy} onClick={() => dialogRef.current?.close()} aria-label="Close">×</button></header>
        <form className={dialogStyles.communityDialog__form} onSubmit={submit}>
          {kind === 'rules' ? (
            <>
              <p className={styles.governance__muted}>Only the community owner can change these rules. Existing proposals keep their original rules. All members can propose and get one vote.</p>
              <label className={styles.governance__field}>Minimum voting duration (hours)<input type="number" min="1" max={maxVotingPeriod || 2160} step="any" value={minVotingPeriod} onChange={(event) => setMinVotingPeriod(event.target.value)} required disabled={busy} /></label>
              <label className={styles.governance__field}>Maximum voting duration (hours)<input type="number" min={minVotingPeriod || 1} max="2160" step="any" value={maxVotingPeriod} onChange={(event) => setMaxVotingPeriod(event.target.value)} required disabled={busy} /></label>
              <p className={styles.governance__muted}>Members choose each proposal’s duration within these limits. Existing proposals keep their closing times.</p>
              <label className={styles.governance__field}>Delay before voting ({delayUnit})<input type="number" min="0" max={delayUnit === 'days' ? 30 : 720} step="any" value={votingDelay} onChange={(event) => setVotingDelay(event.target.value)} required disabled={busy} /></label>
              <label className={styles.governance__field}>Delay unit<select value={delayUnit} disabled={busy} onChange={(event) => {
                const nextUnit = event.target.value
                if (votingDelay !== '') setVotingDelay(String(Number(votingDelay) * (delayUnit === 'days' ? 24 : 1) / (nextUnit === 'days' ? 24 : 1)))
                setDelayUnit(nextUnit)
              }}><option value="hours">Hours</option><option value="days">Days</option></select></label>
              <p className={styles.governance__muted}>Members can read and discuss a proposal during this period. Voting opens after the delay, then runs for the duration chosen by its creator. Set 0 to open voting immediately.</p>
              <label className={styles.governance__field}>Delay before payment (hours)<input type="number" min="1" max="720" step="any" value={executionDelay} onChange={(event) => setExecutionDelay(event.target.value)} required disabled={busy} /></label>
              <label className={styles.governance__field}>Minimum votes required<input type="number" min="1" max="4294967295" step="1" value={minimumVotes} onChange={(event) => setMinimumVotes(event.target.value)} required disabled={busy} /></label>
              <label className={styles.governance__field}>Approval required (%)<input type="number" min="50.01" max="100" step="0.01" value={approval} onChange={(event) => setApproval(event.target.value)} required disabled={busy} /></label>
              <p className={styles.governance__muted}>Abstentions count toward turnout. Binary approval excludes abstentions. Multiple-choice proposals need one choice to meet the approval percentage.</p>
            </>
          ) : kind === 'deposit' ? (
            <>{assetFields}<p className={styles.governance__muted}>Deposits belong to this community. Funds leave only through an approved spending proposal. Token funding requires authorization followed by a deposit.</p></>
          ) : (
            <>
              <label className={styles.governance__field}>Title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} required disabled={busy} /></label>
              <label className={styles.governance__field}>Purpose and details<textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={10000} rows={5} disabled={busy} /></label>
              <label className={styles.governance__field}>Voting duration (hours)<input type="number" min={minPeriod / 3600} max={maxPeriod / 3600} step="any" value={votingPeriod} onChange={(event) => setVotingPeriod(event.target.value)} required disabled={busy} /><span>Choose {minPeriod / 3600}–{maxPeriod / 3600} hours. The duration is fixed when you submit.</span></label>
              <label className={styles.governance__field}>Proposal type<select value={proposalType} onChange={(event) => setProposalType(event.target.value)} disabled={busy}><option value="signal">Yes / No / Abstain</option><option value="choice">Multiple choice</option><option value="spending">Treasury payment</option></select></label>
              {proposalType === 'choice' && <label className={styles.governance__field}>Choices (one per line, 2–8)<textarea value={choices} onChange={(event) => setChoices(event.target.value)} rows={4} maxLength={1000} required disabled={busy} /></label>}
              {proposalType === 'spending' && <>{assetFields}<label className={styles.governance__field}>Recipient wallet<input value={recipient} onChange={(event) => setRecipient(event.target.value)} required disabled={busy} /></label><p className={styles.governance__muted}>The asset, amount, and recipient are fixed when you submit. Payment can be executed after this proposal passes and its execution delay ends.</p></>}
            </>
          )}
          <button type="submit" className={styles.governance__button} disabled={busy || ((kind === 'deposit' || proposalType === 'spending') && !native && (!token.exists || token.isLoading))}>
            {busy && <Spinner size={16} color="currentColor" />}
            {uploading ? 'Uploading…' : writer.busy === 'authorize' ? 'Authorizing…' : busy ? 'Confirming…' : kind === 'rules' ? 'Save voting rules' : kind === 'deposit' ? 'Deposit funds' : 'Create proposal'}
          </button>
        </form>
      </div>
    </NativeDialog>
  )
}
