import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchTokenInfo } from '@/lib/tokenInfo'

test('indexed LSP4 branding remains available when the market source fails', async (context) => {
  const previous = process.env.NEXT_PUBLIC_LUKSO_API_ENDPOINT
  const endpoint = 'https://index.example/graphql'
  process.env.NEXT_PUBLIC_LUKSO_API_ENDPOINT = endpoint
  context.after(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_LUKSO_API_ENDPOINT
    else process.env.NEXT_PUBLIC_LUKSO_API_ENDPOINT = previous
  })
  const address = '0x0000000000000000000000000000000000000002'
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url !== endpoint) return new Response('', { status: 503 })
    assert.equal(JSON.parse(options.body).variables.address, address)
    return Response.json({ data: { Asset: [{ lsp4TokenName: 'Example', lsp4TokenSymbol: 'EXAMPLE', icons: [{ src: 'ipfs://example-icon' }] }] } })
  })
  const result = await fetchTokenInfo(42, address)
  assert.equal(result.symbol, 'EXAMPLE')
  assert.equal(result.logo, 'ipfs://example-icon')
})
