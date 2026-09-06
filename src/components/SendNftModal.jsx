'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import clsx from 'clsx'
import { appChains } from '@/config/contracts'
import { normalizeAddress } from '@/lib/walletAssets'
import { resolveStorageImageUrl } from '@/lib/storageHelper'
import { EMPTY_RECIPIENT, rememberRecipient } from '@/lib/recipientSearch'
import { toast } from '@/components/NextToast'
import NativeDialog from './ui/NativeDialog'
import RecipientField from './ui/RecipientField'
import styles from './SendNftModal.module.scss'

// LSP8 mirrors LSP7's transfer, with a bytes32 token id in place of an amount. `force` is true
// for the same reason: unforced, the token refuses any recipient that isn't an LSP1-aware
// contract, which would reject every plain EOA.
const lsp8Abi = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'bytes32' },
      { name: 'force', type: 'bool' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
]

const erc721Abi = [
  {
    type: 'function',
    name: 'safeTransferFrom',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
]

/**
 * SendNftModal
 * Wallet-to-wallet transfer of a single NFT. LSP8 takes the bytes32 id the index already hands
 * back; ERC721 takes the same id widened to uint256.
 *
 * The dialog stays open, locked, from the wallet prompt to the receipt, and closes itself once
 * the transfer has landed. Mount = open / unmount = close, matching the other dialogs.
 *
 * @param {Object} props
 * @param {Object} props.nft The token, the way the gallery and detail panel hand it over.
 * @param {string} props.owner The wallet that holds it — the connected wallet has to match.
 * @param {Function} [props.onSent] Called once the transfer confirmed, so lists re-read.
 * @param {Function} [props.onClose]
 */
export default function SendNftModal({ nft, owner, onSent, onClose }) {
  const dialogRef = useRef(null)
  const { address, chain: walletChain } = useConnection()
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId: nft.chainId })

  const [recipient, setRecipient] = useState(EMPTY_RECIPIENT)
  // Which wait the button names: null idle, 'wallet' awaiting the signature, 'mining' the receipt
  const [phase, setPhase] = useState(null)

  const chain = useMemo(() => appChains.find((item) => item.id === nft.chainId), [nft.chainId])
  const recipientAddress = recipient.address
  const wrongChain = Boolean(walletChain) && walletChain.id !== nft.chainId
  const isBusy = phase !== null || isSwitching
  const canSubmit = Boolean(recipientAddress) && !isBusy
  const image = nft.image ? resolveStorageImageUrl(nft.image, { width: 320 }) : null

  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canSubmit) return

    const sender = normalizeAddress(address)
    if (!sender || sender !== normalizeAddress(owner)) {
      toast('Connect the wallet that holds this NFT to send it', 'error')
      return
    }

    const to = recipientAddress
    setPhase('wallet')

    try {
      if (wrongChain) await switchChainAsync({ chainId: nft.chainId })

      const hash = nft.isLsp8
        ? await writeContractAsync({
            address: nft.address,
            abi: lsp8Abi,
            functionName: 'transfer',
            args: [sender, to, nft.tokenId, true, '0x'],
            chainId: nft.chainId,
          })
        : await writeContractAsync({
            address: nft.address,
            abi: erc721Abi,
            functionName: 'safeTransferFrom',
            // The gallery stores every id as bytes32; ERC721 wants the same value as a number
            args: [sender, to, BigInt(nft.tokenId)],
            chainId: nft.chainId,
          })

      // viem hands back a reverted receipt rather than throwing, so the status is the verdict
      setPhase('mining')
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status === 'reverted') throw new Error('The transfer failed onchain')

      toast(`Sent ${nft.name}`, 'success')
      // Only a confirmed transfer earns a place in the recipient shortlist
      rememberRecipient(owner, { address: to, ...recipient.profile })
      onSent?.()
      dialogRef.current?.close()
    } catch (error) {
      toast(error?.shortMessage || error?.message || 'Transaction rejected', 'error')
      setPhase(null)
    }
  }

  const label = isSwitching ? 'Switching network…' : phase === 'wallet' ? 'Confirm in wallet…' : phase === 'mining' ? 'Sending…' : 'Send'

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.sendNft}
      aria-label={`Send ${nft.name}`}
      onClick={(event) => event.stopPropagation()}
      // React's synthetic close/cancel bubble where the native events don't — without this,
      // dismissing this dialog from inside another one (the token detail panel's Transfer)
      // would close its host too. Esc is also refused mid-transfer: there is nothing to go back to.
      onCancel={(event) => {
        event.stopPropagation()
        if (isBusy) event.preventDefault()
      }}
      onClose={(event) => {
        event.stopPropagation()
        onClose?.()
      }}
    >
      <header className={styles.sendNft__header}>
        <button type="button" className={styles.sendNft__cancel} onClick={() => dialogRef.current?.close()} disabled={isBusy}>
          Cancel
        </button>
        <h2 className={styles.sendNft__title}>Send NFT</h2>
      </header>

      <form className={styles.sendNft__body} onSubmit={handleSubmit}>
        <div className={styles.sendNft__preview}>
          <span className={styles.sendNft__art}>
            {image ? <img src={image} alt="" /> : <span className={styles.sendNft__artFallback} aria-hidden="true" />}
          </span>
          <div className={styles.sendNft__identity}>
            <span className={styles.sendNft__name}>{nft.name}</span>
            {nft.collection && <span className={styles.sendNft__collection}>{nft.collection}</span>}
            {nft.label && <span className={styles.sendNft__tokenId}>#{nft.label}</span>}
          </div>
        </div>

        <RecipientField
          id="sendNftRecipient"
          label="Recipient"
          value={recipient}
          onChange={setRecipient}
          viewer={owner}
          exclude={[owner]}
          disabled={isBusy}
        />

        <p className={styles.sendNft__hint}>Sending an NFT is final — it cannot be undone from here.</p>

        {wrongChain && chain && <p className={styles.sendNft__hint}>Your wallet will be asked to switch to {chain.name} first.</p>}

        <button type="submit" className={clsx(styles.sendNft__submit, 'w-100')} disabled={!canSubmit}>
          {label}
        </button>
      </form>
    </NativeDialog>
  )
}
