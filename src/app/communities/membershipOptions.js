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

export const ADMISSION_OPTIONS = [
  {
    value: ADMISSION.Open,
    label: 'Open',
    note: 'Anyone joins instantly with one click. Requirements below (if any) still gate posting.',
  },
  {
    value: ADMISSION.RequestApproval,
    label: 'Request Approval',
    note: 'Anyone can ask to join; a moderator approves each request.',
  },
  {
    value: ADMISSION.InviteOnly,
    label: 'Invite Only',
    note: 'Moderators send invites — a wallet becomes a member only after accepting the invite itself.',
  },
  {
    value: ADMISSION.SelfServeIfEligible,
    label: 'Self-serve if eligible',
    note: 'Anyone who meets the requirements below joins instantly — the contract verifies at join time.',
  },
  {
    value: ADMISSION.PayToJoin,
    label: 'Pay to Join',
    note: 'A one-time payment (native coin or token) buys membership. The price goes to the creator.',
  },
]

// Self-serve only differs from Open once at least one requirement exists: with an empty list
// isEligible() returns true for every wallet onchain, so join() admits exactly who Open would.
// The forms lock the option in that state instead of offering a silent duplicate of Open.
export const SELF_SERVE_HINTS = {
  lockedSuffix: '— add a requirement first',
  locked:
    'Needs at least one requirement. With an empty list the contract finds everyone eligible, so this would admit exactly the same wallets as Open.',
  redundant:
    'This community has no requirements, so everyone is eligible — self-serve currently admits the same wallets as Open. Add a requirement below to make it gate the roster.',
}

export const REQUIREMENT_TYPE = {
  NativeBalance: 0,
  TokenBalance: 1,
  NftBalance: 2,
  Whitelisted: 3,
  FollowsCreator: 4,
}

export const REQUIREMENT_TYPE_OPTIONS = [
  {
    value: REQUIREMENT_TYPE.NativeBalance,
    label: 'Native coin balance',
    note: "Hold at least this much of the chain's native coin — whole-coin units, decimals allowed (e.g. 0.001).",
    needsAsset: false,
    needsMin: true,
  },
  {
    value: REQUIREMENT_TYPE.TokenBalance,
    label: 'Token balance',
    note: 'Hold at least this many whole tokens of an ERC-20/LSP7 (e.g. 100, not 100000000 — the token’s own decimals are applied for you).',
    needsAsset: true,
    needsMin: true,
  },
  {
    value: REQUIREMENT_TYPE.NftBalance,
    label: 'NFT collection',
    note: 'Hold at least this many NFTs from the collection (ERC-721/LSP8).',
    needsAsset: true,
    needsMin: true,
  },
  {
    value: REQUIREMENT_TYPE.Whitelisted,
    label: 'Whitelisted',
    note: "Be on the community's whitelist (managed from Members & moderation).",
    needsAsset: false,
    needsMin: false,
  },
  {
    value: REQUIREMENT_TYPE.FollowsCreator,
    label: 'Follows the creator',
    note: 'Follow the community creator on the follower registry.',
    needsAsset: false,
    needsMin: false,
  },
]

export const REQUIREMENT_MODE_OPTIONS = [
  { value: 0, label: 'ALL of these', note: 'Members must satisfy every requirement in the list.' },
  { value: 1, label: 'ANY of these', note: 'Satisfying any single requirement is enough.' },
]

export const COMMUNITY_TYPE_OPTIONS = [
  {
    value: 0,
    label: 'Discussion (Members can post)',
    note: 'Every member with posting rights can publish to the community feed.',
  },
  {
    value: 1,
    label: 'Broadcast (Only moderators post)',
    note: 'Read-only for members — only the creator and moderators can publish.',
  },
]

export const ENCRYPTION_NOTES = {
  on: 'Posts are end-to-end encrypted to members holding the community key. 🔒 Honest limit: any member can leak plaintext — encryption protects small and medium groups, not huge ones.',
  onSelfAdmit:
    'Heads up: with instant self-service admission, new members can read only after a moderator delivers their key (they join immediately, the key follows when a moderator is next online).',
  off: 'Posts are public plaintext. Enabling encryption later only protects posts from that point on.',
}
