/**
 * @file config/launchpadChains.js
 * @description Where Hup coins launch: the launchpad stack (src/contracts/launchpad: Chainlink CCIP 2.0
 * burn and mint, Uniswap v4, one token address on every chain). Moved here from the Atoll app on
 * 2026-10-26, and the contracts from C:\xampp\htdocs\CCT on 2026-10-28.
 *
 * Addresses were verified onchain (bytecode present, every v4 periphery contract bound to its
 * PoolManager, CCIP lanes open; /admin/launchpad repeats the checks before it deploys). The chain
 * table is part of every launch's salt and of the factory's constructor, so this list must stay
 * identical to the one the factory was deployed with: adding a chain means a new factory label,
 * not an edit here alone. `module`, `rmn` and `positionManager` are read only by the factory's
 * constructor (lib/launchpad/deploy.js).
 *
 * Only chains with both CCIP and Uniswap v4, and lanes between every pair, can join. Coins launch on
 * Base and Arbitrum Sepolia, or on the seven mainnets below with NEXT_PUBLIC_LAUNCHPAD_NETWORK=mainnet.
 */

import { arbitrum, arbitrumSepolia, avalanche, base, baseSepolia, bsc, mainnet, monad } from 'viem/chains'
import { CHAIN_ICONS } from './chainIcons'
import { robinhood } from './contracts'

// Data URIs keep each mark in its own SVG document, as config/wagmi does for the network picker
const iconUrl = (chain) => `data:image/svg+xml,${encodeURIComponent(CHAIN_ICONS[chain.id])}`

// The testnet launch chains: Base Sepolia and Arbitrum Sepolia
const TESTNET_CHAINS = {
  base: {
    key: 'base',
    chain: baseSepolia,
    name: 'Base Sepolia',
    shortName: 'Base',
    selector: 10344971235874465080n,
    rpc: ['https://base-sepolia-rpc.publicnode.com', 'https://sepolia.base.org'],
    explorer: 'https://sepolia.basescan.org',
    iconUrl: iconUrl(baseSepolia),
    primaryColor: '#0052FF',
    // Minutes a CCIP transfer leaving this chain takes: its safe and finalized heads measured on
    // 2026-10-22 (safe 2–3 min, finalized 21–23 min behind) plus an estimated 1–2 min of CCIP
    // Fast moves wait 30 blocks instead of finality (about a minute or two), then CCIP's own
    fastBlockDepth: 30,
    transferMinutes: { finality: '20–25', fast: '3–5' },
    router: '0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93',
    registry: '0x736D0bBb318c1B27Ff686cd19804094E66250e17',
    module: '0x176ae8C6C11DD2c031B924CE1A0A43188035f3f6',
    rmn: '0x99360767a4705f68CcCb9533195B761648d6d807',
    poolManager: '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408',
    positionManager: '0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80',
    stateView: '0x571291b572ed32ce6751a2cb2486ebee8defb9b4',
    quoter: '0x4a6513c898fe1b2d0e78d3b0e0a4a151589b1cba',
    universalRouter: '0x492e6456d9528771018deb9e87ef7750ef184104',
  },
  arb: {
    key: 'arb',
    chain: arbitrumSepolia,
    name: 'Arbitrum Sepolia',
    shortName: 'Arbitrum',
    selector: 3478487238524512106n,
    // publicnode prunes state; the official endpoint answers historical reads
    rpc: ['https://sepolia-rollup.arbitrum.io/rpc', 'https://arbitrum-sepolia-rpc.publicnode.com'],
    explorer: 'https://sepolia.arbiscan.io',
    iconUrl: iconUrl(arbitrumSepolia),
    primaryColor: '#12AAFF',
    // Arbitrum's safe head trails by 7–9 min (finalized 15–17), so fast helps less here
    // Fast moves wait 240 blocks instead of finality (about a minute or two), then CCIP's own
    fastBlockDepth: 240,
    transferMinutes: { finality: '17–19', fast: '3–5' },
    router: '0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165',
    registry: '0x8126bE56454B628a88C17849B9ED99dd5a11Bd2f',
    module: '0xaD417c0611dBD225471D31F056b8B6beC1CBC153',
    rmn: '0x9527E2d01A3064ef6b50c1Da1C0cC523803BCFF2',
    poolManager: '0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317',
    positionManager: '0xAc631556d3d4019C95769033B5E719dD77124BAc',
    stateView: '0x9d467fa9062b6e9b1a46e26007ad82db116c67cb',
    quoter: '0x7de51022d70a725b508085468052e25e22b5c4c9',
    universalRouter: '0xefd1d4bd4cf1e86da286bb4cb1b8bced9c10ba47',
  },
}

