'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import {
  Bold,
  FileText,
  Image as ImageIcon,
  Italic,
  List,
  MapPin,
  MoreHorizontal,
  Smile,
  SlidersHorizontal,
  SquarePlay,
  Trash2,
  X,
} from 'lucide-react'

import abi from '@/abi/post.json'
import { ContentSpinner } from '@/components/Loading'
import { toast } from '@/components/NextToast'
import { useClientMounted } from '@/hooks/useClientMount'
import { getActiveChain } from '@/lib/communication'
import styles from '@/components/NewPost.module.scss'
import Profile from './Profile'
import clsx from 'clsx'

const MAX_MEDIA_ITEMS = 4
const MAX_MEDIA_SIZE_MB = 5

const normalizePrefillValue = (value) => {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === 'string' && item.length > 0) || ''
  }

  return typeof value === 'string' ? value : ''
}

const getInitialPostText = (text, url, actionType, existingPost) => {
  if (actionType === 'edit' && existingPost) {
    console.log('Prefilling edit post with existing content:', existingPost)
    return existingPost.content?.elements?.[0]?.data?.text || ''
  }
  return [normalizePrefillValue(text), normalizePrefillValue(url)].filter(Boolean).join('\n')
}

const createPostContent = (text = '', mediaItems = []) => ({
  version: '1',
  elements: [
    { type: 'text', data: { text } },
    {
      type: 'media',
      data: {
        items: mediaItems,
      },
    },
  ],
})

