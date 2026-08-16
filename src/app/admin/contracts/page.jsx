/* @file app/admin/contracts/page.jsx */
'use client'

import { useState, useEffect, useRef } from 'react'
import { useConnection, useWriteContract } from 'wagmi' // Hook added here
import { createPublicClient, http, isAddress, keccak256, stringToHex, formatEther, parseEther, zeroAddress } from 'viem'
import Link from 'next/link'
import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import { config, CONTRACTS } from '@/config/wagmi'
import storeAbi from '@/abis/HupBazaar.json'
import eventsAbi from '@/abis/HupEvents.json'
import appsAbi from '@/abis/HupApps.json'
import predictAbi from '@/abis/HupPredict.json'
import tradeAbi from '@/abis/HupTrade.json'
import offersAbi from '@/abis/HupOffers.json'
import tipperAbi from '@/abis/HupTipper.json'
import communityAbi from '@/abis/HupCommunity.json'
import dropsAbi from '@/abis/HupDrops.json'
import { dropStandardLabel, dropStandardsFor } from '@/lib/drops'
import { TIP_TOKENS } from '@/lib/tokens'
import styles from './page.module.scss'

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS?.toLowerCase()

const OPERATOR_ROLE = keccak256(stringToHex('OPERATOR_ROLE'))

// setErc677Token/onTokenTransfer landed in HupTipper 1.1.0 — older deployments have no such
// function, so writing to them would revert. Gate the whole card on the version it reports.
const supportsErc677 = (version) => {
  const [major = 0, minor = 0] = String(version ?? '')
    .split('.')
    .map(Number)
  return major > 1 || (major === 1 && minor >= 1)
}

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

// Contracts whose native balance the overview tracks, in display order. Keys map to the
// per-chain entries in CONTRACTS — anything unset on a given chain is skipped.
const BALANCE_CONTRACTS = [
  { key: 'hup', label: 'Hup' },
  { key: 'status', label: 'HupStatus' },
  { key: 'chat', label: 'HupChat' },
  { key: 'store', label: 'HupBazaar' },
  { key: 'tipper', label: 'HupTipper' },
  { key: 'trade', label: 'HupTrade' },
  { key: 'offers', label: 'HupOffers' },
  { key: 'events', label: 'HupEvents' },
  { key: 'predict', label: 'HupPredict' },
  { key: 'apps', label: 'HupApps' },
  { key: 'drops', label: 'HupDrops' },
  { key: 'community', label: 'HupCommunity' },
  { key: 'miner', label: 'HupMiner' },
  { key: 'forwarder', label: 'Forwarder' },
  { key: 'followerSystem', label: 'Follower System' },
]

// Native amounts span ETH and MON-sized units, so cap the decimals with Intl rather than
// printing raw ether strings — but never round dust down to a flat "0", which would read
// as an empty contract.
const formatNative = (wei) => {
  const value = Number(formatEther(wei ?? 0n))
  if (value === 0) return '0'
  if (value < 0.0001) return '<0.0001'
  return new Intl.NumberFormat('en', { maximumFractionDigits: 4 }).format(value)
}

// One card per chain per contract adds up to a hundred-plus cards, so each group is a tab
// rather than another stretch of scroll. `contractKey` is the CONTRACTS field a chain must
// have set for the tab to have anything to show (null = every configured chain).
const SECTIONS = [
  { id: 'balances', label: 'Balances', icon: '💰', contractKey: null },
  { id: 'forwarders', label: 'Forwarders', icon: '✍️', contractKey: 'forwarder' },
  { id: 'bazaar-roles', label: 'Bazaar Roles', icon: '🛡️', contractKey: 'store' },
  { id: 'bazaar-treasury', label: 'Bazaar Treasury', icon: '🏦', contractKey: 'store' },
  { id: 'events', label: 'Events', icon: '🎟️', contractKey: 'events' },
  { id: 'apps', label: 'Apps', icon: '🧩', contractKey: 'apps' },
  { id: 'predict', label: 'Predict', icon: '🎲', contractKey: 'predict' },
  { id: 'trade', label: 'Trade', icon: '🖼️', contractKey: 'trade' },
  { id: 'offers', label: 'Offers', icon: '🤝', contractKey: 'offers' },
  { id: 'tipper', label: 'Tipper', icon: '💸', contractKey: 'tipper' },
  { id: 'drops', label: 'Drops', icon: '🎨', contractKey: 'drops' },
  { id: 'community', label: 'Community', icon: '👥', contractKey: 'community' },
]

const DEFAULT_SECTION = SECTIONS[0].id

// A chain belongs in a tab only when it actually has that contract deployed — an empty string
// in CONTRACTS means "not on this chain", and a card for it is a form that can only revert.
const chainsWithContract = (contractKey) =>
  config.chains.filter((chain) => {
    const deployment = CONTRACTS[`chain${chain.id}`]
    if (!deployment) return false
    return contractKey ? isAddress(deployment[contractKey] ?? '') : true
  })