// The mainnet launch chains: the largest set with both Uniswap v4 and CCIP lanes between every pair
// that includes Robinhood Chain, where tokenized stocks live (checked 2026-10-29: each router's
// isChainSupported for every other chain, both ways; CreateX present on all). Addresses from
// Chainlink's CCIP directory API and Uniswap's v4 deployments, each verified onchain: code present
// and every v4 periphery contract bound to its PoolManager. Lane versions still need a CCIP send on
// a fork per pair before launch: a lane existing does not prove it carries CCIP 2.0 pools.
const MAINNET_CHAINS = {
  ethereum: {
    key: 'ethereum',
    chain: mainnet,
    name: 'Ethereum',
    shortName: 'Ethereum',
    selector: 5009297550715157269n,
    rpc: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
    explorer: 'https://etherscan.io',
    iconUrl: iconUrl(mainnet),
    primaryColor: '#627EEA',
    // Ethereum finalizes in two epochs (~13 min) and its safe head trails ~6 min, plus CCIP's own minute or two; estimates, to measure before launch
    // Fast moves wait 10 blocks instead of finality (about a minute or two), then CCIP's own
    fastBlockDepth: 10,
    transferMinutes: { finality: '15–20', fast: '3–5' },
    router: '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D',
    registry: '0xb22764f98dD05c789929716D677382Df22C05Cb6',
    module: '0x4855174E9479E211337832E109E7721d43A4CA64',
    rmn: '0x411dE17f12D1A34ecC7F45f49844626267c75e81',
    poolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
    positionManager: '0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e',
    stateView: '0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227',
    quoter: '0x99bd42B2B22e531f283b7F8a86dFf631EB16A9D1',
    universalRouter: '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af',
  },
  base: {
    key: 'base',
    chain: base,
    name: 'Base',
    shortName: 'Base',
    selector: 15971525489660198786n,
    rpc: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'],
    explorer: 'https://basescan.org',
    iconUrl: iconUrl(base),
    primaryColor: '#0052FF',
    // An OP Stack rollup: final once its batch is final on Ethereum; the safe head trails a few minutes; estimates, to measure before launch
    // Fast moves wait 30 blocks instead of finality (about a minute or two), then CCIP's own
    fastBlockDepth: 30,
    transferMinutes: { finality: '20–25', fast: '3–5' },
    router: '0x881e3A65B4d4a04dD529061dd0071cf975F58bCD',
    registry: '0x6f6C373d09C07425BaAE72317863d7F6bb731e37',
    module: '0xAFEd606Bd2CAb6983fC6F10167c98aaC2173D77f',
    rmn: '0xC842c69d54F83170C42C4d556B4F6B2ca53Dd3E8',
    poolManager: '0x498581fF718922c3f8e6A244956aF099B2652b2b',
    positionManager: '0x7C5f5A4bBd8fD63184577525326123B519429bDc',
    stateView: '0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71',
    quoter: '0xE1A6C5803e3c44368b171BD680c7D32dfc92CA47',
    universalRouter: '0x6fF5693b99212Da76ad316178A184AB56D299b43',
  },
  arbitrum: {
    key: 'arbitrum',
    chain: arbitrum,
    name: 'Arbitrum One',
    shortName: 'Arbitrum',
    selector: 4949039107694359620n,
    rpc: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
    explorer: 'https://arbiscan.io',
    iconUrl: iconUrl(arbitrum),
    primaryColor: '#12AAFF',
    // Final once its batch is final on Ethereum; the safe head trails 7–9 min, so fast helps less here; estimates, to measure before launch
    // Fast moves wait 240 blocks instead of finality (about a minute or two), then CCIP's own
    fastBlockDepth: 240,
    transferMinutes: { finality: '17–25', fast: '3–5' },
    router: '0x141fa059441E0ca23ce184B6A78bafD2A517DdE8',
    registry: '0x39AE1032cF4B334a1Ed41cdD0833bdD7c7E7751E',
    module: '0x1f1df9f7fc939E71819F766978d8F900B816761b',
    rmn: '0xC311a21e6fEf769344EB1515588B9d535662a145',
    poolManager: '0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32',
    positionManager: '0xd88F38F930b7952f2DB2432Cb002E7abbF3dD869',
    stateView: '0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990',
    quoter: '0x8928074CA1b241D8Ec02815881c1Af11E8bC5219',
    universalRouter: '0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3',
  },
  bsc: {
    key: 'bsc',
    chain: bsc,
    name: 'BNB Chain',
    shortName: 'BNB',
    selector: 11344663589394136015n,
    rpc: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'],
    explorer: 'https://bscscan.com',
    iconUrl: iconUrl(bsc),
    primaryColor: '#F0B90B',
    // Fast finality within seconds: CCIP's own processing dominates; estimates, to measure before launch
    // Final within seconds: a fast move would gain nothing, so none is offered
    fastBlockDepth: null,
    transferMinutes: { finality: '1–3', fast: null },
    router: '0x34B03Cb9086d7D758AC55af71584F81A598759FE',
    registry: '0x736Fd8660c443547a85e4Eaf70A49C1b7Bb008fc',
    module: '0x47Db76c9c97F4bcFd54D8872FDb848Cab696092d',
    rmn: '0x9e09697842194f77d315E0907F1Bda77922e8f84',
    poolManager: '0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF',
    positionManager: '0x7A4a5c919aE2541AeD11041A1AEeE68f1287f95b',
    stateView: '0xd13Dd3D6E93f276FAfc9Db9E6BB47C1180aeE0c4',
    quoter: '0x95C086d7fE28AdD842ee220fef225a777474d781',
    universalRouter: '0x1906c1d672b88cD1B9aC7593301cA990F94Eae07',
  },
  avalanche: {
    key: 'avalanche',
    chain: avalanche,
    name: 'Avalanche',
    shortName: 'Avalanche',
    selector: 6433500567565415381n,
    rpc: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://api.avax.network/ext/bc/C/rpc'],
    explorer: 'https://snowscan.xyz',
    iconUrl: iconUrl(avalanche),
    primaryColor: '#E84142',
    // Final in about a second: CCIP's own processing dominates; estimates, to measure before launch
    // Final within seconds: a fast move would gain nothing, so none is offered
    fastBlockDepth: null,
    transferMinutes: { finality: '1–3', fast: null },
    router: '0xF4c7E640EdA248ef95972845a62bdC74237805dB',
    registry: '0xc8df5D618c6a59Cc6A311E96a39450381001464F',
    module: '0x76Aa17dCda9E8529149E76e9ffaE4aD1C4AD701B',
    rmn: '0xcBD48A8eB077381c3c4Eb36b402d7283aB2b11Bc',
    poolManager: '0x06380C0e0912312B5150364B9DC4542BA0DbBc85',
    positionManager: '0xB74b1F14d2754AcfcbBe1a221023a5cf50Ab8ACD',
    stateView: '0xc3c9e198C735a4b97e3e683f391cCBDD60B69286',
    quoter: '0xf27e532878B622d6b916F524E8711880107D4eF0',
    universalRouter: '0x94b75331AE8d42C1b61065089B7d48FE14aA73b7',
  },
  monad: {
    key: 'monad',
    chain: monad,
    name: 'Monad',
    shortName: 'Monad',
    selector: 8481857512324358265n,
    rpc: ['https://rpc.monad.xyz', 'https://monad-mainnet-rpc.publicnode.com'],
    explorer: 'https://monadscan.com',
    iconUrl: iconUrl(monad),
    primaryColor: '#836EF9',
    // Final within a second or two: CCIP's own processing dominates; estimates, to measure before launch
    // Final within seconds: a fast move would gain nothing, so none is offered
    fastBlockDepth: null,
    transferMinutes: { finality: '1–3', fast: null },
    router: '0x33566fE5976AAa420F3d5C64996641Fc3858CaDB',
    registry: '0x11ACd984DD680363117B310f6ebdf78fD6c0195f',
    module: '0xB71513B6c80Adf35B43eACC24DA7A08A806a7f2C',
    rmn: '0x99dFCa5d88f4D9C023531F4403966b8d61562AcD',
    poolManager: '0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e',
    positionManager: '0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016',
    stateView: '0x77395F3b2E73aE90843717371294fa97cC419D64',
    quoter: '0xa222Dd357A9076d1091Ed6Aa2e16C9742dD26891',
    universalRouter: '0x0D97Dc33264bfC1c226207428A79b26757fb9dc3',
  },
  robinhood: {
    key: 'robinhood',
    chain: robinhood,
    name: 'Robinhood Chain',
    shortName: 'Robinhood',
    selector: 6180753054346818345n,
    rpc: ['https://rpc.mainnet.chain.robinhood.com', 'https://robinhood-rpc.publicnode.com'],
    explorer: 'https://robinhoodchain.blockscout.com',
    iconUrl: iconUrl(robinhood),
    primaryColor: '#CCFF00',
    // An Arbitrum Orbit rollup on Ethereum: settles like Arbitrum; estimates, to measure before launch
    // Fast moves wait 240 blocks instead of finality (about a minute or two), then CCIP's own
    fastBlockDepth: 240,
    transferMinutes: { finality: '17–25', fast: '3–5' },
    router: '0x06fC836cf9839B1cd891C440A0a45242DA6Ae1c9',
    registry: '0x1912C3cFafE8A76A32a92861d815aC2837F237Ca',
    module: '0x3237c0D7B58BEc8Dc17F00103B784Bd6678f789E',
    rmn: '0xe8464c353210Cc398A45dB2454FBc5BCd25fFf20',
    poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
    positionManager: '0x58daec3116aae6D93017bAAea7749052E8a04fA7',
    stateView: '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b',
    quoter: '0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94',
    universalRouter: '0x8876789976dEcBfCbBbe364623C63652db8C0904',
  },
}

