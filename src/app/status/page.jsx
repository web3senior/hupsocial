import PageTitle from '@/components/PageTitle'
import StatusOverview from './StatusOverview'

export const metadata = {
  title: 'System status',
  description: 'Current availability of Hup services.',
  alternates: { canonical: '/status' },
}

export default function StatusPage() {
  return (
    <>
      <PageTitle name="System status" />
      <StatusOverview />
    </>
  )
}
