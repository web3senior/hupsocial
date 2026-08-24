/**
 * @file lib/solana/wallet.js
 * @description The Wallet Standard side of Solana support: which wallets are installed, how to
 * connect one, and how to sign with it.
 *
 * Solana wallets are not EIP-1193 providers, so none of this goes through wagmi. Every wallet
 * that matters (Phantom, Solflare, Backpack, …) registers itself with the Wallet Standard
 * registry on page load, which is the only discovery mechanism used here — no per-wallet
 * `window.phantom` sniffing. The functions take the wallet object straight from the registry;
 * the store (stores/useSolanaWalletStore.js) owns which one is current.
 */
import { getWallets } from '@wallet-standard/app'
import bs58 from 'bs58'

const FEATURE_CONNECT = 'standard:connect'
const FEATURE_DISCONNECT = 'standard:disconnect'
const FEATURE_EVENTS = 'standard:events'
const FEATURE_SIGN_AND_SEND = 'solana:signAndSendTransaction'
const FEATURE_SIGN = 'solana:signTransaction'

const isSolanaChainId = (chain) => String(chain).startsWith('solana:')

const isSolanaWallet = (wallet) =>
  Array.isArray(wallet?.chains) && wallet.chains.some(isSolanaChainId) && FEATURE_CONNECT in (wallet.features ?? {})

/** Every installed wallet that can sign for a Solana chain, in registry order. */
export const listSolanaWallets = () => getWallets().get().filter(isSolanaWallet)

/**
 * Wallets inject themselves asynchronously (an extension can register after the app has
 * mounted), so anything listing them re-reads on these events.
 * @param {() => void} listener
 * @returns {() => void} unsubscribe
 */
export const onSolanaWalletsChange = (listener) => {
  const { on } = getWallets()
  const offs = [on('register', listener), on('unregister', listener)]
  return () => offs.forEach((off) => off())
}

const solanaAccountOf = (accounts) =>
  accounts?.find((account) => account.chains?.some(isSolanaChainId)) ?? accounts?.[0] ?? null

/**
 * Asks the wallet for an account. `silent` only succeeds when the site was approved before,
 * which is what a page reload uses to reconnect without a prompt.
 * @param {object} wallet
 * @param {{silent?: boolean}} [options]
 * @returns {Promise<object|null>} The Wallet Standard account (address, publicKey, chains, features).
 */
export const connectSolanaWallet = async (wallet, { silent = false } = {}) => {
  const { accounts } = await wallet.features[FEATURE_CONNECT].connect(silent ? { silent: true } : undefined)
  return solanaAccountOf(accounts)
}

export const disconnectSolanaWallet = async (wallet) => {
  await wallet?.features?.[FEATURE_DISCONNECT]?.disconnect?.()
}

/**
 * Fires with the new account (or null) when the user switches or revokes the account inside
 * the wallet.
 * @param {object} wallet
 * @param {(account: object|null) => void} listener
 * @returns {() => void} unsubscribe
 */
export const onSolanaAccountChange = (wallet, listener) => {
  const events = wallet?.features?.[FEATURE_EVENTS]
  if (typeof events?.on !== 'function') return () => {}

  return events.on('change', (properties) => {
    if (!properties || !('accounts' in properties)) return
    listener(solanaAccountOf(properties.accounts))
  })
}

// The chain an account signs against has to be one it declares; sending a devnet transaction
// to a mainnet-only account is refused by the wallet with an opaque error, so it is caught here
const chainForAccount = (account, chain) => {
  if (!account.chains?.length || account.chains.includes(chain)) return chain
  throw new Error(`This wallet account does not support ${chain.replace('solana:', 'Solana ')}`)
}

// Unsigned (or partially signed) bytes: the wallet deserializes, signs and re-serializes
const serializeForWallet = (transaction) => transaction.serialize({ requireAllSignatures: false, verifySignatures: false })

/**
 * Signs and broadcasts through the wallet, which pays the fee.
 * @param {object} wallet
 * @param {object} account
 * @param {import('@solana/web3.js').Transaction} transaction
 * @param {string} chain - Wallet Standard chain id, e.g. 'solana:devnet'.
 * @returns {Promise<string>} The base58 transaction signature.
 */
export const signAndSendWithWallet = async (wallet, account, transaction, chain) => {
  const feature = wallet.features[FEATURE_SIGN_AND_SEND]
  if (!feature) throw new Error(`${wallet.name} cannot send Solana transactions`)

  const [output] = await feature.signAndSendTransaction({
    account,
    chain: chainForAccount(account, chain),
    transaction: serializeForWallet(transaction),
  })

  return bs58.encode(output.signature)
}

/**
 * Signs without sending — the relay path, where the relayer is the fee payer and adds its own
 * signature before broadcasting.
 * @param {object} wallet
 * @param {object} account
 * @param {import('@solana/web3.js').Transaction} transaction
 * @param {string} chain
 * @returns {Promise<Uint8Array>} The signed transaction bytes.
 */
export const signWithWallet = async (wallet, account, transaction, chain) => {
  const feature = wallet.features[FEATURE_SIGN]
  if (!feature) throw new Error(`${wallet.name} cannot sign Solana transactions`)

  const [output] = await feature.signTransaction({
    account,
    chain: chainForAccount(account, chain),
    transaction: serializeForWallet(transaction),
  })

  return output.signedTransaction
}
