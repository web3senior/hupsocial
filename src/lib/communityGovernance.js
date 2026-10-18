import { CONTRACTS } from '@/config/contracts'

export const governanceAddressFor = (chainId) => CONTRACTS[`chain${chainId}`]?.communityGovernance || ''
const percentFormat = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 })
export const formatRulePercent = (basisPoints) => percentFormat.format(Number(basisPoints) / 10000)
export const communityPath = (chainId, id) => `/communities/${chainId}/${id}`
export const communityProposalsPath = (chainId, id) => `${communityPath(chainId, id)}/proposals`
export const communityProposalPath = (chainId, id, proposalId) => `${communityProposalsPath(chainId, id)}/${proposalId}`

export const COMMUNITY_PROPOSAL_STATES = [
  { key: 'pending', label: 'Upcoming' },
  { key: 'active', label: 'Voting' },
  { key: 'defeated', label: 'Rejected' },
  { key: 'succeeded', label: 'Passed' },
  { key: 'canceled', label: 'Canceled' },
  { key: 'executed', label: 'Paid' },
]

export const EMPTY_PAYMENT = {
  asset: '0x0000000000000000000000000000000000000000',
  recipient: '0x0000000000000000000000000000000000000000',
  amount: 0n,
  isLsp7: false,
}
