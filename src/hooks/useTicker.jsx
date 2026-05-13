import useSWR from 'swr'

const fetcher = (url) => fetch(url).then((res) => {
  if (!res.ok) throw new Error('Fetch failed')
  return res.json()
})

const STATIC_MAP = {
  ETH: { chain: 'Ethereum', address: '0x0000000000000000000000000000000000000000' },
  LYX: { chain: 'Lukso', address: '0x22307240A0a19C9271810CC96245F924fB998E56' },
}

export function useTicker(blockchain, address, symbol) {
  // Try to get static info first
  const staticInfo = symbol ? STATIC_MAP[symbol.toUpperCase()] : null
  const initialChain = blockchain || staticInfo?.chain
  const initialAddress = address || staticInfo?.address

  // Step 1: Search for metadata if address is missing
  // This allows us to support tickers not in our static list
  const { data: searchData, error: searchError } = useSWR(
    symbol && !initialAddress 
      ? `https://api.diadata.org/v1/search?q=${symbol}` 
      : null,
    fetcher
  )

  // Determine final lookup params
  // If we searched, we take the first result's address and blockchain
  const finalChain = initialAddress ? initialChain : searchData?.[0]?.Blockchain
  const finalAddress = initialAddress ? initialAddress : searchData?.[0]?.Address

  // Step 2: Fetch actual price data using the resolved address
  const { data, error, isLoading } = useSWR(
    finalChain && finalAddress
      ? `https://api.diadata.org/v1/assetQuotation/${finalChain}/${finalAddress}`
      : null,
    fetcher,
    {
      refreshInterval: 30000,
      dedupingInterval: 5000,
    }
  )

  return {
    tickerData: data,
    isLoading: isLoading || (symbol && !initialAddress && !searchData && !searchError),
    isError: error || searchError || (!isLoading && symbol && !data && !searchData),
  }
}