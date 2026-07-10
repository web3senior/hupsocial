/* @file app/admin/contracts/page.jsx */
'use client'

import { useState, useEffect } from 'react'
import { useConnection, useWriteContract } from 'wagmi' // Hook added here
import { createPublicClient, http, isAddress, keccak256, stringToHex } from 'viem'
import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import { config, CONTRACTS } from '@/config/wagmi'
import storeAbi from '@/abis/HupBazzar.json'
import styles from './page.module.scss'

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS?.toLowerCase()

const OPERATOR_ROLE = keccak256(stringToHex('OPERATOR_ROLE'))

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
  const { mutateAsync: writeContractAsync, isPending: isWritePending } = useWriteContract()

  const [overrides, setOverrides] = useState({})
  const [inputs, setInputs] = useState({})
  const [verifications, setVerifications] = useState({})
  const [txStates, setTxStates] = useState({}) // Keep track of pending transactions per chain
  const [operatorInputs, setOperatorInputs] = useState({})
  const [roleChecks, setRoleChecks] = useState({})
  const [roleTxStates, setRoleTxStates] = useState({})
  const [receiverInputs, setReceiverInputs] = useState({})
  const [tokenInputs, setTokenInputs] = useState({})
  const [tokenIsLsp7, setTokenIsLsp7] = useState({})
  const [nativeWithdrawStates, setNativeWithdrawStates] = useState({})
  const [tokenWithdrawStates, setTokenWithdrawStates] = useState({})

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

  // Check whether an address currently holds OPERATOR_ROLE on the chain's HupBazzar
  const handleCheckOperator = async (chain, storeAddress) => {
    const operator = operatorInputs[chain.id]?.trim()
    if (!isAddress(operator)) {
      setRoleChecks((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid address' } }))
      return
    }

    setRoleChecks((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) })
      const hasRole = await client.readContract({
        address: storeAddress,
        abi: storeAbi,
        functionName: 'hasRole',
        args: [OPERATOR_ROLE, operator],
      })

      setRoleChecks((prev) => ({ ...prev, [chain.id]: { loading: false, checked: operator, hasRole } }))
    } catch (err) {
      console.error(`Role check error for chain ${chain.id}:`, err)
      setRoleChecks((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read role' },
      }))
    }
  }

  // Grant or revoke OPERATOR_ROLE on the chain's HupBazzar (admin wallet signs)
  const handleOperatorRole = async (chain, storeAddress, grant) => {
    const operator = operatorInputs[chain.id]?.trim()
    if (!isAddress(operator)) {
      setRoleTxStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid address' } }))
      return
    }

    setRoleTxStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: storeAddress,
        abi: storeAbi,
        functionName: grant ? 'grantRole' : 'revokeRole',
        args: [OPERATOR_ROLE, operator],
        chainId: chain.id,
      })

      setRoleTxStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, success: true, hash: txHash, action: grant ? 'granted' : 'revoked' },
      }))

      // Refresh the role check shortly after so the result reflects the new state
      setTimeout(() => handleCheckOperator(chain, storeAddress), 3000)
    } catch (err) {
      console.error(`Role ${grant ? 'grant' : 'revoke'} error on chain ${chain.id}:`, err)
      setRoleTxStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Withdraw the store's full native token balance to an address
  const handleWithdrawNative = async (chain, storeAddress) => {
    const receiver = receiverInputs[chain.id]?.trim()
    if (!isAddress(receiver)) {
      setNativeWithdrawStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid receiver address' } }))
      return
    }

    setNativeWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: storeAddress,
        abi: storeAbi,
        functionName: 'withdrawAll',
        args: [receiver],
        chainId: chain.id,
      })

      setNativeWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))
    } catch (err) {
      console.error(`Native withdrawal error on chain ${chain.id}:`, err)
      setNativeWithdrawStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Withdraw the store's full ERC20/LSP7 token balance to an address
  const handleWithdrawToken = async (chain, storeAddress) => {
    const receiver = receiverInputs[chain.id]?.trim()
    const token = tokenInputs[chain.id]?.trim()
    const isLsp7 = Boolean(tokenIsLsp7[chain.id])

    if (!isAddress(receiver) || !isAddress(token)) {
      setTokenWithdrawStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid token and receiver address' } }))
      return
    }

    setTokenWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: storeAddress,
        abi: storeAbi,
        functionName: 'withdrawAllToken',
        args: [token, receiver, isLsp7],
        chainId: chain.id,
      })

      setTokenWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))
    } catch (err) {
      console.error(`Token withdrawal error on chain ${chain.id}:`, err)
      setTokenWithdrawStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
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
                      <div className={styles['admin-contracts__card-icon']}>
                        <img src={chain.iconUrl} alt="" />
                      </div>
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
                          {txState.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
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

          <header className={styles['admin-contracts__header']}>
            <h1 className={styles['admin-contracts__title']}>HupBazzar Operator Role</h1>
            <p className={styles['admin-contracts__subtitle']}>
              Grant or revoke OPERATOR_ROLE on HupBazzar deployments — required for the x402 settlement wallet to call grantPurchase.
            </p>
          </header>

          <div className={styles['admin-contracts__grid']}>
            {config.chains.map((chain) => {
              const deployment = CONTRACTS[`chain${chain.id}`]
              if (!deployment?.store) return null

              const operatorDraft = operatorInputs[chain.id] ?? ''
              const roleCheck = roleChecks[chain.id]
              const roleTx = roleTxStates[chain.id]
              const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')

              return (
                <div
                  key={`store-${chain.id}`}
                  className={styles['admin-contracts__card']}
                  style={{
                    '--network-color-primary': chain.primaryColor || '#f97316',
                    '--network-color-text': chain.textColor || '#0d0d0d',
                  }}
                >
                  <div className={styles['admin-contracts__card-header']}>
                    <div className={styles['admin-contracts__network-info']}>
                      <div className={styles['admin-contracts__card-icon']}>
                        <img src={chain.iconUrl} alt="" />
                      </div>
                      <h3 className={styles['admin-contracts__card-title']}>{chain.name}</h3>
                    </div>
                    <span className={styles['admin-contracts__badge']}>HUPBAZZAR</span>
                  </div>

                  <div className={styles['admin-contracts__details']}>
                    <div className={styles['admin-contracts__detail-row']}>
                      <span className={styles['admin-contracts__detail-label']}>Store Address</span>
                      <span className={styles['admin-contracts__detail-value']}>
                        {explorerUrl ? (
                          <a href={`${explorerUrl}/address/${deployment.store}`} target="_blank" rel="noopener noreferrer">
                            <code>{deployment.store}</code> ↗
                          </a>
                        ) : (
                          <code>{deployment.store}</code>
                        )}
                      </span>
                    </div>

                    {roleCheck && !roleCheck.loading && (
                      <div className={styles['admin-contracts__detail-row']}>
                        <span className={styles['admin-contracts__detail-label']}>Role Status</span>
                        <div className={styles['admin-contracts__detail-value']}>
                          {roleCheck.error && (
                            <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                              {roleCheck.error}
                            </div>
                          )}
                          {roleCheck.checked && roleCheck.hasRole && (
                            <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--success'])}>
                              ✓ {roleCheck.checked.slice(0, 6)}...{roleCheck.checked.slice(-4)} holds OPERATOR_ROLE
                            </div>
                          )}
                          {roleCheck.checked && !roleCheck.hasRole && (
                            <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}>
                              {roleCheck.checked.slice(0, 6)}...{roleCheck.checked.slice(-4)} does not hold OPERATOR_ROLE
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {roleTx && (
                      <div className={styles['admin-contracts__detail-row']}>
                        <span className={styles['admin-contracts__detail-label']}>Tx Status</span>
                        <div className={styles['admin-contracts__detail-value']}>
                          {roleTx.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                          {roleTx.error && <span style={{ color: '#ef4444' }}>❌ {roleTx.error}</span>}
                          {roleTx.success && <span style={{ color: '#10b981' }}>🚀 Role {roleTx.action}.</span>}
                        </div>
                      </div>
                    )}
                  </div>

                  <form
                    className={styles['admin-contracts__edit-form']}
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleOperatorRole(chain, deployment.store, true)
                    }}
                  >
                    <div className={styles['admin-contracts__input-group']}>
                      <label className={styles['admin-contracts__detail-label']}>Operator Wallet Address</label>
                      <input
                        type="text"
                        className={styles['admin-contracts__input']}
                        value={operatorDraft}
                        onChange={(e) => setOperatorInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                        placeholder="0x..."
                      />
                    </div>

                    <div className={styles['admin-contracts__actions']}>
                      <button
                        type="submit"
                        disabled={!operatorDraft.trim() || roleTx?.loading}
                        className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                      >
                        {roleTx?.loading ? 'Writing...' : 'Grant OPERATOR_ROLE'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOperatorRole(chain, deployment.store, false)}
                        disabled={!operatorDraft.trim() || roleTx?.loading}
                        className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                      >
                        Revoke
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCheckOperator(chain, deployment.store)}
                        disabled={!operatorDraft.trim() || roleCheck?.loading}
                        className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                      >
                        {roleCheck?.loading ? 'Checking...' : 'Check Role'}
                      </button>
                    </div>
                  </form>
                </div>
              )
            })}
          </div>

          <header className={styles['admin-contracts__header']}>
            <h1 className={styles['admin-contracts__title']}>HupBazzar Treasury</h1>
            <p className={styles['admin-contracts__subtitle']}>
              Withdraw accumulated listing/buy fees from HupBazzar — native token balance, or any ERC20/LSP7 token balance.
            </p>
          </header>

          <div className={styles['admin-contracts__grid']}>
            {config.chains.map((chain) => {
              const deployment = CONTRACTS[`chain${chain.id}`]
              if (!deployment?.store) return null

              const receiverDraft = receiverInputs[chain.id] ?? ''
              const tokenDraft = tokenInputs[chain.id] ?? ''
              const isLsp7 = Boolean(tokenIsLsp7[chain.id])
              const nativeState = nativeWithdrawStates[chain.id]
              const tokenState = tokenWithdrawStates[chain.id]
              const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')

              return (
                <div
                  key={`treasury-${chain.id}`}
                  className={styles['admin-contracts__card']}
                  style={{
                    '--network-color-primary': chain.primaryColor || '#f97316',
                    '--network-color-text': chain.textColor || '#0d0d0d',
                  }}
                >
                  <div className={styles['admin-contracts__card-header']}>
                    <div className={styles['admin-contracts__network-info']}>
                      <div className={styles['admin-contracts__card-icon']}>
                        <img src={chain.iconUrl} alt="" />
                      </div>
                      <h3 className={styles['admin-contracts__card-title']}>{chain.name}</h3>
                    </div>
                    <span className={styles['admin-contracts__badge']}>HUPBAZZAR</span>
                  </div>

                  <div className={styles['admin-contracts__details']}>
                    <div className={styles['admin-contracts__detail-row']}>
                      <span className={styles['admin-contracts__detail-label']}>Store Address</span>
                      <span className={styles['admin-contracts__detail-value']}>
                        {explorerUrl ? (
                          <a href={`${explorerUrl}/address/${deployment.store}`} target="_blank" rel="noopener noreferrer">
                            <code>{deployment.store}</code> ↗
                          </a>
                        ) : (
                          <code>{deployment.store}</code>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className={styles['admin-contracts__input-group']}>
                    <label className={styles['admin-contracts__detail-label']}>Receiver Address</label>
                    <input
                      type="text"
                      className={styles['admin-contracts__input']}
                      value={receiverDraft}
                      onChange={(e) => setReceiverInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                      placeholder="0x..."
                    />
                  </div>

                  <form
                    className={styles['admin-contracts__edit-form']}
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleWithdrawNative(chain, deployment.store)
                    }}
                  >
                    {nativeState && (
                      <div className={styles['admin-contracts__detail-row']}>
                        <span className={styles['admin-contracts__detail-label']}>Native Withdrawal</span>
                        <div className={styles['admin-contracts__detail-value']}>
                          {nativeState.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                          {nativeState.error && <span style={{ color: '#ef4444' }}>❌ {nativeState.error}</span>}
                          {nativeState.success && <span style={{ color: '#10b981' }}>🚀 Withdrawn.</span>}
                        </div>
                      </div>
                    )}

                    <div className={styles['admin-contracts__actions']}>
                      <button
                        type="submit"
                        disabled={!receiverDraft.trim() || nativeState?.loading}
                        className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                      >
                        {nativeState?.loading ? 'Withdrawing...' : 'Withdraw Native Balance'}
                      </button>
                    </div>
                  </form>

                  <form
                    className={styles['admin-contracts__edit-form']}
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleWithdrawToken(chain, deployment.store)
                    }}
                  >
                    <div className={styles['admin-contracts__input-group']}>
                      <label className={styles['admin-contracts__detail-label']}>Token Address</label>
                      <input
                        type="text"
                        className={styles['admin-contracts__input']}
                        value={tokenDraft}
                        onChange={(e) => setTokenInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                        placeholder="0x..."
                      />
                    </div>

                    <label className={styles['admin-contracts__detail-label']} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={isLsp7}
                        onChange={(e) => setTokenIsLsp7((prev) => ({ ...prev, [chain.id]: e.target.checked }))}
                      />
                      This token is an LSP7 Digital Asset (LUKSO), not an ERC20
                    </label>

                    {tokenState && (
                      <div className={styles['admin-contracts__detail-row']}>
                        <span className={styles['admin-contracts__detail-label']}>Token Withdrawal</span>
                        <div className={styles['admin-contracts__detail-value']}>
                          {tokenState.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                          {tokenState.error && <span style={{ color: '#ef4444' }}>❌ {tokenState.error}</span>}
                          {tokenState.success && <span style={{ color: '#10b981' }}>🚀 Withdrawn.</span>}
                        </div>
                      </div>
                    )}

                    <div className={styles['admin-contracts__actions']}>
                      <button
                        type="submit"
                        disabled={!receiverDraft.trim() || !tokenDraft.trim() || tokenState?.loading}
                        className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                      >
                        {tokenState?.loading ? 'Withdrawing...' : 'Withdraw Token Balance'}
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
