/**
 * @file lib/liveRecorder.js
 * @description Keeps a copy of a live stream in the streamer's own browser, for them to download
 * once it ends. Nothing is stored on a server. Pieces go to the browser's private disk storage
 * every few seconds, so a long stream does not fill memory and a crashed tab keeps what it had.
 */

import { LIVE_AUDIO_BITRATE, LIVE_VIDEO_BITRATE } from '@/lib/live'

const FOLDER = 'hup-live-recording'
const META_FILE = 'meta.json'
const PIECE_PREFIX = 'piece-'
const PIECE_MS = 4000
const TITLE_MAX = 80

const FORMATS = [
  { mime: 'video/mp4;codecs="avc1.42E01F,mp4a.40.2"', type: 'video/mp4', extension: 'mp4' },
  { mime: 'video/mp4', type: 'video/mp4', extension: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', type: 'video/webm', extension: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', type: 'video/webm', extension: 'webm' },
  { mime: 'video/webm', type: 'video/webm', extension: 'webm' },
]

const megabytes = new Intl.NumberFormat('en', { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 })
const gigabytes = new Intl.NumberFormat('en', { style: 'unit', unit: 'gigabyte', maximumFractionDigits: 2 })

export const recordingSizeLabel = (bytes) => {
  const mb = (Number(bytes) || 0) / (1024 * 1024)
  return mb >= 1024 ? gigabytes.format(mb / 1024) : megabytes.format(mb)
}

export const canRecordLive = () =>
  typeof MediaRecorder !== 'undefined' && FORMATS.some((format) => MediaRecorder.isTypeSupported(format.mime))

// Unicode letters and the ZWNJ stay; only what a file system refuses is dropped
export const recordingFileName = (title, extension, date = new Date()) => {
  const slug = String(title ?? '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, TITLE_MAX)
  const day = date.toISOString().slice(0, 10)
  return `hup-live-${day}${slug ? `-${slug}` : ''}.${extension}`
}

// Safari has the storage but not main-thread writing, and then the copy is held in memory
const canWriteToDisk = () =>
  Boolean(navigator.storage?.getDirectory) && typeof FileSystemFileHandle !== 'undefined' && 'createWritable' in FileSystemFileHandle.prototype

const openFolder = async (create) => {
  if (!navigator.storage?.getDirectory) return null
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(FOLDER, { create })
  } catch {
    return null
  }
}

const writeFile = async (folder, name, data) => {
  const handle = await folder.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(data)
  await writable.close()
}

const readFolder = async (folder) => {
  let meta = null
  const pieces = []
  for await (const [name, handle] of folder.entries()) {
    if (name === META_FILE) meta = JSON.parse(await (await handle.getFile()).text())
    else if (name.startsWith(PIECE_PREFIX)) pieces.push({ name, file: await handle.getFile() })
  }
  pieces.sort((a, b) => a.name.localeCompare(b.name))
  return { meta, files: pieces.map((piece) => piece.file) }
}

const toRecording = (parts, meta) => {
  const blob = new Blob(parts, { type: meta.type })
  return blob.size ? { blob, name: meta.name, size: blob.size, startedAt: meta.startedAt } : null
}

/** A recording left in this browser by an earlier stream, or null. */
export const readSavedRecording = async () => {
  try {
    const folder = await openFolder(false)
    if (!folder) return null
    const { meta, files } = await readFolder(folder)
    return meta ? toRecording(files, meta) : null
  } catch {
    return null
  }
}

export const discardSavedRecording = async () => {
  try {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(FOLDER, { recursive: true })
  } catch {
    /* nothing saved, or no storage */
  }
}

/**
 * Starts recording and replaces whatever an earlier stream left behind.
 * @param {{stream: MediaStream, title: string}} options
 * @returns {Promise<{stop: () => Promise<{blob: Blob, name: string, size: number}|null>}|null>} null when this browser cannot record
 */
export const startLiveRecording = async ({ stream, title }) => {
  if (!canRecordLive()) return null
  const format = FORMATS.find((candidate) => MediaRecorder.isTypeSupported(candidate.mime))
  const meta = { name: recordingFileName(title, format.extension), type: format.type, startedAt: Date.now() }

  await discardSavedRecording()
  let folder = canWriteToDisk() ? await openFolder(true) : null
  if (folder) {
    await writeFile(folder, META_FILE, JSON.stringify(meta)).catch(() => {
      folder = null
    })
  }

  const memory = []
  let pieces = 0
  let queue = Promise.resolve()

  const keep = (chunk) => {
    queue = queue.then(async () => {
      if (!folder) return memory.push(chunk)
      try {
        pieces += 1
        await writeFile(folder, `${PIECE_PREFIX}${String(pieces).padStart(6, '0')}`, chunk)
      } catch {
        // Out of disk quota: what is already saved stays, the rest is held in memory
        folder = null
        memory.push(chunk)
      }
    })
  }

  const recorder = new MediaRecorder(stream, {
    mimeType: format.mime,
    videoBitsPerSecond: LIVE_VIDEO_BITRATE,
    audioBitsPerSecond: LIVE_AUDIO_BITRATE,
  })
  const stopped = new Promise((resolve) => {
    recorder.addEventListener('stop', resolve, { once: true })
    recorder.addEventListener('error', resolve, { once: true })
  })
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data?.size) keep(event.data)
  })
  recorder.start(PIECE_MS)

  return {
    stop: async () => {
      if (recorder.state !== 'inactive') recorder.stop()
      await stopped
      await queue

      const saved = await openFolder(false)
      const files = saved ? (await readFolder(saved).catch(() => ({ files: [] }))).files : []
      return toRecording([...files, ...memory], meta)
    },
  }
}
