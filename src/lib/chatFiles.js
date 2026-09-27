/**
 * @file lib/chatFiles.js
 * @description What a chat line may carry besides text, as one set of rules the browser checks
 * before it uploads and the room route checks again before it stores. A picture or a file is
 * pinned on IPFS first; the line then names it by CID.
 */

import { gatewayUrl } from '@/lib/ipfsGateways'

export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const CHAT_FILE_MAX_BYTES = 25 * 1024 * 1024
export const CHAT_ATTACHMENTS_MAX = 4
export const CHAT_FILE_NAME_MAX = 120

// The formats the moderator reads, which is what lets a picture in a public room be checked
export const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

// An allowlist: nothing that runs, and nothing a gateway would render as a page
const FILE_TYPES = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

export const CHAT_FILE_ACCEPT = [...CHAT_IMAGE_TYPES, ...Object.keys(FILE_TYPES).map((extension) => `.${extension}`)].join(',')

const megabytes = (bytes) => Math.floor(bytes / (1024 * 1024))

const extensionOf = (name) => /\.([A-Za-z0-9]{1,8})$/.exec(name || '')?.[1]?.toLowerCase() ?? ''

/**
 * A name safe to store and show: no path, no control characters, capped with its extension kept.
 * @param {string} raw
 * @returns {string} '' when nothing usable is left
 */
export const cleanFileName = (raw) => {
  const name = String(raw ?? '')
    .normalize('NFC')
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, '')
    .trim()
  if (name.length <= CHAT_FILE_NAME_MAX) return name
  const extension = extensionOf(name)
  const tail = extension ? `.${extension}` : ''
  return `${name.slice(0, CHAT_FILE_NAME_MAX - tail.length)}${tail}`
}

/**
 * Whether the room takes this file, and as what.
 * @param {{name?: string, type?: string, mime?: string, size?: number}} file a File, or what a line declares
 * @returns {{kind: 'image'|'file', name: string, mime: string, size: number}|{error: string}}
 */
export const classifyChatFile = (file) => {
  const name = cleanFileName(file?.name)
  const mime = String(file?.type ?? file?.mime ?? '').toLowerCase()
  const size = Number(file?.size)
  if (!name) return { error: 'That file has no name' }
  if (!Number.isInteger(size) || size <= 0) return { error: `${name} is empty` }

  if (CHAT_IMAGE_TYPES.includes(mime)) {
    if (size > CHAT_IMAGE_MAX_BYTES) return { error: `Images are capped at ${megabytes(CHAT_IMAGE_MAX_BYTES)} MB` }
    return { kind: 'image', name, mime, size }
  }

  const known = FILE_TYPES[extensionOf(name)]
  if (!known) return { error: `${name} is not a kind of file the chat takes` }
  if (size > CHAT_FILE_MAX_BYTES) return { error: `Files are capped at ${megabytes(CHAT_FILE_MAX_BYTES)} MB` }
  // The extension decides: browsers report an empty or generic type for half of these
  return { kind: 'file', name, mime: known, size }
}

const CID_PATTERN = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,100})$/

/** @returns {string|null} the bare CID of an `ipfs://` URI or a CID, null for anything else */
export const chatCidFrom = (raw) => {
  const cid = String(raw ?? '')
    .replace(/^(?:ipfs:\/\/)+/, '')
    .trim()
  return CID_PATTERN.test(cid) ? cid : null
}

/** Where a file downloads from, carrying its name so the browser saves it under that name. */
export const chatFileUrl = (cid, name) => `${gatewayUrl(cid)}?${new URLSearchParams({ filename: name || 'file' })}`
