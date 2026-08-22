'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
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
 * Wallet-to-wallet transfer of a single NFT from the profile Assets tab. LSP8 takes the bytes32
 * id the index already hands back; ERC721 takes the same id widened to uint256.
 *
 * Mount = open / unmount = close, matching the other dialogs.
 */
export default function SendNftModal({ nft, owner, onSent, onClose }) {
  const dialogRef = useRef(null)
  const { address, chain: walletChain } = useConnection()
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const [recipient, setRecipient] = useState(EMPTY_RECIPIENT)
  const [hash, setHash] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash, chainId: nft.chainId })

  const chain = useMemo(() => appChains.find((item) => item.id === nft.chainId), [nft.chainId])
  const recipientAddress = recipient.address
  const wrongChain = Boolean(walletChain) && walletChain.id !== nft.chainId
  const isBusy = isSubmitting || isSwitching || isConfirming
  const canSubmit = Boolean(recipientAddress) && !isBusy
  const image = nft.image ? resolveStorageImageUrl(nft.image, { width: 320 }) : null

  useEffect(() => {
    dialogRef.current?.open()
  }, [])

  useEffect(() => {
    if (!isConfirmed) return
    toast(`Sent ${nft.name}`, 'success')
    // Only a confirmed transfer earns a place in the recipient shortlist
    rememberRecipient(owner, { address: recipientAddress, ...recipient.profile })
    onSent?.()
    dialogRef.current?.close()
    // Firing on confirmation only — re-running on the nft identity would double-toast
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canSubmit) return

    const sender = normalizeAddress(address)
    if (!sender || sender !== normalizeAddress(owner)) {
      toast('Connect the wallet that holds this NFT to send it', 'error')
      return
    }

    setIsSubmitting(true)
    try {
      if (wrongChain) await switchChainAsync({ chainId: nft.chainId })

      const submitted = nft.isLsp8
        ? await writeContractAsync({
            address: nft.address,
            abi: lsp8Abi,
            functionName: 'transfer',
            args: [sender, recipientAddress, nft.tokenId, true, '0x'],
            chainId: nft.chainId,
          })
        : await writeContractAsync({
            address: nft.address,
            abi: erc721Abi,
            functionName: 'safeTransferFrom',
            // The gallery stores every id as bytes32; ERC721 wants the same value as a number
            args: [sender, recipientAddress, BigInt(nft.tokenId)],
            chainId: nft.chainId,
          })

      setHash(submitted)
    } catch (error) {
      toast(error?.shortMessage || error?.message || 'Transaction rejected', 'error')
      setIsSubmitting(false)
    }
  }

  return (
    <NativeDialog
      ref={dialogRef}
      className={styles.sendNft}
      aria-label={`Send ${nft.name}`}
      onClick={(event) => event.stopPropagation()}
      // React's synthetic close/cancel bubble where the native events don't — without this,
      // dismissing this dialog from inside another one (the token detail panel's Transfer)
      // would close its host too
      onCancel={(event) => event.stopPropagation()}
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
          {isSwitching ? 'Switching network…' : isSubmitting && !isConfirming ? 'Confirm in wallet…' : isConfirming ? 'Sending…' : 'Send'}
        </button>
      </form>
    </NativeDialog>
  )
}
