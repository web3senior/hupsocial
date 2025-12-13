/**
 * Fetches and parses JSON content from a specified IPFS gateway URL using the CID.
 * * @param {string} CID - The Content Identifier (hash) of the data to fetch.
 * @returns {Promise<object | {result: false}>} The parsed JSON object, or {result: false} on failure.
 */
export const getIPFS = async (CID) => {
    // 1. Basic input validation
    if (!CID) {
        console.error('getIPFS Error: No CID provided.');
        return { result: false };
    }

    // Ensure the gateway URL is configured
    const gatewayUrl = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL;
    if (!gatewayUrl) {
        console.error('getIPFS Error: NEXT_PUBLIC_IPFS_GATEWAY_URL environment variable is not set.');
        return { result: false };
    }
    
    // Construct the full URL for the IPFS content
    const url = `${gatewayUrl}${CID}`;

    try {
        // console.log(`Fetching from IPFS: ${url}`);
        
        const requestOptions = {
            method: 'GET',
            // 'follow' is the default behavior for 'redirect', but explicitly stating it is fine.
            redirect: 'follow', 
        };

        const response = await fetch(url, requestOptions);

        // 2. Handle HTTP errors (e.g., 404 Not Found, 500 Server Error)
        if (!response.ok) {
            console.error(`IPFS Fetch Error: Failed to fetch CID ${CID}. Status: ${response.status} ${response.statusText}`);
            return { result: false };
        }

        // 3. Parse the response body as JSON
        const data = await response.json();
        
        return data;

    } catch (e) {
        // 4. Handle network or JSON parsing errors
        console.error(`IPFS Fetch Exception for CID ${CID}:`, e);
        return { result: false };
    }
};