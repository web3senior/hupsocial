/**
 * @file config/contracts.js
 * @description Server-safe chain and contract-address data. API routes and lib/
 * readers import from here instead of config/wagmi so evaluating them never
 * constructs wallet connectors (WalletConnect touches browser-only storage such
 * as indexedDB the moment it is instantiated). config/wagmi re-exports these for
 * client code.
 */

import { arbitrum, base, baseSepolia, bsc, celo, lukso, mainnet, monad } from 'wagmi/chains'
import { defineChain } from 'viem'

// Robinhood Chain (Arbitrum Orbit L2, ETH as native gas token)
export const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [`https://rpc.mainnet.chain.robinhood.com`],
    },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: `https://robinhoodchain.blockscout.com`,
    },
  },
})

// Chains the app runs on â€” single source of truth for the wagmi config's
// `chains` tuple and for server-side RPC lookups (chain.rpcUrls.default.http).
// L1s first, then L2s.
export const appChains = [mainnet, lukso, bsc, monad, arbitrum, base, celo, robinhood, baseSepolia] //somniaTestnet

export const CONTRACTS = {
  chain1: {
    name: 'ethereum',
    forwarder: '0xA8231e213a85BA0FBEB42F319175f10E2D849352',
    forwarderName: 'HupForwarder',
    hup: '0xd1aEc7Bb7679FA30E74Ab30877FbdF96d51333D4',
    status: '0x130BD13f5A7AcA97cfF4Ed32ac2EbF94197Be88f',
    chat: '',
    followerSystem: '0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    store: '',
    tipper: '0x9a8Daf359280eb03D734530992691888fA33D476',
    trade: '0x7eb333Ad710d398A38c45d49A6A96568c8276b5f',
    offers: '',
    events: '',
    predict: '0xc77372d05ccc2d30938aa58686671625769f88bd',
    apps: '',
    // HupDrops NFT launchpad: `drops` is the engine; deployer satellites are registered inside
    // it per standard (1 = ERC721, 2 = ERC1155, 3 = LSP7, 4 = LSP8) and never read by the app.
    drops: '',
    // Launch tokens trade as ordinary Uniswap v3 swaps. Router executes, quoter previews —
    // resolve BOTH from Uniswap's official deployments registry before enabling a chain: a
    // wrong quoter fails safe, a wrong router is where user funds would go.
    // All six mainnet stacks below taken from the official registry and verified onchain
    // 2026-08-12: router.factory() == quoter.factory() == registry factory, and
    // router.WETH9() == wnative (Celo excepted, see its entry).
    // The univ4* stacks were verified the same day: quoter.poolManager() == registry
    // PoolManager, the UniversalRouter bytecode embeds it, and Permit2 (canonical
    // 0x000000000022D473030F116dDEE9F6B43aC78BA3 everywhere) has code. The swap page quotes
    // v3 and v4 side by side and executes on whichever venue answers best.
    launch: '',
    univ3Router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    univ3Quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    wnative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    univ4Router: '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af',
    univ4PoolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
    univ4Quoters: ['0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203'],
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  },
  chain42: {
    name: 'lukso',
    forwarder: '0x76d610248ADDd1619c0Bc34F18E5436E38Dc6972',
    forwarderName: 'HupChatForwarder',
    hup: '0xf6eeC4e32a532b23ACC56b72865e79c79877CEc8',
    status: '0xeCF2c230df65F50482c687040b272A808F753849',
    chat: '0x3a98ACd2B8CcBe85121F95BF9F9636A484A80d67',
    followerSystem: '0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    store: '',
    tipper: '0x52A22BEaA2e7d2aC6C0124259b6984f49c56598E',
    trade: '0x4bad88a02d8a4926fE50F69A12A3e095E433CEc0',
    offers: '',
    events: '0x29fAdA247735a95Ad92A70890cb21106D12a5E0C',
    predict: '0xD76dcBB664a002247269c1fBB161B0440674C570',
    apps: '0xe30350Cf486210C299Aef91De61799Daed1Df6C5',
    drops: '',
    // No Uniswap on LUKSO, and launches are one-phase Uniswap pools — so no launches here.
    // Stays empty unless LUKSO ever gets a v3 deployment.
    launch: '',
    univ3Router: '',
    univ3Quoter: '',
  },
  // Base Sepolia is the active dev chain (replaced Linea Sepolia 2026-08-11 — Linea had no
  // Uniswap v3 stack, so HupLaunch could never run there). Deployments in progress — fill
  // addresses in as contracts land.
  chain84532: {
    name: 'base-sepolia',
    forwarder: '',
    hup: '',
    status: '',
    community: '',
    chat: '',
    followerSystem: '',
    store: '',
    tipper: '',
    trade: '',
    offers: '',
    events: '',
    predict: '',
    apps: '',
    drops: '',
    // Uniswap's official Base Sepolia deployment, verified onchain 2026-08-11: router/quoter/
    // posMgr all cross-reference factory 0x4752…aD24 and the OP-stack WETH predeploy, and the
    // 0.30% tier is enabled. Deploy HupLaunch with:
    //   factory  0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24
    //   posMgr   0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2
    //   wnative  0x4200000000000000000000000000000000000006
    launch: '',
    univ3Router: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
    univ3Quoter: '0xC5290058841028F1614F3A6F0F5816cAd0df5E27',
    // WNATIVE (the OP-stack WETH predeploy, same address as in the HupLaunch constructor
    // params above). The swap page routes native legs and token↔token hops through it and
    // requires it alongside univ3Router/univ3Quoter before offering swaps on a chain.
    wnative: '0x4200000000000000000000000000000000000006',
  },
  chain143: {
    name: 'monad',
    forwarder: '0x09FAf2fddED624958589aD9ca704Bc4C6C232e72',
    forwarderName: 'HupChatForwarder',
    hup: '0x8b76923EA3BFAA8EB29FC58e81E49F3c4Fa9Ba8A',
    status: '0xcDc18688D98Ff84fF5352d1ddDe183De7817Df98',
    chat: '0x09E50a68f63dFFF83924c149268923eeDBCF1B7e',
    followerSystem: '0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    store: '',
    tipper: '0xCf7C449F5dF10E3FD4ae46C25E9B0895C1Be90e4',
    trade: '0x80218c06A00316687957951036bbD1326a6790C1',
    offers: '',
    events: '0x39CB4342C425Cdc8576fa593988E5a4980db9853',
    predict: '0xf9df0275821dbcCBd7Fe461c4224F1ccAC46ae20',
    apps: '',
    drops: '',
    launch: '',
    univ3Router: '0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900',
    univ3Quoter: '0x661E93cca42AfacB172121EF892830cA3b70F08d',
    wnative: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', // WMON
    univ4Router: '0x0D97Dc33264bfC1c226207428A79b26757fb9dc3',
    univ4PoolManager: '0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e',
    univ4Quoters: ['0xa222Dd357A9076d1091Ed6Aa2e16C9742dD26891'],
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  },
  chain42220: {
    name: 'celo',
    forwarder: '0x46a3dfcb1f4ec29db7f96c0d3962df20e6edb259',
    hup: '0xdda507afa7be1e70b9dceeb3b34c9b886c98ff73',
    status: '0xe7A1F3601b6dCA2F0D5176cd9d8FFA10479D3Ed0',
    chat: '',
    followerSystem: '0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    store: '',
    tipper: '0x04771ed6223C237Ae6eA9F5e7126871a46cb2583',
    trade: '0x94D81b00b1e4596343e84298dD705e93E36eAb14',
    offers: '',
    events: '0x10feacEEDDB387112f9a484EfB2df9FB197934E4',
    predict: '0xb0F3D16De2B029Bb18d44C35AB811E23C4FC1B87',
    apps: '',
    drops: '',
    launch: '',
    univ3Router: '0x5615CDAb10dc425a742d643d949a7F474C01abc4',
    univ3Quoter: '0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8',
    // Native CELO IS an ERC20 — Uniswap's Celo deployment has no WETH9 (router.WETH9() is
    // zero, verified onchain 2026-08-12); pools pair against the CELO token itself. The flag
    // makes the swap page trade CELO as a plain ERC20: approve instead of msg.value, no unwrap.
    wnative: '0x471EcE3750Da237f93B8E339c536989b8978a438',
    nativeIsErc20: true,
    // v4 exists on Celo, but its native-as-ERC20 model means v4's currency-0x0 pools don't
    // apply the same way; the swap page only probes v4 where the coin is genuinely native,
    // so these stay recorded for later use.
    univ4Router: '0xcb695bc5D3Aa22cAD1E6DF07801b061a05A0233A',
    univ4PoolManager: '0x288dc841A52FCA2707c6947B3A777c5E56cd87BC',
    univ4Quoters: ['0x28566da1093609182dFf2cB2A91CFD72e61d66cd'],
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  },
  chain8453: {
    name: 'base',
    forwarder: '0xae95e44D2642F568D0e0Fc0d60202B55c8764567',
    hup: '0xE401aF10CAa79F9Bb6945C87Ee196503E5DE6BEA',
    status: '0xc9ddc0E09eFa8D3333DFEdFFd68157BC2a9026F3',
    followerSystem: '0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    store: '',
    tipper: '0x01F725975b17dB66DBF26ebAa02bc74F8a433A18',
    trade: '0x7E14bB18b370b59e0b70759C915f5E3A79599091',
    offers: '',
    events: '0x6dB2352e9921F46F005449FcA36938e7cb5A29f5',
    predict: '0x70DBfbb6E64f2e246A83d3Ae0262CC9588c31472',
    apps: '',
    drops: '',
    launch: '',
    univ3Router: '0x2626664c2603336E57B271c5C0b26F421741e481',
    univ3Quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
    wnative: '0x4200000000000000000000000000000000000006',
    univ4Router: '0x6fF5693b99212Da76ad316178A184AB56D299b43',
    univ4PoolManager: '0x498581fF718922c3f8e6A244956aF099B2652b2b',
    univ4Quoters: ['0x0d5e0F971ED27FBfF6c2837bf31316121532048D'],
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  },
  chain56: {
    name: 'bnb',
    forwarder: '0xc407722d150c8a65e890096869f8015D90a89EfD',
    hup: '0xA5e73b15c1C3eE477AED682741f0324C6787bbb8',
    status: '0x81c5a8fd5771cB398e2461cEF9Abb2eCD308d4c8',
    followerSystem: '0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    store: '',
    tipper: '0x74AC93C4A4a67f56af9d1Bd3153910D90F802632',
    trade: '0x594d084D863446cd1618244de695d574a5DfADD5',
    offers: '',
    events: '0xD479950963A8F87d9Cd44Ad3983C96A5A4b3c14d',
    predict: '0xae95e44D2642F568D0e0Fc0d60202B55c8764567',
    apps: '',
    drops: '',
    launch: '',
    univ3Router: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2',
    univ3Quoter: '0x78D78E420Da98ad378D7799bE8f4AF69033EB077',
    wnative: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    univ4Router: '0x1906c1d672b88cD1B9aC7593301cA990F94Eae07',
    univ4PoolManager: '0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF',
    univ4Quoters: ['0x9F75dD27D6664c475B90e105573E550ff69437B0'],
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  },
  chain4663: {
    name: 'robinhood',
    forwarder: '0xf5e4d19c9de1323dfF4fd85822Ca7A3582035e76',
    hup: '0x4E6Bab4961Ab53D70745E791FA727993A4221d1F',
    status: '0xc407722d150c8a65e890096869f8015D90a89EfD',
    followerSystem: '0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    chat: '',
    store: '',
    tipper: '0x3EF07D888e4B4d91e5b6c889E6Bdb7A37BE76CDE',
    trade: '0x77F884698945883841384bCA8bE6df17fCB7c04D',
    offers: '',
    events: '0x735A8352036B953F8AC0Ae421DaEf8f2978EcC91',
    predict: '0x08c4631B621959468770c3C9831E867aF9014780',
    apps: '',
    drops: '',
    launch: '',
    // Robinhood Chain has only a Uniswap V4 stack — no official v3 deployment. Addresses
    // come from the hooder project (read off a live UniversalRouter swap tx, verified on
    // Blockscout there) and re-verified onchain 2026-08-12 with the same cross-checks as the
    // registry chains. Two quoters exist; both are wired and the batch quote uses whichever
    // answers. Meme-launch pools here use the 2500/25 fee tier (probed by lib/uniswap-v4.js).
    univ3Router: '',
    univ3Quoter: '',
    univ4Router: '0x8876789976dEcBfCbBbe364623C63652db8C0904',
    univ4PoolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
    univ4Quoters: ['0xf775B2d3f858063054B31dCBb6ca93DAd8fCBd55', '0x5c3db48cFd8352D845fac70009d714F0Ce1d7914'],
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  },
  // chain10143: {
  //   name: 'monad-testnet',
  //   forwarder: '0x46a3dfCb1F4ec29dB7F96C0D3962DF20E6EdB259',
  //   hup: '0xddA507aFA7bE1e70B9dceEB3B34c9B886C98Ff73',
  //   status: '0xd5f02276c28E1F134BfA0b423381CE740ccb644E',
  //   community: '0x2ac3380C3c751F20A76c489689aF785aDfD220E3',
  //   followerSystem:'0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
  //   store: '0x85765350FF07802155a35fFf261DFfaAb0ffA366',
  //   tipper: '0x487aE425f90425a3376F3bC8A016aA1Fb6bec96f',
  //   trade: '0xC2b7f6eDecE9E5aB04C296a02bf61054487812e5',
  //   events: '0x4A6D88aBd0fd9049c1adD6757D382c1bb5bbC1D9',
  //   predict: '0x15C42Cf47D0Fe1D5314A91E5B23da35c72b129D9',
  //   apps: '0x16D02878DEA645209D64e1AC2b22131C7ee128FB',
  //   miner: '0x859F3cC26446f39Bc68DBA31197824f05716465D',
  //   launch: '0x5AAd99c0b7865C6e178Ec77e841Da1bDFaEccC72',
  // },
  chain42161: {
    name: 'arbitrum',
    forwarder: '0x41e6D71623FD02633C568342852154D2Cd7DBD0e',
    hup: '0x1EC0B3b802aFE596929a038f40F832EA01eCc281',
    status: '0x2269Fb436d594902e3c38085CBB3f350532531B3',
    followerSystem: '0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA',
    community: '',
    store: '',
    tipper: '0x0Fc1223079367ADC73F9960E48d786705e992e14',
    trade: '0x71Ce7aF80996AB5a9c265E2048c5759435131631',
    offers: '',
    events: '0x88C0963857049368470E2851aFf5EDFc2D32346C',
    predict: '0x81369e32F31DDAb46F9BF3269e523A440822C748',
    apps: '',
    drops: '',
    launch: '',
    univ3Router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    univ3Quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    wnative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    univ4Router: '0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3',
    univ4PoolManager: '0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32',
    univ4Quoters: ['0x3972C00f7ed4885e145823eb7C655375d275A1C5'],
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  },
}

/**
 * Contracts an embedded mini app may call with the viewer's burner session key via the bridge's
 * hup_sessionCall method — value-less, rate-limited, and gated behind a one-time per-app consent.
 * Keyed by chainId, then the app's onchain registry appId, listing the ONLY `to` addresses that
 * app may target. An app absent here cannot session-call at all.
 *
 * Keep this list host-owned and explicit: the session key can act as the viewer on Hup Core, so
 * a wildcard or app-supplied target would hand every embedded frame the viewer's identity.
 */
export const SESSION_CALL_ALLOWLIST = {
  10143: {
    // Hup Miner — its own registry listing (frame served from localhost/hupminer).
    // 4: [CONTRACTS.chain10143.miner],
  },
}
