/**
 * Direct LUKSO Envio GraphQL access.
 * Shared by the universal-profile proxy route and the profile API route so
 * server code never has to self-fetch its own HTTP endpoints.
 */

const PROFILE_FIELDS = `    id
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
    url`

const buildProfileQuery = (fields) => `query MyQuery($id: String!) {
  Profile(where: {id: {_eq: $id}}) {
${fields}
  }
}`

/* The LSP3 cover is asked for in its own query shape because a field the upstream schema does
   not have is not a missing field in the reply — GraphQL rejects the whole document, `Profile`
   comes back undefined, and every Universal Profile in the app silently degrades to its database
   row. The richer query is tried first and dropped for the life of the process the one time the
   upstream refuses it. */
const PROFILE_QUERY_WITH_COVER = buildProfileQuery(`${PROFILE_FIELDS}
    backgroundImages { src url }`)
const PROFILE_QUERY = buildProfileQuery(PROFILE_FIELDS)

let coverFieldUnsupported = false

/**
 * One GraphQL round trip. Throws on transport failure; returns the parsed body otherwise,
 * `errors` and all — deciding what an error means is the caller's job.
 */
async function postProfileQuery(endpoint, query, addr, timeoutMs) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query,
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
}

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
    if (coverFieldUnsupported) return await postProfileQuery(endpoint, PROFILE_QUERY, addr, timeoutMs)

    const body = await postProfileQuery(endpoint, PROFILE_QUERY_WITH_COVER, addr, timeoutMs)
    /* A validation error is the only outcome that costs a second request, and it can only ever
       happen once: everything the profile read needs is in the shorter query. */
    if (body?.errors && !body?.data?.Profile) {
      coverFieldUnsupported = true
      console.warn('LUKSO indexer has no Profile.backgroundImages — covers will come from Hup only:', body.errors[0]?.message)
      return await postProfileQuery(endpoint, PROFILE_QUERY, addr, timeoutMs)
    }

    return body
  } catch (networkError) {
    console.error('LUKSO upstream error:', networkError.message)
    return null
  }
}
