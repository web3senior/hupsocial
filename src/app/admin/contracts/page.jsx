/* @file app/admin/contracts/page.jsx */
'use client'

import { useState, useEffect, useRef } from 'react'
import { useConnection, useWriteContract } from 'wagmi' // Hook added here
import { waitForTransactionReceipt } from 'wagmi/actions'
import { createPublicClient, erc20Abi, http, isAddress, formatEther, formatUnits, parseEther, parseUnits, zeroAddress } from 'viem'
import Link from 'next/link'
import clsx from 'clsx'
import PageTitle from '@/components/PageTitle'
import { browserTransport, config, CONTRACTS } from '@/config/wagmi'
import sellAbi from '@/abis/HupSell.json'
import eventsAbi from '@/abis/HupEvents.json'
import appsAbi from '@/abis/HupApps.json'
import predictAbi from '@/abis/HupPredict.json'
import tradeAbi from '@/abis/HupTrade.json'
import offersAbi from '@/abis/HupOffers.json'
import tipperAbi from '@/abis/HupTipper.json'
import communityAbi from '@/abis/HupCommunity.json'
import pollsAbi from '@/abis/HupPolls.json'
import dropsAbi from '@/abis/HupDrops.json'
import fundAbi from '@/abis/HupFund.json'
import premiumAbi from '@/abis/HupPremium.json'
import { dropStandardLabel, dropStandardRowsFor } from '@/lib/drops'
import {
  GRANT_UNITS,
  grantSeconds,
  isNativeClosed,
  NATIVE_CLOSED_PRICE,
  PLAN_IDS as PREMIUM_PLAN_IDS,
  PLAN_MONTHLY,
  PLAN_YEARLY,
  PREMIUM_MAX_BATCH,
} from '@/lib/premium'
import { TIP_TOKENS, USDC } from '@/lib/tokens'
import styles from './page.module.scss'

const ADMIN_WALLET = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS?.toLowerCase()


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

// pause() / unpause() halt new sendMessage calls on HupChat; paused() reads the current state.
// Gated by ADMIN_ROLE on the contract, so the connected wallet must hold that role or the tx
// reverts. Pausing does not retract already-published messages — those stay onchain.
const CHAT_PAUSE_ABI = [
  { inputs: [], name: 'pause', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'unpause', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'paused', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
]

// Contracts whose native balance the overview tracks, in display order. Keys map to the
// per-chain entries in CONTRACTS — anything unset on a given chain is skipped.
const BALANCE_CONTRACTS = [
  { key: 'hup', label: 'Hup' },
  { key: 'status', label: 'HupStatus' },
  { key: 'chat', label: 'HupChat' },
  { key: 'sell', label: 'HupSell' },
  { key: 'tipper', label: 'HupTipper' },
  { key: 'trade', label: 'HupTrade' },
  { key: 'offers', label: 'HupOffers' },
  { key: 'events', label: 'HupEvents' },
  { key: 'predict', label: 'HupPredict' },
  { key: 'apps', label: 'HupApps' },
  { key: 'drops', label: 'HupDrops' },
  { key: 'premium', label: 'HupPremium' },
  { key: 'community', label: 'HupCommunity' },
  { key: 'miner', label: 'HupMiner' },
  { key: 'forwarder', label: 'Forwarder' },
  { key: 'followerSystem', label: 'Follower System' },
]

// Four decimals for ordinary amounts; dust keeps three significant digits so a small fee is
// printed as the figure it is, never rounded to "0" or hidden behind a "<" placeholder.
const nativeFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 4 })
const dustFormat = new Intl.NumberFormat('en', { maximumSignificantDigits: 3 })
const formatToken = (raw, decimals = 18) => {
  const value = Number(formatUnits(raw ?? 0n, decimals))
  if (value === 0) return '0'
  return value < 0.0001 ? dustFormat.format(value) : nativeFormat.format(value)
}
const formatNative = (wei) => formatToken(wei, 18)

// One card per chain per contract adds up to a hundred-plus cards, so each group is a tab
// rather than another stretch of scroll. `contractKey` is the CONTRACTS field a chain must
// have set for the tab to have anything to show (null = every configured chain).
const SECTIONS = [
  { id: 'balances', label: 'Balances', icon: '💰', contractKey: null },
  { id: 'forwarders', label: 'Forwarders', icon: '✍️', contractKey: 'forwarder' },
  { id: 'sell-fees', label: 'Sell Fees', icon: '💸', contractKey: 'sell' },
  { id: 'sell-treasury', label: 'Sell Treasury', icon: '🏦', contractKey: 'sell' },
  { id: 'events', label: 'Events', icon: '🎟️', contractKey: 'events' },
  { id: 'apps', label: 'Apps', icon: '🧩', contractKey: 'apps' },
  { id: 'predict', label: 'Predict', icon: '🎲', contractKey: 'predict' },
  { id: 'trade', label: 'Trade', icon: '🖼️', contractKey: 'trade' },
  { id: 'offers', label: 'Offers', icon: '🤝', contractKey: 'offers' },
  { id: 'tipper', label: 'Tipper', icon: '💸', contractKey: 'tipper' },
  { id: 'drops', label: 'Drops', icon: '🎨', contractKey: 'drops' },
  { id: 'community', label: 'Community', icon: '👥', contractKey: 'community' },
  { id: 'polls', label: 'Polls', icon: '📊', contractKey: 'polls' },
  { id: 'fund', label: 'Fundraise', icon: '🪙', contractKey: 'fund' },
  { id: 'premium', label: 'Premium', icon: '⭐', contractKey: 'premium' },
  { id: 'chat', label: 'Chat', icon: '💬', contractKey: 'chat' },
]

const DEFAULT_SECTION = SECTIONS[0].id

// Contracts that read an LSP26 follower registry the admin wires in after deployment. One
// panel serves them all: the registry is never a constructor argument, so every fresh
// deployment starts unset, and until it is set every FollowsCreator requirement on that
// contract fails closed — `consequence` is what that looks like to users.
const FOLLOWER_SYSTEM_TARGETS = {
  community: {
    key: 'community',
    label: 'HupCommunity',
    abi: communityAbi,
    consequence: 'silently rejecting joins and blocking posts in follower-gated communities',
  },
  polls: {
    key: 'polls',
    label: 'HupPolls',
    abi: pollsAbi,
    consequence: 'refusing every ballot on a follower-only poll (the composer hides that gate until this is set)',
  },
}

