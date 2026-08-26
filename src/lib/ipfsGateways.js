/* Where IPFS bytes come from. The configured gateway goes first; when it fails, the CID is
   retried on public gateways that resolve the whole network, so a bad minute at one host no
   longer decides whether content loads. Filebase before ipfs.io because that is where uploads
   pin — its gateway has the blocks before anyone else has ever fetched them. */
const BUILT_IN_FALLBACK_GATEWAYS = ['https://ipfs.filebase.io/ipfs/', 'https://ipfs.io/ipfs/']

/**
 * The gateways to try, in order, deduplicated. Shared by the media proxy (/api/ipfs/file) and
 * the article body reader (lib/article) so the two can never drift onto different fallbacks.
 * @returns {string[]} Base URLs ending in a slash, ready for the CID to be appended.
 */
export function gatewayList() {
  const configured = [process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL, process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL_FALLBACK]
  const normalized = [...configured, ...BUILT_IN_FALLBACK_GATEWAYS]
    .filter(Boolean)
    /* The fallback var has shipped as http:// — every gateway speaks https, and a mixed
       scheme would only put the same host in the list twice */
    .map((gateway) => gateway.replace(/^http:\/\//, 'https://'))
    .map((gateway) => (gateway.endsWith('/') ? gateway : `${gateway}/`))
  return [...new Set(normalized)]
}
