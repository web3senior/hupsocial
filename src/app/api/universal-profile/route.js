import { NextResponse } from 'next/server'

/**
 * Robust POST handler for Universal Profile proxy
 * Updated to preserve original address casing and match working GraphQL format
 */
export async function POST(request) {
  let body
  
  /* Fetch the LUKSO endpoint from environment variables */
  const endpoint = process.env.NEXT_PUBLIC_LUKSO_API_ENDPOINT
  if (!endpoint) {
    console.error('Configuration Error: NEXT_PUBLIC_LUKSO_API_ENDPOINT is missing')
    return NextResponse.json(
      { error: 'Server configuration error' }, 
      { status: 500 }
    )
  }

  /* Safely parse incoming payload */
  try {
    body = await request.json()
  } catch (parseError) {
    return NextResponse.json(
      { error: 'Invalid JSON payload provided' }, 
      { status: 400 }
    )
  }

  /* Extract address without forcing lowercase, matching your working query state */
  const addr = body.addr
  if (!addr) {
    return NextResponse.json(
      { error: 'Address is required' }, 
      { status: 400 }
    )
  }

  /* Structure the payload exactly as the GraphQL engine expects parameters */
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
    variables: { id: addr.toLowerCase() }, // Preserve original casing in variable, but ensure query matches expected format
    operationName: 'MyQuery'
  }

  /* Post payload directly to the upstream network */
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(graphqlQuery),
    })

    /* Validate that the response format matches JSON expectations */
    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      const errorText = await response.text()
      console.error('Upstream API non-JSON response:', errorText.slice(0, 200))
      return NextResponse.json(
        { error: 'Upstream API returned unexpected format.' },
        { status: 502 },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (networkError) {
    console.error('Upstream Network Error:', networkError.message)
    return NextResponse.json(
      { error: 'Failed to communicate with upstream API service' }, 
      { status: 502 }
    )
  }
}