// Which network the launchpad runs on. Each has its own factory deployment (one label, one deployer),
// and the chain table is part of every launch's salt, so a coin only ever lives on one of them.
export const LAUNCH_NETWORK = process.env.NEXT_PUBLIC_LAUNCHPAD_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'

export const LAUNCH_CHAINS = LAUNCH_NETWORK === 'mainnet' ? MAINNET_CHAINS : TESTNET_CHAINS

export const LAUNCH_CHAIN_KEYS = Object.keys(LAUNCH_CHAINS)

// Presentation chain list derived from the configured mainnets.
export const NETWORK_SHOWCASE = Object.values(MAINNET_CHAINS).map((item) => ({
  key: item.key,
  name: item.name,
  iconUrl: item.iconUrl,
  color: item.primaryColor,
  note: 'CCIP and Uniswap v4',
}))

export const launchChainById = (chainId) => Object.values(LAUNCH_CHAINS).find((item) => item.chain.id === Number(chainId)) ?? null

// Same on every EVM chain: Arachnid's deterministic CREATE2 deployer, CreateX and Uniswap's Permit2
export const SHARED = {
  create2Deployer: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
  // CreateX, the audited deployer at this address on every launch chain and every mainnet the
  // launchpad targets (checked onchain 2026-10-28). Its CREATE3 places the factory.
  createX: '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  // The factory's CREATE3 salt is deployer ‖ 0x00 ‖ bytes7(keccak(label)) ‖ a counter, searched so
  // the address carries Uniswap's beforeInitialize flag (lib/launchpad/protocol.js factorySalt):
  // CreateX lets only that deployer use it, on any chain. The label is only a salt, never a
  // release number (every contract is version 1.0.0); a new one gives a new factory address.
  // hup-launchpad-2: coins list their own chains, and an admin can add chains for new coins.
  // hup-launchpad-3: every chain of a coin launches inside one window, or never.
  factoryLabel: 'hup-launchpad-3',
}

