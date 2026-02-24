import { NextResponse } from 'next/server'

/**
 * Robust POST handler for Universal Profile proxy
 * Includes error handling for non-JSON responses
 */
export async function POST(request) {
  try {
    /* 1. Extract and validate address */
    const body = await request.json()
    const addr = body.addr?.toLowerCase()

    if (!addr) {
      return NextResponse.json({ error: 'Address is required' }, { status: 400 })
    }

    /* 2. Build the query - using a variable is safer than string injection */
    const graphqlQuery = {
      query: `query MyQuery($id: String!) {
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
      }`,
      variables: { id: addr },
    }

    /* 3. Fetch from LUKSO API */
    const endpoint = process.env.NEXT_PUBLIC_LUKSO_API_ENDPOINT

    /* Ensure the endpoint exists */
    if (!endpoint) {
      throw new Error('LUKSO API Endpoint is not defined in environment variables')
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(graphqlQuery),
    })

    /* 4. Check if the response is actually JSON before parsing */
    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      const errorText = await response.text()
      console.error('Non-JSON response received:', errorText.slice(0, 200)) // Log first 200 chars
      return NextResponse.json(
        { error: 'Upstream API returned HTML instead of JSON. Check your API URL.' },
        { status: 502 },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    /* Log the specific error for debugging */
    console.error('Proxy Error Detail:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
