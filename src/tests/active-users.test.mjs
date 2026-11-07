import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const state = { columns: new Set(), queries: [], counts: [] }
globalThis.__activeUsersTest = state
state.execute = async (sql, params) => {
  state.queries.push({ sql, params })
  return [[{ total: state.counts[0], earlier: state.counts[1] }]]
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/lib/db' || specifier === '@/lib/schema') {
      return { url: `active-users-test:${specifier}`, shortCircuit: true }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url === 'active-users-test:@/lib/db') {
      return { format: 'module', source: 'export default { execute: (...args) => globalThis.__activeUsersTest.execute(...args) }', shortCircuit: true }
    }
    if (url === 'active-users-test:@/lib/schema') {
      return { format: 'module', source: 'export const hasColumn = async (table, column) => globalThis.__activeUsersTest.columns.has(`${table}.${column}`)', shortCircuit: true }
    }
    return next(url, context)
  },
})

const { countActiveWallets } = await import('../lib/activeWallets.js')

test('active users exclude passive records, tolerate missing features, and count first-time participants', async () => {
  state.columns = new Set(['users.joined_at', 'post_views.viewer_address'])
  assert.deepEqual(await countActiveWallets(), { total: 0, recent: 0 })
  assert.equal(state.queries.length, 0)

  state.columns = new Set(['posts.wallet_address', 'posts.created_at', 'tips.tipper', 'tips.tipped_at'])
  state.counts = ['7', '5']
  assert.deepEqual(await countActiveWallets('2026-11-06 00:00:00'), { total: 7, recent: 2 })
  assert.equal(state.queries.length, 2)
  const [all, before] = state.queries
  assert.match(all.sql, / UNION /)
  assert.doesNotMatch(all.sql, /UNION ALL|FROM users|post_views|chat_messages/)
  assert.match(all.sql, /wallet_address <> ''/)
  assert.deepEqual(before.params, ['2026-11-06 00:00:00', Date.parse('2026-11-06T00:00:00Z') / 1000])

  state.queries = []
  assert.deepEqual(await countActiveWallets(), { total: 7, recent: 0 })
  assert.equal(state.queries.length, 1)
})
