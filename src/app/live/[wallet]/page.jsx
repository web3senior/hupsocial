import { notFound } from 'next/navigation'
import { getProfile } from '@/lib/api'
import { isEvmAddress } from '@/lib/address'
import { readHandleSegment } from '@/lib/username'
import PageTitle from '@/components/PageTitle'
import LiveWatch from './_components/LiveWatch'
import styles from '../page.module.scss'

// Streams belong to EVM wallets, reached as /live/0xabc… or /live/@alice
async function readStreamer(segment) {
  if (!isEvmAddress(segment) && !readHandleSegment(segment)) return null

  const profile = (await getProfile(segment).catch(() => null))?.data ?? null
  const address = isEvmAddress(segment) ? segment : profile?.wallet_address
  if (!isEvmAddress(address)) return null

  return { address: address.toLowerCase(), name: profile?.name || null, username: profile?.username || null }
}

export async function generateMetadata({ params }) {
  const { wallet } = await params
  const streamer = await readStreamer(wallet)
  if (!streamer) notFound()

  const who = streamer.name || (streamer.username ? `@${streamer.username}` : 'Live stream')
  return {
    title: `${who} | Live`,
    description: `Watch ${who} live on Hup and tip onchain.`,
    alternates: { canonical: `/live/${streamer.username ? `@${streamer.username}` : streamer.address}` },
  }
}

export default async function Page({ params }) {
  const { wallet } = await params
  const streamer = await readStreamer(wallet)
  if (!streamer) notFound()

  return (
    <>
      <PageTitle name="Live" changeDocumentTitle={false} backHref="/live" backLabel="Live" />
      <div className={`${styles.page} animate fade`}>
        <div className={`__container ${styles.page__container}`} data-width="large">
          <LiveWatch address={streamer.address} name={streamer.name} username={streamer.username} />
        </div>
      </div>
    </>
  )
}
