import { isEvmAddress, normalizeAddress } from './address.js'
import { achievementById } from '../config/achievements.js'
import { POINTS_SEASONS } from '../config/points.js'

// Separate from SQL so catalog coverage can be checked without loading the server.
export const AUTO_ACHIEVEMENT_IDS = ['og', 'first-post', 'first-tip', 'generous', 'rising-voice', 'season-top-10']

export class AchievementError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export function validateAchievementScope(id, scope = '') {
  const item = achievementById(id)
  if (!item) throw new AchievementError('Unknown achievement')
  if (typeof scope !== 'string' || (item.perSeason
    ? !POINTS_SEASONS.some((season) => String(season.id) === scope)
    : scope !== '')) throw new AchievementError('Invalid achievement scope')
  return scope
}

export const featuredAchievementMessage = ({ address, achievementId, scope = '', nonce, issuedAt }) => [
  'Feature an achievement on Hup',
  '',
  `Wallet: ${normalizeAddress(address)}`,
  `Achievement: ${achievementId ?? 'none'}`,
  `Scope: ${scope}`,
  `Nonce: ${nonce}`,
  `Timestamp: ${issuedAt}`,
].join('\n')

// Bind every write parameter, including notes and silent backfills, to the signature.
export const achievementAdminMessage = ({ action, wallet = '', id = null, scope = '', note = '', notify = true, nonce }) => [
  'Manage achievements on Hup',
  JSON.stringify({ action, wallet: normalizeAddress(wallet), id, scope, note, notify, nonce }),
].join('\n')

export function validateFeaturedAchievementClaim(body, now = Date.now()) {
  const address = normalizeAddress(body?.address)
  if (!isEvmAddress(address)) throw new AchievementError('A valid EVM wallet address is required')
  if (typeof body?.signature !== 'string' || !body.signature || body.signature.length > 16384 ||
    typeof body?.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(body.nonce) ||
    !Number.isSafeInteger(body?.issuedAt) || Math.abs(now - body.issuedAt) > 5 * 60_000) {
    throw new AchievementError('A recent wallet signature and nonce are required')
  }
  const { achievementId, scope = '' } = body
  if (achievementId !== null) validateAchievementScope(achievementId, scope)
  else if (scope !== '') throw new AchievementError('Clearing a feature requires an empty scope')
  return { address, achievementId, scope, nonce: body.nonce, issuedAt: body.issuedAt, signature: body.signature, chainId: body.chainId }
}

export function validateAchievementAdminClaim(body) {
  const { action, wallet = '', id = null, scope = '', note = '', notify = true, signature, nonce, chainId } = body ?? {}
  if (!['grant', 'revoke', 'run'].includes(action) || typeof signature !== 'string' || !signature || signature.length > 16384 ||
    typeof nonce !== 'string' || !/^[a-f0-9]{32}$/.test(nonce) || typeof notify !== 'boolean' ||
    typeof note !== 'string' || note.length > 255 || typeof wallet !== 'string') {
    throw new AchievementError('Invalid achievement request')
  }
  if (action === 'run') {
    if (id !== null && !AUTO_ACHIEVEMENT_IDS.includes(id)) throw new AchievementError('Unknown automatic rule')
    if (scope !== '') throw new AchievementError('Rules determine their own scope')
  } else {
    if (!isEvmAddress(normalizeAddress(wallet))) throw new AchievementError('A valid EVM wallet address is required')
    validateAchievementScope(id, scope)
  }
  return { action, wallet: normalizeAddress(wallet), id, scope, note, notify, signature, nonce, chainId }
}
