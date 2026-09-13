'use client'

/**
 * @file hooks/useQuickBuy.js
 * @description One-click buy for a single launch, at whatever the toolbar's amount is set to.
 *
 * This is the same swap the launch card runs — quoter for the minimum out, then one
 * UniversalRouter.execute — and deliberately from the connected wallet rather than a session key,
 * because it moves value. What is different is when the reads happen. A card is one ticket on a
 * page and can afford to keep a live quote; a table is fifty rows, and fifty subscribed quoter,
 * allowance and Permit2 reads would cost hundreds of calls to answer a question nobody has asked
 * yet. So everything but the pool key is read on the press, through the public client.
 *
 * An ERC20-quoted launch still needs its two grants before a swap can pull anything, so the first
 * press may spend itself on an approval and say so. Native-quoted launches — nearly all of them —
 * ride as tx value and go straight through.
 */

import { useEffect, useState } from 'react'
import { erc20Abi } from 'viem'
import {
  useConnection,
  usePublicClient,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { CONTRACTS, config } from '@/config/wagmi'
import useSlippagePreference from '@/hooks/useSlippagePreference'
import useQuickBuyAmount from '@/hooks/useQuickBuyAmount'
import { useLaunchPoolKey } from '@/hooks/useLaunchFeeSchedule'
import { usdToQuoteWei, withSlippage } from '@/lib/launch'
import { buildV4SwapForKey } from '@/lib/uniswap-v4'
import { toast } from '@/components/NextToast'
import v4Abi from '@/abis/UniswapV4.json'

const ZERO = '0x0000000000000000000000000000000000000000'
const PERMIT2_EXPIRY_SECONDS = 60 * 60 * 24 * 30
const SWAP_DEADLINE_SECONDS = 1800

/**
 * @param {Object} launch An indexed launch row.
 * @param {number} chainId The chain the launch lives on.
 * @returns {{buy: Function, isBusy: boolean, canBuy: boolean, blocked: string|null,
 *   spendUsd: number}} `blocked` is why the button is disabled, ready to be a tooltip.
 */
export default function useQuickBuy(launch, chainId) {
  const { address, chain: walletChain } = useConnection()
  const switchChain = useSwitchChain({ config })
  const publicClient = usePublicClient({ chainId })
  const [spendUsd] = useQuickBuyAmount()
  const [slippageBps] = useSlippagePreference()
  const { poolKey, quoteAddress, buyIsZeroForOne } = useLaunchPoolKey(launch, chainId)

  // Separate from the write's own pending flag: the on-demand reads happen before anything is
  // signed, and the row has to look busy for that stretch too
  const [isPreparing, setIsPreparing] = useState(false)

  const chainContracts = CONTRACTS[`chain${chainId}`]
  const routerAddress = chainContracts?.univ4Router
  const quoterAddress = chainContracts?.univ4Quoters?.[0]
  const permit2Address = chainContracts?.permit2

  const { data: hash, isPending, writeContractAsync } = useWriteContract()
  const { isSuccess, isError, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash })

  // The verdict lands well after the press, and often after the row has scrolled away, so it is
  // reported through the toast layer rather than anywhere on the row itself
  useEffect(() => {
    if (isSuccess) toast(`Bought $${launch?.symbol ?? 'token'}`, 'success')
  }, [isSuccess, launch?.symbol])

  useEffect(() => {
    if (isError) toast('The buy failed onchain', 'error')
  }, [isError])

  const isNativeQuote = !launch?.quote || String(launch.quote).toLowerCase() === ZERO
  const quoteUsd = launch?.quote_usd ?? null
  const quoteDecimals = launch?.quote_decimals ?? 18

  const blocked = (() => {
    if (!routerAddress || !quoterAddress || !permit2Address) return 'Trading is not available on this network yet'
    if (!quoteUsd) return `No dollar price for ${launch?.quote_symbol ?? 'this pool’s quote asset'} yet`
    return null
  })()

  const isBusy = isPreparing || isPending || isConfirming

  const buy = async () => {
    if (blocked) {
      toast(blocked, 'error')
      return
    }
    if (!address) {
      toast('Connect your wallet first', 'error')
      return
    }
    if (walletChain && walletChain.id !== chainId) {
      switchChain.mutate?.({ chainId })
      return
    }
    if (!poolKey || !publicClient) {
      toast('Still loading this pool', 'error')
      return
    }

    let spend = 0n
    try {
      spend = usdToQuoteWei(String(spendUsd), quoteUsd, quoteDecimals)
    } catch {
      spend = 0n
    }
    if (spend <= 0n) {
      toast('Set a buy amount first', 'error')
      return
    }

    setIsPreparing(true)
    try {
      const nowSeconds = Math.floor(Date.now() / 1000)

      // v4 pulls an ERC20 input through Permit2, which needs two grants: token → Permit2, then
      // Permit2 → UniversalRouter with an expiry. Native input needs neither.
      if (!isNativeQuote) {
        const [allowance, grant] = await Promise.all([
          publicClient.readContract({
            abi: erc20Abi,
            address: quoteAddress,
            functionName: 'allowance',
            args: [address, permit2Address],
          }),
          publicClient.readContract({
            abi: v4Abi.permit2,
            address: permit2Address,
            functionName: 'allowance',
            args: [address, quoteAddress, routerAddress],
          }),
        ])

        if (allowance < spend) {
          await writeContractAsync({
            abi: erc20Abi,
            address: quoteAddress,
            functionName: 'approve',
            args: [permit2Address, spend],
            chainId,
          })
          toast(`Approved ${launch?.quote_symbol ?? 'the quote asset'} — press again to buy`, 'success')
          return
        }

        if (!grant || grant[0] < spend || Number(grant[1]) <= nowSeconds) {
          await writeContractAsync({
            abi: v4Abi.permit2,
            address: permit2Address,
            functionName: 'approve',
            args: [quoteAddress, routerAddress, spend, nowSeconds + PERMIT2_EXPIRY_SECONDS],
            chainId,
          })
          toast('Permit granted — press again to buy', 'success')
          return
        }
      }

      // The quoter simulates the exact swap the router will run, including whatever fee the hook
      // charges at this moment — so a launch still inside its anti-snipe window prices honestly
      const quoted = await publicClient.readContract({
        abi: v4Abi.quoter,
        address: quoterAddress,
        functionName: 'quoteExactInputSingle',
        args: [{ poolKey, zeroForOne: buyIsZeroForOne, exactAmount: spend, hookData: '0x' }],
      })
      const minOut = withSlippage(quoted?.[0] ?? 0n, slippageBps)
      if (minOut <= 0n) {
        toast('This pool could not quote that amount', 'error')
        return
      }

      const { commands, inputs, value } = buildV4SwapForKey(poolKey, buyIsZeroForOne, spend, minOut)

      await writeContractAsync({
        abi: v4Abi.universalRouter,
        address: routerAddress,
        functionName: 'execute',
        args: [commands, inputs, BigInt(nowSeconds + SWAP_DEADLINE_SECONDS)],
        value,
        chainId,
      })
      // Reported the moment it is signed rather than when it confirms: the row goes back to being
      // a row immediately, and the receipt's verdict arrives on its own above
      toast(`Buying $${launch?.symbol ?? 'token'}…`, 'success')
    } catch (error) {
      toast(error?.shortMessage || error?.message || 'Transaction rejected', 'error')
    } finally {
      setIsPreparing(false)
    }
  }

  return { buy, isBusy, canBuy: !blocked, blocked, spendUsd }
}
