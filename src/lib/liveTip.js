/**
 * @file lib/liveTip.js
 * @description Owns a stream tip once its transaction is sent. The dialog closes on the hash, so
 * the wait for the receipt and the toast that reports it have to outlive it.
 */

import { waitForTransactionReceipt } from 'wagmi/actions'
import { config } from '@/config/wagmi'
import { shortTxError } from '@/lib/utils'
import { toast } from '@/components/NextToast'

const RECEIPT_TIMEOUT_MS = 120_000

export const trackLiveTip = async ({ hash, chainId, amountLabel }) => {
  const handle = toast(`Sending ${amountLabel}…`, 'loading')
  const report = (message, type) => {
    if (!handle?.update(message, type)) toast(message, type)
  }

  try {
    const receipt = await waitForTransactionReceipt(config, { chainId, hash, timeout: RECEIPT_TIMEOUT_MS })
    if (receipt.status !== 'success') throw new Error('The tip was rejected onchain')
    report(`Tipped ${amountLabel}`, 'success')
  } catch (error) {
    report(shortTxError(error, 'The tip could not be confirmed'), 'error')
  }
}
