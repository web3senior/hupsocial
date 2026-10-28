import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, posix } from 'node:path'
import solc from 'solc'

const roots = [resolve('node_modules'), ...readdirSync('node_modules/.pnpm').map((name) => resolve('node_modules/.pnpm', name, 'node_modules'))]
const sources = {}
function visit(name) {
  if (sources[name]) return
  const path = name.startsWith('@') ? roots.map((root) => resolve(root, name)).find(existsSync) : resolve(name)
  if (!path) throw new Error(`Missing import ${name}`)
  const content = readFileSync(path, 'utf8')
  sources[name] = { content }
  for (const match of content.matchAll(/import\s+(?:[^'";]*from\s+)?["']([^"']+)["']/g)) {
    visit(match[1].startsWith('.') ? posix.normalize(posix.join(posix.dirname(name), match[1])) : match[1])
  }
}
visit('HupBridge.sol')
const input = {
  language: 'Solidity', sources,
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } },
}
const output = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (output.errors || []).filter((error) => error.severity === 'error')
if (errors.length) throw new Error(errors.map((error) => error.formattedMessage).join('\n'))
mkdirSync('artifacts', { recursive: true })
writeFileSync('artifacts/contracts.json', JSON.stringify(output.contracts, null, 2) + '\n')
const artifactDir = resolve('../../tests/deploy-artifacts/artifacts')
mkdirSync(artifactDir, { recursive: true })
for (const name of ['HupBridgeVault', 'HupLuksoBridge']) {
  const file = 'HupBridge.sol'
  const contract = output.contracts[file][name]
  const size = contract.evm.deployedBytecode.object.length / 2
  if (size > 24576) throw new Error(`${name} exceeds EIP-170`)
  writeFileSync(resolve(artifactDir, `${name}.json`), JSON.stringify({ contractName: name, bridgeVersion: 1, compilerVersion: '0.8.30+commit.73712a01', identifier: `${file}:${name}`, verificationInput: './deploy-artifacts/verification/hupbridge.json', abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` }, null, 2) + '\n')
  console.log(`${name}: ${size} runtime bytes`)
}
const verificationDir = resolve('../../tests/deploy-artifacts/verification')
mkdirSync(verificationDir, { recursive: true })
writeFileSync(resolve(verificationDir, 'hupbridge.json'), JSON.stringify(input) + '\n')
console.log(`solc ${solc.version()}, optimizer 200, Shanghai; standard JSON exported`)
