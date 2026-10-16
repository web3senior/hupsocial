// Builds HupDao's deploy artifact and its explorer-verification input from ONE standard-JSON
// input, so the bytes deployed are exactly the bytes a verifier recompiles.
// usage: node src/tests/deploy-artifacts/build-hupdao.js <repoRoot> <@openzeppelin/contracts 5.6.1 dir> <solc 0.8.36 binary>
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const [repo, ozDir, solc] = process.argv.slice(2)
const contractsDir = path.join(repo, 'src/contracts')
const OZ_PREFIX = '@openzeppelin/contracts/'

const sources = {}
const toDisk = (key) => (key.startsWith(OZ_PREFIX) ? path.join(ozDir, key.slice(OZ_PREFIX.length)) : path.join(contractsDir, key))

const visit = (key) => {
  if (sources[key]) return
  const content = fs.readFileSync(toDisk(key), 'utf8')
  sources[key] = { content }
  for (const match of content.matchAll(/import\s+(?:[^'"]*from\s+)?["']([^"']+)["']/g)) {
    const spec = match[1]
    const next = spec.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(key), spec)) : spec
    visit(next)
  }
}
visit('v2/Extensions/HupDao.sol')

const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: 'cancun',
    metadata: { useLiteralContent: false, bytecodeHash: 'ipfs', appendCBOR: true },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } },
  },
}

const output = JSON.parse(execFileSync(solc, ['--standard-json'], { input: JSON.stringify(input), maxBuffer: 1 << 28 }).toString())
const errors = (output.errors || []).filter((e) => e.severity === 'error')
if (errors.length) {
  console.error(errors.map((e) => e.formattedMessage).join('\n'))
  process.exit(1)
}

const compiled = output.contracts['v2/Extensions/HupDao.sol'].HupDao
const runtimeBytes = compiled.evm.deployedBytecode.object.length / 2
const artifact = { contractName: 'HupDao', abi: compiled.abi, bytecode: `0x${compiled.evm.bytecode.object}` }

fs.writeFileSync(path.join(repo, 'src/tests/deploy-artifacts/artifacts/HupDao.json'), JSON.stringify(artifact))
fs.writeFileSync(path.join(repo, 'src/abis/HupDao.json'), JSON.stringify(compiled.abi, null, 2) + '\n')
// Chain-independent — the same input verifies on every chain; deploy.html reads one of these two folders
for (const folder of ['monad-mainnet', 'lukso-mainnet']) {
  fs.writeFileSync(path.join(contractsDir, 'v2/for-verification', folder, 'HupDao.json'), JSON.stringify(input))
}

console.log(`sources: ${Object.keys(sources).length}`)
console.log(`runtime: ${runtimeBytes} bytes (EIP-170 limit 24576)`)
console.log(`initcode: ${compiled.evm.bytecode.object.length / 2} bytes`)
