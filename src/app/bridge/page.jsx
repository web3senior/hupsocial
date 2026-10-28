import PageTitle from '@/components/PageTitle'
import BridgePanel from './BridgePanel'

export const metadata = {
  title: 'Bridge',
  description: 'Bring any ERC20 or native coin to LUKSO as an LSP7, and back.',
}

export default function BridgePage() {
  return (
    <>
      <PageTitle name="Bridge" />
      <BridgePanel />
    </>
  )
}
