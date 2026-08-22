import { cache } from 'react'
import PageTitle from '@/components/PageTitle'
import PollDetail from './_components/PollDetail'
import styles from './page.module.scss'

// Server-side poll fetch for generateMetadata, mirroring the market page's pattern; cache()
// deduplicates if a future server read joins the render
const fetchPoll = cache(async (networkId, pollId) => {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://localhost:3000'
  const response = await fetch(`${baseUrl}/api/v1/polls/${pollId}?networkId=${networkId}`, { next: { revalidate: 30 } })
  if (!response.ok) throw new Error('Poll fetch failed')
  return response.json()
})

export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent
  const { networkId, pollId } = await params

  try {
    const res = await fetchPoll(networkId, pollId)
    const poll = res?.data?.poll

    return {
      title: poll?.question || 'Poll',
      description: parentMetadata.description || 'Ask anything, count it onchain.',
    }
  } catch (error) {
    return {
      title: 'Poll',
      description: parentMetadata.description || 'Ask anything, count it onchain.',
    }
  }
}

export default async function Page({ params }) {
  const { networkId, pollId } = await params
  // cache() shares this fetch with generateMetadata — one request per render
  const res = await fetchPoll(networkId, pollId).catch(() => null)

  return (
    <>
      <PageTitle name={res?.data?.poll?.question || 'Poll'} />
      <div className={styles.page}>
        <div className={`__container ${styles.page__container}`} data-width="small">
          <PollDetail networkId={networkId} pollId={pollId} />
        </div>
      </div>
    </>
  )
}
