'use client'

import { useState, useEffect, useMemo } from 'react'
import clsx from 'clsx'
import { Heart } from 'lucide-react'
import { useWaitForTransactionReceipt, useConnection, useWriteContract, usePublicClient } from 'wagmi'
import { getActiveChain, initPostCommentContract } from '@/lib/communication'
import { isSessionActive, writeWithBurnerSession } from '@/lib/burnerSession'
import { CONTRACTS } from '@/config/wagmi'
import abi from '@/abi/post.json'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { useClientMounted } from '@/hooks/useClientMount'
import { toast } from '@/components/NextToast'
import { AnimatedHeart } from '@/components/Icons'
import Profile from '../Profile'
import { renderMarkdown } from '@/lib/markdown'
import MediaGallery from '../Gallery'
import styles from './Comment.module.scss'


const localStorageBatchLikeKey = `${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}batch_like_enabled`

/**
 * Like Interaction Component
 * @param {Object} props
 * @param {Object} props.post Core content model with network metadata and like metrics.
 * @param {Function} [props.onUpdate] Optional parent update callback to sync list states.
 */

export const Comment = ({ item, postContent, setShowCommentModal }) => {
  
const [status, setStatus] = useState(true)
  const [error, setError] = useState(null)
  const isMounted = useClientMounted()
  const [commentContent, setCommentContent] = useState('')
  const { address, isConnected } = useConnection()
  const activeChain = getActiveChain()
  const { web3, contract } = initPostCommentContract()
  const { data: hash, isPending: isSigning, error: submitError, writeContractAsync } = useWriteContract()
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash,
  })
  const [isUploadingComment, setIsUploadingComment] = useState(false)
  const isPostingComment = isUploadingComment || isSigning || isConfirming
  const uploadObjectToIPFS = async (json) => {
    //setIsUploading(true)
    try {
      const uploadRequest = await fetch(`/api/ipfs/object`, {
        method: 'POST',
        // Set the Content-Type header
        headers: {
          'Content-Type': 'application/json',
        },
        // Stringify the JSON object directly (no extra wrapper)
        body: JSON.stringify(json),
      })

      // Check for non-200 status codes
      if (!uploadRequest.ok) {
        const errorData = await uploadRequest.json()
        throw new Error(errorData.error || `HTTP error! Status: ${uploadRequest.status}`)
      }

      const responseData = await uploadRequest.json()
      //setIsUploading(false)
      return responseData
    } catch (e) {
      //setIsUploading(false)
      console.error('Trouble uploading file/object:', e)
      // Re-throw the error or return null/undefined depending on your error handling preference
      throw e
    }
  }
  const getHasLiked = async () => {
    return isConnected ? await getHasLikedPost(id, address) : false
  }

  const postComment = async (e) => {
    e.stopPropagation()

    if (isPostingComment) {
      return
    }

    if (!isConnected) {
      console.log(`Please connect your wallet first`, 'error')
      return
    }

    //const formData = new FormData(e.target)

    try {
      setIsUploadingComment(true)

      const resultIPFS = await uploadObjectToIPFS({
        version: '1',
        elements: [
          { type: 'text', data: { text: commentContent } },
          {
            type: 'media',
            data: {
              items: [
                // { type: 'image', cid: 'Qm1234...image-cid-1', alt: 'Photo of the launch party.', mimeType: 'image/jpeg' },
                // { type: 'image', cid: 'Qm5678...image-cid-2', alt: 'Screenshot of the new interface.', mimeType: 'image/jpeg' },
                // { type: 'video', cid: 'Qm9012...video-cid-3', format: 'mp4', duration: 45 },
              ],
            },
          },
        ],
      })
      if (!resultIPFS.cid) {
        console.error(`CID not found`)
        return
      }
      const metadata = resultIPFS.cid
      console.log(address, 1, metadata, item.id, true)
      await writeContractAsync({
        abi,
        address: activeChain[1].hup,
        functionName: 'create',
        args: [address, 1, metadata, item.id, true], //formData.get(`allowComments`) === 'true' ? true : false
      })
      setShowCommentModal(false)
      setCommentContent('')
      toast('Your post will appear once the transaction is confirmed.', 'success')
    } catch (err) {
      console.error('Trouble posting comment:', err)
    } finally {
      setIsUploadingComment(false)
    }
  }

  useEffect(() => {
    // getHasLiked()
    //   .then((result) => {
    //     setHasLiked(result)
    //     setLoading(false)
    //   })
    //   .catch((err) => {
    //     console.log(err)
    //     setError(`⚠️`)
    //     setLoading(false)
    //   })
  }, [item])

  // if (loading) {
  //   return <InlineLoading />
  // }

  if (error) {
    return <span>{error}</span>
  }

  return (
    <div
      className={`${styles.modal} animate fade`}
      onClick={(e) => {
        e.stopPropagation()
        setShowCommentModal()
      }}
    >
      <div className={`${styles.modal__container}`} onClick={(e) => e.stopPropagation()}>
        <header className={`${styles.modal__container__header}`}>
          <div className={``} aria-label="Close" onClick={() => setShowCommentModal()}>
            Cancel
          </div>
          <div className={`flex-1`}>
            <h3>Post your reply</h3>
          </div>
          <div className={`pointer`} onClick={(e) => updateStatus(e)}>
            {isSigning ? `Signing...` : isConfirming ? 'Confirming...' : status && status.content !== '' ? `Update` : `Share`}
          </div>
        </header>

        <main className={`${styles.modal__container__main}`}>
          <article className={`${styles.modal__post}`}>
            <section className={`flex flex-column align-items-start justify-content-between`}>
              <header className={`${styles.modal__post__header}`}>
                <Profile creator={item.wallet_address} createdAt={item.created_at} networkId={item.network_id} />
              </header>
              <main className={`${styles.modal__post__main} w-100 flex flex-column grid--gap-050`}>
                <div className={`${styles.post__main__media}`}>
                  <>
                    <div
                      className={`${styles.post__main__content} `}
                      style={{ maxHeight: '400px', overflowY: 'auto' }}
                      id={`post${item.postId}`}
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(item?.content?.elements?.[0]?.data?.text || item?.content || ''),
                      }}
                    />
                    {item?.content?.elements?.[1]?.type === 'media' && <MediaGallery data={item.content.elements[1].data.items} />}
                  </>
                </div>
              </main>
            </section>
          </article>
        </main>

        <footer className={`${styles.modal__footer}  flex flex-column align-items-start`}>
          <div className="flex flex-row align-items-center gap-050 w-100">
            <Profile variant="imageOnly" creator={address} createdAt={item.created_at} networkId={item.network_id} />
            <textarea
              autoFocus
              defaultValue={commentContent}
              onInput={(e) => setCommentContent(e.target.value)}
              placeholder={`Reply to ${item?.wallet_address?.slice(0, 4)}…${item?.wallet_address?.slice(-4)}`}
            />
          </div>
          <button className="btn" onClick={(e) => postComment(e)} disabled={isPostingComment} aria-busy={isPostingComment}>
            {isUploadingComment ? 'Posting...' : isSigning ? 'Signing...' : isConfirming ? 'Confirming...' : 'Post comment'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default Comment