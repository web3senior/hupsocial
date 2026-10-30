import { appChains } from '@/config/contracts'
import PersonalVault from './PersonalVault'
import { personalVaultDeployment } from '@/lib/personalVaultDeployments'

export const metadata = { title: 'Vault' }

export default async function Page({ searchParams }) {
  const params = await searchParams
  const deployments = {}
  for (const chain of appChains) {
    const deployment = personalVaultDeployment(chain.id)
    if (deployment) deployments[chain.id] = deployment
  }
  return <PersonalVault key={`${params.chain}-${params.address}-${params.proposal}`} deployments={deployments} initialChain={String(params.chain || '')} initialVault={String(params.address || '')} initialProposal={String(params.proposal || '')} />
}
