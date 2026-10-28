'use client'

import { useCallback, useState } from 'react'
import { useConnection, useSignMessage } from 'wagmi'
import { ADMIN_PASS_HEADER, ADMIN_PASS_TTL_MS, adminPassMessage, encodeAdminPass } from '@/lib/adminPass'
import { sameAddress } from '@/lib/address'

const STORAGE_KEY = 'hup:admin-pass'

// A pass is only worth keeping for the wallet that signed it, and only while it still runs
const isLive = (pass, address) => Boolean(pass && sameAddress(pass.wallet, address) && pass.expiresAt > Date.now())

const readStored = () => {
  if (typeof window === 'undefined') return null
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null')
  } catch {
    return null
  }
}

const writeStored = (pass) => {
  try {
    if (pass) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pass))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked: the pass lives as long as the page does
  }
}

/**
 * The admin pass (lib/adminPass.js) for the connected wallet: one signature opens the admin page
 * for this tab until it runs out. `adminFetch` carries it to the private reads and drops it the
 * moment the server says it no longer holds, which sends the page back to the gate.
 * @param {string | undefined} address
 */
export default function useAdminPass(address) {
  const { chainId } = useConnection()
  const { signMessageAsync } = useSignMessage()
  // Read once on mount; `unlocked` re-checks the wallet and the clock on every render, so a wallet
  // switch or a pass that ran out lands on the gate again
  const [pass, setPass] = useState(readStored)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState(null)

  const unlock = async () => {
    if (!address) return
    setSigning(true)
    setError(null)
    try {
      const expiresAt = Date.now() + ADMIN_PASS_TTL_MS
      const signature = await signMessageAsync({ message: adminPassMessage({ wallet: address, expiresAt }) })
      const next = { wallet: address, expiresAt, signature, chainId }
      writeStored(next)
      setPass(next)
    } catch (err) {
      setError(err.shortMessage || err.message || 'Signature rejected')
    } finally {
      setSigning(false)
    }
  }

  const lock = useCallback(() => {
    writeStored(null)
    setPass(null)
  }, [])

  const adminFetch = useCallback(
    async (url) => {
      const res = await fetch(url, { cache: 'no-store', headers: pass ? { [ADMIN_PASS_HEADER]: encodeAdminPass(pass) } : {} })
      if (res.status === 401) lock()
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Request failed')
      return json.data
    },
    [pass, lock],
  )

  return { pass, unlocked: isLive(pass, address), unlock, lock, adminFetch, signing, error }
}
