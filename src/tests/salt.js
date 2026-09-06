/**
 * Prints a CREATE2 salt derived from a label — the same value deploy.html's console gives for
 * `ethers.id(label)` — so a redeploy can use a salt that is easy to remember and to reproduce.
 *
 *   node src/tests/salt.js                # hup-drops
 *   node src/tests/salt.js hup-drops-2    # any label
 *
 * Paste the printed value into the salt field of deploy.html. The same label always gives the
 * same salt, and the same salt with the same bytes always gives the same address, so keep the
 * label with the deployment notes.
 */
const { id } = require('ethers')

const label = process.argv[2] || 'hup-drops'
const salt = id(label)

console.log(`label: ${label}`)
console.log(`salt:  ${salt}`)
