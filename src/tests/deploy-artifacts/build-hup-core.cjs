// Usage: node build-hup-core.cjs <solc-module-path> [openzeppelin-contracts-dir]
// Builds the core set a new chain starts with: forwarder, Hup core, Status, Polls and Tipper.
// Same settings as the live Hup core builds (optimizer 200, no viaIR), pinned to cancun so the
// bytes run on every chain Hup targets, Hedera included.
const fs = require('node:fs')
const path = require('node:path')
const repo = path.resolve(__dirname, '../../..')
const contractsDir = path.join(repo, 'src/contracts')
const solc = require(path.resolve(process.argv[2]))
const ozDir = path.resolve(process.argv[3] || path.join(contractsDir, 'node_modules/@openzeppelin/contracts'))
if (!solc.version().startsWith('0.8.36+')) throw new Error('Use solc 0.8.36')
const TARGETS = {
  HupChatForwarder: 'metatx/HupChatForwarder.sol',
  Hup: 'v2/Hup.sol',
  HupStatus: 'v2/Extensions/HupStatus.sol',
  HupPolls: 'v2/Extensions/HupPolls.sol',
  HupTipper: 'v2/Extensions/HupTipper.sol',
}
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
Object.values(TARGETS).forEach(visit)
const input = {
  language: 'Solidity', sources,
  settings: {
    optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
}
const output = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (output.errors || []).filter((error) => error.severity === 'error')
if (errors.length) throw new Error(errors.map((error) => error.formattedMessage).join('\n'))
for (const [name, file] of Object.entries(TARGETS)) {
  const contract = output.contracts[file][name]
  const size = contract.evm.deployedBytecode.object.length / 2
  if (size > 24576) throw new Error(`${name}: runtime ${size} exceeds EIP-170`)
  fs.writeFileSync(path.join(__dirname, `artifacts/${name}.json`), JSON.stringify({ contractName: name, abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` }, null, 2) + '\n')
  console.log(`${name}: ${size} runtime bytes`)
}
fs.writeFileSync(path.join(contractsDir, 'v2/for-verification/hup-core.json'), JSON.stringify(input) + '\n')
