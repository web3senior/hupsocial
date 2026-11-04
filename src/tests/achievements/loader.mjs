// Next-style aliases and extensionless imports for achievement integration tests.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

if (!globalThis.__achievementTestLoader) {
  globalThis.__achievementTestLoader = true
  register(import.meta.url)
}

const SRC = new URL('../../', import.meta.url)
const EXTENSIONS = ['', '.js', '.jsx', '.mjs', '.json', '/index.js']

export async function resolve(specifier, context, next) {
  if (specifier === 'next/server') return next('next/server.js', context)
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
  if (url.startsWith(SRC.href) && url.endsWith('.js')) return next(url, { ...context, format: 'module' })
  return next(url, context)
}
