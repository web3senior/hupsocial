// Lets `node --test` import the app's modules as Next does: `@/` points at src/, imports may leave
// out the extension, and JSON imports need no import attribute.
//   node --import ./src/tests/personal-vault/loader.mjs --test src/tests/personal-vault/*.test.mjs
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

if (!globalThis.__personalVaultLoader) {
  globalThis.__personalVaultLoader = true
  register(import.meta.url)
}

const SRC = new URL('../../', import.meta.url)
const EXTENSIONS = ['', '.js', '.jsx', '.mjs', '.json', '/index.js']

export async function resolve(specifier, context, next) {
  let target = null
  if (specifier.startsWith('@/')) target = new URL(specifier.slice(2), SRC)
  else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) target = new URL(specifier, context.parentURL)
  if (target) {
    const path = fileURLToPath(target)
    const found = EXTENSIONS.map((extension) => path + extension).find((candidate) => existsSync(candidate) && !candidate.endsWith('/'))
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true }
  }
  return next(specifier, context)
}

export async function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.json')) {
    return { format: 'module', source: `export default ${await readFile(fileURLToPath(url), 'utf8')}`, shortCircuit: true }
  }
  // The app's sources are ES modules, though package.json declares no type
  if (url.startsWith(SRC.href) && url.endsWith('.js')) return next(url, { ...context, format: 'module' })
  return next(url, context)
}
