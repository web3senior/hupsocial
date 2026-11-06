import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const nextRequire = createRequire(require.resolve('next/package.json'))
nextRequire('@next/env').loadEnvConfig(process.cwd(), false)
if (!process.env.CRON_SECRET) throw new Error('CRON_SECRET is required')
const response = await fetch('http://127.0.0.1:3000/api/post-storage/cleanup', {
  headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  signal: AbortSignal.timeout(65_000),
})
if (!response.ok) throw new Error(`Cleanup worker returned ${response.status}`)
const { results } = await response.json()
if (results.some((result) => result.error)) {
  console.error('Some storage cleanup jobs failed; see post_storage_cleanup.last_error')
  process.exitCode = 1
}
