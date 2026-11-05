/**
 * @file config/token.js
 * @description What /token tells the public about $HUP before its TGE: the plan as it stands. The
 * page marks every number as subject to change until launch, so update them here as the plan moves.
 */

export const HUP_TOKEN = {
  symbol: '$HUP',
  // Fixed for good: minted once at TGE, no mint function afterwards
  totalSupply: 1_000_000_000,
  // Each launch chain's HupFeeSplitter once placed (/admin/launchpad), keyed by launch chain key,
  // e.g. { base: '0x…' }. Empty until then; the page says so instead of listing nothing.
  feeSplitters: {},
  // The share of every protocol fee held for buybacks (config/vaults.js feeSplitterBuybackBps)
  buybackShare: 0.5,
}

// Shares of the 1B supply, largest first; they sum to 100. `unlock` is the bucket's vesting in words.
export const HUP_ALLOCATION = [
  { bucket: 'Community rewards', share: 34, unlock: 'Paid out over 4 years through staking, creator rewards and seasons', community: true },
  { bucket: 'Airdrops', share: 18, unlock: 'In seasons: Season 1 at launch, later seasons after', community: true },
  { bucket: 'Treasury', share: 17, unlock: 'Held in a multisig, later governed by the community' },
  { bucket: 'Team', share: 15, unlock: '1-year cliff, then monthly over 3 years' },
  { bucket: 'Public sale', share: 8, unlock: 'At launch', community: true },
  { bucket: 'Liquidity', share: 5, unlock: 'At launch, liquidity locked' },
  { bucket: 'Advisors', share: 3, unlock: '6-month cliff, then monthly over 18 months' },
]

// What Hup aims to reach before $HUP launches: the launch waits for these, not for a date
export const HUP_LAUNCH_TARGETS = [
  { value: '10,000+', label: 'real users', text: 'Accounts with real activity, not farmed wallets.' },
  { value: 'Daily', label: 'growth', text: 'New members every day, not a one-off spike.' },
  { value: 'Monthly', label: 'launchpad revenue', text: 'Steady fees, so buybacks start on day one.' },
]

// How the public sale runs. Price, dates and caps are not set yet: the page says they are announced
// before the sale, so fill them in here once they are final.
export const HUP_PUBLIC_SALE = {
  platform: 'Sonar',
  platformNote: 'the token sale platform by Echo, owned by Coinbase',
  currency: 'USDC',
  price: null,
  opensAt: null,
  perPersonCap: null,
  steps: [
    { title: 'Register', text: 'Sign up for the sale on Sonar when registration opens; we announce it here and on Hup.' },
    { title: 'Verify', text: 'A quick identity check. Regions where token sales are restricted cannot take part.' },
    { title: 'Commit', text: 'Commit USDC during the sale window, up to the per-person cap, so one buyer cannot take it all.' },
    {
      title: 'Get your share',
      text: 'If more is committed than is for sale, everyone gets a fair pro-rata share and the rest is refunded.',
    },
    { title: 'Receive $HUP', text: 'Your tokens arrive at launch, unlocked, at the same price everyone paid.' },
  ],
}
