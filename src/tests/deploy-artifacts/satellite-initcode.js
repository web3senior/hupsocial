// Emits paste-ready CREATE2 init code for both LUKSO deployer satellites, bound to a given
// HupDrops engine address (their `drops` is immutable, so a new engine = new satellites).
// usage: node satellite-initcode.js 0x<newEngineAddress>
const fs = require('fs')
const engine = process.argv[2]
if (!/^0x[0-9a-fA-F]{40}$/.test(engine ?? '')) {
  console.error('usage: node satellite-initcode.js 0x<engineAddress>')
  process.exit(1)
}
const suffix = engine.replace(/^0x/, '').toLowerCase().padStart(64, '0')
for (const name of ['HupDropsDeployerLSP7', 'HupDropsDeployerLSP8']) {
  const { bytecode } = require(`./artifacts/${name}.json`)
  const file = `${name}.paste-ready.txt`
  fs.writeFileSync(file, bytecode + suffix + '\n')
  console.log(`${name}: ${file}`)
}
