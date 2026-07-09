// Shared helpers for the store's gated-content envelope — used by both RevealGatedContent
// (rendering a purchased/owned listing's content) and SellItemPopover (loading a seller's own
// content back into the edit form).

export function isHttpUrl(value) {
  try {
    const url = new URL(String(value).trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const getElement = (elements, type) => elements?.find((el) => el?.type === type)

// Normalizes the store's gated-content envelope into one shape: { name, description, links, files }.
// Elements-based (name/description/links/files blocks), mirroring the post-content elements shape.
export function normalizeEnvelope(envelope) {
  const elements = envelope?.elements || []
  return {
    name: getElement(elements, 'name')?.data?.text || '',
    description: getElement(elements, 'description')?.data?.text || '',
    links: getElement(elements, 'links')?.data?.items || [],
    files: getElement(elements, 'files')?.data?.items || [],
  }
}
