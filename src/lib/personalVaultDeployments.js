import { getProxyFactoryDeployment, getSafeL2SingletonDeployment } from '@safe-global/safe-deployments'
import proxy141 from '@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxy.sol/SafeProxy.json'
import proxy130 from 'safe-contracts-v130/build/artifacts/contracts/proxies/GnosisSafeProxy.sol/GnosisSafeProxy.json'
import { keccak256 } from 'viem'

// Prefer 1.4.1; use the official 1.3.0 deployment where 1.4.1 is not registered.
const versions = [['1.4.1', proxy141], ['1.3.0', proxy130]]

function contract(deployment, chainId) {
  const address = deployment?.networkAddresses[String(chainId)]
  const match = Object.values(deployment?.deployments || {}).find((item) => item.address.toLowerCase() === address?.toLowerCase())
  return match ? { address, codeHash: match.codeHash } : null
}

export function personalVaultDeployment(chainId) {
  for (const [version, proxy] of versions) {
    const filter = { version, network: String(chainId), released: true }
    const singleton = contract(getSafeL2SingletonDeployment(filter), chainId)
    const factory = contract(getProxyFactoryDeployment(filter), chainId)
    if (singleton && factory) return { version, singleton, factory, proxyCodeHash: keccak256(proxy.deployedBytecode) }
  }
  return null
}
