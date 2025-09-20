import React from 'react'
import { toast } from 'react-hot-toast'
import styles from './AddNetworkButton.module.scss'
import { ChromeIcon } from './icons'

// TODO: we could use a global config file and fetch the info from there on all pages
// const LUKSO_NETWORK_CONFIGS = {
//   mainnet: {
//     chainId: '0x2A', // 42
//     chainName: 'LUKSO',
//     nativeCurrency: {
//       name: 'LYX',
//       symbol: 'LYX',
//       decimals: 18,
//     },
//     rpcUrls: ['https://rpc.lukso.gateway.fm'],
//     blockExplorerUrls: ['https://explorer.execution.mainnet.lukso.network'],
//   },
// }

export default function GetUPButtonChrome() {
  // const addNetwork = async () => {
  //   const ethereum = window.ethereum

  //   if (!ethereum) {
  //     toast.error('No extension detected.')
  //     return
  //   }

  //   try {
  //     await ethereum.request({
  //       method: 'wallet_switchEthereumChain',
  //       params: [{ chainId: LUKSO_NETWORK_CONFIGS.mainnet.chainId }],
  //     })
  //     toast.success('Your extension is now connected to LUKSO network.')
  //   } catch (switchError) {
  //     // This error code indicates that the chain has not been added to MetaMask.
  //     if (switchError.code === 4902) {
  //       try {
  //         await ethereum.request({
  //           method: 'wallet_addEthereumChain',
  //           params: [LUKSO_NETWORK_CONFIGS.mainnet],
  //         })
  //       } catch (addError) {
  //         toast.error(addError.message)
  //       }
  //     } else {
  //       toast.error(switchError.message)
  //     }
  //   }
  // }

  return (
    <a href={`https://chromewebstore.google.com/detail/universal-profiles/abpickdkkbnbcoepogfhkhennhfhehfn`} 
    className={`d-flex align-items-center justify-content-center ${styles.button}`} style={{columnGap:'.5rem'}}>
      <ChromeIcon/> Download UP on Chrome 
    </a>
  )
}