// What the factory is deployed with (IHupLaunchpad.Settings), fixed for good once it is: the
// deploy page passes these to every chain's factory, and the app computes with them
export const LAUNCH_SETTINGS = {
  // 1B: a launch's worldwide supply
  supplyUnit: 10n ** 27n,
  // Uniswap's 1% tier
  launchFee: 10_000,
  tickSpacing: 200,
  // Hup's share of every trading fee; the creator earns the rest
  protocolShareBps: 2_000,
  // The creator's opening buy is capped at 1% of each chain's own market
  maxOpeningBuyBps: 100,
  // A presale's pot buys at most 10% of each chain's own market, and stays open 30 days at most
  maxPresaleBps: 1_000,
  maxPresaleSeconds: 30 * 24 * 3600,
  // Every chain of a coin launches within one day of its launchBy, or never: a chain still missing
  // when the window closes stays out, so no chain can open later at a stale price
  launchWindowSeconds: 24 * 3600,
  // Each CCIP bucket holds 5% of the worldwide supply, refilled in an hour; fast transfers 1%
  rateLimitBps: 500,
  fastRateLimitBps: 100,
  rateLimitRefillSeconds: 3_600,
  // What a fast move may wait for instead of finality (Chainlink's FinalityCodec): the `safe` head,
  // or at least 10 blocks. Chainlink's lanes take only block depths today; `safe` is kept for when
  // they take it too. Each chain's fastBlockDepth is what the app asks for, never below 10.
  allowedFinality: '0x0001000a',
}

// The wallet that placed the factory. The factory address follows from it alone, the same on
// every chain; unset, launching is switched off and the pages say so.
export const FACTORY_DEPLOYER = process.env.NEXT_PUBLIC_LAUNCHPAD_FACTORY_DEPLOYER || ''

// Coins carry no launch tax: every buy is untaxed from the first block
export const MAX_OPENING_BUY_BPS = LAUNCH_SETTINGS.maxOpeningBuyBps

// The default split favours one main chain, so liquidity is deep where most trading happens and
// thinner elsewhere: 70% there, the rest shared equally (HupLaunchpad takes any split summing to 100%)
export const MAIN_CHAIN_SHARE_BPS = 7_000

// A coin graduates once its market cap (price x the 1B worldwide supply, read on its main chain)
// reaches this, in ETH; each chain also shows its own progress. A milestone shown in Hup, not a
// contract state: the curve is already a Uniswap pool, so nothing has to migrate.
export const GRADUATION_MARKET_CAP_ETH = 10
