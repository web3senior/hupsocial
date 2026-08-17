/**
 * @file lib/embeddedWallet/connector.js
 * @description wagmi connector for the email embedded wallet.
 *
 * The wallet is exposed through a minimal EIP-1193 provider rather than the
 * connector's getClient shortcut, deliberately: every signature then funnels
 * through one request() switch, which is the single place the confirmation
 * policy lives. The policy mirrors the mini app bridge: reads pass straight to
 * the chain, personal_sign is silent (it cannot move funds; it is how login
 * nonces get signed), and anything that can spend — eth_sendTransaction, typed
 * data (Permit2 approvals travel as typed data) — must clear the in-app
 * confirmation dialog first.
 *
 * The private key lives in module memory only, reconstructed from the two
 * shares (lib/embeddedWallet/crypto.js) at connect time and forgotten on
 * disconnect. Nothing here ever persists it.
 */

import { createConnector } from 'wagmi'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { hasDeviceShareMarker, joinShares, loadDeviceShare } from './crypto'

export const EMAIL_CONNECTOR_ID = 'hupEmail'

// Solid tile + white envelope, sized like the wallet icons EIP-6963 announces.
const EMAIL_ICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0d6efd"/><path d="M8 11.5c0-.83.67-1.5 1.5-1.5h13c.83 0 1.5.67 1.5 1.5v9c0 .83-.67 1.5-1.5 1.5h-13A1.5 1.5 0 0 1 8 20.5v-9Zm2.2.5 5.8 4.35L21.8 12H10.2Zm11.8 1.63-5.4 4.05a1 1 0 0 1-1.2 0L10 13.63V20h12v-6.37Z" fill="#fff"/></svg>`,
)}`

// --- In-memory account ---

let activeAccount = null
let activePrivateKey = null
let restorePromise = null

export const activateEmbeddedAccount = (privateKey) => {
  activeAccount = privateKeyToAccount(privateKey)
  activePrivateKey = privateKey
  return activeAccount.address
}

export const deactivateEmbeddedAccount = () => {
  activeAccount = null
  activePrivateKey = null
  restorePromise = null
}

export const getEmbeddedAddress = () => activeAccount?.address ?? null

/**
 * The raw key, for the owner-facing settings flows only (export, recovery
 * password change). Returns null unless the wallet is unlocked in this tab —
 * there is no path to it without an active session.
 */
export const getEmbeddedPrivateKey = () => activePrivateKey

/**
 * Rebuilds the key from the IndexedDB device share and the session-gated server
 * share. Shared by silent reconnect and the login dialog's fast path; the
 * promise is memoized so a reconnect racing a dialog open restores once.
 * @throws when either share is unavailable (no device share, or session expired)
 */
export const restoreEmbeddedAccount = () => {
  if (activeAccount) return Promise.resolve(activeAccount.address)
  restorePromise ??= (async () => {
    try {
      // The session cookie names the account; the matching device share is
      // looked up by the address the keystore reports.
      const response = await fetch('/api/v1/auth/email/keystore')
      if (!response.ok) throw new Error('Email session expired')
      const { keystore } = await response.json()

      const device = await loadDeviceShare(keystore.walletAddress)
      if (!device?.share) throw new Error('No device share for this account on this browser')

      const address = activateEmbeddedAccount(joinShares(device.share, keystore.serverShare))
      if (address.toLowerCase() !== keystore.walletAddress.toLowerCase()) {
        deactivateEmbeddedAccount()
        throw new Error('Key shares do not match the stored wallet')
      }
      return address
    } finally {
      restorePromise = null
    }
  })()
  return restorePromise
}

// --- UI buses ---
// The dialogs live in the React tree; the connector does not. Each host
// registers its handler on mount, and these fall back to a hard error rather
// than to silent approval when no confirm surface is mounted.

let txConfirmHandler = null
let emailLoginHandler = null

export const setTxConfirmHandler = (handler) => {
  txConfirmHandler = handler
  return () => {
    if (txConfirmHandler === handler) txConfirmHandler = null
  }
}

export const setEmailLoginHandler = (handler) => {
  emailLoginHandler = handler
  return () => {
    if (emailLoginHandler === handler) emailLoginHandler = null
  }
}

/** Opens the email login dialog (registered by EmailLoginDialog). */
export const openEmailLogin = () => {
  if (!emailLoginHandler) throw new Error('Email login dialog is not mounted')
  emailLoginHandler()
}

const rpcError = (code, message) => Object.assign(new Error(message), { code })

const confirmOrReject = async (details) => {
  if (!txConfirmHandler) throw rpcError(-32603, 'No confirmation surface is mounted')
  const approved = await txConfirmHandler(details)
  if (!approved) throw rpcError(4001, 'User rejected the request')
}

// --- Connector ---

// wagmi's reconnect() sweeps every configured connector on page load and
// revives any that reports isAuthorized() — the device share surviving
// disconnect (by design) would make Disconnect un-stick on the next reload.
// Same cure as wagmi's own injected connector: an explicit-disconnect flag in
// wagmi storage that only a user-initiated connect clears.
const DISCONNECTED_KEY = 'hupEmail.disconnected'

export function emailWallet() {
  return createConnector((config) => {
    let currentChainId = config.chains[0].id

    const chainFor = (chainId) => config.chains.find((chain) => chain.id === chainId)

    // The config's transport for a chain (which carries the CORS-pinned RPC
    // overrides from config/wagmi.js) instantiated for direct request() use.
    const rpcFor = (chainId) => {
      const chain = chainFor(chainId)
      if (!chain) throw rpcError(4901, `Chain ${chainId} is not supported`)
      return (config.transports?.[chainId] ?? http())({ chain })
    }

    const requireAccount = () => {
      if (!activeAccount) throw rpcError(4100, 'Email wallet is locked')
      return activeAccount
    }

    const sendTransaction = async (tx) => {
      const account = requireAccount()
      const chain = chainFor(currentChainId)

      await confirmOrReject({ kind: 'transaction', chain, tx })

      const client = createWalletClient({ account, chain, transport: config.transports?.[chain.id] ?? http() })
      return client.sendTransaction({
        to: tx.to ?? undefined,
        data: tx.data ?? undefined,
        value: tx.value ? BigInt(tx.value) : undefined,
        gas: tx.gas ? BigInt(tx.gas) : undefined,
        maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : undefined,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : undefined,
        nonce: tx.nonce ? Number(BigInt(tx.nonce)) : undefined,
      })
    }

    const signTypedData = async (payload) => {
      const account = requireAccount()
      const typedData = typeof payload === 'string' ? JSON.parse(payload) : payload

      await confirmOrReject({ kind: 'typedData', chain: chainFor(currentChainId), typedData })

      return account.signTypedData({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      })
    }

    const provider = {
      request: async ({ method, params = [] }) => {
        switch (method) {
          case 'eth_accounts':
          case 'eth_requestAccounts':
            return activeAccount ? [activeAccount.address] : []

          case 'eth_chainId':
            return `0x${currentChainId.toString(16)}`

          case 'personal_sign': {
            const account = requireAccount()
            // MetaMask parameter order is [data, address]; tolerate the swap
            const [first, second] = params
            const data = typeof first === 'string' && first.toLowerCase() === account.address.toLowerCase() ? second : first
            return account.signMessage({ message: /^0x/.test(data) ? { raw: data } : data })
          }

          case 'eth_signTypedData':
          case 'eth_signTypedData_v4':
            return signTypedData(params[1] ?? params[0])

          case 'eth_sendTransaction':
            return sendTransaction(params[0] ?? {})

          case 'wallet_switchEthereumChain': {
            const chainId = Number(BigInt(params[0]?.chainId ?? '0x0'))
            if (!chainFor(chainId)) throw rpcError(4902, `Chain ${chainId} is not supported`)
            currentChainId = chainId
            config.emitter.emit('change', { chainId })
            return null
          }

          // No key export surface exists, so nothing can serve an opaque-digest
          // signature; same refusal (and reasoning) as the mini app bridge.
          case 'eth_sign':
          case 'eth_signTransaction':
            throw rpcError(4200, `${method} is not supported by the email wallet`)

          default:
            return rpcFor(currentChainId).request({ method, params })
        }
      },
    }

    return {
      id: EMAIL_CONNECTOR_ID,
      name: 'Email',
      type: 'email',
      icon: EMAIL_ICON,

      async connect({ chainId, isReconnecting, withCapabilities } = {}) {
        if (!activeAccount && isReconnecting) await restoreEmbeddedAccount()
        const account = requireAccount()

        // A user-initiated connect (via the login dialog) lifts the flag;
        // reconnects never get here while it is set because isAuthorized
        // already answered false.
        await config.storage?.removeItem(DISCONNECTED_KEY)

        if (chainId && chainFor(chainId)) currentChainId = chainId
        const accounts = withCapabilities ? [{ address: account.address, capabilities: {} }] : [account.address]
        return { accounts, chainId: currentChainId }
      },

      // The device share and session cookie survive on purpose — disconnect
      // forgets the key, it does not tear down the account. "Forget this
      // device" in the login dialog is the destructive path.
      async disconnect() {
        await config.storage?.setItem(DISCONNECTED_KEY, true)
        deactivateEmbeddedAccount()
      },

      async getAccounts() {
        return activeAccount ? [activeAccount.address] : []
      },

      async getChainId() {
        return currentChainId
      },

      async getProvider() {
        return provider
      },

      async isAuthorized() {
        if (await config.storage?.getItem(DISCONNECTED_KEY)) return false
        return Boolean(activeAccount) || hasDeviceShareMarker()
      },

      async switchChain({ chainId }) {
        const chain = chainFor(chainId)
        if (!chain) throw rpcError(4902, `Chain ${chainId} is not supported`)
        currentChainId = chainId
        config.emitter.emit('change', { chainId })
        return chain
      },

      onAccountsChanged() {},
      onChainChanged() {},
      onDisconnect() {
        config.emitter.emit('disconnect')
      },
    }
  })
}
