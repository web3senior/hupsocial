/**
 * Direct LUKSO Envio GraphQL access.
 * Shared by the universal-profile proxy route and the profile API route so
 * server code never has to self-fetch its own HTTP endpoints.
 */

const PROFILE_QUERY = `query MyQuery($id: String!) {
  Profile(where: {id: {_eq: $id}}) {
    id
    fullName
    name
    tags
    links { id title url }
    standard
    transactions_aggregate { aggregate { count } }
    profileImages { src url }
    isEOA
    isContract
    followed_aggregate { aggregate { count } }
    following_aggregate { aggregate { count } }
    description
    createdBlockNumber
    createdTimestamp
    lastMetadataUpdate
    url
  }
}`

/**
 * Query a Universal Profile from the LUKSO Envio GraphQL endpoint.
 * Returns the raw GraphQL response body ({ data: { Profile: [...] } }) or null
 * on any configuration, network, timeout, or upstream error — callers treat
 * null as "no UP, use the fallback".
 * @param {string} addr - Wallet address (any casing)
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<Object|null>}
 */
export async function queryUniversalProfile(addr, { timeoutMs = 4000 } = {}) {
  const endpoint = process.env.NEXT_PUBLIC_LUKSO_API_ENDPOINT
  if (!endpoint || !addr) {
    if (!endpoint) console.error('Configuration Error: NEXT_PUBLIC_LUKSO_API_ENDPOINT is missing')
    return null
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: PROFILE_QUERY,
        variables: { id: addr.toLowerCase() },
        operationName: 'MyQuery',
      }),
      // A hung upstream must not stall page navigation — fall back to the DB instead.
      signal: AbortSignal.timeout(timeoutMs),
    })

    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      const errorText = await response.text()
      console.error('Upstream API non-JSON response:', errorText.slice(0, 200))
      return null
    }

    return await response.json()
  } catch (networkError) {
    console.error('LUKSO upstream error:', networkError.message)
    return null
  }
}