const getContentPayload = (existingPost) => {
  const content = existingPost?.content
  if (!content) return null

  if (typeof content === 'string') {
    try {
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  return content
}

const getContentElement = (content, type) => {
  return content?.elements?.find((element) => element?.type === type)
}

const getInitialPostContent = (text, url, actionType, existingPost) => {
  if (actionType === 'edit' && existingPost) {
    const content = getContentPayload(existingPost)
    const existingText = getContentElement(content, 'text')?.data?.text || ''
    const existingMedia = getContentElement(content, 'media')?.data?.items || []

    return createPostContent(existingText, existingMedia)
  }

  return createPostContent([normalizePrefillValue(text), normalizePrefillValue(url)].filter(Boolean).join('\n'))
}

const getMediaPreviewSrc = (item) => {
  console.log(item)
  // if (item.localUrl) return item.localUrl
  // if (item.url) return item.url
  // if (item.src) return item.src
  // if (item.gatewayUrl) return item.gatewayUrl

  return `/api/0g/file?hash=${item.cid}`
}

const getSerializablePostContent = (content) => ({
  ...content,
  elements: content.elements.map((element) => {
    if (element.type !== 'media') return element

    return {
      ...element,
      data: {
        ...element.data,
        items: element.data.items.map(({ localUrl, ...item }) => item),
      },
    }
  }),
})
const getShortAddress = (address) => {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export default function NewPost({
  text = '',
  url = '',
  close,
  onClose,
  displayName,
  avatarSrc,
  communityLabel = 'Community or topic',
  existingPost = null, // for edit mode
  actionType = 'post', // or 'thread'
}) {
  const mounted = useClientMounted()

  const initialPostContent = useMemo(
    () => getInitialPostContent(text, url, actionType, existingPost),
    [text, url, actionType, existingPost],
  )

  const [postContent, setPostContent] = useState(() => initialPostContent)

  const [allowComments, setAllowComments] = useState(true)
  const [isOptionsOpen, setIsOptionsOpen] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [selectedMediaType, setSelectedMediaType] = useState(null)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)

  const { address, isConnected } = useConnection()
  const { data: hash, isPending: isSigning, error: submitError, writeContract } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })

  const postText = postContent.elements[0].data.text
  const mediaItems = postContent.elements[1].data.items
  const isBusy = isSigning || isConfirming || isUploading
  const resolvedDisplayName = displayName || getShortAddress(address) || 'Guest'
  const avatarInitial = resolvedDisplayName.slice(0, 1).toUpperCase()

  const handleClose = (e) => {
    if (e) e.stopPropagation()
    onClose?.()
  }

  const updateTextContent = (nextText) => {
    setPostContent((prevContent) => {
      const nextElements = [...prevContent.elements]
      nextElements[0] = {
        ...nextElements[0],
        data: {
          ...nextElements[0].data,
          text: nextText,
        },
      }

      return {
        ...prevContent,
        elements: nextElements,
      }
    })
  }

  const wrapSelection = (mark) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const { selectionStart, selectionEnd, value } = textarea
    const selectedText = value.slice(selectionStart, selectionEnd)
    const nextText = selectedText
      ? `${value.slice(0, selectionStart)}${mark}${selectedText}${mark}${value.slice(selectionEnd)}`
      : `${value.slice(0, selectionStart)}${mark}${mark}${value.slice(selectionEnd)}`

    updateTextContent(nextText)

    requestAnimationFrame(() => {
      textarea.focus()
      const cursorOffset = selectedText ? mark.length : mark.length
      const cursorPosition = selectedText ? selectionEnd + mark.length * 2 : selectionStart + cursorOffset
      textarea.setSelectionRange(cursorPosition, cursorPosition)
    })
  }

  const uploadFileToIPFS = async (file) => {
    if (!file) return null

    setIsUploading(true)

    try {
      const data = new FormData()
      data.set('file', file)

      const uploadRequest = await fetch('/api/0g/file', {
        method: 'POST',
        body: data,
      })

      if (!uploadRequest.ok) {
        throw new Error(`Upload failed with status ${uploadRequest.status}`)
      }

      const result = await uploadRequest.json()
      return result.rootHash
    } catch (error) {
      console.error('Trouble uploading file:', error)
      toast('Error uploading file', 'error')
      return null
    } finally {
      setIsUploading(false)
    }
  }

  const uploadObjectToIPFS = async (json) => {
    setIsUploading(true)

    try {
      const uploadRequest = await fetch('/api/0g/object', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(json),
      })

      if (!uploadRequest.ok) {
        const errorData = await uploadRequest.json().catch(() => ({}))
        throw new Error(errorData.error || `Upload failed with status ${uploadRequest.status}`)
      }

      return uploadRequest.json()
    } catch (error) {
      console.error('Trouble uploading post metadata:', error)
      toast('Error uploading post metadata', 'error')
      throw error
    } finally {
      setIsUploading(false)
    }
  }

  const triggerFileInput = (type) => {
    if (mediaItems.length >= MAX_MEDIA_ITEMS) {
      toast(`Maximum ${MAX_MEDIA_ITEMS} media items reached`, 'error')
      return
    }

    setSelectedMediaType(type)

    if (fileInputRef.current) {
      fileInputRef.current.accept = type === 'image' ? 'image/*' : 'video/*'
      fileInputRef.current.click()
    }
  }

  const handleFileSelect = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || mediaItems.length >= MAX_MEDIA_ITEMS) return

    const sizeInMB = file.size / (1024 * 1024)
    if (sizeInMB > MAX_MEDIA_SIZE_MB) {
      toast(`File size error. Maximum size is ${MAX_MEDIA_SIZE_MB}MB`, 'error')
      return
    }

    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    const isExpectedType = (isImage && selectedMediaType === 'image') || (isVideo && selectedMediaType === 'video')

    if (!isExpectedType) {
      toast(`Please select a ${selectedMediaType} file`, 'error')
      return
    }

    const cid = await uploadFileToIPFS(file)
    if (!cid) return

    const localUrl = URL.createObjectURL(file)
    const nextItem = {
      type: selectedMediaType,
      cid,
      alt: `Hup asset ${selectedMediaType}`,
      storage: '0G',
      mimeType: file.type,
      localUrl,
      duration: selectedMediaType === 'video' ? 0 : undefined,
      spoiler: false,
    }

    setPostContent((prevContent) => {
      const nextElements = [...prevContent.elements]
      const mediaElement = nextElements[1]

      nextElements[1] = {
        ...mediaElement,
        data: {
          ...mediaElement.data,
          items: [...mediaElement.data.items, nextItem],
        },
      }

      return {
        ...prevContent,
        elements: nextElements,
      }
    })
  }

  const handleRemoveMedia = (itemIndex) => {
    const item = mediaItems[itemIndex]
    if (item?.localUrl) URL.revokeObjectURL(item.localUrl)

    setPostContent((prevContent) => {
      const nextElements = [...prevContent.elements]
      const mediaElement = nextElements[1]

      nextElements[1] = {
        ...mediaElement,
        data: {
          ...mediaElement.data,
          items: mediaElement.data.items.filter((_, index) => index !== itemIndex),
        },
      }

      return {
        ...prevContent,
        elements: nextElements,
      }
    })
  }

  const toggleSpoiler = (itemIndex) => {
    setPostContent((prevContent) => {
      const nextElements = prevContent.elements.map((element, elementIndex) => {
        if (elementIndex !== 1) return element

        return {
          ...element,
          data: {
            ...element.data,
            items: element.data.items.map((item, index) => (index === itemIndex ? { ...item, spoiler: !item.spoiler } : item)),
          },
        }
      })

      return {
        ...prevContent,
        elements: nextElements,
      }
    })
  }

  const handleCreatePost = async (event) => {
    event.preventDefault()

    if (!isConnected || !address) {
      toast('Connect your wallet before posting', 'error')
      return
    }

    if (!postText.trim()) {
      textareaRef.current?.focus()
      return
    }

    try {
      const resultIPFS = await uploadObjectToIPFS(getSerializablePostContent(postContent))
      const metadata = resultIPFS.cid // || resultIPFS.IpfsHash || resultIPFS.rootHash
      console.log(metadata)
      if (!metadata) {
        throw new Error('CID not found')
      }

      const activeChain = getActiveChain()
      const postContractAddress = activeChain?.[1]?.hup || process.env.NEXT_PUBLIC_CONTRACT_POST
      if (actionType === 'edit') {
        writeContract({
          abi,
          address: postContractAddress,
          functionName: 'update',
          args: [address, actionType === 'edit' ? existingPost.id : 0, metadata, allowComments],
        })
      } else {
        writeContract({
          abi,
          address: postContractAddress,
          functionName: 'create',
          args: [address, 0, metadata, 0, allowComments],
        })
      }
    } catch (error) {
      console.error(error)
      toast(error.message || 'Unable to create post', 'error')
    }
  }

  useEffect(() => {
    if (!submitError) return
    toast(submitError.shortMessage || submitError.message || 'Transaction rejected', 'error')
  }, [submitError])

  useEffect(() => {
    if (!isConfirmed) return

    localStorage.setItem(`${process.env.NEXT_PUBLIC_LOCALSTORAGE_PREFIX}post-content`, '')
    setPostContent(createPostContent(''))
    toast('Post sent.', 'success')
    handleClose()
  }, [isConfirmed])

  useEffect(() => {
    return () => {
      mediaItems.forEach((item) => {
        if (item.localUrl) URL.revokeObjectURL(item.localUrl)
      })
    }
  }, [])

  if (!mounted) return null

  return (
    <section className={styles.newPost} aria-label="New thread composer" onClick={(e) => e.stopPropagation()}>
      <header className={styles.header}>
        <button type="button" className={styles.cancelButton} onClick={(e) => handleClose(e)}>
          Cancel
        </button>

        <h2>New post</h2>
      </header>

      <main className={clsx(styles.main, 'text-center')}>
        <small>Once submitted, your post will appear in the feed as soon as the network block confirms.</small>
      </main>

      <form className={styles.form} onSubmit={handleCreatePost}>
        <input ref={fileInputRef} type="file" onChange={handleFileSelect} className={styles.fileInput} multiple={false} />

        <div className={clsx(styles.composer, 'flex flex-column align-items-start', 'gap-1')}>
          <Profile variant="full" creator={address} />

          <div className={styles.composerBody}>
            <textarea
              ref={textareaRef}
              name="q"
              placeholder="What's happening?"
              value={postText}
              onChange={(event) => updateTextContent(event.target.value)}
              rows={3}
              autoFocus
            />

            <div className={styles.toolbar} aria-label="Post tools">
              <button type="button" onClick={() => triggerFileInput('image')} aria-label="Add image">
                <ImageIcon size={22} strokeWidth={1.8} />
              </button>
              <button type="button" onClick={() => triggerFileInput('video')} aria-label="Add video">
                <SquarePlay size={22} strokeWidth={1.8} />
              </button>
              <button type="button" aria-label="Add emoji" style={{ display: 'none' }}>
                <Smile size={22} strokeWidth={1.8} />
              </button>
              <button type="button" aria-label="Add poll" style={{ display: 'none' }}>
                <List size={22} strokeWidth={1.8} />
              </button>
              <button type="button" onClick={() => wrapSelection('**')} aria-label="Bold">
                <Bold size={20} strokeWidth={1.8} />
              </button>
              <button type="button" onClick={() => wrapSelection('*')} aria-label="Italic">
                <Italic size={20} strokeWidth={1.8} />
              </button>
              <button type="button" aria-label="Add location">
                <MapPin size={22} strokeWidth={1.8} />
              </button>
            </div>

            {mediaItems.length > 0 && (
              <div className={styles.mediaGrid}>
                {mediaItems.map((item, index) => {
                  const mediaSrc = getMediaPreviewSrc(item)

                  return (
                    <figure key={`${item.cid || item.localUrl || index}`} className={styles.mediaItem}>
                      {item.type === 'image' ? (
                        <img src={mediaSrc} alt={item.alt || ''} className={item.spoiler ? styles.spoiler : undefined} />
                      ) : (
                        <video src={mediaSrc} controls className={item.spoiler ? styles.spoiler : undefined} />
                      )}

                      <figcaption>
                        <button type="button" onClick={() => toggleSpoiler(index)}>
                          <X size={14} />
                          <span>{item.spoiler ? 'Show' : 'Spoiler'}</span>
                        </button>
                        <button type="button" onClick={() => handleRemoveMedia(index)}>
                          <Trash2 size={14} />
                          <span>Remove</span>
                        </button>
                      </figcaption>
                    </figure>
                  )
                })}
              </div>
            )}

            {isUploading && (
              <div className={styles.uploading}>
                <ContentSpinner />
                <span>Uploading media...</span>
              </div>
            )}
          </div>
        </div>

        <footer className={styles.footer}>
          <div className={styles.postOptions}>
            <button
              type="button"
              className={styles.postOptionsButton}
              onClick={() => setIsOptionsOpen((value) => !value)}
              aria-expanded={isOptionsOpen}
            >
              <SlidersHorizontal size={22} strokeWidth={1.8} />
              <span>Post Options</span>
            </button>

            {isOptionsOpen && (
              <div className={styles.optionsPanel}>
                <label htmlFor="allowComments">Allow comments</label>
                <select
                  id="allowComments"
                  name="allowComments"
                  value={allowComments ? 'true' : 'false'}
                  onChange={(event) => setAllowComments(event.target.value === 'true')}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
            )}
          </div>

          <button type="submit" className={styles.postButton} disabled={isBusy || postText.trim().length < 1}>
            {}
            {isConfirming
              ? actionType === 'edit'
                ? 'Updating...'
                : 'Posting...'
              : isSigning
                ? 'Signing...'
                : actionType === 'edit'
                  ? 'Update'
                  : 'Post'}
          </button>
        </footer>
      </form>
    </section>
  )
}
