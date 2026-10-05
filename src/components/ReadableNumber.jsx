'use client'

import { useQuery } from '@tanstack/react-query'
import { readable } from '@/config/readable'
import { isEvmAddress } from '@/lib/address'
import styles from './ReadableNumber.module.scss'

const fetchName = async (address) => {
  const response = await fetch(`${readable.api}/api/reverse/${address}`)
  if (!response.ok) return null
  const { name } = await response.json()
  return typeof name === 'string' && name ? name : null
}

// The page of a name on readable.name: `+0 4242` is /names/+0-4242
const pageOf = (name) => `${readable.api}/names/${encodeURIComponent(name.startsWith('+') ? name.replaceAll(' ', '-') : name)}`

/**
 * The Readable number a wallet chose as its primary name, as a link to its page. Nothing while it
 * loads, for a wallet with none, or when readable.name can't be reached: the profile reads the
 * same as before for everyone without a number.
 *
 * @param {string} props.address The profile's wallet.
 */
export default function ReadableNumber({ address }) {
  const evm = isEvmAddress(address)
  const { data: name } = useQuery({
    queryKey: ['readable-name', address?.toLowerCase()],
    queryFn: () => fetchName(address),
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
