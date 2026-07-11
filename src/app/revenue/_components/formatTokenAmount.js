import { formatUnits } from 'viem'

const amountFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

/**
 * Renders a raw-unit token amount string from the revenue API (BigInt-safe) as a localized
 * display number, e.g. ('1000000', 6) → '1'.
 */
export function formatTokenAmount(amount, decimals) {
  try {
    return amountFormatter.format(Number(formatUnits(BigInt(amount), Number(decimals))))
  } catch {
    return '0'
  }
}
