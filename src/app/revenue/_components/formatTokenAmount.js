import { formatUnits } from 'viem'

const amountFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
// Sub-1 amounts keep their significant digits — 2-fraction-digit rounding would collapse
// e.g. a 0.0001 MON sale to '0'. Significant-digit mode renders down to 1 wei (1e-18).
const smallAmountFormatter = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 })

/**
 * Renders a raw-unit token amount string from the revenue API (BigInt-safe) as a localized
 * display number, e.g. ('1000000', 6) → '1', ('100000000000000', 18) → '0.0001'.
 */
export function formatTokenAmount(amount, decimals) {
  try {
    const value = Number(formatUnits(BigInt(amount), Number(decimals)))
    return value > 0 && value < 1 ? smallAmountFormatter.format(value) : amountFormatter.format(value)
  } catch {
    return '0'
  }
}
