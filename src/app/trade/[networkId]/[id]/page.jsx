import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'
import PageTitle from '@/components/PageTitle'
import TokenOverview from '@/components/TokenOverview'
import { launchHref, parseTokenRef } from '@/lib/tokenRef'
import LaunchDetail from './_components/LaunchDetail'
import styles from './page.module.scss'

/**
 * The trading workspace for one token, addressed by its contract.
 *
 * A token launched here gets the full page — chart, trades, holders, locked liquidity, creator
 * fees — off the indexed row. Any other contract on a supported chain still gets a page: what it
 * says it is onchain, plus whatever the public market feeds know, and a way to trade it. The
 * address in the URL is the only identity a token off Hup has.
 */
const baseUrl = () => process.env.NEXT_PUBLIC_BASE_URL || 'https://localhost:3000'

// cache() so generateMetadata and the render share one request each
const fetchLaunch = cache(async (networkId, ref) => {
  const response = await fetch(`${baseUrl()}/api/v1/launches/${networkId}/${ref}`, { next: { revalidate: 30 } })
  if (!response.ok) return null
  return (await response.json())?.data ?? null
})

const fetchToken = cache(async (networkId, address) => {
  const response = await fetch(`${baseUrl()}/api/v1/tokens/${networkId}/${address}`, { next: { revalidate: 30 } })
  if (!response.ok) return null
  return (await response.json())?.data ?? null
})

/**
 * Whichever of the two this address turns out to be. A launch id is resolved to its token here
 * too, so the caller always ends up with the canonical address form.
 */
const resolve = async (networkId, rawRef) => {
  const ref = parseTokenRef(rawRef)
  if (!ref) return { ref: null }

  const launch = await fetchLaunch(networkId, ref.kind === 'address' ? ref.address : ref.launchId)
  if (launch) return { ref, launch, token: null }
  if (ref.kind === 'id') return { ref, launch: null, token: null }

  return { ref, launch: null, token: await fetchToken(networkId, ref.address) }
}

export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent
  const { networkId, id } = await params

  const { launch, token } = await resolve(networkId, id).catch(() => ({}))
  const subject = launch ?? token

  if (!subject) {
    return { title: 'Token', description: parentMetadata.description || 'Launch and trade memecoins on Hup.' }
  }

  const title = subject.symbol ? `${subject.name || subject.symbol} ($${subject.symbol})` : 'Token'

  return {
    title,
    description: launch?.description || parentMetadata.description || `Trade ${title} on Hup.`,
    // The redirect below can only degrade to a meta refresh — this app's root layout streams, so
    // the response has already begun by the time a page component runs. The canonical is what
    // consolidates an old numeric link for a crawler without waiting on that.
    alternates: { canonical: launchHref(networkId, launch?.token ?? subject.address) },
  }
}

export default async function Page({ params }) {
  const { networkId, id } = await params
  const { ref, launch, token } = await resolve(networkId, id)

  if (!ref) notFound()

  // Every link written before the pages moved to addresses arrives this way — resolved once, then
  // sent on to the canonical URL rather than served at two addresses forever
  if (ref.kind === 'id') {
    if (!launch) notFound()
    redirect(launchHref(networkId, launch.token))
  }

  // Nothing on this chain answered at this address — not a launch, not a contract that names
  // itself. That is a wrong address, not an empty page.
  if (!launch && !token) notFound()

  const name = launch?.name || token?.name
  const symbol = launch?.symbol || token?.symbol

  return (
    <>
      <PageTitle name={symbol ? `${name || symbol} ($${symbol})` : 'Token'} />
      <div className={styles.page}>
        {/* The workspace fills the widest container it can; the overview is a reading page and
            has nothing to put in that width */}
        <div className={`__container ${styles.page__container}`} data-width={launch ? 'xxlarge' : 'large'}>
          {launch ? (
            <LaunchDetail
              networkId={Number(networkId)}
              launchId={String(launch.launch_id)}
              initialLaunch={launch}
            />
          ) : (
            <TokenOverview networkId={Number(networkId)} address={ref.address} initialToken={token} />
          )}
        </div>
      </div>
    </>
  )
}
