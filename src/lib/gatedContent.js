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

/**
 * Normalizes the store's gated-content envelope into one shape: { name, description, links, files }.
 *
 * The canonical form is elements-based (name/description/links/files blocks), mirroring the
 * post-content elements shape. A flat { name, description, links, files } object is also accepted,
 * because a batch of HupSell listings was written that way before the writer was corrected — their
 * content key can never be rotated and the CID is already sold, so those blobs are immutable and
 * would otherwise read as empty forever, for their buyers as well as their seller.
 */
export function normalizeEnvelope(envelope) {
  if (!envelope) return { name: '', description: '', links: [], files: [] }

  const elements = envelope.elements
  if (Array.isArray(elements) && elements.length > 0) {
    return {
      name: getElement(elements, 'name')?.data?.text || '',
      description: getElement(elements, 'description')?.data?.text || '',
      links: getElement(elements, 'links')?.data?.items || [],
      files: getElement(elements, 'files')?.data?.items || [],
    }
  }

  return {
    name: typeof envelope.name === 'string' ? envelope.name : '',
    description: typeof envelope.description === 'string' ? envelope.description : '',
    links: Array.isArray(envelope.links) ? envelope.links : [],
    files: Array.isArray(envelope.files) ? envelope.files : [],
  }
}
