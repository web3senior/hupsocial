// Shared option metadata for the community selects — one place for the user-facing
// explanation of what each onchain setting actually does. Used by both the creation modal
// and the card's Modify form so the copy can't drift between them.
//
// Three orthogonal axes (the old MembershipType enum conflated them):
//   1. AdmissionMode  — how wallets get onto the roster
//   2. Requirements   — what wallets must hold/be (composable list, ALL/ANY)
//   3. Encryption     — whether post content is sealed (keyVersion > 0 onchain)

export const ADMISSION = {
  Open: 0,
  RequestApproval: 1,
  InviteOnly: 2,
  SelfServeIfEligible: 3,
  PayToJoin: 4,
}

// `label` is the picker title (spells out where the gate sits, since Open vs Token-gated was
// the confusing pair), `tag` the short form for card pills, `note` the line shown under the
// option in the picker. The onchain enum name (SelfServeIfEligible) is unchanged — only the
// words people see.
export const ADMISSION_OPTIONS = [
  {
    value: ADMISSION.Open,
    label: 'Open (anyone joins, gated at post)',
    tag: 'Open',
    note: 'One click to join, no checks. Requirements, if you add any, are checked when posting — a member who doesn’t hold the asset stays a member but can’t post.',
  },
  {
    value: ADMISSION.RequestApproval,
    label: 'Request approval',
    tag: 'Request approval',
    note: 'Anyone can ask to join; a moderator approves or declines each request.',
  },
  {
    value: ADMISSION.InviteOnly,
    label: 'Invite only',
    tag: 'Invite only',
    note: 'Moderators send invites — a wallet becomes a member only after accepting its invite.',
  },
  {
    value: ADMISSION.SelfServeIfEligible,
    label: 'Token-gated (checked at join)',
    tag: 'Token-gated',
    note: 'Only wallets that meet the requirements can join — checked automatically the moment they join, no moderator needed. Anyone who doesn’t qualify is turned away at the door.',
  },
  {
    value: ADMISSION.PayToJoin,
    label: 'Pay to join',
    tag: 'Pay to join',
    note: 'A one-time payment (native coin or token) buys membership. The price goes to the creator.',
  },
]

// Self-serve only differs from Open once at least one requirement exists: with an empty list
// isEligible() returns true for every wallet onchain, so join() admits exactly who Open would.
// The forms lock the option in that state instead of offering a silent duplicate of Open.
export const SELF_SERVE_HINTS = {
  lockedSuffix: '— add a requirement first',
  locked:
    'Add at least one requirement below first. With nothing to check, everyone qualifies — this would let in exactly the same people as Open.',
  redundant:
    'This community has no requirements, so everyone qualifies — right now this lets in the same people as Open. Add a requirement below to actually gate it.',
}

export const REQUIREMENT_TYPE = {
  NativeBalance: 0,
  TokenBalance: 1,
  NftBalance: 2,
  Whitelisted: 3,
  FollowsCreator: 4,
}

// Indexed by onchain RequirementType, so every enum value has a slot here even when the form
// doesn't offer it. NativeBalance and TokenBalance are ONE choice in the UI ("Token or coin
// balance"): leaving the asset blank means the chain's native coin, which is exactly how the
// contract spells it (rType NativeBalance, asset ignored). toOnchainRequirement/toUiRequirement
// translate between the single form row and the two onchain types.
export const REQUIREMENT_TYPE_OPTIONS = [
  {
    value: REQUIREMENT_TYPE.NativeBalance,
    label: 'Native coin balance',
    note: "Hold at least this much of the chain's native coin — whole-coin units, decimals allowed (e.g. 0.001).",
    needsAsset: false,
    needsMin: true,
    // Folded into the TokenBalance row in the pickers — see toUiRequirementType
    hidden: true,
  },
  {
    value: REQUIREMENT_TYPE.TokenBalance,
    label: 'Token or coin balance',
    note: 'Hold at least this much of a token — search it by name or paste its address — or leave the token blank for the network’s own coin. Enter the amount the way you’d say it (e.g. 100).',
    needsAsset: true,
    // A blank asset is valid here: it means the native coin
    assetOptional: true,
    needsMin: true,
  },
  {
    value: REQUIREMENT_TYPE.NftBalance,
    label: 'NFT collection',
    note: 'Own at least this many NFTs from a collection.',
    needsAsset: true,
    needsMin: true,
  },
  {
    value: REQUIREMENT_TYPE.Whitelisted,
    label: 'Whitelisted',
    note: 'Be on the community’s whitelist (you manage it under Members & moderation).',
    needsAsset: false,
    needsMin: false,
  },
  {
    value: REQUIREMENT_TYPE.FollowsCreator,
    label: 'Follows the creator',
    note: 'Follow the community’s creator.',
    needsAsset: false,
    needsMin: false,
  },
]

/** The requirement types the pickers actually offer (the native row is folded into token). */
export const REQUIREMENT_TYPE_CHOICES = REQUIREMENT_TYPE_OPTIONS.filter((option) => !option.hidden)

const ZERO = '0x0000000000000000000000000000000000000000'
const isBlankOrZeroAddress = (asset) => !asset?.trim() || asset.trim().toLowerCase() === ZERO

/**
 * The onchain (rType, asset) for a form row. A "Token or coin balance" row with no asset is
 * the contract's NativeBalance type; everything else passes through. The minimum is scaled by
 * the caller (fetchTokenDecimals already resolves a blank asset to the native coin's decimals).
 */
export const toOnchainRequirement = (row) => {
  if (row.rType === REQUIREMENT_TYPE.TokenBalance && isBlankOrZeroAddress(row.asset)) {
    return { rType: REQUIREMENT_TYPE.NativeBalance, asset: ZERO }
  }
  return { rType: row.rType, asset: row.asset?.trim() || ZERO }
}

/** The form row type for an onchain requirement: NativeBalance opens as a blank-asset token row. */
export const toUiRequirementType = (rType) => (rType === REQUIREMENT_TYPE.NativeBalance ? REQUIREMENT_TYPE.TokenBalance : rType)

export const REQUIREMENT_MODE_OPTIONS = [
  { value: 0, label: 'ALL of these', note: 'Members must satisfy every requirement in the list.' },
  { value: 1, label: 'ANY of these', note: 'Satisfying any single requirement is enough.' },
]

export const COMMUNITY_TYPE_OPTIONS = [
  {
    value: 0,
    label: 'Discussion (Members can post)',
    note: 'Every member can post to the community feed.',
  },
  {
    value: 1,
    label: 'Broadcast (Only moderators post)',
    note: 'Members read; only the creator and moderators can post.',
  },
]

export const ENCRYPTION_NOTES = {
  on: 'Posts are end-to-end encrypted — only members holding the community key can read them.',
  onSelfAdmit: 'New members join instantly but can read only once a moderator delivers their key.',
  off: 'Posts are public. If you turn on encryption later, only posts from then on are protected.',
}
