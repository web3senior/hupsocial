/* @file app/admin/contracts/page.jsx */
'use client'

import { useState, useEffect } from 'react'
import { useConnection, useWriteContract } from 'wagmi' // Hook added here
import { createPublicClient, http } from 'viem'
import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import { config, CONTRACTS } from '@/config/wagmi'
import styles from './page.module.scss'

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS?.toLowerCase()

const EIP712_DOMAIN_ABI = [
  {
    name: 'eip712Domain',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'fields', type: 'bytes1' },
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
      { name: 'salt', type: 'bytes32' },
      { name: 'extensions', type: 'uint256[]' },
    ],
  },
]

// ABI definition to write the new string value on-chain
const FORWARDER_WRITE_ABI = [
  {
    name: 'updateName', // Ensure this matches your contract's setter method name
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newName', type: 'string' }],
    outputs: [],
  },
]

const CHAT_UPDATE_FORWARDER_ABI = [
  {
    inputs: [
      {
        internalType: 'address',
        name: '_newForwarder',
        type: 'address',
      },
    ],
    name: 'updateForwarder',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
]

export default function Page() {
  const { address, isConnected } = useConnection()
  const { writeContractAsync, isPending: isWritePending } = useWriteContract()

  const [overrides, setOverrides] = useState({})
  const [inputs, setInputs] = useState({})
  const [verifications, setVerifications] = useState({})
  const [txStates, setTxStates] = useState({}) // Keep track of pending transactions per chain

  const isAdmin = isConnected && address?.toLowerCase() === ADMIN_WALLET

  // Load initial overrides on client load
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const initialOverrides = {}
      const initialInputs = {}

      config.chains.forEach((chain) => {
        const key = `chain${chain.id}`
        const defaultContracts = CONTRACTS[key]
        if (defaultContracts) {
          const savedOverride = localStorage.getItem(`hupsocial_forwarder_name_override_${chain.id}`)
          if (savedOverride) {
            initialOverrides[chain.id] = savedOverride
            initialInputs[chain.id] = savedOverride
          } else {
            initialInputs[chain.id] = defaultContracts.forwarderName || ''
          }
        }
      })

      setOverrides(initialOverrides)
      setInputs(initialInputs)
    }
  }, [])

  // Verify on-chain EIP-712 domain name dynamically using viem
  const handleVerify = async (chain, forwarderAddress) => {
    if (!forwarderAddress) return

    setVerifications((prev) => ({
      ...prev,
      [chain.id]: { loading: true },
    }))

    try {
      const rpcUrl = chain.rpcUrls.default.http[0]
      const client = createPublicClient({
        chain,
        transport: http(rpcUrl),
      })

      const domainData = await client.readContract({
        address: forwarderAddress,
        abi: EIP712_DOMAIN_ABI,
        functionName: 'eip712Domain',
      })

      const onChainName = domainData[1]

      setVerifications((prev) => ({
        ...prev,
        [chain.id]: {
          loading: false,
          onChainName,
          verified: true,
        },
      }))
    } catch (err) {
      console.error(`Verification error for chain ${chain.id}:`, err)
      setVerifications((prev) => ({
        ...prev,
        [chain.id]: {
          loading: false,
          error: err.message || 'Failed to read contract metadata',
        },
      }))
    }
  }
  const test = async () => {
    console.log('test')
    // setStatus('signing') // Optional, for UI state tracking

    try {
      const { hash: txHash } = await writeContractAsync({
        address: '0x3a98ACd2B8CcBe85121F95BF9F9636A484A80d67',
        abi: CHAT_UPDATE_FORWARDER_ABI, // Your ABI here
        functionName: 'updateForwarder',
        args: ['0x76d610248ADDd1619c0Bc34F18E5436E38Dc6972'],
      })

      console.log('✅ Transaction sent:', txHash)
      // setStatus('success') // Optional, for UI state tracking
    } catch (err) {
      console.error('❌ Error sending transaction:', err)
      // setStatus('error') // Optional, for UI state tracking
    }
  }
  // Update name directly on-chain inside the smart contract
  const handleUpdate = async (chain, forwarderAddress, newName) => {
    if (!newName.trim() || !forwarderAddress) return

    setTxStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      // Prompt user's connected wallet to sign the contract invocation
      const txHash = await writeContractAsync({
        address: forwarderAddress,
        abi: FORWARDER_WRITE_ABI,
        functionName: 'updateName', // Update this if your contract function differs
        args: [newName],
        chainId: chain.id,
      })

      console.log(`Transaction sent successfully on chain ${chain.id}. Hash: ${txHash}`)

      // Fallback update to local client state and storage synchronously
      localStorage.setItem(`hupsocial_forwarder_name_override_${chain.id}`, newName)
      setOverrides((prev) => ({ ...prev, [chain.id]: newName }))

      setTxStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, success: true, hash: txHash },
      }))

      // Auto-trigger a verify refresh to demonstrate immediate or pending matching
      setTimeout(() => handleVerify(chain, forwarderAddress), 3000)
    } catch (err) {
      console.error(`On-chain write execution error on chain ${chain.id}:`, err)
      setTxStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Reset override back to code default
  const handleReset = (chainId) => {
    localStorage.removeItem(`hupsocial_forwarder_name_override_${chainId}`)

    const key = `chain${chainId}`
    const defaultContracts = CONTRACTS[key]
    const defaultName = defaultContracts ? defaultContracts.forwarderName : ''

    setOverrides((prev) => {
      const updated = { ...prev }
      delete updated[chainId]
      return updated
    })

    setInputs((prev) => ({ ...prev, [chainId]: defaultName }))
  }

  if (!isConnected) {
    return (
      <>
        <PageTitle name="Admin Contracts" />
        <div className={clsx(styles['admin-contracts'], 'ms-motion-slideDownIn')}>
          <div className={styles['admin-contracts__container']}>
            <p className={styles['admin-contracts__gate']}>Connect your wallet to continue.</p>
          </div>
        </div>
      </>
    )
  }

  if (!isAdmin) {
    return (
      <>
        <PageTitle name="Admin Contracts" />
        <div className={clsx(styles['admin-contracts'], 'ms-motion-slideDownIn')}>
          <div className={styles['admin-contracts__container']}>
            <p className={styles['admin-contracts__gate']}>You do not have permission to access this page.</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle name="Admin Contracts" />
      <div className={clsx(styles['admin-contracts'], 'ms-motion-slideDownIn')}>
        <div className={styles['admin-contracts__container']}>
          <header className={styles['admin-contracts__header']}>
            <h1 className={styles['admin-contracts__title']}>Forwarder Configurations</h1>
            <p className={styles['admin-contracts__subtitle']}>Manage signing domain names for EIP-2771 Meta-Transaction Forwarders.</p>
          <button onClick={test}>update chat forwarder address</button>
          </header>

          <div className={styles['admin-contracts__grid']}>
            {config.chains.map((chain) => {
              const key = `chain${chain.id}`
              const deployment = CONTRACTS[key]
              if (!deployment) return null

              const hasOverride = overrides[chain.id] !== undefined
              const currentName = overrides[chain.id] ?? deployment.forwarderName ?? 'HupChatForwarder'
              const draftName = inputs[chain.id] ?? ''
              const verification = verifications[chain.id]
              const txState = txStates[chain.id]
              const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')

              return (
                <div
                  key={chain.id}
                  className={styles['admin-contracts__card']}
                  style={{
                    '--network-color-primary': chain.primaryColor || '#f97316',
                    '--network-color-text': chain.textColor || '#0d0d0d',
                  }}
                >
                  <div className={styles['admin-contracts__card-header']}>
                    <div className={styles['admin-contracts__network-info']}>
                      <div className={styles['admin-contracts__card-icon']} dangerouslySetInnerHTML={{ __html: chain.icon }} />
                      <h3 className={styles['admin-contracts__card-title']}>{chain.name}</h3>
                    </div>
                    {hasOverride ? (
                      <span className={clsx(styles['admin-contracts__badge'], styles['admin-contracts__badge--override'])}>OVERRIDDEN</span>
                    ) : (
                      <span className={styles['admin-contracts__badge']}>DEFAULT</span>
                    )}
                  </div>

                  <div className={styles['admin-contracts__details']}>
                    <div className={styles['admin-contracts__detail-row']}>
                      <span className={styles['admin-contracts__detail-label']}>Chain ID</span>
                      <span className={styles['admin-contracts__detail-value']}>
                        <code>{chain.id}</code>
                      </span>
                    </div>

                    <div className={styles['admin-contracts__detail-row']}>
                      <span className={styles['admin-contracts__detail-label']}>Forwarder Address</span>
                      <span className={styles['admin-contracts__detail-value']}>
                        {explorerUrl ? (
                          <a href={`${explorerUrl}/address/${deployment.forwarder}`} target="_blank" rel="noopener noreferrer">
                            <code>{deployment.forwarder}</code> ↗
                          </a>
                        ) : (
                          <code>{deployment.forwarder}</code>
                        )}
                      </span>
                    </div>

                    <div className={styles['admin-contracts__detail-row']}>
                      <span className={styles['admin-contracts__detail-label']}>Active Name</span>
                      <span className={styles['admin-contracts__detail-value']}>
                        <strong>{currentName}</strong>
                      </span>
                    </div>

                    {verification && (
                      <div className={styles['admin-contracts__detail-row']}>
                        <span className={styles['admin-contracts__detail-label']}>On-Chain Domain Status</span>
                        <div className={styles['admin-contracts__detail-value']}>
                          {verification.loading && (
                            <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}>
                              Fetching contract domain name...
                            </div>
                          )}
                          {verification.error && (
                            <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                              Error reading EIP-712 domain: {verification.error}
                            </div>
                          )}
                          {verification.verified && (
                            <>
                              {verification.onChainName === currentName ? (
                                <div
                                  className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--success'])}
                                >
                                  ✓ Matches on-chain domain name: &ldquo;{verification.onChainName}&rdquo;
                                </div>
                              ) : (
                                <div
                                  className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}
                                >
                                  ⚠️ Name mismatch! On-chain name is &ldquo;{verification.onChainName}&rdquo; but client will sign with
                                  &ldquo;{currentName}&rdquo;.
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Transaction Status UI Logs */}
                    {txState && (
                      <div className={styles['admin-contracts__detail-row']}>
                        <span className={styles['admin-contracts__detail-label']}>Tx Status</span>
                        <div className={styles['admin-contracts__detail-value']}>
                          {txState.loading && <span style={{ color: '#f59e0b' }}>Signing & broadcasting tx...</span>}
                          {txState.error && <span style={{ color: '#ef4444' }}>❌ {txState.error}</span>}
                          {txState.success && <span style={{ color: '#10b981' }}>🚀 Success! TX sent.</span>}
                        </div>
                      </div>
                    )}
                  </div>

                  <form
                    className={styles['admin-contracts__edit-form']}
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleUpdate(chain, deployment.forwarder, draftName)
                    }}
                  >
                    <div className={styles['admin-contracts__input-group']}>
                      <label className={styles['admin-contracts__detail-label']}>Configure Forwarder Name</label>
                      <input
                        type="text"
                        className={styles['admin-contracts__input']}
                        value={draftName}
                        onChange={(e) => setInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                        placeholder="e.g. HupChatForwarder"
                      />
                    </div>

                    <div className={styles['admin-contracts__actions']}>
                      <button
                        type="submit"
                        disabled={!draftName.trim() || txState?.loading}
                        className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                      >
                        {txState?.loading ? 'Writing...' : 'Apply Name to Contract'}
                      </button>

                      {hasOverride && (
                        <button
                          type="button"
                          onClick={() => handleReset(chain.id)}
                          className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                        >
                          Reset Local Default
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleVerify(chain, deployment.forwarder)}
                        disabled={verification?.loading}
                        className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                      >
                        {verification?.loading ? 'Verifying...' : 'Verify On-Chain'}
                      </button>
                    </div>
                  </form>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
