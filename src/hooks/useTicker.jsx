import useSWR from 'swr'

/* fetcher to handle the API response */
const fetcher = (url) => fetch(url).then((res) => res.json())

export function useTicker(blockchain, address) {
  /*
   * The key changes whenever the blockchain or address changes,
   * forcing a new fetch.
   */
  const { data, error, isLoading } = useSWR(
    blockchain && address
      ? `https://api.diadata.org/v1/assetQuotation/${blockchain}/${address}`
      : null,
    fetcher,
    {
      refreshInterval: 30000, // Refresh every 30 seconds
      dedupingInterval: 5000, // Prevent duplicate requests within 5 seconds
    },
  )

  return {
    tickerData: data,
    isLoading,
    isError: error,
  }
}
