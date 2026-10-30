import { NextResponse } from 'next/server'
import { listPersonalVaults, VaultRegistryError } from '@/lib/personalVaultRegistry'
import { personalVaultDb, registerPersonalVault } from '@/lib/personalVaultServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ok = (data) => NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } })
const fail = (error) => {
  if (!(error instanceof VaultRegistryError)) console.error('[personal-vaults]', error.message)
  return NextResponse.json({ success: false, error: error instanceof VaultRegistryError ? error.message : 'Vault records are unavailable. Please retry.' }, { status: error instanceof VaultRegistryError ? error.status : 503 })
}

// These records contain only public onchain facts. A submission cannot assign an owner:
// the server reads owners from the verified Safe, including contract-account owners.
export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams
    return ok(await listPersonalVaults(personalVaultDb, params.get('wallet'), Number(params.get('cursor') || 0)))
  } catch (error) { return fail(error) }
}

export async function POST(request) {
  try {
    if (Number(request.headers.get('content-length')) > 2048) throw new VaultRegistryError('Vault registration is too large.', 413)
    const text = await request.text()
    if (text.length > 2048) throw new VaultRegistryError('Vault registration is too large.', 413)
    let body
    try { body = JSON.parse(text) } catch { throw new VaultRegistryError('Expected a JSON body.') }
    return ok(await registerPersonalVault(body))
  } catch (error) { return fail(error) }
}
