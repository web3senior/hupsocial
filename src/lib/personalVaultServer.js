import pool from '@/lib/db'
import { getServerPublicClient } from '@/lib/serverPublicClient'
import { personalVaultDeployment } from '@/lib/personalVaultDeployments'
import { readVault } from '@/lib/personalVault'
import { PERSONAL_VAULT_TABLES, recordVerifiedVault, vaultRegistrationInput, VaultRegistryError } from '@/lib/personalVaultRegistry'

let ready
export function ensurePersonalVaultTables() {
  if (!ready) ready = (async () => {
    for (const sql of PERSONAL_VAULT_TABLES) await pool.query(sql)
  })().catch((error) => { ready = null; throw error })
  return ready
}

export const personalVaultDb = {
  execute: async (...args) => { await ensurePersonalVaultTables(); return pool.execute(...args) },
  getConnection: async () => { await ensurePersonalVaultTables(); return pool.getConnection() },
}

export async function registerPersonalVault(body) {
  const { chainId, address } = vaultRegistrationInput(body)
  const deployment = personalVaultDeployment(chainId)
  const client = getServerPublicClient(chainId)
  if (!deployment || !client) throw new VaultRegistryError('This network does not support vault registration.')
  let snapshot
  let blockNumber
  try {
    blockNumber = await client.getBlockNumber({ cacheTime: 0 })
    snapshot = await readVault(client, address, deployment, { blockNumber })
  } catch (error) {
    if (/not a supported|does not require|verification failed/.test(error.message)) throw new VaultRegistryError('This address is not a supported multisig vault on the selected network.')
    throw new VaultRegistryError('The network could not verify this vault. Please retry shortly.', 503)
  }
  return recordVerifiedVault(personalVaultDb, { chainId, address, version: deployment.version, owners: snapshot.owners, threshold: snapshot.threshold, blockNumber })
}
