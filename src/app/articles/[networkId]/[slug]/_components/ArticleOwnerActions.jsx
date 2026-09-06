'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { useConnection, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { NotePencilIcon, TrashSimpleIcon } from '@phosphor-icons/react'
import { CONTRACTS } from '@/config/wagmi'
import abi from '@/abi/post.json'
import { toast } from '@/components/NextToast'
import { describeWalletError } from '@/lib/walletErrors'
import styles from './ArticleOwnerActions.module.scss'

/**
 * Article Owner Actions
 * Edit and delete, for the wallet that wrote the article.
 *
 * A client island on an otherwise server-rendered page: whether to show these depends on who is
 * connected, which the server cannot know without making the page unshareable. Rendering nothing
 * until the addresses match leaves the article itself static for every reader.
 *
 * Delete is the same `deleteContent` the feed's post menu calls — an article is a post, so there
 * is one way to remove one rather than two that can drift.
 *
 * @param {number} props.networkId The chain the article's post lives on.
 * @param {string|number} props.postId The post id.
 * @param {string} props.author The address that wrote it.
 */
export default function ArticleOwnerActions({ networkId, postId, author }) {
  const router = useRouter()
  const { address } = useConnection()
  const [armed, setArmed] = useState(false)

  const { data: hash, isPending, writeContractAsync } = useWriteContract()
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash })

  const isOwner = Boolean(address && author && address.toLowerCase() === String(author).toLowerCase())
  if (!isOwner) return null

  const hupAddress = CONTRACTS[`chain${networkId}`]?.hup
  const isBusy = isPending || isConfirming

  const handleDelete = async () => {
    // Two taps, like the form's reset — deleting is the one action here that cannot be undone
    if (!armed) {
      setArmed(true)
      return
    }

    try {
      await writeContractAsync({
        abi,
        address: hupAddress,
        functionName: 'deleteContent',
        args: [address, BigInt(postId)],
        chainId: Number(networkId),
      })
      toast('Article deleted onchain', 'success')
      router.replace('/articles')
    } catch (error) {
      toast(describeWalletError(error, { fallback: 'Could not delete the article' }), 'error')
      setArmed(false)
    }
  }

  return (
    <div className={styles.actions}>
      <Link href={`/compose/article?network=${networkId}&post=${postId}`} className={styles.actions__edit}>
        <NotePencilIcon size={15} />
        Edit
      </Link>

      <button
        type="button"
        className={clsx(styles.actions__delete, armed && styles['actions__delete--armed'])}
        onClick={handleDelete}
        disabled={isBusy || !hupAddress}
        title={hupAddress ? 'Remove this article onchain' : 'Hup is not deployed on this network'}
      >
        <TrashSimpleIcon size={15} />
        {isBusy ? 'Deleting…' : armed ? 'Tap again to delete' : 'Delete'}
      </button>
    </div>
  )
}
