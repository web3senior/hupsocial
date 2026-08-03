// Shared option metadata for the community selects — one place for the user-facing
// explanation of what each onchain setting actually does. Used by both the creation modal
// and the card's Modify form so the copy can't drift between them.

export const MEMBERSHIP_OPTIONS = [
  {
    value: 0,
    label: 'Public',
    note: 'Open to everyone — one click to join and all posts are public. Joining is still required before posting.',
  },
  {
    value: 1,
    label: 'Request-Based',
    note: 'Anyone can request access; a moderator approves each member. Posts are end-to-end encrypted. 🔒',
  },
  {
    value: 2,
    label: 'Private (Invite Only)',
    note: 'No self-service join — moderators grant access directly. Posts are end-to-end encrypted. 🔒',
  },
  {
    value: 3,
    label: 'NFT-Gated',
    note: 'Posting requires holding the configured NFT, re-checked live at every post — selling it means losing access. Posts are end-to-end encrypted. 🔒',
  },
  {
    value: 4,
    label: 'Token-Gated',
    note: 'Posting requires a minimum token (or native coin) balance, re-checked live at every post. Posts are end-to-end encrypted. 🔒',
  },
  {
    value: 5,
    label: 'NFT + Token Gated',
    note: 'Requires both the NFT and the minimum token balance, re-checked live at every post. Posts are end-to-end encrypted. 🔒',
  },
  {
    value: 6,
    label: 'Whitelisted',
    note: 'Only wallets you pre-approve can join (self-service once whitelisted). Posts are public.',
  },
  {
    value: 7,
    label: 'Pay to Join',
    note: 'A one-time payment (native coin or token) buys membership. Posts are public.',
  },
  {
    value: 8,
    label: 'Follower-Gated',
    note: "Only wallets that follow the creator's profile can post, re-checked live at every post. Posts are end-to-end encrypted. 🔒",
  },
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
