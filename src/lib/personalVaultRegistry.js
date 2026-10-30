import { getAddress } from 'viem'
import { validAddress } from '@/lib/personalVault'

export class VaultRegistryError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export function vaultRegistrationInput(body) {
  if (!body || !Number.isSafeInteger(body.chainId) || body.chainId <= 0) throw new VaultRegistryError('Choose a valid network.')
  let address
  try { address = validAddress(body.address) } catch { throw new VaultRegistryError('Enter a valid vault address.') }
  return { chainId: body.chainId, address }
}

export const PERSONAL_VAULT_TABLES = [
  `CREATE TABLE IF NOT EXISTS personal_vaults (
    chain_id BIGINT UNSIGNED NOT NULL,
    address CHAR(42) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    safe_version VARCHAR(16) NOT NULL,
    approval_threshold SMALLINT UNSIGNED NOT NULL,
    signer_count SMALLINT UNSIGNED NOT NULL,
    verified_block BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chain_id, address)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS personal_vault_signers (
    chain_id BIGINT UNSIGNED NOT NULL,
    vault_address CHAR(42) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    signer_address CHAR(42) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (chain_id, vault_address, signer_address),
    KEY idx_personal_vault_signer (signer_address, chain_id, vault_address)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
]

// Input is a server-verified, block-pinned snapshot, never ownership supplied by a browser.
export async function recordVerifiedVault(db, snapshot) {
  const { chainId, address } = vaultRegistrationInput(snapshot)
  const normalized = address.toLowerCase()
  const owners = [...new Set(snapshot.owners.map((owner) => validAddress(owner).toLowerCase()))]
  if (owners.length < 2 || owners.length > 100 || !Number.isInteger(snapshot.threshold) || snapshot.threshold < 2 || snapshot.threshold > owners.length) throw new VaultRegistryError('Invalid vault signer configuration.')
  const block = BigInt(snapshot.blockNumber)
  if (block < 0n) throw new VaultRegistryError('Invalid verification block.')
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    // Upsert obtains the row lock before owner associations are replaced.
    await connection.execute(
      `INSERT INTO personal_vaults (chain_id, address, safe_version, approval_threshold, signer_count, verified_block)
       VALUES (?, ?, ?, ?, ?, 0) ON DUPLICATE KEY UPDATE chain_id = VALUES(chain_id)`,
      [chainId, normalized, snapshot.version, snapshot.threshold, owners.length],
    )
    const [rows] = await connection.execute('SELECT verified_block FROM personal_vaults WHERE chain_id = ? AND address = ? FOR UPDATE', [chainId, normalized])
    // A slower RPC response must not restore an older signer list.
    if (BigInt(rows[0].verified_block) <= block) {
      await connection.execute(
        'UPDATE personal_vaults SET safe_version = ?, approval_threshold = ?, signer_count = ?, verified_block = ?, verified_at = CURRENT_TIMESTAMP WHERE chain_id = ? AND address = ?',
        [snapshot.version, snapshot.threshold, owners.length, block.toString(), chainId, normalized],
      )
      await connection.execute('DELETE FROM personal_vault_signers WHERE chain_id = ? AND vault_address = ?', [chainId, normalized])
      for (const owner of owners) await connection.execute('INSERT INTO personal_vault_signers (chain_id, vault_address, signer_address) VALUES (?, ?, ?)', [chainId, normalized, owner])
    }
    await connection.commit()
    return { chainId, address }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listPersonalVaults(db, wallet, cursor = 0, limit = 24) {
  let signer
  try { signer = validAddress(wallet).toLowerCase() } catch { throw new VaultRegistryError('Enter a valid signing wallet.') }
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > 100_000) throw new VaultRegistryError('Invalid vault cursor.')
  const size = Math.min(100, Math.max(1, limit))
  const [rows] = await db.execute(
    `SELECT v.chain_id, v.address, v.safe_version, v.approval_threshold, v.verified_at, v.signer_count
     FROM personal_vaults v INNER JOIN personal_vault_signers s ON s.chain_id = v.chain_id AND s.vault_address = v.address
     WHERE s.signer_address = ? ORDER BY v.created_at DESC, v.chain_id, v.address LIMIT ? OFFSET ?`,
    [signer, size + 1, cursor],
  )
  return {
    vaults: rows.slice(0, size).map((row) => ({ chainId: Number(row.chain_id), address: getAddress(row.address), version: row.safe_version, threshold: Number(row.approval_threshold), signerCount: Number(row.signer_count), verifiedAt: row.verified_at })),
    nextCursor: rows.length > size ? cursor + size : null,
  }
}
