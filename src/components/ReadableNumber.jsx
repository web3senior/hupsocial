'use client'

import { useQuery } from '@tanstack/react-query'
import { readable, readableRegistry } from '@/config/readable'
import { isEvmAddress } from '@/lib/address'
import styles from './ReadableNumber.module.scss'

// The page of a name on readable.name, as it links it: `+0 42421230` is /names/+042421230
const pageOf = (name) => `${readable.api}/names/${encodeURIComponent(name.replaceAll(' ', '')).replace(/^%2B/, '+')}`

/**
 * The Readable number on a profile, as a link to its page: the one its owner set in Edit profile,
 * else the primary name the wallet chose. Nothing while it loads, for a wallet with none, for a set
 * number that has since expired, or when the registry can't be read: the profile reads the same as
 * before for everyone without a number.
 *
 * @param {string} props.address The profile's wallet.
 * @param {string|null} [props.name] The number set in Edit profile.
 */
export default function ReadableNumber({ address, name: chosen }) {
  const evm = isEvmAddress(address)
  const { data: primary } = useQuery({
    queryKey: ['readable-name', address?.toLowerCase()],
    // Lowercased first so a miscased URL can't fail the checksum
    queryFn: () => readableRegistry.getName(address.toLowerCase()),
    enabled: evm && !chosen,
    staleTime: readable.staleMs,
    retry: false,
  })
  // A number can run out after it was set; it is shown only while it is still live
  const { data: live } = useQuery({
    queryKey: ['readable-live', chosen],
    queryFn: async () => (await readableRegistry.getRecords(chosen)) !== null,
    enabled: Boolean(chosen),
    staleTime: readable.staleMs,
    retry: false,
  })
  const name = chosen ? live && chosen : evm && primary
  if (!name) return null

  return (
    <a className={styles.number} href={pageOf(name)} target="_blank" rel="noopener noreferrer" title={`${name} on readable.name`}>
      <span className={styles.number__mark} aria-hidden="true">
        #
      </span>
      {name}
    </a>
  )
}
