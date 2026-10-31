import catalog from './chatStickers.json'

export const CHAT_STICKERS = catalog
const byId = new Map(catalog.map((sticker) => [sticker.id, sticker]))

// An exact catalog reference travels through the existing text-message protocol.
export function stickerBody(sticker, caption = '') {
  const marker = `[Hup sticker: ${sticker.id}]`
  return caption ? `${marker}\n${caption}` : marker
}

export const stickerFromBody = (body) => {
  if (typeof body !== 'string') return null
  const marker = body.split('\n', 1)[0]
  const match = /^\[Hup sticker: ([a-f0-9]{8})\]$/.exec(marker)
  return match ? byId.get(match[1]) ?? null : null
}
export const stickerCaption = (body) => {
  if (!stickerFromBody(body)) return body
  const separator = body.indexOf('\n')
  return separator < 0 ? '' : body.slice(separator + 1)
}
export const stickerAsset = (sticker, extension) => `/chat-stickers/${sticker.file ?? sticker.id}.${extension}`