export default function Page() {
  const { address, isConnected } = useConnection()
  const { mutateAsync: writeContractAsync, isPending: isWritePending } = useWriteContract()

  const tabsRef = useRef(null)
  const [activeSection, setActiveSection] = useState(DEFAULT_SECTION)
  const [chainFilter, setChainFilter] = useState('all')
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
  const [eventsFees, setEventsFees] = useState({})
  const [eventsFeeInputs, setEventsFeeInputs] = useState({})
  const [eventsFeeTxStates, setEventsFeeTxStates] = useState({})
  const [eventsReceiverInputs, setEventsReceiverInputs] = useState({})
  const [eventsWithdrawStates, setEventsWithdrawStates] = useState({})
  const [appsFees, setAppsFees] = useState({})
  const [appsFeeInputs, setAppsFeeInputs] = useState({})
  const [appsFeeTxStates, setAppsFeeTxStates] = useState({})
  const [appsReceiverInputs, setAppsReceiverInputs] = useState({})
  const [appsWithdrawStates, setAppsWithdrawStates] = useState({})
  const [predictConfigs, setPredictConfigs] = useState({})
  const [predictInputs, setPredictInputs] = useState({})
  const [predictTxStates, setPredictTxStates] = useState({})
  const [predictReceiverInputs, setPredictReceiverInputs] = useState({})
  const [predictTokenInputs, setPredictTokenInputs] = useState({})
  const [predictWithdrawStates, setPredictWithdrawStates] = useState({})
  const [tradeFees, setTradeFees] = useState({})
  const [tradeFeeInputs, setTradeFeeInputs] = useState({})
  const [tradeFeeTxStates, setTradeFeeTxStates] = useState({})
  const [tradeReceiverInputs, setTradeReceiverInputs] = useState({})
  const [tradeTokenInputs, setTradeTokenInputs] = useState({})
  const [tradeTokenIsLsp7, setTradeTokenIsLsp7] = useState({})
  const [tradeWithdrawStates, setTradeWithdrawStates] = useState({})
  const [offerFees, setOfferFees] = useState({})
  const [offerFeeInputs, setOfferFeeInputs] = useState({})
  const [offerFeeTxStates, setOfferFeeTxStates] = useState({})
  const [offerReceiverInputs, setOfferReceiverInputs] = useState({})
  const [offerTokenInputs, setOfferTokenInputs] = useState({})
  const [offerTokenIsLsp7, setOfferTokenIsLsp7] = useState({})
  const [offerWithdrawStates, setOfferWithdrawStates] = useState({})
  const [tipperVersions, setTipperVersions] = useState({})
  const [erc677Inputs, setErc677Inputs] = useState({})
  const [erc677Checks, setErc677Checks] = useState({})
  const [erc677TxStates, setErc677TxStates] = useState({})
  const [contractBalances, setContractBalances] = useState({})
  const [communityFollowerSystems, setCommunityFollowerSystems] = useState({})
  const [followerSystemInputs, setFollowerSystemInputs] = useState({})
  const [followerSystemTxStates, setFollowerSystemTxStates] = useState({})
  const [dropsConfigs, setDropsConfigs] = useState({})
  const [dropsDeployerInputs, setDropsDeployerInputs] = useState({})
  const [dropsDeployerTxStates, setDropsDeployerTxStates] = useState({})
  const [dropsFollowerInputs, setDropsFollowerInputs] = useState({})
  const [dropsFollowerTxStates, setDropsFollowerTxStates] = useState({})
  const [dropsFeeInputs, setDropsFeeInputs] = useState({})
  const [dropsFeeTxStates, setDropsFeeTxStates] = useState({})
  const [dropsReceiverInputs, setDropsReceiverInputs] = useState({})
  const [dropsWithdrawStates, setDropsWithdrawStates] = useState({})

  const isAdmin = isConnected && address?.toLowerCase() === ADMIN_WALLET

  // The chains a tab renders: those running that contract, narrowed by the chain chip. Tab
  // counts read from the same helper, so picking a chain also shows which groups it is in.
  const visibleChains = (contractKey) =>
    chainsWithContract(contractKey).filter((chain) => chainFilter === 'all' || chain.id === chainFilter)

  // Deep-link the open tab so a reload — or a link pasted to someone else — lands on the same
  // group instead of dumping them back at Balances
  useEffect(() => {
    const fromHash = window.location.hash.slice(1)
    if (SECTIONS.some((section) => section.id === fromHash)) setActiveSection(fromHash)
  }, [])

  const selectSection = (id) => {
    setActiveSection(id)
    window.history.replaceState(null, '', `#${id}`)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  // The strip scrolls sideways, so a deep-linked tab near the end opens off screen — pull it back
  // in. Instant, because the app sets scroll-behavior: smooth globally and this would animate.
  // `isAdmin` is a dependency because the strip only mounts once the gate below opens: on a deep
  // link the hash resolves while the page still shows "connect your wallet", and without it this
  // would run against a ref that is still null.
  useEffect(() => {
    tabsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' })
  }, [activeSection, isAdmin])

  // Read the native-coin balance of every deployed contract on a chain. This is the money the
  // withdraw forms further down move out, so it doubles as a pre-flight check before signing.
  const loadChainBalances = async (chain) => {
    const deployment = CONTRACTS[`chain${chain.id}`]
    if (!deployment) return

    const targets = BALANCE_CONTRACTS.map(({ key, label }) => ({ key, label, address: deployment[key] })).filter((target) =>
      isAddress(target.address ?? '')
    )
    if (targets.length === 0) return

    setContractBalances((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], loading: true, error: null } }))

    try {
      const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) })
      const values = await Promise.all(targets.map((target) => client.getBalance({ address: target.address })))
      const items = targets.map((target, index) => ({ ...target, value: values[index] }))
      const total = items.reduce((sum, item) => sum + item.value, 0n)

      setContractBalances((prev) => ({ ...prev, [chain.id]: { loading: false, items, total } }))
    } catch (err) {
      console.error(`Balance read error for chain ${chain.id}:`, err)
      setContractBalances((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read balances' },
      }))
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    config.chains.forEach((chain) => loadChainBalances(chain))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // Pull a single contract's balance out of the overview so the withdraw cards can show what
  // they are about to move without issuing their own RPC call
  const balanceOf = (chainId, contractAddress) => contractBalances[chainId]?.items?.find((item) => item.address === contractAddress)?.value

  // Render that balance for a withdraw card — an em dash when the chain's read failed, so a
  // dead RPC reads as "unknown" instead of spinning forever
  const renderBalance = (chainId, contractAddress, symbol) => {
    const value = balanceOf(chainId, contractAddress)
    if (value === undefined) return <span>{contractBalances[chainId]?.error ? '—' : 'Loading…'}</span>

    return (
      <strong>
        {formatNative(value)} {symbol}
      </strong>
    )
  }

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

  // Check whether an address currently holds OPERATOR_ROLE on the chain's HupBazaar
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

  // Grant or revoke OPERATOR_ROLE on the chain's HupBazaar (admin wallet signs)
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

      setTimeout(() => loadChainBalances(chain), 3000)
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

  // Read current listing/featured fees from a chain's HupEvents deployment
  const loadEventsFees = async (chain, eventsAddress) => {
    setEventsFees((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) })
      const [listingFee, featuredFee] = await Promise.all([
        client.readContract({ address: eventsAddress, abi: eventsAbi, functionName: 'listingFee' }),
        client.readContract({ address: eventsAddress, abi: eventsAbi, functionName: 'featuredFee' }),
      ])

      setEventsFees((prev) => ({ ...prev, [chain.id]: { loading: false, listingFee, featuredFee } }))
    } catch (err) {
      console.error(`Events fee read error for chain ${chain.id}:`, err)
      setEventsFees((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read fees' },
      }))
    }
  }

  // Load current fees for every chain with a HupEvents deployment once the admin is in
  useEffect(() => {
    if (!isAdmin) return
    config.chains.forEach((chain) => {
      const eventsAddress = CONTRACTS[`chain${chain.id}`]?.events
      if (eventsAddress) loadEventsFees(chain, eventsAddress)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // Set the flat listing fee or the featured surcharge on a chain's HupEvents (admin wallet signs)
  const handleSetEventsFee = async (chain, eventsAddress, which) => {
    const draft = eventsFeeInputs[chain.id]?.[which]?.trim()
    let value
    try {
      value = parseEther(draft || '')
    } catch {
      setEventsFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, error: 'Enter a valid amount in native units' } }))
      return
    }

    setEventsFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: eventsAddress,
        abi: eventsAbi,
        functionName: which === 'listing' ? 'setListingFee' : 'setFeaturedFee',
        args: [value],
        chainId: chain.id,
      })

      setEventsFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, loading: false, success: true, hash: txHash } }))

      // Refresh the displayed fees shortly after so the card reflects the new values
      setTimeout(() => loadEventsFees(chain, eventsAddress), 3000)
    } catch (err) {
      console.error(`Events ${which} fee update error on chain ${chain.id}:`, err)
      setEventsFeeTxStates((prev) => ({
        ...prev,
        [chain.id]: { which, loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Withdraw the HupEvents contract's full native balance (accumulated listing fees)
  const handleWithdrawEvents = async (chain, eventsAddress) => {
    const receiver = eventsReceiverInputs[chain.id]?.trim()
    if (!isAddress(receiver)) {
      setEventsWithdrawStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid receiver address' } }))
      return
    }

    setEventsWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: eventsAddress,
        abi: eventsAbi,
        functionName: 'withdrawAll',
        args: [receiver],
        chainId: chain.id,
      })

      setEventsWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadChainBalances(chain), 3000)
    } catch (err) {
      console.error(`Events withdrawal error on chain ${chain.id}:`, err)
      setEventsWithdrawStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Read current listing/featured fees from a chain's HupApps deployment. HupApps exposes the
  // same fee surface as HupEvents by design, so this section mirrors the events one.
  const loadAppsFees = async (chain, appsAddress) => {
    setAppsFees((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) })
      const [listingFee, featuredFee] = await Promise.all([
        client.readContract({ address: appsAddress, abi: appsAbi, functionName: 'listingFee' }),
        client.readContract({ address: appsAddress, abi: appsAbi, functionName: 'featuredFee' }),
      ])

      setAppsFees((prev) => ({ ...prev, [chain.id]: { loading: false, listingFee, featuredFee } }))
    } catch (err) {
      console.error(`Apps fee read error for chain ${chain.id}:`, err)
      setAppsFees((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read fees' },
      }))
    }
  }

  // Load current fees for every chain with a HupApps deployment once the admin is in
  useEffect(() => {
    if (!isAdmin) return
    config.chains.forEach((chain) => {
      const appsAddress = CONTRACTS[`chain${chain.id}`]?.apps
      if (appsAddress) loadAppsFees(chain, appsAddress)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // Set the flat listing fee or the featured surcharge on a chain's HupApps (admin wallet signs)
  const handleSetAppsFee = async (chain, appsAddress, which) => {
    const draft = appsFeeInputs[chain.id]?.[which]?.trim()
    let value
    try {
      value = parseEther(draft || '')
    } catch {
      setAppsFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, error: 'Enter a valid amount in native units' } }))
      return
    }

    setAppsFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: appsAddress,
        abi: appsAbi,
        functionName: which === 'listing' ? 'setListingFee' : 'setFeaturedFee',
        args: [value],
        chainId: chain.id,
      })

      setAppsFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, loading: false, success: true, hash: txHash } }))

      // Refresh the displayed fees shortly after so the card reflects the new values
      setTimeout(() => loadAppsFees(chain, appsAddress), 3000)
    } catch (err) {
      console.error(`Apps ${which} fee update error on chain ${chain.id}:`, err)
      setAppsFeeTxStates((prev) => ({
        ...prev,
        [chain.id]: { which, loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Withdraw the HupApps contract's full native balance (accumulated listing fees)
  const handleWithdrawApps = async (chain, appsAddress) => {
    const receiver = appsReceiverInputs[chain.id]?.trim()
    if (!isAddress(receiver)) {
      setAppsWithdrawStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid receiver address' } }))
      return
    }

    setAppsWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: appsAddress,
        abi: appsAbi,
        functionName: 'withdrawAll',
        args: [receiver],
        chainId: chain.id,
      })

      setAppsWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadChainBalances(chain), 3000)
    } catch (err) {
      console.error(`Apps withdrawal error on chain ${chain.id}:`, err)
      setAppsWithdrawStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Read the live HupPredict config from a chain's deployment: protocol fee, resolve
  // window, and the accrued native-coin fee ledger (token fees are read ad hoc)
  const loadPredictConfig = async (chain, predictAddress) => {
    setPredictConfigs((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) })
      const [feeBps, creatorFeeBps, featuredFee, resolveWindow, nativeFees] = await Promise.all([
        client.readContract({ address: predictAddress, abi: predictAbi, functionName: 'predictFeeBps' }),
        client.readContract({ address: predictAddress, abi: predictAbi, functionName: 'creatorFeeBps' }),
        client.readContract({ address: predictAddress, abi: predictAbi, functionName: 'featuredFee' }),
        client.readContract({ address: predictAddress, abi: predictAbi, functionName: 'resolveWindow' }),
        client.readContract({ address: predictAddress, abi: predictAbi, functionName: 'accruedFees', args: [zeroAddress] }),
      ])

      setPredictConfigs((prev) => ({
        ...prev,
        [chain.id]: { loading: false, feeBps, creatorFeeBps, featuredFee, resolveWindow, nativeFees },
      }))
    } catch (err) {
      console.error(`Predict config read error for chain ${chain.id}:`, err)
      setPredictConfigs((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read config' },
      }))
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    config.chains.forEach((chain) => {
      const predictAddress = CONTRACTS[`chain${chain.id}`]?.predict
      if (predictAddress) loadPredictConfig(chain, predictAddress)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // Set the protocol fee (entered in %, stored in bps, snapshotted into new markets only)
  // or the resolve window (entered in days) on a chain's HupPredict (admin wallet signs)
  const handleSetPredictConfig = async (chain, predictAddress, which) => {
    const draft = predictInputs[chain.id]?.[which]?.trim()
    let functionName
    let value

    if (which === 'fee' || which === 'creatorFee') {
      const percent = Number(draft)
      if (!Number.isFinite(percent) || percent < 0 || percent > 10) {
        setPredictTxStates((prev) => ({ ...prev, [chain.id]: { which, error: 'Fee must be 0–10%' } }))
        return
      }
      // The contract enforces the real cap: platform + creator combined ≤ 10%
      functionName = which === 'fee' ? 'setPredictFeeBps' : 'setCreatorFeeBps'
      value = BigInt(Math.round(percent * 100))
    } else if (which === 'featured') {
      try {
        value = parseEther(draft || '')
      } catch {
        setPredictTxStates((prev) => ({ ...prev, [chain.id]: { which, error: 'Enter a valid amount in native units' } }))
        return
      }
      functionName = 'setFeaturedFee'
    } else {
      const days = Number(draft)
      if (!Number.isFinite(days) || days < 1 || days > 90) {
        setPredictTxStates((prev) => ({ ...prev, [chain.id]: { which, error: 'Window must be 1–90 days' } }))
        return
      }
      functionName = 'setResolveWindow'
      value = BigInt(Math.round(days * 86400))
    }

    setPredictTxStates((prev) => ({ ...prev, [chain.id]: { which, loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: predictAddress,
        abi: predictAbi,
        functionName,
        args: [value],
        chainId: chain.id,
      })

      setPredictTxStates((prev) => ({ ...prev, [chain.id]: { which, loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadPredictConfig(chain, predictAddress), 3000)
    } catch (err) {
      console.error(`Predict ${which} update error on chain ${chain.id}:`, err)
      setPredictTxStates((prev) => ({
        ...prev,
        [chain.id]: { which, loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Withdraw accrued protocol fees for one stake token (empty token input = native coin).
  // Only the fee ledger is withdrawable — escrowed stakes are untouchable by design.
  const handleWithdrawPredictFees = async (chain, predictAddress) => {
    const receiver = predictReceiverInputs[chain.id]?.trim()
    const tokenDraft = predictTokenInputs[chain.id]?.trim()
    const token = tokenDraft ? tokenDraft : zeroAddress

    if (!isAddress(receiver) || (tokenDraft && !isAddress(tokenDraft))) {
      setPredictWithdrawStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid receiver (and token) address' } }))
      return
    }

    setPredictWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: predictAddress,
        abi: predictAbi,
        functionName: 'withdrawFees',
        args: [token, receiver],
        chainId: chain.id,
      })

      setPredictWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))

      setTimeout(() => {
        loadPredictConfig(chain, predictAddress)
        loadChainBalances(chain)
      }, 3000)
    } catch (err) {
      console.error(`Predict fee withdrawal error on chain ${chain.id}:`, err)
      setPredictWithdrawStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Read the current sale fee from a chain's HupTrade deployment
  const loadTradeFee = async (chain, tradeAddress) => {
    setTradeFees((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) })
      const feeBps = await client.readContract({ address: tradeAddress, abi: tradeAbi, functionName: 'tradeFeeBps' })

      setTradeFees((prev) => ({ ...prev, [chain.id]: { loading: false, feeBps } }))
    } catch (err) {
      console.error(`Trade fee read error for chain ${chain.id}:`, err)
      setTradeFees((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read fee' },
      }))
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    config.chains.forEach((chain) => {
      const tradeAddress = CONTRACTS[`chain${chain.id}`]?.trade
      if (tradeAddress) loadTradeFee(chain, tradeAddress)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // Set the sale fee (entered in %, stored in bps, hard-capped at 10%) on a chain's HupTrade
  const handleSetTradeFee = async (chain, tradeAddress) => {
    const percent = Number(tradeFeeInputs[chain.id]?.trim())
    if (!Number.isFinite(percent) || percent < 0 || percent > 10) {
      setTradeFeeTxStates((prev) => ({ ...prev, [chain.id]: { error: 'Fee must be 0–10%' } }))
      return
    }

    setTradeFeeTxStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: tradeAddress,
        abi: tradeAbi,
        functionName: 'setTradeFeeBps',
        args: [BigInt(Math.round(percent * 100))],
        chainId: chain.id,
      })

      setTradeFeeTxStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadTradeFee(chain, tradeAddress), 3000)
    } catch (err) {
      console.error(`Trade fee update error on chain ${chain.id}:`, err)
      setTradeFeeTxStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Withdraw HupTrade's accumulated fees: native balance, or a token balance (ERC20/LSP7)
  const handleWithdrawTrade = async (chain, tradeAddress, asToken) => {
    const receiver = tradeReceiverInputs[chain.id]?.trim()
    const token = tradeTokenInputs[chain.id]?.trim()

    if (!isAddress(receiver) || (asToken && !isAddress(token))) {
      setTradeWithdrawStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid receiver (and token) address' } }))
      return
    }

    setTradeWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: tradeAddress,
        abi: tradeAbi,
        functionName: asToken ? 'withdrawAllToken' : 'withdrawAll',
        args: asToken ? [token, receiver, Boolean(tradeTokenIsLsp7[chain.id])] : [receiver],
        chainId: chain.id,
      })

      setTradeWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))

      if (!asToken) setTimeout(() => loadChainBalances(chain), 3000)
    } catch (err) {
      console.error(`Trade withdrawal error on chain ${chain.id}:`, err)
      setTradeWithdrawStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Read a chain's HupOffers fee alongside its accrued native fees. Both matter together:
  // unlike HupTrade, this contract's balance is mostly live offer escrow, so only the
  // accrual counter says what an admin can actually take out.
  const loadOfferFee = async (chain, offersAddress) => {
    setOfferFees((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) })
      const [feeBps, accruedNative] = await Promise.all([
        client.readContract({ address: offersAddress, abi: offersAbi, functionName: 'offerFeeBps' }),
        client.readContract({ address: offersAddress, abi: offersAbi, functionName: 'accruedFees', args: [zeroAddress] }),
      ])

      setOfferFees((prev) => ({ ...prev, [chain.id]: { loading: false, feeBps, accruedNative } }))
    } catch (err) {
      console.error(`Offer fee read error for chain ${chain.id}:`, err)
      setOfferFees((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read fee' },
      }))
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    config.chains.forEach((chain) => {
      const offersAddress = CONTRACTS[`chain${chain.id}`]?.offers
      if (offersAddress) loadOfferFee(chain, offersAddress)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // Set the offer fee (entered in %, stored in bps, hard-capped at 10%) on a chain's HupOffers
  const handleSetOfferFee = async (chain, offersAddress) => {
    const percent = Number(offerFeeInputs[chain.id]?.trim())
    if (!Number.isFinite(percent) || percent < 0 || percent > 10) {
      setOfferFeeTxStates((prev) => ({ ...prev, [chain.id]: { error: 'Fee must be 0–10%' } }))
      return
    }

    setOfferFeeTxStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: offersAddress,
        abi: offersAbi,
        functionName: 'setOfferFeeBps',
        args: [BigInt(Math.round(percent * 100))],
        chainId: chain.id,
      })

      setOfferFeeTxStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadOfferFee(chain, offersAddress), 3000)
    } catch (err) {
      console.error(`Offer fee update error on chain ${chain.id}:`, err)
      setOfferFeeTxStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Withdraw HupOffers' accrued fees for one payment token. Deliberately not a balance sweep:
  // withdrawFees pays out the accrual counter only, so escrowed offers stay untouchable.
  const handleWithdrawOfferFees = async (chain, offersAddress, asToken) => {
    const receiver = offerReceiverInputs[chain.id]?.trim()
    const token = offerTokenInputs[chain.id]?.trim()

    if (!isAddress(receiver) || (asToken && !isAddress(token))) {
      setOfferWithdrawStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid receiver (and token) address' } }))
      return
    }

    setOfferWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: offersAddress,
        abi: offersAbi,
        functionName: 'withdrawFees',
        args: [asToken ? token : zeroAddress, receiver, asToken ? Boolean(offerTokenIsLsp7[chain.id]) : false],
        chainId: chain.id,
      })

      setOfferWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadOfferFee(chain, offersAddress), 3000)
      if (!asToken) setTimeout(() => loadChainBalances(chain), 3000)
    } catch (err) {
      console.error(`Offer fee withdrawal error on chain ${chain.id}:`, err)
      setOfferWithdrawStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Read a chain's HupTipper version — decides whether the ERC677 controls are usable at all
  const loadTipperVersion = async (chain, tipperAddress) => {
    setTipperVersions((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) })
      const version = await client.readContract({ address: tipperAddress, abi: tipperAbi, functionName: 'version' })

      setTipperVersions((prev) => ({ ...prev, [chain.id]: { loading: false, version } }))
    } catch (err) {
      console.error(`Tipper version read error for chain ${chain.id}:`, err)
      setTipperVersions((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read version' },
      }))
    }
  }

  // Load tipper versions, and seed each input with the chain's curated ERC677 token so the
  // common case (enable G$ on Celo) is one click rather than an address paste
  useEffect(() => {
    if (!isAdmin) return

    const seeds = {}
    config.chains.forEach((chain) => {
      const tipperAddress = CONTRACTS[`chain${chain.id}`]?.tipper
      if (!tipperAddress) return

      loadTipperVersion(chain, tipperAddress)

      const curated = (TIP_TOKENS[chain.id] ?? []).find((token) => token.erc677)
      if (curated) seeds[chain.id] = curated.address
    })

    setErc677Inputs((prev) => ({ ...seeds, ...prev }))
  }, [isAdmin])

  // Read whether a token is currently whitelisted for one-transaction ERC677 tipping
  const handleCheckErc677 = async (chain, tipperAddress) => {
    const token = erc677Inputs[chain.id]?.trim()
    if (!isAddress(token)) {
      setErc677Checks((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid token address' } }))
      return
    }

    setErc677Checks((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) })
      const enabled = await client.readContract({
        address: tipperAddress,
        abi: tipperAbi,
        functionName: 'erc677Tokens',
        args: [token],
      })

      setErc677Checks((prev) => ({ ...prev, [chain.id]: { loading: false, checked: token, enabled } }))
    } catch (err) {
      console.error(`ERC677 status read error for chain ${chain.id}:`, err)
      setErc677Checks((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read status' },
      }))
    }
  }

  // Enable or disable an ERC677 token on a chain's HupTipper (admin wallet signs). Only
  // whitelisted tokens may call onTokenTransfer, so this is what activates one-tx tipping.
  const handleSetErc677 = async (chain, tipperAddress, enabled) => {
    const token = erc677Inputs[chain.id]?.trim()
    if (!isAddress(token)) {
      setErc677TxStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid token address' } }))
      return
    }

    setErc677TxStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: tipperAddress,
        abi: tipperAbi,
        functionName: 'setErc677Token',
        args: [token, enabled],
        chainId: chain.id,
      })

      setErc677TxStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, success: true, hash: txHash, action: enabled ? 'enabled' : 'disabled' },
      }))

      setTimeout(() => handleCheckErc677(chain, tipperAddress), 3000)
    } catch (err) {
      console.error(`ERC677 ${enabled ? 'enable' : 'disable'} error on chain ${chain.id}:`, err)
      setErc677TxStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Read the LSP26 follower registry a chain's HupCommunity is currently wired to. It is not a
  // constructor arg, so every fresh deployment starts at address(0).
  const loadCommunityFollowerSystem = async (chain, communityAddress) => {
    setCommunityFollowerSystems((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) })
      const followerSystem = await client.readContract({
        address: communityAddress,
        abi: communityAbi,
        functionName: 'followerSystem',
      })

      setCommunityFollowerSystems((prev) => ({ ...prev, [chain.id]: { loading: false, followerSystem } }))
    } catch (err) {
      console.error(`Community follower system read error for chain ${chain.id}:`, err)
      setCommunityFollowerSystems((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read follower system' },
      }))
    }
  }

  // Load the live wiring per chain, and seed each input with that chain's configured registry so
  // the ordinary case (point a fresh deployment at the known LSP26 address) is one click
  useEffect(() => {
    if (!isAdmin) return

    const seeds = {}
    config.chains.forEach((chain) => {
      const deployment = CONTRACTS[`chain${chain.id}`]
      if (!deployment?.community) return

      loadCommunityFollowerSystem(chain, deployment.community)
      if (deployment.followerSystem) seeds[chain.id] = deployment.followerSystem
    })

    setFollowerSystemInputs((prev) => ({ ...seeds, ...prev }))
  }, [isAdmin])

  // Wire the follower registry into a chain's HupCommunity (admin wallet signs). Until this is
  // set, every FollowsCreator requirement fails closed — follower-gated communities silently
  // reject joins and block posting with nothing in the UI explaining why.
  const handleSetFollowerSystem = async (chain, communityAddress) => {
    const registry = followerSystemInputs[chain.id]?.trim()
    if (!isAddress(registry)) {
      setFollowerSystemTxStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid registry address' } }))
      return
    }

    setFollowerSystemTxStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: communityAddress,
        abi: communityAbi,
        functionName: 'setFollowerSystem',
        args: [registry],
        chainId: chain.id,
      })

      setFollowerSystemTxStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadCommunityFollowerSystem(chain, communityAddress), 3000)
    } catch (err) {
      console.error(`Follower system update error on chain ${chain.id}:`, err)
      setFollowerSystemTxStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Read a chain's HupDrops wiring: the deployer satellite per standard the chain actually
  // uses (LSP7/LSP8 on LUKSO, ERC721/1155 elsewhere), the follower registry the Followers
  // gate asks, and both fee knobs
  const loadDropsConfig = async (chain, dropsAddress) => {
    setDropsConfigs((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) })
      const standards = dropStandardsFor(chain.id)
      const standardIds = [standards.editions, standards.numbered]

      const [editionsDeployer, numberedDeployer, followerSystem, mintFeeBps, creationFee] = await Promise.all([
        client.readContract({ address: dropsAddress, abi: dropsAbi, functionName: 'deployers', args: [BigInt(standards.editions)] }),
        client.readContract({ address: dropsAddress, abi: dropsAbi, functionName: 'deployers', args: [BigInt(standards.numbered)] }),
        client.readContract({ address: dropsAddress, abi: dropsAbi, functionName: 'followerSystem' }),
        client.readContract({ address: dropsAddress, abi: dropsAbi, functionName: 'mintFeeBps' }),
        client.readContract({ address: dropsAddress, abi: dropsAbi, functionName: 'creationFee' }),
      ])

      setDropsConfigs((prev) => ({
        ...prev,
        [chain.id]: {
          loading: false,
          deployers: { [standards.editions]: editionsDeployer, [standards.numbered]: numberedDeployer },
          standardIds,
          followerSystem,
          mintFeeBps,
          creationFee,
        },
      }))
    } catch (err) {
      console.error(`Drops config read error for chain ${chain.id}:`, err)
      setDropsConfigs((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read config' },
      }))
    }
  }

  // Load the live wiring per chain with a HupDrops engine, and seed the follower input with the
  // chain's configured registry so the ordinary rotation is one click
  useEffect(() => {
    if (!isAdmin) return

    const seeds = {}
    config.chains.forEach((chain) => {
      const deployment = CONTRACTS[`chain${chain.id}`]
      if (!deployment?.drops) return

      loadDropsConfig(chain, deployment.drops)
      if (deployment.followerSystem) seeds[chain.id] = deployment.followerSystem
    })

    setDropsFollowerInputs((prev) => ({ ...seeds, ...prev }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // Register (or replace) a standard's deployer satellite on a chain's HupDrops. Until both of
  // a chain's standards are registered, createDrop reverts InvalidStandard for the missing one.
  // setDeployer is msg.sender-gated — the admin wallet must sign directly, never via relayer.
  const handleSetDropsDeployer = async (chain, dropsAddress, standardId) => {
    const satellite = dropsDeployerInputs[chain.id]?.[standardId]?.trim()
    if (!isAddress(satellite)) {
      setDropsDeployerTxStates((prev) => ({ ...prev, [chain.id]: { standardId, error: 'Enter a valid satellite address' } }))
      return
    }

    setDropsDeployerTxStates((prev) => ({ ...prev, [chain.id]: { standardId, loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: dropsAddress,
        abi: dropsAbi,
        functionName: 'setDeployer',
        args: [BigInt(standardId), satellite],
        chainId: chain.id,
      })

      setDropsDeployerTxStates((prev) => ({ ...prev, [chain.id]: { standardId, loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadDropsConfig(chain, dropsAddress), 3000)
    } catch (err) {
      console.error(`Drops deployer update error on chain ${chain.id}:`, err)
      setDropsDeployerTxStates((prev) => ({
        ...prev,
        [chain.id]: { standardId, loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Rotate the LSP26 registry the Followers gate asks. Zero disables followers-gated drops
  // (creating one reverts InvalidGateConfig); a stale registry silently gates against follows
  // nobody writes anymore — worse than unset.
  const handleSetDropsFollower = async (chain, dropsAddress) => {
    const registry = dropsFollowerInputs[chain.id]?.trim()
    if (!isAddress(registry)) {
      setDropsFollowerTxStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid registry address' } }))
      return
    }

    setDropsFollowerTxStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: dropsAddress,
        abi: dropsAbi,
        functionName: 'setFollowerSystem',
        args: [registry],
        chainId: chain.id,
      })

      setDropsFollowerTxStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadDropsConfig(chain, dropsAddress), 3000)
    } catch (err) {
      console.error(`Drops follower system update error on chain ${chain.id}:`, err)
      setDropsFollowerTxStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Set the mint fee (entered in %, stored in bps, hard-capped at 10% by the contract) or the
  // flat drop-creation fee on a chain's HupDrops (admin wallet signs)
  const handleSetDropsFee = async (chain, dropsAddress, which) => {
    const draft = dropsFeeInputs[chain.id]?.[which]?.trim()
    let functionName
    let value

    if (which === 'mint') {
      const percent = Number(draft)
      if (!Number.isFinite(percent) || percent < 0 || percent > 10) {
        setDropsFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, error: 'Fee must be 0–10%' } }))
        return
      }
      functionName = 'setMintFeeBps'
      value = BigInt(Math.round(percent * 100))
    } else {
      try {
        value = parseEther(draft || '')
      } catch {
        setDropsFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, error: 'Enter a valid amount in native units' } }))
        return
      }
      functionName = 'setCreationFee'
    }

    setDropsFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: dropsAddress,
        abi: dropsAbi,
        functionName,
        args: [value],
        chainId: chain.id,
      })

      setDropsFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadDropsConfig(chain, dropsAddress), 3000)
    } catch (err) {
      console.error(`Drops ${which} fee update error on chain ${chain.id}:`, err)
      setDropsFeeTxStates((prev) => ({
        ...prev,
        [chain.id]: { which, loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Withdraw the HupDrops contract's full native balance (accrued mint + creation fees)
  const handleWithdrawDrops = async (chain, dropsAddress) => {
    const receiver = dropsReceiverInputs[chain.id]?.trim()
    if (!isAddress(receiver)) {
      setDropsWithdrawStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid receiver address' } }))
      return
    }

    setDropsWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: dropsAddress,
        abi: dropsAbi,
        functionName: 'withdrawAll',
        args: [receiver],
        chainId: chain.id,
      })

      setDropsWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadChainBalances(chain), 3000)
    } catch (err) {
      console.error(`Drops withdrawal error on chain ${chain.id}:`, err)
      setDropsWithdrawStates((prev) => ({
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
          <header className={styles['admin-contracts__toolbar']}>
            <div className={styles['admin-contracts__toolbar-main']}>
              <h1 className={styles['admin-contracts__page-title']}>Contract Admin</h1>
              <p className={styles['admin-contracts__page-subtitle']}>
                Every write on this page is signed by <code>{address}</code>.
              </p>
            </div>

            <nav className={styles['admin-contracts__tools']}>
              <button
                type="button"
                onClick={() => config.chains.forEach((chain) => loadChainBalances(chain))}
                className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
              >
                Refresh all balances
              </button>

              <Link href="/admin/deploy-lsp7" className={styles['admin-contracts__tool-link']}>
                <span className={styles['admin-contracts__tool-name']}>🧪 Deploy HupTestLSP7</span>
                <span className={styles['admin-contracts__tool-hint']}>
                  Throwaway LSP7 faucet token for testing the authorizeOperator payment path
                </span>
              </Link>
            </nav>
          </header>

          <div className={styles['admin-contracts__nav']}>
            <div className={styles['admin-contracts__tabs']} role="tablist" aria-label="Contract groups" ref={tabsRef}>
              {SECTIONS.map((section) => {
                const count = visibleChains(section.contractKey).length
                const isActive = activeSection === section.id

                return (
                  <button
                    key={section.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => selectSection(section.id)}
                    className={clsx(styles['admin-contracts__tab'], {
                      [styles['admin-contracts__tab--active']]: isActive,
                      [styles['admin-contracts__tab--empty']]: count === 0,
                    })}
                  >
                    <span aria-hidden="true">{section.icon}</span>
                    {section.label}
                    <span className={styles['admin-contracts__tab-count']}>{count}</span>
                  </button>
                )
              })}
            </div>

            <div className={styles['admin-contracts__filters']}>
              <button
                type="button"
                onClick={() => setChainFilter('all')}
                className={clsx(styles['admin-contracts__chip'], {
                  [styles['admin-contracts__chip--active']]: chainFilter === 'all',
                })}
              >
                All chains
              </button>

              {config.chains.map((chain) => (
                <button
                  key={`filter-${chain.id}`}
                  type="button"
                  onClick={() => setChainFilter(chain.id)}
                  className={clsx(styles['admin-contracts__chip'], {
                    [styles['admin-contracts__chip--active']]: chainFilter === chain.id,
                  })}
                  style={{
                    '--network-color-primary': chain.primaryColor || '#f97316',
                    '--network-color-text': chain.textColor || '#0d0d0d',
                  }}
                >
                  <img src={chain.iconUrl} alt="" className={styles['admin-contracts__chip-icon']} />
                  {chain.name}
                </button>
              ))}
            </div>
          </div>

          {activeSection === 'balances' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>Contract Balances</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Native coin held by every deployed contract, per chain — the funds the withdraw forms below move out.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains(null).map((chain) => {
                  const balances = contractBalances[chain.id]
                  const symbol = chain.nativeCurrency?.symbol ?? 'ETH'
                  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')

                  return (
                    <div
                      key={`balances-${chain.id}`}
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
                        <span className={styles['admin-contracts__badge']}>{symbol}</span>
                      </div>

                      <div className={styles['admin-contracts__details']}>
                        {!balances && <span className={styles['admin-contracts__detail-value']}>Loading…</span>}

                        {balances?.error && (
                          <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                            {balances.error}
                          </div>
                        )}

                        {balances?.items?.map((item) => (
                          <div key={item.key} className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>
                              {explorerUrl ? (
                                <a href={`${explorerUrl}/address/${item.address}`} target="_blank" rel="noopener noreferrer">
                                  {item.label} ↗
                                </a>
                              ) : (
                                item.label
                              )}
                            </span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {formatNative(item.value)} {symbol}
                            </div>
                          </div>
                        ))}

                        {balances?.items && (
                          <div className={clsx(styles['admin-contracts__detail-row'], styles['admin-contracts__detail-row--total'])}>
                            <span className={styles['admin-contracts__detail-label']}>Total</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              <strong>
                                {formatNative(balances.total)} {symbol}
                              </strong>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className={styles['admin-contracts__actions']}>
                        <button
                          type="button"
                          disabled={balances?.loading}
                          onClick={() => loadChainBalances(chain)}
                          className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                        >
                          {balances?.loading ? 'Refreshing...' : 'Refresh'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
              {visibleChains(null).length === 0 && <p className={styles['admin-contracts__empty']}>No chains configured.</p>}
            </section>
          )}

          {activeSection === 'forwarders' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>Forwarder Configurations</h2>
                <p className={styles['admin-contracts__subtitle']}>Manage signing domain names for EIP-2771 Meta-Transaction Forwarders.</p>

                <div className={styles['admin-contracts__actions']}>
                  <button
                    type="button"
                    onClick={test}
                    title="Calls updateForwarder on the hardcoded LUKSO HupChat — sent on whatever chain the wallet is currently on"
                    className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                  >
                    Repoint LUKSO HupChat forwarder
                  </button>
                </div>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('forwarder').map((chain) => {
                  const key = `chain${chain.id}`
                  const deployment = CONTRACTS[key]
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
                          <span className={clsx(styles['admin-contracts__badge'], styles['admin-contracts__badge--override'])}>
                            OVERRIDDEN
                          </span>
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
                                <div
                                  className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}
                                >
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
                                      className={clsx(
                                        styles['admin-contracts__validation'],
                                        styles['admin-contracts__validation--success']
                                      )}
                                    >
                                      ✓ Matches on-chain domain name: &ldquo;{verification.onChainName}&rdquo;
                                    </div>
                                  ) : (
                                    <div
                                      className={clsx(
                                        styles['admin-contracts__validation'],
                                        styles['admin-contracts__validation--warning']
                                      )}
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
              {visibleChains('forwarder').length === 0 && (
                <p className={styles['admin-contracts__empty']}>No forwarder deployments match this filter.</p>
              )}
            </section>
          )}

          {activeSection === 'bazaar-roles' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>HupBazaar Operator Role</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Grant or revoke OPERATOR_ROLE on HupBazaar deployments — required for the x402 settlement wallet to call grantPurchase.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('store').map((chain) => {
                  const deployment = CONTRACTS[`chain${chain.id}`]
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
                        <span className={styles['admin-contracts__badge']}>HUPBAZAAR</span>
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
                                <div
                                  className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--success'])}
                                >
                                  ✓ {roleCheck.checked.slice(0, 6)}...{roleCheck.checked.slice(-4)} holds OPERATOR_ROLE
                                </div>
                              )}
                              {roleCheck.checked && !roleCheck.hasRole && (
                                <div
                                  className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}
                                >
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
              {visibleChains('store').length === 0 && (
                <p className={styles['admin-contracts__empty']}>No HupBazaar deployments match this filter.</p>
              )}
            </section>
          )}

          {activeSection === 'bazaar-treasury' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>HupBazaar Treasury</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Withdraw accumulated listing/buy fees from HupBazaar — native token balance, or any ERC20/LSP7 token balance.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('store').map((chain) => {
                  const deployment = CONTRACTS[`chain${chain.id}`]
                  const receiverDraft = receiverInputs[chain.id] ?? ''
                  const tokenDraft = tokenInputs[chain.id] ?? ''
                  const isLsp7 = Boolean(tokenIsLsp7[chain.id])
                  const nativeState = nativeWithdrawStates[chain.id]
                  const tokenState = tokenWithdrawStates[chain.id]
                  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
                  const symbol = chain.nativeCurrency?.symbol ?? 'ETH'
                  const nativeBalance = renderBalance(chain.id, deployment.store, symbol)

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
                        <span className={styles['admin-contracts__badge']}>HUPBAZAAR</span>
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

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Native Balance</span>
                          <div className={styles['admin-contracts__detail-value']}>{nativeBalance}</div>
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

                        <label
                          className={styles['admin-contracts__detail-label']}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
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
              {visibleChains('store').length === 0 && (
                <p className={styles['admin-contracts__empty']}>No HupBazaar deployments match this filter.</p>
              )}
            </section>
          )}

          {activeSection === 'events' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>HupEvents Fees</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Set the flat listing fee and the featured surcharge (both in the chain&apos;s native coin) on HupEvents deployments, and
                  withdraw accumulated fees.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('events').map((chain) => {
                  const deployment = CONTRACTS[`chain${chain.id}`]
                  const fees = eventsFees[chain.id]
                  const feeInputs = eventsFeeInputs[chain.id] ?? {}
                  const feeTx = eventsFeeTxStates[chain.id]
                  const receiverDraft = eventsReceiverInputs[chain.id] ?? ''
                  const withdrawState = eventsWithdrawStates[chain.id]
                  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
                  const symbol = chain.nativeCurrency?.symbol ?? 'ETH'
                  const nativeBalance = renderBalance(chain.id, deployment.events, symbol)

                  return (
                    <div
                      key={`events-${chain.id}`}
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
                        <span className={styles['admin-contracts__badge']}>HUPEVENTS</span>
                      </div>

                      <div className={styles['admin-contracts__details']}>
                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Events Address</span>
                          <span className={styles['admin-contracts__detail-value']}>
                            {explorerUrl ? (
                              <a href={`${explorerUrl}/address/${deployment.events}`} target="_blank" rel="noopener noreferrer">
                                <code>{deployment.events}</code> ↗
                              </a>
                            ) : (
                              <code>{deployment.events}</code>
                            )}
                          </span>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Native Balance</span>
                          <div className={styles['admin-contracts__detail-value']}>{nativeBalance}</div>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Current Fees</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {(!fees || fees.loading) && <span>Loading…</span>}
                            {fees?.error && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                                {fees.error}
                              </div>
                            )}
                            {fees && !fees.loading && !fees.error && (
                              <strong>
                                Listing {formatEther(fees.listingFee)} {symbol} · Featured +{formatEther(fees.featuredFee)} {symbol}
                              </strong>
                            )}
                          </div>
                        </div>

                        {feeTx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Tx Status</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {feeTx.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                              {feeTx.error && <span style={{ color: '#ef4444' }}>❌ {feeTx.error}</span>}
                              {feeTx.success && (
                                <span style={{ color: '#10b981' }}>
                                  🚀 {feeTx.which === 'listing' ? 'Listing fee' : 'Featured fee'} updated.
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetEventsFee(chain, deployment.events, 'listing')
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Listing Fee ({symbol})</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={feeInputs.listing ?? ''}
                            onChange={(e) =>
                              setEventsFeeInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], listing: e.target.value } }))
                            }
                            placeholder="e.g. 0.5"
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!feeInputs.listing?.trim() || feeTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {feeTx?.loading && feeTx.which === 'listing' ? 'Writing...' : 'Set Listing Fee'}
                          </button>
                        </div>
                      </form>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetEventsFee(chain, deployment.events, 'featured')
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Featured Surcharge ({symbol})</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={feeInputs.featured ?? ''}
                            onChange={(e) =>
                              setEventsFeeInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], featured: e.target.value } }))
                            }
                            placeholder="e.g. 1.0"
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!feeInputs.featured?.trim() || feeTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {feeTx?.loading && feeTx.which === 'featured' ? 'Writing...' : 'Set Featured Fee'}
                          </button>
                        </div>
                      </form>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleWithdrawEvents(chain, deployment.events)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Withdraw Receiver</label>
                          <input
                            type="text"
                            className={styles['admin-contracts__input']}
                            value={receiverDraft}
                            onChange={(e) => setEventsReceiverInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                            placeholder="0x..."
                          />
                        </div>

                        {withdrawState && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Withdrawal</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {withdrawState.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                              {withdrawState.error && <span style={{ color: '#ef4444' }}>❌ {withdrawState.error}</span>}
                              {withdrawState.success && <span style={{ color: '#10b981' }}>🚀 Withdrawn.</span>}
                            </div>
                          </div>
                        )}

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!receiverDraft.trim() || withdrawState?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                          >
                            {withdrawState?.loading ? 'Withdrawing...' : 'Withdraw Native Balance'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )
                })}
              </div>
              {visibleChains('events').length === 0 && (
                <p className={styles['admin-contracts__empty']}>No HupEvents deployments match this filter.</p>
              )}
            </section>
          )}

          {activeSection === 'apps' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>HupApps Fees</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Set the flat listing fee and the featured surcharge (both in the chain&apos;s native coin) on HupApps deployments, and
                  withdraw accumulated fees.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('apps').map((chain) => {
                  const deployment = CONTRACTS[`chain${chain.id}`]
                  const fees = appsFees[chain.id]
                  const feeInputs = appsFeeInputs[chain.id] ?? {}
                  const feeTx = appsFeeTxStates[chain.id]
                  const receiverDraft = appsReceiverInputs[chain.id] ?? ''
                  const withdrawState = appsWithdrawStates[chain.id]
                  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
                  const symbol = chain.nativeCurrency?.symbol ?? 'ETH'
                  const nativeBalance = renderBalance(chain.id, deployment.apps, symbol)

                  return (
                    <div
                      key={`apps-${chain.id}`}
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
                        <span className={styles['admin-contracts__badge']}>HUPAPPS</span>
                      </div>

                      <div className={styles['admin-contracts__details']}>
                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Apps Address</span>
                          <span className={styles['admin-contracts__detail-value']}>
                            {explorerUrl ? (
                              <a href={`${explorerUrl}/address/${deployment.apps}`} target="_blank" rel="noopener noreferrer">
                                <code>{deployment.apps}</code> ↗
                              </a>
                            ) : (
                              <code>{deployment.apps}</code>
                            )}
                          </span>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Native Balance</span>
                          <div className={styles['admin-contracts__detail-value']}>{nativeBalance}</div>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Current Fees</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {(!fees || fees.loading) && <span>Loading…</span>}
                            {fees?.error && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                                {fees.error}
                              </div>
                            )}
                            {fees && !fees.loading && !fees.error && (
                              <strong>
                                Listing {formatEther(fees.listingFee)} {symbol} · Featured +{formatEther(fees.featuredFee)} {symbol}
                              </strong>
                            )}
                          </div>
                        </div>

                        {feeTx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Tx Status</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {feeTx.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                              {feeTx.error && <span style={{ color: '#ef4444' }}>❌ {feeTx.error}</span>}
                              {feeTx.success && (
                                <span style={{ color: '#10b981' }}>
                                  🚀 {feeTx.which === 'listing' ? 'Listing fee' : 'Featured fee'} updated.
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetAppsFee(chain, deployment.apps, 'listing')
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Listing Fee ({symbol})</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={feeInputs.listing ?? ''}
                            onChange={(e) =>
                              setAppsFeeInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], listing: e.target.value } }))
                            }
                            placeholder="e.g. 0.5"
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!feeInputs.listing?.trim() || feeTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {feeTx?.loading && feeTx.which === 'listing' ? 'Writing...' : 'Set Listing Fee'}
                          </button>
                        </div>
                      </form>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetAppsFee(chain, deployment.apps, 'featured')
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Featured Surcharge ({symbol})</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={feeInputs.featured ?? ''}
                            onChange={(e) =>
                              setAppsFeeInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], featured: e.target.value } }))
                            }
                            placeholder="e.g. 1.0"
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!feeInputs.featured?.trim() || feeTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {feeTx?.loading && feeTx.which === 'featured' ? 'Writing...' : 'Set Featured Fee'}
                          </button>
                        </div>
                      </form>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleWithdrawApps(chain, deployment.apps)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Withdraw Receiver</label>
                          <input
                            type="text"
                            className={styles['admin-contracts__input']}
                            value={receiverDraft}
                            onChange={(e) => setAppsReceiverInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                            placeholder="0x..."
                          />
                        </div>

                        {withdrawState && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Withdrawal</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {withdrawState.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                              {withdrawState.error && <span style={{ color: '#ef4444' }}>❌ {withdrawState.error}</span>}
                              {withdrawState.success && <span style={{ color: '#10b981' }}>🚀 Withdrawn.</span>}
                            </div>
                          </div>
                        )}

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!receiverDraft.trim() || withdrawState?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                          >
                            {withdrawState?.loading ? 'Withdrawing...' : 'Withdraw Native Balance'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )
                })}
              </div>
              {visibleChains('apps').length === 0 && (
                <p className={styles['admin-contracts__empty']}>No HupApps deployments match this filter.</p>
              )}
            </section>
          )}

          {activeSection === 'predict' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>HupPredict Config</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Set the platform and creator fees (snapshotted into new markets only, combined cap 10%) and the judge resolve window, and
                  withdraw accrued platform fees per stake token — escrowed stakes and creator fee ledgers are never withdrawable.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('predict').map((chain) => {
                  const deployment = CONTRACTS[`chain${chain.id}`]
                  const predictConfig = predictConfigs[chain.id]
                  const drafts = predictInputs[chain.id] ?? {}
                  const configTx = predictTxStates[chain.id]
                  const receiverDraft = predictReceiverInputs[chain.id] ?? ''
                  const tokenDraft = predictTokenInputs[chain.id] ?? ''
                  const withdrawState = predictWithdrawStates[chain.id]
                  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
                  const symbol = chain.nativeCurrency?.symbol ?? 'ETH'
                  const nativeBalance = renderBalance(chain.id, deployment.predict, symbol)

                  return (
                    <div
                      key={`predict-${chain.id}`}
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
                        <span className={styles['admin-contracts__badge']}>HUPPREDICT</span>
                      </div>

                      <div className={styles['admin-contracts__details']}>
                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Predict Address</span>
                          <span className={styles['admin-contracts__detail-value']}>
                            {explorerUrl ? (
                              <a href={`${explorerUrl}/address/${deployment.predict}`} target="_blank" rel="noopener noreferrer">
                                <code>{deployment.predict}</code> ↗
                              </a>
                            ) : (
                              <code>{deployment.predict}</code>
                            )}
                          </span>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Native Balance</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {nativeBalance}
                            {/* Escrowed stakes live in the same balance — only the accrued fee ledger is withdrawable */}
                            <span className={styles['admin-contracts__detail-label']}> incl. escrowed stakes</span>
                          </div>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Current Config</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {(!predictConfig || predictConfig.loading) && <span>Loading…</span>}
                            {predictConfig?.error && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                                {predictConfig.error}
                              </div>
                            )}
                            {predictConfig && !predictConfig.loading && !predictConfig.error && (
                              <strong>
                                Platform fee {Number(predictConfig.feeBps) / 100}% · Creator fee {Number(predictConfig.creatorFeeBps) / 100}
                                % · Featured {formatEther(predictConfig.featuredFee)} {symbol} · Resolve window{' '}
                                {Number(predictConfig.resolveWindow) / 86400}d · Accrued {formatEther(predictConfig.nativeFees)} {symbol}
                              </strong>
                            )}
                          </div>
                        </div>

                        {configTx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Tx Status</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {configTx.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                              {configTx.error && <span style={{ color: '#ef4444' }}>❌ {configTx.error}</span>}
                              {configTx.success && (
                                <span style={{ color: '#10b981' }}>
                                  🚀{' '}
                                  {configTx.which === 'fee'
                                    ? 'Platform fee'
                                    : configTx.which === 'creatorFee'
                                      ? 'Creator fee'
                                      : configTx.which === 'featured'
                                        ? 'Featured fee'
                                        : 'Resolve window'}{' '}
                                  updated.
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetPredictConfig(chain, deployment.predict, 'fee')
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>
                            Platform Fee (%) — combined cap 10, new markets only
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={drafts.fee ?? ''}
                            onChange={(e) =>
                              setPredictInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], fee: e.target.value } }))
                            }
                            placeholder="e.g. 1"
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!drafts.fee?.trim() || configTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {configTx?.loading && configTx.which === 'fee' ? 'Writing...' : 'Set Platform Fee'}
                          </button>
                        </div>
                      </form>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetPredictConfig(chain, deployment.predict, 'creatorFee')
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>
                            Creator Fee (%) — combined cap 10, new markets only
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={drafts.creatorFee ?? ''}
                            onChange={(e) =>
                              setPredictInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], creatorFee: e.target.value } }))
                            }
                            placeholder="e.g. 1"
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!drafts.creatorFee?.trim() || configTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {configTx?.loading && configTx.which === 'creatorFee' ? 'Writing...' : 'Set Creator Fee'}
                          </button>
                        </div>
                      </form>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetPredictConfig(chain, deployment.predict, 'featured')
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Featured Surcharge ({symbol})</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={drafts.featured ?? ''}
                            onChange={(e) =>
                              setPredictInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], featured: e.target.value } }))
                            }
                            placeholder="e.g. 0.5"
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!drafts.featured?.trim() || configTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {configTx?.loading && configTx.which === 'featured' ? 'Writing...' : 'Set Featured Fee'}
                          </button>
                        </div>
                      </form>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetPredictConfig(chain, deployment.predict, 'window')
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Resolve Window (days) — 1 to 90</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={drafts.window ?? ''}
                            onChange={(e) =>
                              setPredictInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], window: e.target.value } }))
                            }
                            placeholder="e.g. 7"
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!drafts.window?.trim() || configTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {configTx?.loading && configTx.which === 'window' ? 'Writing...' : 'Set Resolve Window'}
                          </button>
                        </div>
                      </form>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleWithdrawPredictFees(chain, deployment.predict)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Withdraw Receiver</label>
                          <input
                            type="text"
                            className={styles['admin-contracts__input']}
                            value={receiverDraft}
                            onChange={(e) => setPredictReceiverInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                            placeholder="0x..."
                          />
                        </div>

                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Fee Token (empty = native {symbol})</label>
                          <input
                            type="text"
                            className={styles['admin-contracts__input']}
                            value={tokenDraft}
                            onChange={(e) => setPredictTokenInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                            placeholder="0x... (optional)"
                          />
                        </div>

                        {withdrawState && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Withdrawal</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {withdrawState.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                              {withdrawState.error && <span style={{ color: '#ef4444' }}>❌ {withdrawState.error}</span>}
                              {withdrawState.success && <span style={{ color: '#10b981' }}>🚀 Fees withdrawn.</span>}
                            </div>
                          </div>
                        )}

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!receiverDraft.trim() || withdrawState?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                          >
                            {withdrawState?.loading ? 'Withdrawing...' : 'Withdraw Accrued Fees'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )
                })}
              </div>
              {visibleChains('predict').length === 0 && (
                <p className={styles['admin-contracts__empty']}>No HupPredict deployments match this filter.</p>
              )}
            </section>
          )}

          {activeSection === 'trade' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>HupTrade Fees</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Set the sale fee (in %, hard-capped at 10%) on HupTrade deployments and withdraw accumulated fees — native balance, or any
                  ERC20/LSP7 token balance.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('trade').map((chain) => {
                  const deployment = CONTRACTS[`chain${chain.id}`]
                  const fee = tradeFees[chain.id]
                  const feeDraft = tradeFeeInputs[chain.id] ?? ''
                  const feeTx = tradeFeeTxStates[chain.id]
                  const receiverDraft = tradeReceiverInputs[chain.id] ?? ''
                  const tokenDraft = tradeTokenInputs[chain.id] ?? ''
                  const isLsp7 = Boolean(tradeTokenIsLsp7[chain.id])
                  const withdrawState = tradeWithdrawStates[chain.id]
                  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
                  const symbol = chain.nativeCurrency?.symbol ?? 'ETH'
                  const nativeBalance = renderBalance(chain.id, deployment.trade, symbol)

                  return (
                    <div
                      key={`trade-${chain.id}`}
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
                        <span className={styles['admin-contracts__badge']}>HUPTRADE</span>
                      </div>

                      <div className={styles['admin-contracts__details']}>
                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Trade Address</span>
                          <span className={styles['admin-contracts__detail-value']}>
                            {explorerUrl ? (
                              <a href={`${explorerUrl}/address/${deployment.trade}`} target="_blank" rel="noopener noreferrer">
                                <code>{deployment.trade}</code> ↗
                              </a>
                            ) : (
                              <code>{deployment.trade}</code>
                            )}
                          </span>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Native Balance</span>
                          <div className={styles['admin-contracts__detail-value']}>{nativeBalance}</div>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Current Sale Fee</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {(!fee || fee.loading) && <span>Loading…</span>}
                            {fee?.error && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                                {fee.error}
                              </div>
                            )}
                            {fee && !fee.loading && !fee.error && <strong>{Number(fee.feeBps) / 100}%</strong>}
                          </div>
                        </div>

                        {feeTx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Tx Status</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {feeTx.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                              {feeTx.error && <span style={{ color: '#ef4444' }}>❌ {feeTx.error}</span>}
                              {feeTx.success && <span style={{ color: '#10b981' }}>🚀 Sale fee updated.</span>}
                            </div>
                          </div>
                        )}
                      </div>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetTradeFee(chain, deployment.trade)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Sale Fee (%) — max 10</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={feeDraft}
                            onChange={(e) => setTradeFeeInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                            placeholder="e.g. 2.5"
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!feeDraft.trim() || feeTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {feeTx?.loading ? 'Writing...' : 'Set Sale Fee'}
                          </button>
                        </div>
                      </form>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleWithdrawTrade(chain, deployment.trade, false)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Withdraw Receiver</label>
                          <input
                            type="text"
                            className={styles['admin-contracts__input']}
                            value={receiverDraft}
                            onChange={(e) => setTradeReceiverInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                            placeholder="0x..."
                          />
                        </div>

                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Token Address (for token withdrawal)</label>
                          <input
                            type="text"
                            className={styles['admin-contracts__input']}
                            value={tokenDraft}
                            onChange={(e) => setTradeTokenInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                            placeholder="0x... (optional)"
                          />
                        </div>

                        <label
                          className={styles['admin-contracts__detail-label']}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                          <input
                            type="checkbox"
                            checked={isLsp7}
                            onChange={(e) => setTradeTokenIsLsp7((prev) => ({ ...prev, [chain.id]: e.target.checked }))}
                          />
                          This token is an LSP7 Digital Asset (LUKSO), not an ERC20
                        </label>

                        {withdrawState && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Withdrawal</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {withdrawState.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                              {withdrawState.error && <span style={{ color: '#ef4444' }}>❌ {withdrawState.error}</span>}
                              {withdrawState.success && <span style={{ color: '#10b981' }}>🚀 Withdrawn.</span>}
                            </div>
                          </div>
                        )}

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!receiverDraft.trim() || withdrawState?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                          >
                            {withdrawState?.loading ? 'Withdrawing...' : 'Withdraw Native Balance'}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleWithdrawTrade(chain, deployment.trade, true)}
                            disabled={!receiverDraft.trim() || !tokenDraft.trim() || withdrawState?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                          >
                            Withdraw Token Balance
                          </button>
                        </div>
                      </form>
                    </div>
                  )
                })}
              </div>
              {visibleChains('trade').length === 0 && (
                <p className={styles['admin-contracts__empty']}>No HupTrade deployments match this filter.</p>
              )}
            </section>
          )}

          {activeSection === 'offers' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>HupOffers Fees</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Set the fee charged when an offer settles (in %, hard-capped at 10%) and withdraw what it has accrued. The fee comes out
                  of the seller&apos;s proceeds — the offerer&apos;s escrow is always exactly what they committed — and making, cancelling
                  or expiring an offer is never charged. Withdrawals pay out the accrual counter only, never live escrow, so the native
                  balance below is not what you can take out.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('offers').map((chain) => {
                  const deployment = CONTRACTS[`chain${chain.id}`]
                  const fee = offerFees[chain.id]
                  const feeDraft = offerFeeInputs[chain.id] ?? ''
                  const feeTx = offerFeeTxStates[chain.id]
                  const receiverDraft = offerReceiverInputs[chain.id] ?? ''
                  const tokenDraft = offerTokenInputs[chain.id] ?? ''
                  const isLsp7 = Boolean(offerTokenIsLsp7[chain.id])
                  const withdrawState = offerWithdrawStates[chain.id]
                  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
                  const symbol = chain.nativeCurrency?.symbol ?? 'ETH'
                  const nativeBalance = renderBalance(chain.id, deployment.offers, symbol)

                  return (
                    <div
                      key={`offers-${chain.id}`}
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
                        <span className={styles['admin-contracts__badge']}>HUPOFFERS</span>
                      </div>

                      <div className={styles['admin-contracts__details']}>
                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Offers Address</span>
                          <span className={styles['admin-contracts__detail-value']}>
                            {explorerUrl ? (
                              <a href={`${explorerUrl}/address/${deployment.offers}`} target="_blank" rel="noopener noreferrer">
                                <code>{deployment.offers}</code> ↗
                              </a>
                            ) : (
                              <code>{deployment.offers}</code>
                            )}
                          </span>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Balance (escrow + fees)</span>
                          <div className={styles['admin-contracts__detail-value']}>{nativeBalance}</div>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Accrued Fees (withdrawable)</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {(!fee || fee.loading) && <span>Loading…</span>}
                            {fee && !fee.loading && !fee.error && (
                              <strong>
                                {formatNative(fee.accruedNative)} {symbol}
                              </strong>
                            )}
                          </div>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Current Offer Fee</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {(!fee || fee.loading) && <span>Loading…</span>}
                            {fee?.error && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                                {fee.error}
                              </div>
                            )}
                            {fee && !fee.loading && !fee.error && <strong>{Number(fee.feeBps) / 100}%</strong>}
                          </div>
                        </div>

                        {feeTx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Tx Status</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {feeTx.loading && <span style={{ color: '#d97706' }}>Signing &amp; broadcasting tx...</span>}
                              {feeTx.error && <span style={{ color: '#ef4444' }}>❌ {feeTx.error}</span>}
                              {feeTx.success && <span style={{ color: '#10b981' }}>🚀 Offer fee updated.</span>}
                            </div>
                          </div>
                        )}
                      </div>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetOfferFee(chain, deployment.offers)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Offer Fee (%) — max 10</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={feeDraft}
                            onChange={(e) => setOfferFeeInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                            placeholder="e.g. 0.5"
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!feeDraft.trim() || feeTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {feeTx?.loading ? 'Writing...' : 'Set Offer Fee'}
                          </button>
                        </div>
                      </form>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleWithdrawOfferFees(chain, deployment.offers, false)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Withdraw Receiver</label>
                          <input
                            type="text"
                            className={styles['admin-contracts__input']}
                            value={receiverDraft}
                            onChange={(e) => setOfferReceiverInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                            placeholder="0x..."
                          />
                        </div>

                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Token Address (for token fees)</label>
                          <input
                            type="text"
                            className={styles['admin-contracts__input']}
                            value={tokenDraft}
                            onChange={(e) => setOfferTokenInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                            placeholder="0x... (optional)"
                          />
                        </div>

                        <label
                          className={styles['admin-contracts__detail-label']}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                          <input
                            type="checkbox"
                            checked={isLsp7}
                            onChange={(e) => setOfferTokenIsLsp7((prev) => ({ ...prev, [chain.id]: e.target.checked }))}
                          />
                          This token is an LSP7 Digital Asset (LUKSO), not an ERC20
                        </label>

                        {withdrawState && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Withdrawal</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {withdrawState.loading && <span style={{ color: '#d97706' }}>Signing &amp; broadcasting tx...</span>}
                              {withdrawState.error && <span style={{ color: '#ef4444' }}>❌ {withdrawState.error}</span>}
                              {withdrawState.success && <span style={{ color: '#10b981' }}>🚀 Fees withdrawn.</span>}
                            </div>
                          </div>
                        )}

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!receiverDraft.trim() || withdrawState?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                          >
                            {withdrawState?.loading ? 'Withdrawing...' : 'Withdraw Native Fees'}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleWithdrawOfferFees(chain, deployment.offers, true)}
                            disabled={!receiverDraft.trim() || !tokenDraft.trim() || withdrawState?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                          >
                            Withdraw Token Fees
                          </button>
                        </div>
                      </form>
                    </div>
                  )
                })}
              </div>
              {visibleChains('offers').length === 0 && (
                <p className={styles['admin-contracts__empty']}>No HupOffers deployments match this filter.</p>
              )}
            </section>
          )}

          {activeSection === 'tipper' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>HupTipper ERC677 Tokens</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Whitelist ERC677 tokens (e.g. GoodDollar) so they can tip in a single transaction via transferAndCall, with no approve
                  step. Only whitelisted tokens may call onTokenTransfer — an unlisted token is rejected, which is what stops anyone forging
                  tip events. Requires HupTipper 1.1.0 or newer.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('tipper').map((chain) => {
                  const deployment = CONTRACTS[`chain${chain.id}`]
                  const tokenDraft = erc677Inputs[chain.id] ?? ''
                  const versionState = tipperVersions[chain.id]
                  const check = erc677Checks[chain.id]
                  const tx = erc677TxStates[chain.id]
                  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
                  const isSupported = supportsErc677(versionState?.version)
                  const isLocked = !versionState || versionState.loading || !isSupported

                  return (
                    <div
                      key={`tipper-${chain.id}`}
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
                        <span className={styles['admin-contracts__badge']}>HUPTIPPER</span>
                      </div>

                      <div className={styles['admin-contracts__details']}>
                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Tipper Address</span>
                          <span className={styles['admin-contracts__detail-value']}>
                            {explorerUrl ? (
                              <a href={`${explorerUrl}/address/${deployment.tipper}`} target="_blank" rel="noopener noreferrer">
                                <code>{deployment.tipper}</code> ↗
                              </a>
                            ) : (
                              <code>{deployment.tipper}</code>
                            )}
                          </span>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Contract Version</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {(!versionState || versionState.loading) && <span>Loading…</span>}
                            {versionState?.error && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                                {versionState.error}
                              </div>
                            )}
                            {versionState?.version && isSupported && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--success'])}>
                                ✓ v{versionState.version} — supports one-transaction ERC677 tipping
                              </div>
                            )}
                            {versionState?.version && !isSupported && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}>
                                ⚠️ v{versionState.version} predates 1.1.0 — redeploy before whitelisting anything here
                              </div>
                            )}
                          </div>
                        </div>

                        {check && !check.loading && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Token Status</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {check.error && (
                                <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                                  {check.error}
                                </div>
                              )}
                              {check.checked && check.enabled && (
                                <div
                                  className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--success'])}
                                >
                                  ✓ {check.checked.slice(0, 6)}...{check.checked.slice(-4)} is enabled for one-tx tipping
                                </div>
                              )}
                              {check.checked && !check.enabled && (
                                <div
                                  className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}
                                >
                                  {check.checked.slice(0, 6)}...{check.checked.slice(-4)} is not whitelisted — tips revert with
                                  UnsupportedToken
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {tx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Tx Status</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {tx.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                              {tx.error && <span style={{ color: '#ef4444' }}>❌ {tx.error}</span>}
                              {tx.success && <span style={{ color: '#10b981' }}>🚀 Token {tx.action}.</span>}
                            </div>
                          </div>
                        )}
                      </div>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetErc677(chain, deployment.tipper, true)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>ERC677 Token Address</label>
                          <input
                            type="text"
                            className={styles['admin-contracts__input']}
                            value={tokenDraft}
                            onChange={(e) => setErc677Inputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                            placeholder="0x..."
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={isLocked || !tokenDraft.trim() || tx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {tx?.loading ? 'Writing...' : 'Enable One-Tx Tipping'}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSetErc677(chain, deployment.tipper, false)}
                            disabled={isLocked || !tokenDraft.trim() || tx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                          >
                            Disable
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCheckErc677(chain, deployment.tipper)}
                            disabled={isLocked || !tokenDraft.trim() || check?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                          >
                            {check?.loading ? 'Checking...' : 'Check Status'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )
                })}
              </div>
              {visibleChains('tipper').length === 0 && (
                <p className={styles['admin-contracts__empty']}>No HupTipper deployments match this filter.</p>
              )}
            </section>
          )}

          {activeSection === 'drops' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>HupDrops</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Wire a chain&apos;s NFT drops engine: register the deployer satellite per standard (createDrop reverts InvalidStandard
                  until the requested standard has one), rotate the LSP26 registry the Followers gate asks, and tune the fee knobs.
                  setDeployer and the setters are msg.sender-gated — sign with the admin wallet directly, never through the relayer.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('drops').map((chain) => {
                  const deployment = CONTRACTS[`chain${chain.id}`]
                  const state = dropsConfigs[chain.id]
                  const standards = dropStandardsFor(chain.id)
                  const standardRows = [
                    { id: standards.editions, hint: 'editions' },
                    { id: standards.numbered, hint: 'numbered' },
                  ]
                  const deployerTx = dropsDeployerTxStates[chain.id]
                  const followerTx = dropsFollowerTxStates[chain.id]
                  const feeTx = dropsFeeTxStates[chain.id]
                  const withdrawTx = dropsWithdrawStates[chain.id]
                  const followerDraft = dropsFollowerInputs[chain.id] ?? ''
                  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
                  const symbol = chain.nativeCurrency?.symbol ?? 'ETH'
                  const onChainFollower = state?.followerSystem
                  const followerUnset = onChainFollower && onChainFollower.toLowerCase() === zeroAddress
                  const followerMatches =
                    onChainFollower &&
                    deployment.followerSystem &&
                    onChainFollower.toLowerCase() === deployment.followerSystem.toLowerCase()

                  return (
                    <div
                      key={`drops-${chain.id}`}
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
                        <span className={styles['admin-contracts__badge']}>HUPDROPS</span>
                      </div>

                      <div className={styles['admin-contracts__details']}>
                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Engine Address</span>
                          <span className={styles['admin-contracts__detail-value']}>
                            {explorerUrl ? (
                              <a href={`${explorerUrl}/address/${deployment.drops}`} target="_blank" rel="noopener noreferrer">
                                <code>{deployment.drops}</code> ↗
                              </a>
                            ) : (
                              <code>{deployment.drops}</code>
                            )}
                          </span>
                        </div>

                        {state?.error && (
                          <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                            {state.error}
                          </div>
                        )}

                        {standardRows.map(({ id, hint }) => {
                          const registered = state?.deployers?.[id]
                          const isRegistered = registered && registered.toLowerCase() !== zeroAddress
                          const draft = dropsDeployerInputs[chain.id]?.[id] ?? ''
                          const isThisTx = deployerTx?.standardId === id

                          return (
                            <div key={`standard-${id}`} className={styles['admin-contracts__detail-row']}>
                              <span className={styles['admin-contracts__detail-label']}>
                                {dropStandardLabel(id)} deployer — standard {id} ({hint})
                              </span>
                              <div className={styles['admin-contracts__detail-value']}>
                                {(!state || state.loading) && <span>Loading…</span>}
                                {state && !state.loading && !state.error && !isRegistered && (
                                  <div
                                    className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}
                                  >
                                    ⚠️ Not registered — {dropStandardLabel(id)} drops revert InvalidStandard
                                  </div>
                                )}
                                {isRegistered && (
                                  <div
                                    className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--success'])}
                                  >
                                    ✓ <code>{registered}</code>
                                  </div>
                                )}

                                <form
                                  className={styles['admin-contracts__edit-form']}
                                  onSubmit={(e) => {
                                    e.preventDefault()
                                    handleSetDropsDeployer(chain, deployment.drops, id)
                                  }}
                                >
                                  <div className={styles['admin-contracts__input-group']}>
                                    <input
                                      type="text"
                                      className={styles['admin-contracts__input']}
                                      value={draft}
                                      onChange={(e) =>
                                        setDropsDeployerInputs((prev) => ({
                                          ...prev,
                                          [chain.id]: { ...prev[chain.id], [id]: e.target.value },
                                        }))
                                      }
                                      placeholder="0x… satellite address"
                                    />
                                  </div>
                                  <div className={styles['admin-contracts__actions']}>
                                    <button
                                      type="submit"
                                      disabled={!draft.trim() || (isThisTx && deployerTx?.loading)}
                                      className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                                    >
                                      {isThisTx && deployerTx?.loading ? 'Writing...' : `Set standard ${id}`}
                                    </button>
                                  </div>
                                  {isThisTx && deployerTx?.error && <span style={{ color: '#ef4444' }}>❌ {deployerTx.error}</span>}
                                  {isThisTx && deployerTx?.success && <span style={{ color: '#10b981' }}>🚀 Deployer registered.</span>}
                                </form>
                              </div>
                            </div>
                          )
                        })}

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Followers-Gate Registry</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {(!state || state.loading) && <span>Loading…</span>}
                            {followerUnset && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}>
                                ⚠️ Unset (address zero) — followers-gated drops can&apos;t be created on this chain
                              </div>
                            )}
                            {onChainFollower && !followerUnset && followerMatches && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--success'])}>
                                ✓ Wired to the configured registry <code>{onChainFollower}</code>
                              </div>
                            )}
                            {onChainFollower && !followerUnset && !followerMatches && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}>
                                ⚠️ Set to <code>{onChainFollower}</code>, which is not this chain&apos;s configured registry
                              </div>
                            )}

                            <form
                              className={styles['admin-contracts__edit-form']}
                              onSubmit={(e) => {
                                e.preventDefault()
                                handleSetDropsFollower(chain, deployment.drops)
                              }}
                            >
                              <div className={styles['admin-contracts__input-group']}>
                                <input
                                  type="text"
                                  className={styles['admin-contracts__input']}
                                  value={followerDraft}
                                  onChange={(e) => setDropsFollowerInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                                  placeholder="0x… LSP26 registry"
                                />
                              </div>
                              <div className={styles['admin-contracts__actions']}>
                                <button
                                  type="submit"
                                  disabled={!followerDraft.trim() || followerTx?.loading}
                                  className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                                >
                                  {followerTx?.loading ? 'Writing...' : 'Set Follower System'}
                                </button>
                              </div>
                              {followerTx?.error && <span style={{ color: '#ef4444' }}>❌ {followerTx.error}</span>}
                              {followerTx?.success && <span style={{ color: '#10b981' }}>🚀 Follower system updated.</span>}
                            </form>
                          </div>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Mint Fee</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {state && !state.loading && !state.error && <strong>{Number(state.mintFeeBps ?? 0n) / 100}%</strong>}
                            <form
                              className={styles['admin-contracts__edit-form']}
                              onSubmit={(e) => {
                                e.preventDefault()
                                handleSetDropsFee(chain, deployment.drops, 'mint')
                              }}
                            >
                              <div className={styles['admin-contracts__input-group']}>
                                <input
                                  type="number"
                                  min="0"
                                  max="10"
                                  step="0.01"
                                  className={styles['admin-contracts__input']}
                                  value={dropsFeeInputs[chain.id]?.mint ?? ''}
                                  onChange={(e) =>
                                    setDropsFeeInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], mint: e.target.value } }))
                                  }
                                  placeholder="% of each paid mint (0–10)"
                                />
                              </div>
                              <div className={styles['admin-contracts__actions']}>
                                <button
                                  type="submit"
                                  disabled={feeTx?.which === 'mint' && feeTx?.loading}
                                  className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                                >
                                  {feeTx?.which === 'mint' && feeTx?.loading ? 'Writing...' : 'Set Mint Fee'}
                                </button>
                              </div>
                              {feeTx?.which === 'mint' && feeTx?.error && <span style={{ color: '#ef4444' }}>❌ {feeTx.error}</span>}
                              {feeTx?.which === 'mint' && feeTx?.success && <span style={{ color: '#10b981' }}>🚀 Mint fee updated.</span>}
                            </form>
                          </div>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Creation Fee</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {state && !state.loading && !state.error && (
                              <strong>
                                {formatNative(state.creationFee)} {symbol}
                              </strong>
                            )}
                            <form
                              className={styles['admin-contracts__edit-form']}
                              onSubmit={(e) => {
                                e.preventDefault()
                                handleSetDropsFee(chain, deployment.drops, 'creation')
                              }}
                            >
                              <div className={styles['admin-contracts__input-group']}>
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  className={styles['admin-contracts__input']}
                                  value={dropsFeeInputs[chain.id]?.creation ?? ''}
                                  onChange={(e) =>
                                    setDropsFeeInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], creation: e.target.value } }))
                                  }
                                  placeholder={`Flat fee per createDrop, in ${symbol}`}
                                />
                              </div>
                              <div className={styles['admin-contracts__actions']}>
                                <button
                                  type="submit"
                                  disabled={feeTx?.which === 'creation' && feeTx?.loading}
                                  className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                                >
                                  {feeTx?.which === 'creation' && feeTx?.loading ? 'Writing...' : 'Set Creation Fee'}
                                </button>
                              </div>
                              {feeTx?.which === 'creation' && feeTx?.error && <span style={{ color: '#ef4444' }}>❌ {feeTx.error}</span>}
                              {feeTx?.which === 'creation' && feeTx?.success && (
                                <span style={{ color: '#10b981' }}>🚀 Creation fee updated.</span>
                              )}
                            </form>
                          </div>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>
                            Withdraw Fees ({renderBalance(chain.id, deployment.drops, symbol)})
                          </span>
                          <div className={styles['admin-contracts__detail-value']}>
                            <form
                              className={styles['admin-contracts__edit-form']}
                              onSubmit={(e) => {
                                e.preventDefault()
                                handleWithdrawDrops(chain, deployment.drops)
                              }}
                            >
                              <div className={styles['admin-contracts__input-group']}>
                                <input
                                  type="text"
                                  className={styles['admin-contracts__input']}
                                  value={dropsReceiverInputs[chain.id] ?? ''}
                                  onChange={(e) => setDropsReceiverInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                                  placeholder="0x… receiver"
                                />
                              </div>
                              <div className={styles['admin-contracts__actions']}>
                                <button
                                  type="submit"
                                  disabled={!dropsReceiverInputs[chain.id]?.trim() || withdrawTx?.loading}
                                  className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                                >
                                  {withdrawTx?.loading ? 'Writing...' : 'Withdraw All'}
                                </button>
                              </div>
                              {withdrawTx?.error && <span style={{ color: '#ef4444' }}>❌ {withdrawTx.error}</span>}
                              {withdrawTx?.success && <span style={{ color: '#10b981' }}>🚀 Withdrawn.</span>}
                            </form>
                          </div>
                        </div>
                      </div>

                      <div className={styles['admin-contracts__actions']}>
                        <button
                          type="button"
                          onClick={() => loadDropsConfig(chain, deployment.drops)}
                          disabled={state?.loading}
                          className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                        >
                          {state?.loading ? 'Reading...' : 'Refresh'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
              {visibleChains('drops').length === 0 && (
                <p className={styles['admin-contracts__empty']}>No HupDrops deployments match this filter.</p>
              )}
            </section>
          )}

          {activeSection === 'community' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>HupCommunity Follower System</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Wire the LSP26 follower registry into HupCommunity. It is not a constructor argument, so a fresh deployment starts unset —
                  and while it is unset every FollowsCreator requirement fails closed, silently rejecting joins and blocking posts in
                  follower-gated communities.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('community').map((chain) => {
                  const deployment = CONTRACTS[`chain${chain.id}`]
                  const registryDraft = followerSystemInputs[chain.id] ?? ''
                  const state = communityFollowerSystems[chain.id]
                  const tx = followerSystemTxStates[chain.id]
                  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
                  const onChain = state?.followerSystem
                  const isUnset = onChain && onChain.toLowerCase() === zeroAddress
                  const matchesConfig =
                    onChain && deployment.followerSystem && onChain.toLowerCase() === deployment.followerSystem.toLowerCase()

                  return (
                    <div
                      key={`community-${chain.id}`}
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
                        <span className={styles['admin-contracts__badge']}>HUPCOMMUNITY</span>
                      </div>

                      <div className={styles['admin-contracts__details']}>
                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Community Address</span>
                          <span className={styles['admin-contracts__detail-value']}>
                            {explorerUrl ? (
                              <a href={`${explorerUrl}/address/${deployment.community}`} target="_blank" rel="noopener noreferrer">
                                <code>{deployment.community}</code> ↗
                              </a>
                            ) : (
                              <code>{deployment.community}</code>
                            )}
                          </span>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>On-Chain Follower System</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {(!state || state.loading) && <span>Loading…</span>}
                            {state?.error && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                                {state.error}
                              </div>
                            )}
                            {isUnset && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}>
                                ⚠️ Unset (address zero) — FollowsCreator gating fails closed on this chain
                              </div>
                            )}
                            {onChain && !isUnset && matchesConfig && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--success'])}>
                                ✓ Wired to the configured registry <code>{onChain}</code>
                              </div>
                            )}
                            {onChain && !isUnset && !matchesConfig && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}>
                                ⚠️ Set to <code>{onChain}</code>, which is not this chain&apos;s configured registry
                              </div>
                            )}
                          </div>
                        </div>

                        {tx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Tx Status</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {tx.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                              {tx.error && <span style={{ color: '#ef4444' }}>❌ {tx.error}</span>}
                              {tx.success && <span style={{ color: '#10b981' }}>🚀 Follower system updated.</span>}
                            </div>
                          </div>
                        )}
                      </div>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetFollowerSystem(chain, deployment.community)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Follower Registry Address</label>
                          <input
                            type="text"
                            className={styles['admin-contracts__input']}
                            value={registryDraft}
                            onChange={(e) => setFollowerSystemInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                            placeholder="0x..."
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!registryDraft.trim() || tx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {tx?.loading ? 'Writing...' : 'Set Follower System'}
                          </button>

                          <button
                            type="button"
                            onClick={() => loadCommunityFollowerSystem(chain, deployment.community)}
                            disabled={state?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                          >
                            {state?.loading ? 'Reading...' : 'Refresh'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )
                })}
              </div>
              {visibleChains('community').length === 0 && (
                <p className={styles['admin-contracts__empty']}>No HupCommunity deployments match this filter.</p>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  )
}
