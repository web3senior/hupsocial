/**
 * ABI-encodes constructor arguments for explorer verification, for the contracts whose arguments
 * depend on the deployment: the engine (per chain) and the satellites (the engine they answer to).
 *
 *   node src/tests/ctor-args.js engine 42                      # HupDrops on LUKSO
 *   node src/tests/ctor-args.js satellite 0x<engine address>   # any deployer satellite
 *
 * HupSplits, HupNativeBalance take no arguments. Collections and splitters are created by other
 * contracts — read theirs from the creation transaction's input on the explorer.
 */
const { AbiCoder, getAddress } = require('ethers')
const { CONTRACTS } = require('../config/contracts.js')

const ADMIN = '0x20e229667Cec8A0e9D3C6Fb89693B2a44ec2C50e'
const LSP26 = '0xf01103E5a9909Fc0DBe8166dA7085e0285daDDcA'
const coder = AbiCoder.defaultAbiCoder()

const [kind, value] = process.argv.slice(2)

if (kind === 'engine') {
  const chain = CONTRACTS[`chain${value}`]
  if (!chain?.hup || !chain?.forwarder) {
    console.error(`No hup/forwarder configured for chain ${value} in src/config/contracts.js`)
    process.exit(1)
  }
  const args = [getAddress(chain.hup), getAddress(chain.forwarder), ADMIN, chain.followerSystem ? getAddress(chain.followerSystem) : LSP26]
  console.log(`HupDrops on chain ${value} — (hup, forwarder, admin, followerSystem):`)
  console.log(args.join(', '))
  console.log(coder.encode(['address', 'address', 'address', 'address'], args))
} else if (kind === 'satellite') {
  const engine = getAddress(value)
  console.log(`Deployer satellite — (engine ${engine}):`)
  console.log(coder.encode(['address'], [engine]))
} else {
  console.log('usage: node src/tests/ctor-args.js engine <chainId> | satellite <engineAddress>')
  process.exit(1)
}
