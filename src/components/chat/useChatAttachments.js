'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/components/NextToast'
import { uploadFileToIPFS } from '@/lib/ipfs'
import { CHAT_ATTACHMENTS_MAX, classifyChatFile } from '@/lib/chatFiles'

// A picture that will not decode here still uploads; it just reserves no box
const MEASURE_TIMEOUT_MS = 3_000

const measureImage = (url) =>
  new Promise((resolve) => {
    const image = new Image()
    const timer = setTimeout(() => resolve({ width: null, height: null }), MEASURE_TIMEOUT_MS)
    const done = (size) => {
      clearTimeout(timer)
      resolve(size)
    }
    image.onload = () => done({ width: image.naturalWidth || null, height: image.naturalHeight || null })
    image.onerror = () => done({ width: null, height: null })
    image.src = url
  })

let nextKey = 0

/**
 * What the next send will carry besides text: pictures and files picked or pasted, and a
 * recording whose send failed, each uploading from the moment it is staged so Send rarely has
 * anything left to wait for.
 * An item's `ready` resolves to `{cid, width, height}` and rejects when the upload fails.
 * @param {{address?: string|null}} options the uploading wallet
 */
export function useChatAttachments({ address = null } = {}) {
  const [items, setItems] = useState([])
  // Read by add/take between renders, where the state would be a render behind
  const itemsRef = useRef([])
  const update = useCallback((change) => {
    itemsRef.current = change(itemsRef.current)
    setItems(itemsRef.current)
  }, [])

  const discard = (item) => {
    item.controller.abort()
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  }

  // Starts one checked file uploading; the item is the tray's whether or not it is in the tray yet
  const prepare = useCallback(
    (file, checked) => {
      const key = `attachment-${++nextKey}`
      const controller = new AbortController()
      // A picture shows its local copy while it uploads; a recording plays from it
      const previewUrl = checked.kind === 'file' ? null : URL.createObjectURL(file)
      const patch = (fields) => update((current) => current.map((item) => (item.key === key ? { ...item, ...fields } : item)))

      const measured = checked.kind === 'image' ? measureImage(previewUrl) : Promise.resolve({ width: null, height: null })
      measured.then((size) => patch(size))
      const uploaded = uploadFileToIPFS(file, {
        signal: controller.signal,
        address,
        onProgress: (progress) => patch({ progress }),
      })
      const ready = Promise.all([uploaded, measured]).then(([cid, size]) => ({ cid, ...size }))
      ready.then(
        () => patch({ progress: 1, status: 'ready' }),
        (error) => {
          // A tile still staged leaves with a word; one already sending is answered by the send
          if (error?.name === 'AbortError' || !itemsRef.current.some((item) => item.key === key)) return
          toast(error?.message || `${checked.name} could not be uploaded`, 'error')
          update((current) => current.filter((item) => item.key !== key))
          if (previewUrl) URL.revokeObjectURL(previewUrl)
        }
      )

      return { key, ...checked, previewUrl, width: null, height: null, progress: 0, status: 'uploading', controller, ready }
    },
    [address, update]
  )

  const add = useCallback(
    (files) => {
      const room = CHAT_ATTACHMENTS_MAX - itemsRef.current.length
      const picked = Array.from(files ?? [])
      if (picked.length > room) toast(`A message sends up to ${CHAT_ATTACHMENTS_MAX} attachments at a time`, 'error')

      const staged = []
      for (const file of picked.slice(0, Math.max(0, room))) {
        const checked = classifyChatFile(file)
        if (checked.error) {
          toast(checked.error, 'error')
          continue
        }
        staged.push(prepare(file, checked))
      }
      if (staged.length) update((current) => [...current, ...staged])
      return staged.length
    },
    [prepare, update]
  )

  /** A finished recording, uploading at once to be sent on its own; it joins the tray only if that send fails. */
  const prepareVoice = useCallback(
    (voice) => {
      const checked = classifyChatFile(voice.file, { voice: true })
      if (checked.error) {
        toast(checked.error, 'error')
        return null
      }
      return { ...prepare(voice.file, checked), durationMs: Math.round(voice.duration * 1000), waveform: voice.waveform }
    },
    [prepare]
  )

  const remove = useCallback(
    (key) => {
      const item = itemsRef.current.find((entry) => entry.key === key)
      if (!item) return
      discard(item)
      update((current) => current.filter((entry) => entry.key !== key))
    },
    [update]
  )

  const clear = useCallback(() => {
    itemsRef.current.forEach(discard)
    update(() => [])
  }, [update])

  /** Hands the staged items to the sender: they leave the tray, their uploads keep running. */
  const take = useCallback(() => {
    const taken = itemsRef.current
    update(() => [])
    return taken
  }, [update])

  /** Puts back what a failed send could not deliver; an upload that itself failed drops out. */
  const restore = useCallback(
    (returned) => {
      update((current) => [...returned, ...current].slice(0, CHAT_ATTACHMENTS_MAX))
      // Their uploads went on while they were away, so where each one stands is asked again
      for (const item of returned) {
        item.ready.then(
          () => update((current) => current.map((entry) => (entry.key === item.key ? { ...entry, progress: 1, status: 'ready' } : entry))),
          () => {
            update((current) => current.filter((entry) => entry.key !== item.key))
            if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
          }
        )
      }
    },
    [update]
  )

  // A composer that goes away takes its unsent uploads with it
  useEffect(() => () => itemsRef.current.forEach(discard), [])

  return { items, add, prepareVoice, remove, clear, take, restore }
}
