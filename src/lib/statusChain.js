/**
 * @file lib/statusChain.js
 * @description Server-only indexer that syncs the on-chain `status` contract's
 * StatusUpdated/StatusCleared events into the `statuses` table, chain by chain.
 * Mirrors the chunked getPastEvents pattern already used by getLikesPaginated
 * in communication.js, but iterates an explicit chainId rather than the
 * browser-resolved "active chain".
 */

import Web3 from 'web3'
import pool from '@/lib/db'
import { config, CONTRACTS } from '@/config/wagmi'
import statusAbi from '@/abi/status.json'

const CHUNK_SIZE = 10000

async function getLastSyncedBlock(networkId) {
  const [rows] = await pool.execute('SELECT last_synced_block FROM status_sync_state WHERE network_id = ?', [networkId])
  return rows[0]?.last_synced_block ?? 0
}

async function setLastSyncedBlock(networkId, blockNumber) {
  await pool.execute(
    `INSERT INTO status_sync_state (network_id, last_synced_block) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE last_synced_block = VALUES(last_synced_block)`,
    [networkId, blockNumber],
  )
}

async function upsertStatusUpdated(networkId, event) {
  const { user, content, statusType, metadata, periodHours, timestamp } = event.returnValues

  await pool.execute(
    `INSERT INTO statuses
      (network_id, wallet_address, content, status_type, metadata, period_hours, event_timestamp, block_number, tx_hash, log_index)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       content = VALUES(content),
       status_type = VALUES(status_type),
       metadata = VALUES(metadata),
       period_hours = VALUES(period_hours),
       event_timestamp = VALUES(event_timestamp),
       block_number = VALUES(block_number),
       is_cleared = 0`,
    [
      networkId,
      user.toLowerCase(),
      content,
      statusType,
      metadata,
      Number(periodHours),
      Number(timestamp),
      event.blockNumber,
      event.transactionHash,
      event.logIndex,
    ],
  )
}

async function applyStatusCleared(networkId, event) {
  const { user, timestamp } = event.returnValues

  await pool.execute(
    `UPDATE statuses SET is_cleared = 1
     WHERE network_id = ? AND wallet_address = ? AND event_timestamp <= ?`,
    [networkId, user.toLowerCase(), Number(timestamp)],
  )
}

/**
 * Scans one chain's status contract since its last synced block and upserts
 * new StatusUpdated/StatusCleared events into the statuses table.
 */
export async function syncStatusesForChain(chainId) {
  const chain = config.chains.find((c) => c.id === Number(chainId))
  const contracts = CONTRACTS[`chain${chainId}`]

  if (!chain || !contracts?.status) {
    return { chainId, skipped: true }
  }

  const web3 = new Web3(new Web3.providers.HttpProvider(chain.rpcUrls.default.http[0]))
  const contract = new web3.eth.Contract(statusAbi, contracts.status)

  const latestBlock = Number(await web3.eth.getBlockNumber())
  let fromBlock = (await getLastSyncedBlock(chainId)) + 1

  if (fromBlock > latestBlock) {
    return { chainId, scanned: 0, latestBlock }
  }

  let scanned = 0

  while (fromBlock <= latestBlock) {
    const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, latestBlock)

    const [updatedEvents, clearedEvents] = await Promise.all([
      contract.getPastEvents('StatusUpdated', { fromBlock, toBlock }),
      contract.getPastEvents('StatusCleared', { fromBlock, toBlock }),
    ])

    for (const event of updatedEvents) {
      await upsertStatusUpdated(chainId, event)
    }
    for (const event of clearedEvents) {
      await applyStatusCleared(chainId, event)
    }

    scanned += updatedEvents.length + clearedEvents.length

    // Advance only after the chunk fully succeeds, so a mid-scan failure resumes from here.
    await setLastSyncedBlock(chainId, toBlock)
    fromBlock = toBlock + 1
  }

  return { chainId, scanned, latestBlock }
}

/**
 * Runs syncStatusesForChain for every configured chain that has a status contract.
 */
export async function syncAllStatuses() {
  const results = []

  for (const chain of config.chains) {
    const contracts = CONTRACTS[`chain${chain.id}`]
    if (!contracts?.status) continue
    results.push(await syncStatusesForChain(chain.id))
  }

  return results
}
