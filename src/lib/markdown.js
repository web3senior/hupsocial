import { marked } from 'marked'
import DOMPurify from 'dompurify'

function escapeAttr(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function renderMarkdown(markdown) {
  const content = typeof markdown === 'string' ? markdown.trim() : ''

  const renderer = new marked.Renderer()

  renderer.text = (token) => {
    const rawText = typeof token === 'string' ? token : token?.text || ''

    return rawText.replace(/\$([A-Z0-9]{1,10})\b/g, (match, symbol) => {
      return `<span class="ticker-trigger" data-symbol="${symbol}">${match}</span>`
    })
  }

  renderer.link = (token) => {
    const href = escapeAttr(token?.href)
    const title = token?.title ? ` title="${escapeAttr(token.title)}"` : ''
    const text = token?.text || ''

    return `<a href="${href}"${title} rel="noopener noreferrer" target="_blank">${text}</a>`
  }

  const dirtyHtml = marked.parse(content, {
    renderer,
    gfm: true,
    breaks: true,
  })

  return DOMPurify.sanitize(dirtyHtml, {
    ADD_TAGS: ['span'],
    ADD_ATTR: ['target', 'rel', 'data-symbol', 'data-chain', 'data-address'],
  }).trim()
}