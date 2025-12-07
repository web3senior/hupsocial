'use client'

import { initPostContract } from '@/lib/communication'
import { useConnection, useBalance } from 'wagmi'

export default function Balance({ params }) {
  const { web3, contract } = initPostContract()
  const { address, isConnected } = useConnection()
  const {
    data: balanceData,
    isLoading: isBalanceLoading,
    isError: isBalanceError,
  } = useBalance({
    address: address,
  })

  // Handle loading and error states for the balance fetch
  if (isBalanceLoading) {
    return (
      <div style={{ padding: '20px' }}>
        <p>Loading balance...</p>
      </div>
    )
  }

  //   Handle error
  if (isBalanceError) {
    return (
      <div style={{ padding: '20px' }}>
        <p>Connected Address: {address}</p>
        <p style={{ color: 'red' }}>Error fetching balance!</p>
      </div>
    )
  }

  // Display the balance when successful
  return (
    <div
      className="mt-10 flex align-items-center justify-content-between"
      style={{ padding: '20px', border: '2px solid var(--network-color-primary)', borderRadius: '8px' }}
    >
      <h3>💰 Account Balance</h3>

      <code className={`flex gap-025`}>
        <span> {Number(web3.utils.fromWei(balanceData?.value, `ether`)).toFixed(2)}</span>
        <span>{balanceData?.symbol}</span>
      </code>
    </div>
  )
}
