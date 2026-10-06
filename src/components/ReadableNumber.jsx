'use client'

import { useQuery } from '@tanstack/react-query'
import { readable, readableRegistry } from '@/config/readable'
import { isEvmAddress } from '@/lib/address'
import styles from './ReadableNumber.module.scss'

// The page of a name on readable.name, as it links it: `+0 42421230` is /names/+042421230
const pageOf = (name) => `${readable.api}/names/${encodeURIComponent(name.replaceAll(' ', '')).replace(/^%2B/, '+')}`

/**
 * The Readable number a wallet chose as its primary name, as a link to its page. Nothing while it
 * loads, for a wallet with none, or when the registry can't be read: the profile reads the same
 * as before for everyone without a number.
 *
 * @param {string} props.address The profile's wallet.
 */
export default function ReadableNumber({ address }) {
  const evm = isEvmAddress(address)
  const { data: name } = useQuery({
    queryKey: ['readable-name', address?.toLowerCase()],
    // Lowercased first so a miscased URL can't fail the checksum
    queryFn: () => readableRegistry.getName(address.toLowerCase()),
    enabled: evm,
    staleTime: readable.staleMs,
    retry: false,
  })
  if (!evm || !name) return null

  return (
    <a className={styles.number} href={pageOf(name)} target="_blank" rel="noopener noreferrer" title={`${name} on readable.name`}>
      <span className={styles.number__mark} aria-hidden="true">
        #
      </span>
      {name}
    </a>
  )
}
