'use client'

import { getActiveChain, initPostContract } from '@/lib/communication'
import { useConnection, useBalance } from 'wagmi'
import styles from './balance.module.scss'

export default function Balance({ addr }) {
  const { web3, contract } = initPostContract()
  const { address, isConnected } = useConnection()
  const activeChain = getActiveChain()

  const {
    data: balanceData,
    isLoading: isBalanceLoading,
    isError: isBalanceError,
  } = useBalance({
    address: addr,
    chainId: activeChain[0].id,
  })

  const getNativeTokenPrice = async (symbol) => {
    const myHeaders = new Headers()
    myHeaders.append('Content-Type', `application/json`)
    myHeaders.append('Accept', `application/json`)

    let requestOptions = {
      method: 'GET',
      redirect: 'follow',
      headers: myHeaders,
    }

    const response = await fetch(`https://api.diadata.org/v1/quotation/${symbol}`, requestOptions)
    if (!response.ok) throw new Response('Failed to get data', { status: 500 })
    return response.json()
  }

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
    <div className={`${styles.balance} mt-10 flex align-items-center justify-content-between`}>
      <span>Account Balance</span>

      {balanceData !== undefined && (
        <span className={`flex gap-025`}>
          <span> {Number(web3.utils.fromWei(balanceData?.value, `ether`)).toFixed(2)}</span>
          <span>{balanceData?.symbol}</span>
        </span>
      )}
    </div>
  )
}