const followerSystemKey = (target, chain) => `${target.key}:${chain.id}`

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
  const [receiverInputs, setReceiverInputs] = useState({})
  const [tokenInputs, setTokenInputs] = useState({})
  const [tokenIsLsp7, setTokenIsLsp7] = useState({})
  const [nativeWithdrawStates, setNativeWithdrawStates] = useState({})
  const [tokenWithdrawStates, setTokenWithdrawStates] = useState({})
  const [sellFees, setSellFees] = useState({})
  const [sellFeeInputs, setSellFeeInputs] = useState({})
  const [sellFeeTxStates, setSellFeeTxStates] = useState({})
  const [premiumPlans, setPremiumPlans] = useState({})
  const [premiumCoinUsd, setPremiumCoinUsd] = useState({})
  const [premiumTokenInputs, setPremiumTokenInputs] = useState({})
  const [premiumTokenStates, setPremiumTokenStates] = useState({})
  const [premiumCompInputs, setPremiumCompInputs] = useState({})
  const [premiumCompStates, setPremiumCompStates] = useState({})
  const [premiumManageInputs, setPremiumManageInputs] = useState({})
  const [premiumManageStates, setPremiumManageStates] = useState({})
  const [premiumPriceInputs, setPremiumPriceInputs] = useState({})
  const [premiumTxStates, setPremiumTxStates] = useState({})
  const [premiumReceiverInputs, setPremiumReceiverInputs] = useState({})
  const [premiumWithdrawStates, setPremiumWithdrawStates] = useState({})
  const [premiumTokenCatalogue, setPremiumTokenCatalogue] = useState(null)
  const [premiumTokenBalances, setPremiumTokenBalances] = useState({})
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
  // Keyed by followerSystemKey(target, chain) — one panel serves every FOLLOWER_SYSTEM_TARGETS entry
  const [followerSystems, setFollowerSystems] = useState({})
  const [followerSystemInputs, setFollowerSystemInputs] = useState({})
  const [followerSystemTxStates, setFollowerSystemTxStates] = useState({})
  const [dropsConfigs, setDropsConfigs] = useState({})
  const [dropsDeployerInputs, setDropsDeployerInputs] = useState({})
  const [dropsDeployerTxStates, setDropsDeployerTxStates] = useState({})
  const [dropsFollowerInputs, setDropsFollowerInputs] = useState({})
  const [dropsCommunityInputs, setDropsCommunityInputs] = useState({})
  const [dropsCommunityTxStates, setDropsCommunityTxStates] = useState({})
  const [dropsSplitsInputs, setDropsSplitsInputs] = useState({})
  const [dropsSplitsTxStates, setDropsSplitsTxStates] = useState({})
  const [dropsFollowerTxStates, setDropsFollowerTxStates] = useState({})
  const [dropsFeeInputs, setDropsFeeInputs] = useState({})
  const [dropsFeeTxStates, setDropsFeeTxStates] = useState({})
  const [dropsReceiverInputs, setDropsReceiverInputs] = useState({})
  const [dropsWithdrawStates, setDropsWithdrawStates] = useState({})
  // HupFund: one config read per chain, then the fee setter, the fee sweep and the pause toggle
  const [fundConfigs, setFundConfigs] = useState({})
  const [fundFeeInputs, setFundFeeInputs] = useState({})
  const [fundFeeTxStates, setFundFeeTxStates] = useState({})
  const [fundReceiverInputs, setFundReceiverInputs] = useState({})
  const [fundWithdrawStates, setFundWithdrawStates] = useState({})
  const [fundPauseTxStates, setFundPauseTxStates] = useState({})
  // HupChat: one paused() read per chain, then the pause toggle
  const [chatConfigs, setChatConfigs] = useState({})
  const [chatPauseTxStates, setChatPauseTxStates] = useState({})

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
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
      // allSettled: one unreadable contract must not blank every withdraw card on the chain
      const settled = await Promise.allSettled(targets.map((target) => client.getBalance({ address: target.address })))
      const items = targets.map((target, index) => ({
        ...target,
        value: settled[index].status === 'fulfilled' ? settled[index].value : undefined,
      }))
      const total = items.reduce((sum, item) => sum + (item.value ?? 0n), 0n)

      const allFailed = items.every((item) => item.value === undefined)
      setContractBalances((prev) => ({
        ...prev,
        [chain.id]: { loading: false, items, total, error: allFailed ? 'Every balance read failed' : null },
      }))
    } catch (err) {
      console.error(`Balance read error for chain ${chain.id}:`, err)
      setContractBalances((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read balances' },
      }))
    }
  }

  // Re-read one contract's balance and merge it into the chain's overview row
  const refreshContractBalance = async (chain, key) => {
    const address = CONTRACTS[`chain${chain.id}`]?.[key]
    const tracked = BALANCE_CONTRACTS.find((entry) => entry.key === key)
    if (!tracked || !isAddress(address ?? '')) return

    try {
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
      const value = await client.getBalance({ address })
      setContractBalances((prev) => {
        const items = [...(prev[chain.id]?.items ?? [])]
        const index = items.findIndex((item) => item.address === address)
        const entry = { ...tracked, address, value }
        if (index === -1) items.push(entry)
        else items[index] = entry
        const total = items.reduce((sum, item) => sum + (item.value ?? 0n), 0n)
        return { ...prev, [chain.id]: { ...prev[chain.id], loading: false, items, total, error: null } }
      })
    } catch (err) {
      console.error(`Balance read error for ${key} on chain ${chain.id}:`, err)
      // A failed single read must not blank a card that already has figures
      setContractBalances((prev) =>
        prev[chain.id]?.items ? prev : { ...prev, [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read balance' } }
      )
    }
  }

  // The overview reads every contract once per open; a contract tab re-reads its own balance
  // each time it opens and whenever the window regains focus, so a fee left by a mint made in
  // another tab shows without a page reload.
  useEffect(() => {
    if (!isAdmin) return
    const section = SECTIONS.find((entry) => entry.id === activeSection)
    if (!section?.contractKey) {
      config.chains.forEach((chain) => loadChainBalances(chain))
      return
    }

    const refresh = () => config.chains.forEach((chain) => refreshContractBalance(chain, section.contractKey))
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, activeSection])

  // Pull a single contract's balance out of the overview so the withdraw cards can show what
  // they are about to move without issuing their own RPC call
  const balanceOf = (chainId, contractAddress) => contractBalances[chainId]?.items?.find((item) => item.address === contractAddress)?.value

  // Render that balance for a withdraw card — an em dash once the chain's read has finished
  // without a figure, so a dead RPC reads as "unknown" instead of spinning forever
  const renderBalance = (chainId, contractAddress, symbol) => {
    const value = balanceOf(chainId, contractAddress)
    if (value === undefined) {
      const finished = contractBalances[chainId] && !contractBalances[chainId].loading
      return <span>{finished ? '—' : 'Loading…'}</span>
    }

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
      const client = createPublicClient({
        chain,
        transport: browserTransport(chain.id),
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

  const handleWithdrawNative = async (chain, sellAddress) => {
    const receiver = receiverInputs[chain.id]?.trim()
    if (!isAddress(receiver)) {
      setNativeWithdrawStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid receiver address' } }))
      return
    }

    setNativeWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: sellAddress,
        abi: sellAbi,
        functionName: 'withdrawFees',
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

  // Withdraw HupSell's accumulated fees in one token to an address
  const handleWithdrawToken = async (chain, sellAddress) => {
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
        address: sellAddress,
        abi: sellAbi,
        functionName: 'withdrawTokenFees',
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
  // Current HupSell fees for one chain. buyFeeBps is basis points (200 = 2%); listingFee is
  // a flat amount in the chain's native coin.
  const loadSellFees = async (chain, sellAddress) => {
    setSellFees((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
      const [buyFeeBps, listingFee] = await Promise.all([
        client.readContract({ address: sellAddress, abi: sellAbi, functionName: 'buyFeeBps' }),
        client.readContract({ address: sellAddress, abi: sellAbi, functionName: 'listingFee' }),
      ])

      setSellFees((prev) => ({ ...prev, [chain.id]: { loading: false, buyFeeBps, listingFee } }))
    } catch (err) {
      console.error(`Sell fee read error for chain ${chain.id}:`, err)
      setSellFees((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read fees' },
      }))
    }
  }

  // Load current HupSell fees for every chain with a deployment once the admin is in
  useEffect(() => {
    if (!isAdmin) return
    config.chains.forEach((chain) => {
      const sellAddress = CONTRACTS[`chain${chain.id}`]?.sell
      if (sellAddress) loadSellFees(chain, sellAddress)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  /**
   * Sets HupSell's per-sale cut or its flat listing fee (admin wallet signs).
   *
   * The buy fee is entered as a PERCENTAGE and converted to basis points here, because 2 is
   * what an operator means and 200 is what the contract stores. Capped at 50%, matching
   * ABSOLUTE_MAX_BUY_FEE_BPS — the contract reverts above it, so catching it here turns a
   * failed transaction into a message.
   */
  const handleSetSellFee = async (chain, sellAddress, which) => {
    const draft = sellFeeInputs[chain.id]?.[which]?.trim()
    let value

    if (which === 'buy') {
      const pct = Number(draft)
      if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
        setSellFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, error: 'Enter a percentage between 0 and 50' } }))
        return
      }
      value = BigInt(Math.round(pct * 100))
    } else {
      try {
        value = parseEther(draft || '')
      } catch {
        setSellFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, error: 'Enter a valid amount in native units' } }))
        return
      }
    }

    setSellFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: sellAddress,
        abi: sellAbi,
        functionName: which === 'buy' ? 'setBuyFeeBps' : 'setListingFee',
        args: [value],
        chainId: chain.id,
      })

      setSellFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, loading: false, success: true, hash: txHash } }))
      setTimeout(() => loadSellFees(chain, sellAddress), 3000)
    } catch (err) {
      console.error(`Sell ${which} fee update error on chain ${chain.id}:`, err)
      setSellFeeTxStates((prev) => ({
        ...prev,
        [chain.id]: { which, loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Read the monthly and yearly plans off a chain's HupPremium. getPlans exists so a client
  // never needs a round trip per plan, and the admin card uses the same door the page does.
  const loadPremiumPlans = async (chain, premiumAddress) => {
    setPremiumPlans((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
      /* Whether this deployment can price tokens at all is probed by CALLING a function only
         the token build has, not by reading version() — both builds report "1.0.0" on purpose,
         so the string cannot tell them apart. An older deployment has no matching selector and
         no fallback, so the call reverts, which is the answer. */
      const [plans, takesTokens, complimentaryCount, moderatorRole, paused] = await Promise.all([
        client.readContract({ address: premiumAddress, abi: premiumAbi, functionName: 'getPlans', args: [PREMIUM_PLAN_IDS] }),
        client
          .readContract({ address: premiumAddress, abi: premiumAbi, functionName: 'getTokenPrices', args: [PLAN_MONTHLY, []] })
          .then(() => true)
          .catch(() => false),
        /* Doubles as the probe for the comp surface: a deployment without it has no such
           selector, so the read reverts and undefined is the answer. */
        client.readContract({ address: premiumAddress, abi: premiumAbi, functionName: 'complimentaryCount' }).catch(() => undefined),
        /* The role id is read rather than hardcoded as keccak256("MODERATOR_ROLE"): a constant
           copied into the client is a constant that can drift from the contract. */
        client.readContract({ address: premiumAddress, abi: premiumAbi, functionName: 'MODERATOR_ROLE' }).catch(() => null),
        client.readContract({ address: premiumAddress, abi: premiumAbi, functionName: 'paused' }).catch(() => null),
      ])

      setPremiumPlans((prev) => ({
        ...prev,
        [chain.id]: { loading: false, monthly: plans[0], yearly: plans[1], takesTokens, complimentaryCount, moderatorRole, paused },
      }))
    } catch (err) {
      console.error(`Premium plan read error for chain ${chain.id}:`, err)
      setPremiumPlans((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read plans' },
      }))
    }
  }

  // Load plans for every chain with a HupPremium deployment once the admin is in
  useEffect(() => {
    if (!isAdmin) return
    config.chains.forEach((chain) => {
      const premiumAddress = CONTRACTS[`chain${chain.id}`]?.premium
      if (premiumAddress) loadPremiumPlans(chain, premiumAddress)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // The tokens each chain's plans are priced in, as cidex indexed them
  useEffect(() => {
    if (!isAdmin) return

    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch('/api/v1/premium')
        const body = response.ok ? await response.json() : null
        if (!cancelled) setPremiumTokenCatalogue(body?.data?.tokens ?? [])
      } catch (err) {
        console.error('Premium token catalogue read failed:', err)
        if (!cancelled) setPremiumTokenCatalogue([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isAdmin])

  // Token revenue sits on the contract until swept. The chain's USDC is always read, so a
  // balance still shows before cidex has indexed its price.
  const loadPremiumTokenBalances = async (chain, premiumAddress) => {
    const candidates = new Map()
    const canonical = USDC[chain.id]?.address
    if (isAddress(canonical ?? '')) candidates.set(canonical.toLowerCase(), { token: canonical, symbol: 'USDC', decimals: null })
    ;(premiumTokenCatalogue ?? [])
      .filter((entry) => String(entry.networkId) === String(chain.id) && isAddress(entry.token ?? ''))
      .forEach((entry) => {
        const key = entry.token.toLowerCase()
        const known = candidates.get(key)
        candidates.set(key, {
          token: entry.token,
          symbol: entry.symbol ?? known?.symbol ?? null,
          decimals: entry.decimals ?? known?.decimals ?? null,
        })
      })
    if (candidates.size === 0) return

    setPremiumTokenBalances((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], loading: true } }))

    const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
    const readOne = async ({ token, symbol, decimals }) => {
      const [value, scale] = await Promise.all([
        client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [premiumAddress] }),
        decimals ?? client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
      ])
      const curated = TIP_TOKENS[chain.id]?.find((entry) => entry.address.toLowerCase() === token.toLowerCase())?.symbol
      return { token, value, decimals: Number(scale), symbol: symbol ?? curated ?? `${token.slice(0, 6)}…${token.slice(-4)}` }
    }

    const entries = [...candidates.values()]
    const settled = await Promise.allSettled(entries.map(readOne))
    const items = entries.map((entry, index) =>
      settled[index].status === 'fulfilled' ? settled[index].value : { ...entry, value: undefined }
    )
    settled.forEach((result, index) => {
      if (result.status === 'rejected') console.error(`Premium token balance read error for ${entries[index].token} on chain ${chain.id}:`, result.reason)
    })

    setPremiumTokenBalances((prev) => ({ ...prev, [chain.id]: { loading: false, items } }))
  }

  // Re-read on tab open and on window focus, like the native balance
  useEffect(() => {
    if (!isAdmin || activeSection !== 'premium') return

    const refresh = () =>
      config.chains.forEach((chain) => {
        const premiumAddress = CONTRACTS[`chain${chain.id}`]?.premium
        if (isAddress(premiumAddress ?? '')) loadPremiumTokenBalances(chain, premiumAddress)
      })
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, activeSection, premiumTokenCatalogue])

  /* Premium is priced in native wei per chain to hit one dollar target, so the lever is
     useless without knowing what a coin is worth today. Same keyless upstream the Assets tab
     reads; a chain it has no price for simply shows none. */
  useEffect(() => {
    if (!isAdmin) return

    const chains = config.chains.filter((chain) => CONTRACTS[`chain${chain.id}`]?.premium)
    if (chains.length === 0) return

    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch('/api/v1/tokens/market', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokens: chains.map((chain) => ({ chainId: chain.id, address: null })) }),
        })
        if (!response.ok) return

        const body = await response.json()
        if (cancelled) return

        setPremiumCoinUsd(
          Object.fromEntries(chains.map((chain) => [chain.id, body?.data?.[`${chain.id}:native`]?.usd ?? null])),
        )
      } catch (err) {
        console.error('Premium coin price read failed:', err)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // Repoint one plan's price. setPlanPrice keeps the plan's duration, which is the whole point:
  // the term never changes, only what a coin has to be worth to buy it.
  const handleSetPremiumPrice = async (chain, premiumAddress, planId) => {
    const which = planId === PLAN_YEARLY ? 'yearly' : 'monthly'
    const draft = premiumPriceInputs[chain.id]?.[which]?.trim()

    let value
    try {
      value = parseEther(draft || '')
    } catch {
      setPremiumTxStates((prev) => ({ ...prev, [chain.id]: { which, error: 'Enter a valid amount in native units' } }))
      return
    }

    setPremiumTxStates((prev) => ({ ...prev, [chain.id]: { which, loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: premiumAddress,
        abi: premiumAbi,
        functionName: 'setPlanPrice',
        args: [planId, value],
        chainId: chain.id,
      })

      setPremiumTxStates((prev) => ({ ...prev, [chain.id]: { which, loading: false, success: true, hash: txHash } }))

      // Existing subscriptions are untouched by a price move — only the card needs refreshing
      setTimeout(() => loadPremiumPlans(chain, premiumAddress), 3000)
    } catch (err) {
      console.error(`Premium ${which} price update error on chain ${chain.id}:`, err)
      setPremiumTxStates((prev) => ({
        ...prev,
        [chain.id]: { which, loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  /**
   * Prices one token for one plan. The amount is typed in the token's own units and scaled by
   * its decimals, read from the token itself — Binance-Peg USDC is 18 decimals where Circle's
   * is 6, and the same literal on the wrong one is off by a factor of a trillion.
   */
  const handleSetPremiumTokenPrice = async (chain, premiumAddress, planId) => {
    const draft = premiumTokenInputs[chain.id] ?? {}
    const token = (draft.token ?? '').trim()
    const which = planId === PLAN_YEARLY ? 'yearly' : 'monthly'
    const amount = (which === 'yearly' ? draft.yearly : draft.monthly)?.trim()

    if (!isAddress(token)) {
      setPremiumTokenStates((prev) => ({ ...prev, [chain.id]: { which, error: 'Enter a valid token address' } }))
      return
    }

    setPremiumTokenStates((prev) => ({ ...prev, [chain.id]: { which, loading: true, error: null } }))

    try {
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
      const decimals = Number(await client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }))

      let value
      try {
        value = parseUnits(amount || '', decimals)
      } catch {
        setPremiumTokenStates((prev) => ({ ...prev, [chain.id]: { which, error: `Enter a valid amount (${decimals} decimals)` } }))
        return
      }

      const txHash = await writeContractAsync({
        address: premiumAddress,
        abi: premiumAbi,
        functionName: 'setTokenPrice',
        args: [planId, token, value, true],
        chainId: chain.id,
      })

      setPremiumTokenStates((prev) => ({
        ...prev,
        [chain.id]: { which, loading: false, success: true, hash: txHash, decimals },
      }))
    } catch (err) {
      console.error(`Premium token price error on chain ${chain.id}:`, err)
      setPremiumTokenStates((prev) => ({
        ...prev,
        [chain.id]: { which, loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  /** Takes one token off sale for one plan, leaving its resolved standard in place. */
  const handleDisablePremiumToken = async (chain, premiumAddress, planId) => {
    const token = (premiumTokenInputs[chain.id]?.token ?? '').trim()
    const which = planId === PLAN_YEARLY ? 'yearly' : 'monthly'

    if (!isAddress(token)) {
      setPremiumTokenStates((prev) => ({ ...prev, [chain.id]: { which, error: 'Enter a valid token address' } }))
      return
    }

    setPremiumTokenStates((prev) => ({ ...prev, [chain.id]: { which, loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: premiumAddress,
        abi: premiumAbi,
        functionName: 'setTokenPrice',
        args: [planId, token, 0n, false],
        chainId: chain.id,
      })

      setPremiumTokenStates((prev) => ({ ...prev, [chain.id]: { which, loading: false, success: true, hash: txHash } }))
    } catch (err) {
      console.error(`Premium token disable error on chain ${chain.id}:`, err)
      setPremiumTokenStates((prev) => ({
        ...prev,
        [chain.id]: { which, loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  /**
   * Splits the textarea into addresses. Commas, spaces and newlines all separate, because a
   * list pasted out of a spreadsheet, a chat message or a CSV should all just work.
   */
  const parsePremiumAccounts = (raw) => {
    const parts = String(raw ?? '')
      .split(/[\s,;]+/)
      .map((part) => part.trim())
      .filter(Boolean)

    return { accounts: [...new Set(parts)], invalid: parts.filter((part) => !isAddress(part)) }
  }

  /**
   * Adds or removes accounts on the complimentary list — premium with no expiry, revocable.
   * Batched when there is more than one, so a list of fifty is one signature rather than fifty.
   */
  const handleSetPremiumComplimentary = async (chain, premiumAddress, granted) => {
    const { accounts, invalid } = parsePremiumAccounts(premiumCompInputs[chain.id]?.accounts)

    if (accounts.length === 0) {
      setPremiumCompStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter at least one wallet address' } }))
      return
    }
    if (invalid.length > 0) {
      setPremiumCompStates((prev) => ({ ...prev, [chain.id]: { error: `Not a valid address: ${invalid[0]}` } }))
      return
    }
    if (accounts.length > PREMIUM_MAX_BATCH) {
      setPremiumCompStates((prev) => ({
        ...prev,
        [chain.id]: { error: `${accounts.length} addresses — the contract caps a batch at ${PREMIUM_MAX_BATCH}` },
      }))
      return
    }

    setPremiumCompStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: premiumAddress,
        abi: premiumAbi,
        functionName: accounts.length === 1 ? 'setComplimentary' : 'setComplimentaryBatch',
        args: accounts.length === 1 ? [accounts[0], granted] : [accounts, granted],
        chainId: chain.id,
      })

      setPremiumCompStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, success: true, hash: txHash, count: accounts.length, granted },
      }))
    } catch (err) {
      console.error(`Premium complimentary error on chain ${chain.id}:`, err)
      setPremiumCompStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  /**
   * Credits a fixed term instead — a make-good that expires on its own. Any length: the
   * contract stopped capping this, so the only bound here is that the number is positive.
   */
  const handleGrantPremium = async (chain, premiumAddress) => {
    const { accounts, invalid } = parsePremiumAccounts(premiumCompInputs[chain.id]?.accounts)
    const draft = premiumCompInputs[chain.id] ?? {}
    const seconds = grantSeconds(draft.term, draft.termUnit ?? GRANT_UNITS[0].id)

    if (accounts.length === 0 || invalid.length > 0) {
      setPremiumCompStates((prev) => ({
        ...prev,
        [chain.id]: { error: invalid[0] ? `Not a valid address: ${invalid[0]}` : 'Enter at least one wallet address' },
      }))
      return
    }
    if (seconds === null) {
      setPremiumCompStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter how long the term should run' } }))
      return
    }

    setPremiumCompStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const duration = BigInt(seconds)
      const txHash = await writeContractAsync({
        address: premiumAddress,
        abi: premiumAbi,
        functionName: accounts.length === 1 ? 'grantPremium' : 'grantPremiumBatch',
        args: accounts.length === 1 ? [accounts[0], duration] : [accounts, duration],
        chainId: chain.id,
      })

      setPremiumCompStates((prev) => ({
        ...prev,
        [chain.id]: {
          loading: false,
          success: true,
          hash: txHash,
          count: accounts.length,
          term: `${draft.term} ${draft.termUnit ?? GRANT_UNITS[0].id}`,
        },
      }))
    } catch (err) {
      console.error(`Premium grant error on chain ${chain.id}:`, err)
      setPremiumCompStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  /**
   * Grants or revokes MODERATOR_ROLE. A moderator can give premium away and nothing else —
   * pricing, the treasury and the pause switch stay with ADMIN_ROLE — so this is the one role
   * worth handing out, and the only one this card offers.
   */
  const handleSetPremiumModerator = async (chain, premiumAddress, role, granted) => {
    const account = (premiumManageInputs[chain.id]?.moderator ?? '').trim()

    if (!isAddress(account)) {
      setPremiumManageStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid wallet address' } }))
      return
    }
    if (!role) {
      setPremiumManageStates((prev) => ({ ...prev, [chain.id]: { error: 'This deployment has no moderator role' } }))
      return
    }

    setPremiumManageStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: premiumAddress,
        abi: premiumAbi,
        functionName: granted ? 'grantRole' : 'revokeRole',
        args: [role, account],
        chainId: chain.id,
      })

      setPremiumManageStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, success: true, hash: txHash, note: granted ? 'Moderator added' : 'Moderator removed' },
      }))
    } catch (err) {
      console.error(`Premium moderator error on chain ${chain.id}:`, err)
      setPremiumManageStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  /** Stops every purchase entry point. Existing subscriptions are untouched by it. */
  const handlePausePremium = async (chain, premiumAddress, paused) => {
    setPremiumManageStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: premiumAddress,
        abi: premiumAbi,
        functionName: paused ? 'unpause' : 'pause',
        args: [],
        chainId: chain.id,
      })

      setPremiumManageStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, success: true, hash: txHash, note: paused ? 'Unpaused' : 'Paused' },
      }))

      setTimeout(() => loadPremiumPlans(chain, premiumAddress), 3000)
    } catch (err) {
      console.error(`Premium pause error on chain ${chain.id}:`, err)
      setPremiumManageStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  /**
   * Sweeps one token's balance. Native revenue has its own button — the two cannot move in the
   * same call, and token revenue is otherwise unreachable from this page.
   */
  const handleWithdrawPremiumToken = async (chain, premiumAddress) => {
    const draft = premiumManageInputs[chain.id] ?? {}
    const token = (draft.sweepToken ?? '').trim()
    const receiver = (draft.sweepReceiver ?? '').trim()

    if (!isAddress(token) || !isAddress(receiver)) {
      setPremiumManageStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid token and receiver address' } }))
      return
    }

    setPremiumManageStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: premiumAddress,
        abi: premiumAbi,
        functionName: 'withdrawToken',
        args: [token, receiver],
        chainId: chain.id,
      })

      setPremiumManageStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash, note: 'Token swept' } }))
      setTimeout(() => loadPremiumTokenBalances(chain, premiumAddress), 3000)
    } catch (err) {
      console.error(`Premium token sweep error on chain ${chain.id}:`, err)
      setPremiumManageStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  /**
   * Closes native sales for one plan by pricing it at the sentinel no coin amount can meet.
   * The deployed contract has no on/off switch for the coin alone — `enabled` would take the
   * tokens down with it — so this is the lever. Reopen by setting a real price.
   */
  const handleClosePremiumNative = async (chain, premiumAddress, planId) => {
    const which = planId === PLAN_YEARLY ? 'yearly' : 'monthly'
    setPremiumTxStates((prev) => ({ ...prev, [chain.id]: { which, loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: premiumAddress,
        abi: premiumAbi,
        functionName: 'setPlanPrice',
        args: [planId, NATIVE_CLOSED_PRICE],
        chainId: chain.id,
      })

      setPremiumTxStates((prev) => ({ ...prev, [chain.id]: { which, loading: false, success: true, hash: txHash, closed: true } }))
      setTimeout(() => loadPremiumPlans(chain, premiumAddress), 3000)
    } catch (err) {
      console.error(`Premium native close error on chain ${chain.id}:`, err)
      setPremiumTxStates((prev) => ({
        ...prev,
        [chain.id]: { which, loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Sweep the contract's full native balance (accumulated subscription revenue)
  const handleWithdrawPremium = async (chain, premiumAddress) => {
    const receiver = premiumReceiverInputs[chain.id]?.trim()
    if (!isAddress(receiver)) {
      setPremiumWithdrawStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid receiver address' } }))
      return
    }

    setPremiumWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: premiumAddress,
        abi: premiumAbi,
        functionName: 'withdrawAll',
        args: [receiver],
        chainId: chain.id,
      })

      setPremiumWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadChainBalances(chain), 3000)
    } catch (err) {
      console.error(`Premium withdrawal error on chain ${chain.id}:`, err)
      setPremiumWithdrawStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  const loadEventsFees = async (chain, eventsAddress) => {
    setEventsFees((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
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
        functionName: 'withdrawFees',
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
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
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
        functionName: 'withdrawFees',
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
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
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
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
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
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
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
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
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
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
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

  // Read everything the Fundraise card shows for one chain's HupFund in a single pass
  const loadFundConfig = async (chain, fundAddress) => {
    setFundConfigs((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
      const read = (functionName) => client.readContract({ address: fundAddress, abi: fundAbi, functionName })
      const [version, feeBps, feesAccrued, paused, nextCampaignId] = await Promise.all([
        read('version'),
        read('fundFeeBps'),
        read('feesAccrued'),
        read('paused'),
        read('nextCampaignId'),
      ])

      setFundConfigs((prev) => ({
        ...prev,
        [chain.id]: {
          loading: false,
          version,
          feeBps: Number(feeBps),
          feesAccrued,
          paused,
          campaigns: Number(nextCampaignId) - 1,
        },
      }))
      // Seed the fee field with the live rate so an untouched form re-submits nothing surprising
      setFundFeeInputs((prev) => (prev[chain.id] === undefined ? { ...prev, [chain.id]: String(Number(feeBps)) } : prev))
    } catch (err) {
      console.error(`Fund config read error for chain ${chain.id}:`, err)
      setFundConfigs((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Failed to read the fund contract' },
      }))
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    config.chains.forEach((chain) => {
      const fundAddress = CONTRACTS[`chain${chain.id}`]?.fund
      if (fundAddress) loadFundConfig(chain, fundAddress)
    })
  }, [isAdmin])

  // Read the one thing the Chat card acts on: whether the contract is paused. A read failure
  // means no live HupChat answers at that address, so the card shows the error and locks the
  // toggle rather than offering a write that would revert.
  const loadChatConfig = async (chain, chatAddress) => {
    setChatConfigs((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
      const paused = await client.readContract({ address: chatAddress, abi: CHAT_PAUSE_ABI, functionName: 'paused' })
      setChatConfigs((prev) => ({ ...prev, [chain.id]: { loading: false, paused } }))
    } catch (err) {
      setChatConfigs((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'No HupChat contract answers at this address' },
      }))
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    config.chains.forEach((chain) => {
      const chatAddress = CONTRACTS[`chain${chain.id}`]?.chat
      if (chatAddress) loadChatConfig(chain, chatAddress)
    })
  }, [isAdmin])

  // Stop or resume new messages on a chain's HupChat. The connected wallet must hold ADMIN_ROLE
  // on the contract or the write reverts.
  const handleChatPause = async (chain, chatAddress, pause) => {
    setChatPauseTxStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: chatAddress,
        abi: CHAT_PAUSE_ABI,
        functionName: pause ? 'pause' : 'unpause',
        chainId: chain.id,
      })

      setChatPauseTxStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash, action: pause ? 'paused' : 'resumed' } }))
      setTimeout(() => loadChatConfig(chain, chatAddress), 3000)
    } catch (err) {
      console.error(`Chat ${pause ? 'pause' : 'unpause'} error on chain ${chain.id}:`, err)
      setChatPauseTxStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Set the platform fee for campaigns created from now on. Campaigns already open keep the
  // rate they were created with — the contract freezes it — so this never reprices a live pot.
  const handleSetFundFee = async (chain, fundAddress) => {
    const bps = Number(fundFeeInputs[chain.id])
    if (!Number.isInteger(bps) || bps < 0 || bps > 1000) {
      setFundFeeTxStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a whole number of basis points, 0 to 1000 (10%)' } }))
      return
    }

    setFundFeeTxStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: fundAddress,
        abi: fundAbi,
        functionName: 'setFundFeeBps',
        args: [BigInt(bps)],
        chainId: chain.id,
      })

      setFundFeeTxStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))
      setTimeout(() => loadFundConfig(chain, fundAddress), 3000)
    } catch (err) {
      console.error(`Fund fee update error on chain ${chain.id}:`, err)
      setFundFeeTxStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Sweep the fee ledger. Only feesAccrued moves — campaign pots are out of the admin's reach
  // by construction, so this can never touch money that is still somebody's to refund.
  const handleWithdrawFundFees = async (chain, fundAddress) => {
    const receiver = fundReceiverInputs[chain.id]?.trim() || address
    if (!isAddress(receiver)) {
      setFundWithdrawStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid receiver address' } }))
      return
    }

    setFundWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: fundAddress,
        abi: fundAbi,
        functionName: 'withdrawFees',
        args: [receiver],
        chainId: chain.id,
      })

      setFundWithdrawStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))
      setTimeout(() => loadFundConfig(chain, fundAddress), 3000)
      setTimeout(() => loadChainBalances(chain), 3000)
    } catch (err) {
      console.error(`Fund fee withdrawal error on chain ${chain.id}:`, err)
      setFundWithdrawStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Pause blocks new campaigns, backings and withdrawals. It never blocks a refund claim —
  // the contract exempts claimRefund so backers can always leave.
  const handleFundPause = async (chain, fundAddress, pause) => {
    setFundPauseTxStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: fundAddress,
        abi: fundAbi,
        functionName: pause ? 'pause' : 'unpause',
        chainId: chain.id,
      })

      setFundPauseTxStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash, action: pause ? 'paused' : 'resumed' } }))
      setTimeout(() => loadFundConfig(chain, fundAddress), 3000)
    } catch (err) {
      console.error(`Fund ${pause ? 'pause' : 'unpause'} error on chain ${chain.id}:`, err)
      setFundPauseTxStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Read the LSP26 follower registry a chain's contract is currently wired to. It is never a
  // constructor arg, so every fresh deployment starts at address(0).
  const loadFollowerSystem = async (chain, target) => {
    const stateKey = followerSystemKey(target, chain)
    setFollowerSystems((prev) => ({ ...prev, [stateKey]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
      const followerSystem = await client.readContract({
        address: CONTRACTS[`chain${chain.id}`][target.key],
        abi: target.abi,
        functionName: 'followerSystem',
      })

      setFollowerSystems((prev) => ({ ...prev, [stateKey]: { loading: false, followerSystem } }))
    } catch (err) {
      console.error(`${target.label} follower system read error for chain ${chain.id}:`, err)
      setFollowerSystems((prev) => ({
        ...prev,
        [stateKey]: { loading: false, error: err.shortMessage || err.message || 'Failed to read follower system' },
      }))
    }
  }

  // Load the live wiring per chain and contract, and seed each input with that chain's
  // configured registry so the ordinary case (point a fresh deployment at the known LSP26
  // address) is one click
  useEffect(() => {
    if (!isAdmin) return

    const seeds = {}
    config.chains.forEach((chain) => {
      const deployment = CONTRACTS[`chain${chain.id}`]
      Object.values(FOLLOWER_SYSTEM_TARGETS).forEach((target) => {
        if (!deployment?.[target.key]) return

        loadFollowerSystem(chain, target)
        if (deployment.followerSystem) seeds[followerSystemKey(target, chain)] = deployment.followerSystem
      })
    })

    setFollowerSystemInputs((prev) => ({ ...seeds, ...prev }))
  }, [isAdmin])

  // Wire the follower registry into a chain's contract (admin wallet signs). Until this is set,
  // every FollowsCreator requirement on it fails closed — see FOLLOWER_SYSTEM_TARGETS for what
  // that looks like — with nothing in the UI explaining why.
  const handleSetFollowerSystem = async (chain, target) => {
    const stateKey = followerSystemKey(target, chain)
    const registry = followerSystemInputs[stateKey]?.trim()
    if (!isAddress(registry)) {
      setFollowerSystemTxStates((prev) => ({ ...prev, [stateKey]: { error: 'Enter a valid registry address' } }))
      return
    }

    setFollowerSystemTxStates((prev) => ({ ...prev, [stateKey]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: CONTRACTS[`chain${chain.id}`][target.key],
        abi: target.abi,
        functionName: 'setFollowerSystem',
        args: [registry],
        chainId: chain.id,
      })

      setFollowerSystemTxStates((prev) => ({ ...prev, [stateKey]: { loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadFollowerSystem(chain, target), 3000)
    } catch (err) {
      console.error(`${target.label} follower system update error on chain ${chain.id}:`, err)
      setFollowerSystemTxStates((prev) => ({
        ...prev,
        [stateKey]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // The follower-registry panel, one card per chain running `target` — shared by every
  // FOLLOWER_SYSTEM_TARGETS entry so wiring HupPolls looks exactly like wiring HupCommunity
  const renderFollowerSystemSection = (target) => (
    <section className={styles['admin-contracts__section']}>
      <header className={styles['admin-contracts__header']}>
        <h2 className={styles['admin-contracts__title']}>{target.label} Follower System</h2>
        <p className={styles['admin-contracts__subtitle']}>
          Wire the LSP26 follower registry into {target.label}. It is not a constructor argument, so a fresh deployment starts unset — and
          while it is unset every FollowsCreator requirement fails closed, {target.consequence}.
        </p>
      </header>

      <div className={styles['admin-contracts__grid']}>
        {visibleChains(target.key).map((chain) => {
          const deployment = CONTRACTS[`chain${chain.id}`]
          const contractAddress = deployment[target.key]
          const stateKey = followerSystemKey(target, chain)
          const registryDraft = followerSystemInputs[stateKey] ?? ''
          const state = followerSystems[stateKey]
          const tx = followerSystemTxStates[stateKey]
          const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
          const onChain = state?.followerSystem
          const isUnset = onChain && onChain.toLowerCase() === zeroAddress
          const matchesConfig = onChain && deployment.followerSystem && onChain.toLowerCase() === deployment.followerSystem.toLowerCase()

          return (
            <div
              key={stateKey}
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
                <span className={styles['admin-contracts__badge']}>{target.label.toUpperCase()}</span>
              </div>

              <div className={styles['admin-contracts__details']}>
                <div className={styles['admin-contracts__detail-row']}>
                  <span className={styles['admin-contracts__detail-label']}>{target.label} Address</span>
                  <span className={styles['admin-contracts__detail-value']}>
                    {explorerUrl ? (
                      <a href={`${explorerUrl}/address/${contractAddress}`} target="_blank" rel="noopener noreferrer">
                        <code>{contractAddress}</code> ↗
                      </a>
                    ) : (
                      <code>{contractAddress}</code>
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
                  handleSetFollowerSystem(chain, target)
                }}
              >
                <div className={styles['admin-contracts__input-group']}>
                  <label className={styles['admin-contracts__detail-label']}>Follower Registry Address</label>
                  <input
                    type="text"
                    className={styles['admin-contracts__input']}
                    value={registryDraft}
                    onChange={(e) => setFollowerSystemInputs((prev) => ({ ...prev, [stateKey]: e.target.value }))}
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
                    onClick={() => loadFollowerSystem(chain, target)}
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
      {visibleChains(target.key).length === 0 && (
        <p className={styles['admin-contracts__empty']}>No {target.label} deployments match this filter.</p>
      )}
    </section>
  )

  // Read a chain's HupDrops wiring: the deployer satellite for every standard the chain can
  // register (its native pair, plus the other family on the dev chain), the two registries the
  // Followers and Community gates ask, and all three fee knobs
  const loadDropsConfig = async (chain, dropsAddress) => {
    setDropsConfigs((prev) => ({ ...prev, [chain.id]: { loading: true } }))

    try {
      const client = createPublicClient({ chain, transport: browserTransport(chain.id) })
      const standardIds = dropStandardRowsFor(chain.id).map((row) => row.id)

      const [deployerAddresses, followerSystem, communitySystem, splits, mintFeeBps, mintFee, mintFeeEnabled, creationFee, featuredFee] = await Promise.all([
        Promise.all(
          standardIds.map((id) => client.readContract({ address: dropsAddress, abi: dropsAbi, functionName: 'deployers', args: [BigInt(id)] })),
        ),
        client.readContract({ address: dropsAddress, abi: dropsAbi, functionName: 'followerSystem' }),
        client.readContract({ address: dropsAddress, abi: dropsAbi, functionName: 'communitySystem' }),
        // Absent on engines older than the splits build (the Monad test engine): null keeps the
        // rest of the card readable rather than failing every lever on that chain
        client.readContract({ address: dropsAddress, abi: dropsAbi, functionName: 'splits' }).catch(() => null),
        client.readContract({ address: dropsAddress, abi: dropsAbi, functionName: 'mintFeeBps' }),
        client.readContract({ address: dropsAddress, abi: dropsAbi, functionName: 'mintFee' }),
        client.readContract({ address: dropsAddress, abi: dropsAbi, functionName: 'mintFeeEnabled' }),
        client.readContract({ address: dropsAddress, abi: dropsAbi, functionName: 'creationFee' }),
        client.readContract({ address: dropsAddress, abi: dropsAbi, functionName: 'featuredFee' }).catch(() => null),
      ])

      setDropsConfigs((prev) => ({
        ...prev,
        [chain.id]: {
          loading: false,
          deployers: Object.fromEntries(standardIds.map((id, index) => [id, deployerAddresses[index]])),
          standardIds,
          followerSystem,
          communitySystem,
          splits,
          mintFeeBps,
          mintFee,
          mintFeeEnabled,
          creationFee,
          featuredFee,
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

  // Until set, a Community-gated phase reverts InvalidGateConfig and the composer hides the gate.
  // Takes the resolved draft: the seeded input state is undefined until someone types.
  const handleSetDropsCommunity = async (chain, dropsAddress, draft) => {
    const registry = draft?.trim()
    if (!isAddress(registry)) {
      setDropsCommunityTxStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid registry address' } }))
      return
    }

    setDropsCommunityTxStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: dropsAddress,
        abi: dropsAbi,
        functionName: 'setCommunitySystem',
        args: [registry],
        chainId: chain.id,
      })

      setDropsCommunityTxStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadDropsConfig(chain, dropsAddress), 3000)
    } catch (err) {
      console.error(`Drops community system update error on chain ${chain.id}:`, err)
      setDropsCommunityTxStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Until set, any drop asking for a payout or royalty split reverts SplitsUnavailable; drops
  // that ask for none are unaffected. HupSplits itself needs no setup — no owner, no fees.
  const handleSetDropsSplits = async (chain, dropsAddress, draft) => {
    const factory = draft?.trim()
    if (!isAddress(factory)) {
      setDropsSplitsTxStates((prev) => ({ ...prev, [chain.id]: { error: 'Enter a valid factory address' } }))
      return
    }

    setDropsSplitsTxStates((prev) => ({ ...prev, [chain.id]: { loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: dropsAddress,
        abi: dropsAbi,
        functionName: 'setSplits',
        args: [factory],
        chainId: chain.id,
      })

      setDropsSplitsTxStates((prev) => ({ ...prev, [chain.id]: { loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadDropsConfig(chain, dropsAddress), 3000)
    } catch (err) {
      console.error(`Drops splits factory update error on chain ${chain.id}:`, err)
      setDropsSplitsTxStates((prev) => ({
        ...prev,
        [chain.id]: { loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  const handleToggleDropsMintFee = async (chain, dropsAddress, enabled) => {
    setDropsFeeTxStates((prev) => ({ ...prev, [chain.id]: { which: 'flatToggle', loading: true, error: null } }))

    try {
      const txHash = await writeContractAsync({
        address: dropsAddress,
        abi: dropsAbi,
        functionName: 'setMintFeeEnabled',
        args: [enabled],
        chainId: chain.id,
      })

      setDropsFeeTxStates((prev) => ({ ...prev, [chain.id]: { which: 'flatToggle', loading: false, success: true, hash: txHash } }))

      setTimeout(() => loadDropsConfig(chain, dropsAddress), 3000)
    } catch (err) {
      console.error(`Drops mint fee toggle error on chain ${chain.id}:`, err)
      setDropsFeeTxStates((prev) => ({
        ...prev,
        [chain.id]: { which: 'flatToggle', loading: false, error: err.shortMessage || err.message || 'Transaction rejected or failed' },
      }))
    }
  }

  // Set a HupDrops fee knob (admin wallet signs): the mint cut (entered in %, stored in bps,
  // capped at 10% by the contract), the flat per-item fee, the drop-creation fee, or the
  // featured-tier surcharge
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
    } else if (which === 'flat') {
      try {
        value = parseEther(draft || '')
      } catch {
        setDropsFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, error: 'Enter a valid amount in native units' } }))
        return
      }
      functionName = 'setMintFee'
    } else {
      try {
        value = parseEther(draft || '')
      } catch {
        setDropsFeeTxStates((prev) => ({ ...prev, [chain.id]: { which, error: 'Enter a valid amount in native units' } }))
        return
      }
      functionName = which === 'featured' ? 'setFeaturedFee' : 'setCreationFee'
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
        functionName: 'withdrawFees',
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

          {activeSection === 'sell-fees' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>HupSell Fees</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Set the platform cut taken from each completed sale, and the flat fee to create a listing. A change applies only to
                  purchases made after it — every escrow already open keeps the fee it was bought under.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('sell').map((chain) => {
                  const deployment = CONTRACTS[`chain${chain.id}`]
                  const fees = sellFees[chain.id]
                  const feeInputs = sellFeeInputs[chain.id] ?? {}
                  const feeTx = sellFeeTxStates[chain.id]
                  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
                  const symbol = chain.nativeCurrency?.symbol ?? 'ETH'

                  return (
                    <div
                      key={`sell-fees-${chain.id}`}
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
                        <span className={styles['admin-contracts__badge']}>HUPSELL</span>
                      </div>

                      <div className={styles['admin-contracts__details']}>
                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Contract</span>
                          <span className={styles['admin-contracts__detail-value']}>
                            {explorerUrl ? (
                              <a href={`${explorerUrl}/address/${deployment.sell}`} target="_blank" rel="noopener noreferrer">
                                <code>{deployment.sell}</code> ↗
                              </a>
                            ) : (
                              <code>{deployment.sell}</code>
                            )}
                          </span>
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
                                {Number(fees.buyFeeBps) / 100}% per sale · Listing {formatEther(fees.listingFee)} {symbol}
                              </strong>
                            )}
                          </div>
                        </div>

                        {feeTx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Tx Status</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {feeTx.loading && <span style={{ color: '#d97706' }}>Signing &amp; broadcasting tx...</span>}
                              {feeTx.error && <span style={{ color: '#ef4444' }}>❌ {feeTx.error}</span>}
                              {feeTx.success && (
                                <span style={{ color: '#10b981' }}>
                                  🚀 {feeTx.which === 'buy' ? 'Sale fee' : 'Listing fee'} updated.
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
                          handleSetSellFee(chain, deployment.sell, 'buy')
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Fee per sale (%)</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={feeInputs.buy ?? ''}
                            onChange={(e) => setSellFeeInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], buy: e.target.value } }))}
                            placeholder="e.g. 2"
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!feeInputs.buy?.trim() || feeTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {feeTx?.loading && feeTx.which === 'buy' ? 'Writing...' : 'Set Sale Fee'}
                          </button>
                        </div>
                      </form>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetSellFee(chain, deployment.sell, 'listing')
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Listing fee ({symbol})</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={feeInputs.listing ?? ''}
                            onChange={(e) =>
                              setSellFeeInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], listing: e.target.value } }))
                            }
                            placeholder="e.g. 0"
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
                    </div>
                  )
                })}
              </div>
              {visibleChains('sell').length === 0 && (
                <p className={styles['admin-contracts__empty']}>No HupSell deployments match this filter.</p>
              )}
            </section>
          )}

          {activeSection === 'sell-treasury' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>HupSell Treasury</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Withdraw accumulated listing/buy fees from HupSell. Only fees are withdrawable — buyer escrow is excluded by the contract.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('sell').map((chain) => {
                  const deployment = CONTRACTS[`chain${chain.id}`]
                  const receiverDraft = receiverInputs[chain.id] ?? ''
                  const tokenDraft = tokenInputs[chain.id] ?? ''
                  const isLsp7 = Boolean(tokenIsLsp7[chain.id])
                  const nativeState = nativeWithdrawStates[chain.id]
                  const tokenState = tokenWithdrawStates[chain.id]
                  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
                  const symbol = chain.nativeCurrency?.symbol ?? 'ETH'
                  const nativeBalance = renderBalance(chain.id, deployment.sell, symbol)

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
                              <a href={`${explorerUrl}/address/${deployment.sell}`} target="_blank" rel="noopener noreferrer">
                                <code>{deployment.sell}</code> ↗
                              </a>
                            ) : (
                              <code>{deployment.sell}</code>
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
                          handleWithdrawNative(chain, deployment.sell)
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
                          handleWithdrawToken(chain, deployment.sell)
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
              {visibleChains('sell').length === 0 && (
                <p className={styles['admin-contracts__empty']}>No HupSell deployments match this filter.</p>
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
                  const standardRows = dropStandardRowsFor(chain.id)
                  const deployerTx = dropsDeployerTxStates[chain.id]
                  const followerTx = dropsFollowerTxStates[chain.id]
                  const feeTx = dropsFeeTxStates[chain.id]
                  const withdrawTx = dropsWithdrawStates[chain.id]
                  const followerDraft = dropsFollowerInputs[chain.id] ?? ''
                  const communityTx = dropsCommunityTxStates[chain.id]
                  const communityDraft = dropsCommunityInputs[chain.id] ?? deployment.community ?? ''
                  const onChainCommunity = state?.communitySystem
                  const communityUnset = onChainCommunity && onChainCommunity.toLowerCase() === zeroAddress
                  const communityMatches =
                    onChainCommunity && deployment.community && onChainCommunity.toLowerCase() === deployment.community.toLowerCase()
                  const splitsTx = dropsSplitsTxStates[chain.id]
                  const splitsDraft = dropsSplitsInputs[chain.id] ?? deployment.splits ?? ''
                  const onChainSplits = state?.splits
                  const splitsUnset = onChainSplits && onChainSplits.toLowerCase() === zeroAddress
                  const splitsMatches = onChainSplits && deployment.splits && onChainSplits.toLowerCase() === deployment.splits.toLowerCase()
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
                          <span className={styles['admin-contracts__detail-label']}>Community System</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {communityUnset ? (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}>
                                ⚠️ Not set — the Community gate is unavailable on this chain
                              </div>
                            ) : (
                              onChainCommunity && (
                                <div
                                  className={clsx(
                                    styles['admin-contracts__validation'],
                                    communityMatches ? styles['admin-contracts__validation--success'] : styles['admin-contracts__validation--warning'],
                                  )}
                                >
                                  {communityMatches ? '✓ Wired to' : '⚠️ Set to'} <code>{onChainCommunity}</code>
                                  {communityMatches ? '' : ", which is not this chain's configured HupCommunity"}
                                </div>
                              )
                            )}

                            <form
                              className={styles['admin-contracts__edit-form']}
                              onSubmit={(e) => {
                                e.preventDefault()
                                handleSetDropsCommunity(chain, deployment.drops, communityDraft)
                              }}
                            >
                              <div className={styles['admin-contracts__input-group']}>
                                <input
                                  type="text"
                                  className={styles['admin-contracts__input']}
                                  value={communityDraft}
                                  onChange={(e) => setDropsCommunityInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                                  placeholder="0x… HupCommunity"
                                />
                              </div>
                              <div className={styles['admin-contracts__actions']}>
                                <button
                                  type="submit"
                                  disabled={!communityDraft.trim() || communityTx?.loading}
                                  className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                                >
                                  {communityTx?.loading ? 'Writing...' : 'Set Community System'}
                                </button>
                              </div>
                              {communityTx?.error && <span style={{ color: '#ef4444' }}>❌ {communityTx.error}</span>}
                              {communityTx?.success && <span style={{ color: '#10b981' }}>🚀 Community system updated.</span>}
                            </form>
                          </div>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Splits Factory</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {splitsUnset ? (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}>
                                ⚠️ Not set — payout and royalty splits are unavailable on this chain
                              </div>
                            ) : (
                              onChainSplits && (
                                <div
                                  className={clsx(
                                    styles['admin-contracts__validation'],
                                    splitsMatches ? styles['admin-contracts__validation--success'] : styles['admin-contracts__validation--warning'],
                                  )}
                                >
                                  {splitsMatches ? '✓ Wired to' : '⚠️ Set to'} <code>{onChainSplits}</code>
                                  {splitsMatches ? '' : ", which is not this chain's configured HupSplits"}
                                </div>
                              )
                            )}

                            <form
                              className={styles['admin-contracts__edit-form']}
                              onSubmit={(e) => {
                                e.preventDefault()
                                handleSetDropsSplits(chain, deployment.drops, splitsDraft)
                              }}
                            >
                              <div className={styles['admin-contracts__input-group']}>
                                <input
                                  type="text"
                                  className={styles['admin-contracts__input']}
                                  value={splitsDraft}
                                  onChange={(e) => setDropsSplitsInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                                  placeholder="0x… HupSplits"
                                />
                              </div>
                              <div className={styles['admin-contracts__actions']}>
                                <button
                                  type="submit"
                                  disabled={!splitsDraft.trim() || splitsTx?.loading}
                                  className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                                >
                                  {splitsTx?.loading ? 'Writing...' : 'Set Splits Factory'}
                                </button>
                              </div>
                              {splitsTx?.error && <span style={{ color: '#ef4444' }}>❌ {splitsTx.error}</span>}
                              {splitsTx?.success && <span style={{ color: '#10b981' }}>🚀 Splits factory updated.</span>}
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
                          <span className={styles['admin-contracts__detail-label']}>Flat Mint Fee</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {state && !state.loading && !state.error && (
                              <strong>
                                {formatNative(state.mintFee)} {symbol} per item{' '}
                                <span style={{ color: state.mintFeeEnabled ? '#10b981' : '#ef4444' }}>
                                  {state.mintFeeEnabled ? '(charging)' : '(off)'}
                                </span>
                              </strong>
                            )}
                            <form
                              className={styles['admin-contracts__edit-form']}
                              onSubmit={(e) => {
                                e.preventDefault()
                                handleSetDropsFee(chain, deployment.drops, 'flat')
                              }}
                            >
                              <div className={styles['admin-contracts__input-group']}>
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  className={styles['admin-contracts__input']}
                                  value={dropsFeeInputs[chain.id]?.flat ?? ''}
                                  onChange={(e) =>
                                    setDropsFeeInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], flat: e.target.value } }))
                                  }
                                  placeholder={`Flat fee per item minted, in ${symbol}`}
                                />
                              </div>
                              <div className={styles['admin-contracts__actions']}>
                                <button
                                  type="submit"
                                  disabled={feeTx?.which === 'flat' && feeTx?.loading}
                                  className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                                >
                                  {feeTx?.which === 'flat' && feeTx?.loading ? 'Writing...' : 'Set Flat Fee'}
                                </button>
                                <button
                                  type="button"
                                  disabled={!state || state.loading || state.error || (feeTx?.which === 'flatToggle' && feeTx?.loading)}
                                  onClick={() => handleToggleDropsMintFee(chain, deployment.drops, !state?.mintFeeEnabled)}
                                  className={styles['admin-contracts__button']}
                                >
                                  {feeTx?.which === 'flatToggle' && feeTx?.loading
                                    ? 'Writing...'
                                    : state?.mintFeeEnabled
                                      ? 'Disable'
                                      : 'Enable'}
                                </button>
                              </div>
                              <span className={styles['admin-contracts__hint']}>
                                Charged on top of the phase price, on every mint including free ones — the only knob a free drop pays.
                                Turning it on also ends gasless session-key minting, which needs a zero-value transaction.
                              </span>
                              {(feeTx?.which === 'flat' || feeTx?.which === 'flatToggle') && feeTx?.error && (
                                <span style={{ color: '#ef4444' }}>❌ {feeTx.error}</span>
                              )}
                              {(feeTx?.which === 'flat' || feeTx?.which === 'flatToggle') && feeTx?.success && (
                                <span style={{ color: '#10b981' }}>🚀 Flat mint fee updated.</span>
                              )}
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
                          <span className={styles['admin-contracts__detail-label']}>Featured Fee</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {state && !state.loading && !state.error && (
                              <strong>{state.featuredFee === null ? 'not on this engine build' : `${formatNative(state.featuredFee)} ${symbol}`}</strong>
                            )}
                            <form
                              className={styles['admin-contracts__edit-form']}
                              onSubmit={(e) => {
                                e.preventDefault()
                                handleSetDropsFee(chain, deployment.drops, 'featured')
                              }}
                            >
                              <div className={styles['admin-contracts__input-group']}>
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  className={styles['admin-contracts__input']}
                                  value={dropsFeeInputs[chain.id]?.featured ?? ''}
                                  onChange={(e) =>
                                    setDropsFeeInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], featured: e.target.value } }))
                                  }
                                  placeholder={`Surcharge for the featured tier, in ${symbol}`}
                                />
                              </div>
                              <span className={styles['admin-contracts__hint']}>
                                Paid on top of the creation fee, or later through featureDrop. Zero means every drop can feature itself for free.
                              </span>
                              <div className={styles['admin-contracts__actions']}>
                                <button
                                  type="submit"
                                  disabled={feeTx?.which === 'featured' && feeTx?.loading}
                                  className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                                >
                                  {feeTx?.which === 'featured' && feeTx?.loading ? 'Writing...' : 'Set Featured Fee'}
                                </button>
                              </div>
                              {feeTx?.which === 'featured' && feeTx?.error && <span style={{ color: '#ef4444' }}>❌ {feeTx.error}</span>}
                              {feeTx?.which === 'featured' && feeTx?.success && (
                                <span style={{ color: '#10b981' }}>🚀 Featured fee updated.</span>
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

          {activeSection === 'community' && renderFollowerSystemSection(FOLLOWER_SYSTEM_TARGETS.community)}

          {activeSection === 'polls' && renderFollowerSystemSection(FOLLOWER_SYSTEM_TARGETS.polls)}

          {activeSection === 'fund' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>HupFund</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Escrowed fundraising campaigns. The fee is taken once, when a creator withdraws a pot, at the rate frozen into the
                  campaign when it was created — changing it here only affects campaigns opened afterwards. Fees land in their own ledger,
                  and that ledger is the only balance this page can move: campaign pots are unreachable by design. Pause stops new
                  campaigns, backings and withdrawals; refund claims always go through.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('fund').map((chain) => {
                  const deployment = CONTRACTS[`chain${chain.id}`]
                  const fundConfig = fundConfigs[chain.id]
                  const feeDraft = fundFeeInputs[chain.id] ?? ''
                  const receiverDraft = fundReceiverInputs[chain.id] ?? ''
                  const feeTx = fundFeeTxStates[chain.id]
                  const withdrawTx = fundWithdrawStates[chain.id]
                  const pauseTx = fundPauseTxStates[chain.id]
                  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
                  const symbol = chain.nativeCurrency?.symbol ?? 'ETH'
                  const isLocked = !fundConfig || fundConfig.loading || Boolean(fundConfig.error)
                  const feesAccrued = fundConfig?.feesAccrued ?? 0n
                  const feePercent = fundConfig ? (fundConfig.feeBps / 100).toFixed(2).replace(/\.?0+$/, '') : ''

                  return (
                    <div
                      key={`fund-${chain.id}`}
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
                        <span className={styles['admin-contracts__badge']}>HUPFUND</span>
                      </div>

                      <div className={styles['admin-contracts__details']}>
                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Fund Address</span>
                          <span className={styles['admin-contracts__detail-value']}>
                            {explorerUrl ? (
                              <a href={`${explorerUrl}/address/${deployment.fund}`} target="_blank" rel="noopener noreferrer">
                                <code>{deployment.fund}</code> ↗
                              </a>
                            ) : (
                              <code>{deployment.fund}</code>
                            )}
                          </span>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Contract</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {(!fundConfig || fundConfig.loading) && <span>Loading…</span>}
                            {fundConfig?.error && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                                {fundConfig.error}
                              </div>
                            )}
                            {fundConfig?.version && !fundConfig.paused && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--success'])}>
                                ✓ v{fundConfig.version} — live, {fundConfig.campaigns} {fundConfig.campaigns === 1 ? 'campaign' : 'campaigns'} opened
                              </div>
                            )}
                            {fundConfig?.version && fundConfig.paused && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}>
                                ⚠️ v{fundConfig.version} — PAUSED: no new campaigns, backings or withdrawals ({fundConfig.campaigns} opened)
                              </div>
                            )}
                          </div>
                        </div>

                        {fundConfig?.version && (
                          <>
                            <div className={styles['admin-contracts__detail-row']}>
                              <span className={styles['admin-contracts__detail-label']}>Fee For New Campaigns</span>
                              <span className={styles['admin-contracts__detail-value']}>
                                {fundConfig.feeBps} bps ({feePercent}%)
                              </span>
                            </div>
                            <div className={styles['admin-contracts__detail-row']}>
                              <span className={styles['admin-contracts__detail-label']}>Fees Accrued</span>
                              <span className={styles['admin-contracts__detail-value']}>
                                {formatEther(feesAccrued)} {symbol}
                              </span>
                            </div>
                          </>
                        )}

                        {feeTx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Fee Tx</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {feeTx.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                              {feeTx.error && <span style={{ color: '#ef4444' }}>❌ {feeTx.error}</span>}
                              {feeTx.success && <span style={{ color: '#10b981' }}>🚀 Fee updated for campaigns created from now on.</span>}
                            </div>
                          </div>
                        )}

                        {withdrawTx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Withdraw Tx</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {withdrawTx.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                              {withdrawTx.error && <span style={{ color: '#ef4444' }}>❌ {withdrawTx.error}</span>}
                              {withdrawTx.success && <span style={{ color: '#10b981' }}>🚀 Fees swept.</span>}
                            </div>
                          </div>
                        )}

                        {pauseTx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Pause Tx</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {pauseTx.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                              {pauseTx.error && <span style={{ color: '#ef4444' }}>❌ {pauseTx.error}</span>}
                              {pauseTx.success && <span style={{ color: '#10b981' }}>🚀 Contract {pauseTx.action}.</span>}
                            </div>
                          </div>
                        )}
                      </div>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetFundFee(chain, deployment.fund)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Fee (basis points, 100 = 1%, max 1000)</label>
                          <input
                            type="number"
                            min="0"
                            max="1000"
                            step="1"
                            className={styles['admin-contracts__input']}
                            value={feeDraft}
                            onChange={(e) => setFundFeeInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                            placeholder="0"
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={isLocked || feeTx?.loading || feeDraft === '' || Number(feeDraft) === fundConfig?.feeBps}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {feeTx?.loading ? 'Writing...' : 'Set Fee'}
                          </button>
                        </div>
                      </form>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleWithdrawFundFees(chain, deployment.fund)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Sweep Fees To (defaults to your wallet)</label>
                          <input
                            type="text"
                            className={styles['admin-contracts__input']}
                            value={receiverDraft}
                            onChange={(e) => setFundReceiverInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                            placeholder={address || '0x...'}
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={isLocked || withdrawTx?.loading || feesAccrued === 0n}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {withdrawTx?.loading ? 'Writing...' : feesAccrued === 0n ? 'Nothing To Sweep' : `Sweep ${formatEther(feesAccrued)} ${symbol}`}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleFundPause(chain, deployment.fund, !fundConfig?.paused)}
                            disabled={isLocked || pauseTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                          >
                            {pauseTx?.loading ? 'Writing...' : fundConfig?.paused ? 'Unpause' : 'Pause'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )
                })}
              </div>
              {visibleChains('fund').length === 0 && (
                <p className={styles['admin-contracts__empty']}>No HupFund deployments match this filter.</p>
              )}
            </section>
          )}

          {activeSection === 'premium' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>Premium Pricing</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Each chain prices the monthly and yearly plans in its own native coin, set to hit the same dollar target — so these
                  move whenever a coin does. Repricing never touches a term already bought. The dollar figure beside each input is what
                  the amount you typed is worth right now.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('premium').map((chain) => {
                  const deployment = CONTRACTS[`chain${chain.id}`]
                  const plans = premiumPlans[chain.id]
                  const priceInputs = premiumPriceInputs[chain.id] ?? {}
                  const priceTx = premiumTxStates[chain.id]
                  const receiverDraft = premiumReceiverInputs[chain.id] ?? ''
                  const withdrawState = premiumWithdrawStates[chain.id]
                  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
                  const symbol = chain.nativeCurrency?.symbol ?? 'ETH'
                  const coinUsd = premiumCoinUsd[chain.id] ?? null
                  const tokenDraft = premiumTokenInputs[chain.id] ?? {}
                  const tokenTx = premiumTokenStates[chain.id]
                  const compDraft = premiumCompInputs[chain.id] ?? {}
                  const compTx = premiumCompStates[chain.id]
                  const compCount = plans?.complimentaryCount
                  const takesComplimentary = compCount !== undefined
                  const manageDraft = premiumManageInputs[chain.id] ?? {}
                  const manageTx = premiumManageStates[chain.id]
                  const moderatorRole = plans?.moderatorRole
                  const isPaused = Boolean(plans?.paused)
                  const takesTokens = Boolean(plans?.takesTokens)
                  const nativeBalance = renderBalance(chain.id, deployment.premium, symbol)
                  const tokenBalances = premiumTokenBalances[chain.id]
                  const nativeHidden = Boolean(deployment.premiumNativeDisabled)

                  // What a typed amount would cost a subscriber, so the target is reachable
                  // without a calculator. Null on a chain with no market price.
                  const draftUsd = (draft) => {
                    const amount = Number(draft)
                    if (!coinUsd || !Number.isFinite(amount) || amount <= 0) return null
                    return `≈ ${(amount * coinUsd).toFixed(2)}`
                  }

                  const livePrice = (plan) => {
                    if (!plan) return '—'
                    // The sentinel is not a price; showing it as one is a 78-digit number
                    if (isNativeClosed(plan.price)) return 'closed'
                    const native = `${formatEther(plan.price)} ${symbol}`
                    if (!coinUsd) return native
                    return `${native} (≈ ${(Number(formatEther(plan.price)) * coinUsd).toFixed(2)})`
                  }

                  return (
                    <div
                      key={`premium-${chain.id}`}
                      className={styles['admin-contracts__card']}
                      style={{
                        '--network-color-primary': chain.primaryColor || '#f59e0b',
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
                        <span className={styles['admin-contracts__badge']}>HUPPREMIUM</span>
                      </div>

                      <div className={styles['admin-contracts__details']}>
                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Premium Address</span>
                          <span className={styles['admin-contracts__detail-value']}>
                            {explorerUrl ? (
                              <a href={`${explorerUrl}/address/${deployment.premium}`} target="_blank" rel="noopener noreferrer">
                                <code>{deployment.premium}</code> ↗
                              </a>
                            ) : (
                              <code>{deployment.premium}</code>
                            )}
                          </span>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Native Balance</span>
                          <div className={styles['admin-contracts__detail-value']}>{nativeBalance}</div>
                        </div>

                        {tokenBalances && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Token Balances</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {!tokenBalances.items ? (
                                <span>Loading…</span>
                              ) : (
                                tokenBalances.items.map((item, index) => (
                                  <span key={item.token}>
                                    {index > 0 && ' · '}
                                    {item.value === undefined ? (
                                      <span>— {item.symbol ?? ''}</span>
                                    ) : (
                                      <strong>
                                        {formatToken(item.value, item.decimals)} {item.symbol}
                                      </strong>
                                    )}
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        )}

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Current Prices</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {(!plans || plans.loading) && <span>Loading…</span>}
                            {plans?.error && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                                {plans.error}
                              </div>
                            )}
                            {plans && !plans.loading && !plans.error && (
                              <strong>
                                Monthly {livePrice(plans.monthly)} · Yearly {livePrice(plans.yearly)}
                              </strong>
                            )}
                          </div>
                        </div>

                        {nativeHidden && (
                          <div className={styles['admin-contracts__validation']}>
                            The app does not offer {symbol} on this chain (premiumNativeDisabled in contracts.js) — only
                            tokens. That hides it; it does not close it. Use <strong>Close {symbol} sales</strong> below so
                            a transaction sent outside the app cannot pay in {symbol} either.
                          </div>
                        )}

                        {plans && !plans.loading && !plans.error && !plans.monthly?.enabled && (
                          <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                            The monthly plan is disabled onchain — nobody can buy it.
                          </div>
                        )}

                        {priceTx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Tx Status</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {priceTx.loading && <span style={{ color: '#d97706' }}>Signing & broadcasting tx...</span>}
                              {priceTx.error && <span style={{ color: '#ef4444' }}>❌ {priceTx.error}</span>}
                              {priceTx.success && (
                                <span style={{ color: '#10b981' }}>
                                  🚀 {priceTx.which === 'yearly' ? 'Yearly' : 'Monthly'} {priceTx.closed ? 'native sales closed.' : 'price updated.'}
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
                          handleSetPremiumPrice(chain, deployment.premium, PLAN_MONTHLY)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>
                            Monthly Price ({symbol}) {draftUsd(priceInputs.monthly) ?? ''}
                          </label>
                          <p className={styles['admin-contracts__hint']}>
                            What one month costs in this chain&apos;s coin. The coin moves, so this is a peg you re-set — the dollar
                            figure beside the label is what the amount is worth right now. Repricing never touches a term someone
                            already bought.
                          </p>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={priceInputs.monthly ?? ''}
                            onChange={(e) =>
                              setPremiumPriceInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], monthly: e.target.value } }))
                            }
                            placeholder="e.g. 0.002"
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!priceInputs.monthly?.trim() || priceTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {priceTx?.loading && priceTx.which === 'monthly' ? 'Writing...' : 'Set Monthly Price'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleClosePremiumNative(chain, deployment.premium, PLAN_MONTHLY)}
                            disabled={priceTx?.loading || isNativeClosed(plans?.monthly?.price)}
                            className={styles['admin-contracts__button']}
                          >
                            {isNativeClosed(plans?.monthly?.price) ? `${symbol} closed (monthly)` : `Close ${symbol} sales (monthly)`}
                          </button>
                        </div>
                      </form>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetPremiumPrice(chain, deployment.premium, PLAN_YEARLY)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>
                            Yearly Price ({symbol}) {draftUsd(priceInputs.yearly) ?? ''}
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={priceInputs.yearly ?? ''}
                            onChange={(e) =>
                              setPremiumPriceInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], yearly: e.target.value } }))
                            }
                            placeholder="e.g. 0.02"
                          />
                        </div>

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!priceInputs.yearly?.trim() || priceTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {priceTx?.loading && priceTx.which === 'yearly' ? 'Writing...' : 'Set Yearly Price'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleClosePremiumNative(chain, deployment.premium, PLAN_YEARLY)}
                            disabled={priceTx?.loading || isNativeClosed(plans?.yearly?.price)}
                            className={styles['admin-contracts__button']}
                          >
                            {isNativeClosed(plans?.yearly?.price) ? `${symbol} closed (yearly)` : `Close ${symbol} sales (yearly)`}
                          </button>
                        </div>
                      </form>

                      {!takesTokens && plans && !plans.loading && !plans.error && (
                        <div className={styles['admin-contracts__validation']}>
                          This deployment takes the native coin only — it predates token pricing. Redeploy from the current
                          HupPremium build to accept ERC20 or LSP7.
                        </div>
                      )}

                      {/* Token pricing. A token is not on sale until setTokenPrice has been
                          called for it, per plan — there is no default. Amounts are typed in the
                          token's own units; the decimals are read off the token, never assumed. */}
                      {takesTokens && (
                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetPremiumTokenPrice(chain, deployment.premium, PLAN_MONTHLY)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Token Address (ERC20 or LSP7)</label>
                          <p className={styles['admin-contracts__hint']}>
                            Let people pay in a token instead of the coin. A stablecoin needs no repricing — 6 USDC is 6 USDC
                            forever. Amounts below are in the token&apos;s own units, and its decimals are read off the token
                            itself. A token is not on sale until you set a price for it here, per plan.
                          </p>
                          <input
                            type="text"
                            className={styles['admin-contracts__input']}
                            value={tokenDraft.token ?? ''}
                            onChange={(e) =>
                              setPremiumTokenInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], token: e.target.value } }))
                            }
                            placeholder="0x..."
                          />
                        </div>

                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Monthly Price (token units)</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={tokenDraft.monthly ?? ''}
                            onChange={(e) =>
                              setPremiumTokenInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], monthly: e.target.value } }))
                            }
                            placeholder="e.g. 6"
                          />
                        </div>

                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Yearly Price (token units)</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className={styles['admin-contracts__input']}
                            value={tokenDraft.yearly ?? ''}
                            onChange={(e) =>
                              setPremiumTokenInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], yearly: e.target.value } }))
                            }
                            placeholder="e.g. 60"
                          />
                        </div>

                        {tokenTx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Token Tx</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {tokenTx.loading && <span style={{ color: '#d97706' }}>Signing &amp; broadcasting tx...</span>}
                              {tokenTx.error && <span style={{ color: '#ef4444' }}>❌ {tokenTx.error}</span>}
                              {tokenTx.success && (
                                <span style={{ color: '#10b981' }}>
                                  🚀 {tokenTx.which === 'yearly' ? 'Yearly' : 'Monthly'} token price set
                                  {tokenTx.decimals !== undefined ? ` (${tokenTx.decimals} decimals)` : ''}.
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!tokenDraft.token?.trim() || !tokenDraft.monthly?.trim() || tokenTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {tokenTx?.loading && tokenTx.which === 'monthly' ? 'Writing...' : 'Set Monthly Token Price'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSetPremiumTokenPrice(chain, deployment.premium, PLAN_YEARLY)}
                            disabled={!tokenDraft.token?.trim() || !tokenDraft.yearly?.trim() || tokenTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {tokenTx?.loading && tokenTx.which === 'yearly' ? 'Writing...' : 'Set Yearly Token Price'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDisablePremiumToken(chain, deployment.premium, PLAN_MONTHLY)}
                            disabled={!tokenDraft.token?.trim() || tokenTx?.loading}
                            className={styles['admin-contracts__button']}
                          >
                            Disable (monthly)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDisablePremiumToken(chain, deployment.premium, PLAN_YEARLY)}
                            disabled={!tokenDraft.token?.trim() || tokenTx?.loading}
                            className={styles['admin-contracts__button']}
                          >
                            Disable (yearly)
                          </button>
                        </div>
                      </form>
                      )}

                      {/* Said out loud rather than rendered as nothing: an absent panel reads
                          as a missing feature, which is exactly the confusion this caused once. */}
                      {!takesComplimentary && plans && !plans.loading && !plans.error && (
                        <div className={styles['admin-contracts__validation']}>
                          This deployment is older than the free-premium features — no free list, no free time, no moderators.
                          Redeploy from the current HupPremium build to manage them here.
                        </div>
                      )}

                      {/* Giving premium away. Two shapes on purpose: a complimentary listing
                          never expires and can be revoked, a granted term expires on its own and
                          cannot. Both are open to moderators; nothing else on this card is. */}
                      {takesComplimentary && (
                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetPremiumComplimentary(chain, deployment.premium, true)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>
                            Always premium — free, no expiry
                            {compCount !== undefined && <> ({String(compCount)} listed)</>}
                          </label>
                          <p className={styles['admin-contracts__hint']}>
                            A switch, not a countdown. Anyone listed here has premium for as long as they are on the list, and loses
                            it the moment you remove them. For your own accounts, the team, partners. One address per line, or
                            comma separated — up to {PREMIUM_MAX_BATCH} in one transaction.
                          </p>
                          <textarea
                            rows={3}
                            className={styles['admin-contracts__input']}
                            value={compDraft.accounts ?? ''}
                            onChange={(e) =>
                              setPremiumCompInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], accounts: e.target.value } }))
                            }
                            placeholder="0x... one per line, or comma separated"
                          />
                        </div>

                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Or give free time to those addresses</label>
                          <p className={styles['admin-contracts__hint']}>
                            A countdown instead. It starts now — or stacks on top of time they already hold — and runs out on its
                            own. <strong>This cannot be taken back</strong>, so use it for make-goods, prizes and trials, and use
                            the list above for anything you might want to reverse.
                          </p>
                          <div className={styles['admin-contracts__field-row']}>
                            <input
                              type="text"
                              inputMode="decimal"
                              className={styles['admin-contracts__input']}
                              value={compDraft.term ?? ''}
                              onChange={(e) =>
                                setPremiumCompInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], term: e.target.value } }))
                              }
                              placeholder="e.g. 3"
                            />
                            <select
                              className={styles['admin-contracts__input']}
                              value={compDraft.termUnit ?? GRANT_UNITS[0].id}
                              onChange={(e) =>
                                setPremiumCompInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], termUnit: e.target.value } }))
                              }
                            >
                              {GRANT_UNITS.map((unit) => (
                                <option key={unit.id} value={unit.id}>
                                  {unit.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {compTx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Comp Tx</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {compTx.loading && <span style={{ color: '#d97706' }}>Signing &amp; broadcasting tx...</span>}
                              {compTx.error && <span style={{ color: '#ef4444' }}>❌ {compTx.error}</span>}
                              {compTx.success && (
                                <span style={{ color: '#10b981' }}>
                                  🚀 {compTx.term ? `${compTx.term} granted to` : compTx.granted ? 'Comped' : 'Revoked for'}{' '}
                                  {compTx.count} {compTx.count === 1 ? 'account' : 'accounts'}.
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        <div className={styles['admin-contracts__actions']}>
                          <button
                            type="submit"
                            disabled={!compDraft.accounts?.trim() || compTx?.loading}
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {compTx?.loading ? 'Writing...' : 'Add to free list'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSetPremiumComplimentary(chain, deployment.premium, false)}
                            disabled={!compDraft.accounts?.trim() || compTx?.loading}
                            className={styles['admin-contracts__button']}
                          >
                            Remove from free list
                          </button>
                          <button
                            type="button"
                            onClick={() => handleGrantPremium(chain, deployment.premium)}
                            disabled={!compDraft.accounts?.trim() || !compDraft.term?.trim() || compTx?.loading}
                            className={styles['admin-contracts__button']}
                          >
                            Give free time
                          </button>
                        </div>
                      </form>
                      )}

                      {/* Access and emergency controls, all ADMIN_ROLE only. */}
                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleSetPremiumModerator(chain, deployment.premium, moderatorRole, true)
                        }}
                      >
                        {moderatorRole && (
                          <div className={styles['admin-contracts__input-group']}>
                            <label className={styles['admin-contracts__detail-label']}>Moderator</label>
                            <p className={styles['admin-contracts__hint']}>
                              Lets someone else use the two sections above — the free list and free time. They cannot change
                              prices, move money, or pause sales; those stay with the admin wallet.
                            </p>
                            <input
                              type="text"
                              className={styles['admin-contracts__input']}
                              value={manageDraft.moderator ?? ''}
                              onChange={(e) =>
                                setPremiumManageInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], moderator: e.target.value } }))
                              }
                              placeholder="0x..."
                            />
                          </div>
                        )}

                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Sweep a token (token, then receiver)</label>
                          <p className={styles['admin-contracts__hint']}>
                            Moves a token&apos;s whole balance out of the contract. The coin has its own button below — the two
                            cannot move in one transaction, so token revenue is only reachable here.
                          </p>
                          <div className={styles['admin-contracts__field-row']}>
                            <input
                              type="text"
                              className={styles['admin-contracts__input']}
                              value={manageDraft.sweepToken ?? ''}
                              onChange={(e) =>
                                setPremiumManageInputs((prev) => ({ ...prev, [chain.id]: { ...prev[chain.id], sweepToken: e.target.value } }))
                              }
                              placeholder="token 0x..."
                            />
                            <input
                              type="text"
                              className={styles['admin-contracts__input']}
                              value={manageDraft.sweepReceiver ?? ''}
                              onChange={(e) =>
                                setPremiumManageInputs((prev) => ({
                                  ...prev,
                                  [chain.id]: { ...prev[chain.id], sweepReceiver: e.target.value },
                                }))
                              }
                              placeholder="receiver 0x..."
                            />
                          </div>
                        </div>

                        {manageTx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Admin Tx</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {manageTx.loading && <span style={{ color: '#d97706' }}>Signing &amp; broadcasting tx...</span>}
                              {manageTx.error && <span style={{ color: '#ef4444' }}>❌ {manageTx.error}</span>}
                              {manageTx.success && <span style={{ color: '#10b981' }}>🚀 {manageTx.note}.</span>}
                            </div>
                          </div>
                        )}

                        <div className={styles['admin-contracts__actions']}>
                          {moderatorRole && (
                            <>
                              <button
                                type="submit"
                                disabled={!manageDraft.moderator?.trim() || manageTx?.loading}
                                className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                              >
                                Add moderator
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSetPremiumModerator(chain, deployment.premium, moderatorRole, false)}
                                disabled={!manageDraft.moderator?.trim() || manageTx?.loading}
                                className={styles['admin-contracts__button']}
                              >
                                Remove moderator
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => handleWithdrawPremiumToken(chain, deployment.premium)}
                            disabled={!manageDraft.sweepToken?.trim() || !manageDraft.sweepReceiver?.trim() || manageTx?.loading}
                            className={styles['admin-contracts__button']}
                          >
                            Sweep token
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePausePremium(chain, deployment.premium, isPaused)}
                            disabled={manageTx?.loading}
                            className={styles['admin-contracts__button']}
                          >
                            {isPaused ? 'Unpause sales' : 'Pause sales'}
                          </button>
                        </div>
                      </form>

                      <form
                        className={styles['admin-contracts__edit-form']}
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleWithdrawPremium(chain, deployment.premium)
                        }}
                      >
                        <div className={styles['admin-contracts__input-group']}>
                          <label className={styles['admin-contracts__detail-label']}>Withdraw Receiver</label>
                          <p className={styles['admin-contracts__hint']}>
                            Sends the contract&apos;s entire {symbol} balance — everything people have paid in the coin — to this
                            address, in one go. Tokens go through the sweep above instead.
                          </p>
                          <input
                            type="text"
                            className={styles['admin-contracts__input']}
                            value={receiverDraft}
                            onChange={(e) => setPremiumReceiverInputs((prev) => ({ ...prev, [chain.id]: e.target.value }))}
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
                            className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--primary'])}
                          >
                            {withdrawState?.loading ? 'Writing...' : 'Withdraw All'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {activeSection === 'chat' && (
            <section className={styles['admin-contracts__section']}>
              <header className={styles['admin-contracts__header']}>
                <h2 className={styles['admin-contracts__title']}>HupChat</h2>
                <p className={styles['admin-contracts__subtitle']}>
                  Encrypted messaging. Pause stops new messages being sent on the contract; it does not touch messages already onchain, which
                  stay exactly where they are. Signed by your wallet, which must hold ADMIN_ROLE on the contract.
                </p>
              </header>

              <div className={styles['admin-contracts__grid']}>
                {visibleChains('chat').map((chain) => {
                  const deployment = CONTRACTS[`chain${chain.id}`]
                  const chatConfig = chatConfigs[chain.id]
                  const pauseTx = chatPauseTxStates[chain.id]
                  const explorerUrl = chain.blockExplorers?.default?.url?.replace(/\/$/, '')
                  const isLocked = !chatConfig || chatConfig.loading || Boolean(chatConfig.error)

                  return (
                    <div
                      key={`chat-${chain.id}`}
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
                        <span className={styles['admin-contracts__badge']}>HUPCHAT</span>
                      </div>

                      <div className={styles['admin-contracts__details']}>
                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Chat Address</span>
                          <span className={styles['admin-contracts__detail-value']}>
                            {explorerUrl ? (
                              <a href={`${explorerUrl}/address/${deployment.chat}`} target="_blank" rel="noopener noreferrer">
                                <code>{deployment.chat}</code> ↗
                              </a>
                            ) : (
                              <code>{deployment.chat}</code>
                            )}
                          </span>
                        </div>

                        <div className={styles['admin-contracts__detail-row']}>
                          <span className={styles['admin-contracts__detail-label']}>Contract</span>
                          <div className={styles['admin-contracts__detail-value']}>
                            {(!chatConfig || chatConfig.loading) && <span>Loading…</span>}
                            {chatConfig?.error && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--error'])}>
                                {chatConfig.error}
                              </div>
                            )}
                            {chatConfig && !chatConfig.loading && !chatConfig.error && !chatConfig.paused && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--success'])}>
                                ✓ Live — messages can be sent
                              </div>
                            )}
                            {chatConfig && !chatConfig.loading && !chatConfig.error && chatConfig.paused && (
                              <div className={clsx(styles['admin-contracts__validation'], styles['admin-contracts__validation--warning'])}>
                                ⚠️ PAUSED — no new messages can be sent
                              </div>
                            )}
                          </div>
                        </div>

                        {pauseTx && (
                          <div className={styles['admin-contracts__detail-row']}>
                            <span className={styles['admin-contracts__detail-label']}>Pause Tx</span>
                            <div className={styles['admin-contracts__detail-value']}>
                              {pauseTx.loading && <span style={{ color: '#d97706' }}>Signing &amp; broadcasting tx...</span>}
                              {pauseTx.error && <span style={{ color: '#ef4444' }}>❌ {pauseTx.error}</span>}
                              {pauseTx.success && <span style={{ color: '#10b981' }}>🚀 Contract {pauseTx.action}.</span>}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className={styles['admin-contracts__actions']}>
                        <button
                          type="button"
                          onClick={() => handleChatPause(chain, deployment.chat, !chatConfig?.paused)}
                          disabled={isLocked || pauseTx?.loading}
                          className={clsx(styles['admin-contracts__button'], styles['admin-contracts__button--secondary'])}
                        >
                          {pauseTx?.loading ? 'Writing...' : chatConfig?.paused ? 'Unpause' : 'Pause'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
              {visibleChains('chat').length === 0 && (
                <p className={styles['admin-contracts__empty']}>No HupChat deployments match this filter.</p>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  )
}
