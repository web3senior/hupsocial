// Usage: node build-community-governance.cjs <solc-module-path> [openzeppelin-contracts-dir]
// Builds governance and treasury only; preserves the deployed community's source and artifacts.
const fs = require('node:fs')
const path = require('node:path')
const repo = path.resolve(__dirname, '../../..')
const contractsDir = path.join(repo, 'src/contracts')
const solc = require(path.resolve(process.argv[2]))
const ozDir = path.resolve(process.argv[3] || path.join(contractsDir, 'node_modules/@openzeppelin/contracts'))
if (!solc.version().startsWith('0.8.36+')) throw new Error('Use solc 0.8.36')
const sources = {}
const visit = (key) => {
  if (sources[key]) return
  const file = key.startsWith('@openzeppelin/contracts/') ? path.join(ozDir, key.slice('@openzeppelin/contracts/'.length)) : path.join(contractsDir, key)
  const content = fs.readFileSync(file, 'utf8')
  sources[key] = { content }
  for (const match of content.matchAll(/import\s+(?:[^'";]*from\s+)?["']([^"']+)["']/g)) {
    visit(match[1].startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(key), match[1])) : match[1])
  }
}
visit('v2/Extensions/HupCommunityGovernance.sol')
const input = {
  language: 'Solidity', sources,
  settings: {
    optimizer: { enabled: true, runs: 1 }, viaIR: true, evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
}
const output = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (output.errors || []).filter((error) => error.severity === 'error')
if (errors.length) throw new Error(errors.map((error) => error.formattedMessage).join('\n'))
for (const name of ['HupCommunityGovernance', 'HupCommunityTreasury']) {
  const contract = output.contracts[`v2/Extensions/${name}.sol`][name]
  const size = contract.evm.deployedBytecode.object.length / 2
  if (size > 24576) throw new Error(`${name}: runtime ${size} exceeds EIP-170`)
  fs.writeFileSync(path.join(repo, `src/abis/${name}.json`), JSON.stringify(contract.abi, null, 2) + '\n')
  fs.writeFileSync(path.join(__dirname, `artifacts/${name}.json`), JSON.stringify({ contractName: name, abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` }, null, 2) + '\n')
  console.log(`${name}: ${size} runtime bytes`)
}
fs.writeFileSync(path.join(contractsDir, 'v2/for-verification/community-governance.json'), JSON.stringify(input) + '\n')
