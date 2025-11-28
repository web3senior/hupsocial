// app/api/poap-scan/[address]/route.js

import { NextResponse } from 'next/server';

/**
 * Handles GET requests to /api/poap-scan/[address]
 * @param {Request} request - The incoming request object
 * @param {{params: {address: string}}} context - Context object containing route parameters
 * @returns {Promise<NextResponse>}
 */
export async function GET(request, context) {
  const { address } =await context.params;
console.log(address)
  if (!address) {
    return NextResponse.json({ error: 'Missing address parameter' }, { status: 400 });
  }

  // Define the API URL using the address parameter
  const apiUrl = `https://api.poap.tech/actions/scan/${address}`;
  
  // Retrieve the API Key from environment variables for security
  const apiKey = process.env.NEXT_POAP_API_KEY; 

  if (!apiKey) {
    // In a real application, you should handle this environment variable check more robustly
    console.error('POAP_API_KEY is not set in environment variables');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  try {
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        // Use the secure API key from the server environment
        "X-API-Key": apiKey,
        // Optional: Specify content type if the external API expects it
        "Content-Type": "application/json",
      },
      // Note: Node.js fetch follows redirects by default, so 'redirect: "follow"' is often unnecessary.
      // Caching behavior can be controlled here (e.g., 'no-store' for dynamic data)
      cache: 'no-store', 
    });

    // Check if the external API request was successful
    if (!response.ok) {
      // Forward the external API's status and error message
      const errorText = await response.text();
      return NextResponse.json({ 
        error: `POAP API request failed with status ${response.status}`, 
        details: errorText 
      }, { status: response.status });
    }

    // Parse the JSON response from the external API
    const data = await response.json();

    // Return the data to the client that called this Next.js API route
    return NextResponse.json(data);

  } catch (error) {
    console.error("Error fetching data from POAP API:", error);
    // Handle network or parsing errors
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}