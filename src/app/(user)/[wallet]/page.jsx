import { notFound } from 'next/navigation'
import { getProfile } from '@/lib/api'
import { isWalletAddress } from '@/lib/address'
import { readHandleSegment } from '@/lib/username'
import UserProfile from './_components/UserProfile'
import PageTitle from '@/components/PageTitle'

/**
 * The wallet a route segment points at. A profile is reachable three ways — `/0xabc…`, `/@alice`
 * and bare `/alice` — and only the first is already an answer; the other two cost the lookup the
 * page is about to do anyway, which Next serves both callers here from one fetch.
 * @param {string} segment The `[wallet]` route parameter.
 * @returns {Promise<{address: string, handle: object|null, username: string|null}|null>}
 */
async function readIdentity(segment) {
  if (isWalletAddress(segment)) {
    const profile = (await getProfile(segment).catch(() => null))?.data ?? null
    return { address: segment, handle: null, username: profile?.username ?? null }
  }

  const handle = readHandleSegment(segment)
  if (!handle) return null

  const profile = (await getProfile(segment).catch(() => null))?.data ?? null
  if (!profile?.wallet_address) return null

  return { address: profile.wallet_address, handle, username: profile.username || handle.key }
}

/**
 * Dynamically generates SEO and Open Graph metadata for the user profile.
 */
export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent

  // Extract the user identifier from route parameters
  const { wallet } = await params

  // Guarded here rather than only in the page body: this route has a loading.jsx, so the shell
  // starts streaming and commits a 200 before the component runs. Metadata resolves first, which
  // is the last point a real 404 status can still be set.
  const identity = await readIdentity(wallet)
  if (!identity) notFound()

  /* One profile has one canonical URL whichever of its three paths was asked for, so the handle
     wins wherever there is one — otherwise `/@alice` and `/0xabc…` compete as duplicates. */
  const canonical = identity.username ? `/@${identity.username}` : `/${identity.address}`

  try {
    const rawProfile = await getProfile(wallet)
    const profile = rawProfile?.data ?? null

    if (!profile) {
      return {
        title: 'Profile Not Found',
        description: parentMetadata.description || 'The requested user profile could not be retrieved.',
        // Still this wallet's page, not the home page — a profile the indexer hasn't reached yet
        // would otherwise inherit the root canonical and tell a crawler it IS the home page
        alternates: { canonical },
      }
    }

    // The handle is the identity when there is one; without it, the shortened wallet as before
    const shortWallet = `@${profile.wallet_address.slice(0, 6)}...${profile.wallet_address.slice(-4)}`
    const handle = profile.username ? `@${profile.username}` : shortWallet

    /* No `images` key on purpose. Next injects the colocated opengraph-image.jsx automatically,
       at a hashed path it also serves — and that route is outside /api/, which robots.txt
       disallows. Naming /api/og here made every shared profile's card un-fetchable to any crawler
       that honours robots, Twitterbot included, so the card was never the problem: the URL was. */

    return {
      title: `${profile.name} (${handle}) | Profile`,
      description: `View ${profile.name}'s Universal Profile and portfolio layout.`,

      /* The root layout pins canonical to '/', which every page inherits, so a shared profile
         resolved back to the home page. Restated here because `alternates` is replaced wholesale
         rather than merged — the llms.txt pointer beside it would otherwise drop the canonical. */
      alternates: {
        canonical,
        types: { 'text/plain': `${canonical}/llms.txt` },
      },

      openGraph: {
        title: `${profile.name} | Profile`,
        description: `View ${profile.name}'s Universal Profile and portfolio layout.`,
        type: 'profile',
        username: profile.username || profile.name,
      },
      twitter: {
        card: 'summary_large_image',
        title: `${profile.name} | Profile`,
        description: `View ${profile.name}'s Universal Profile.`,
      },
    }
  } catch (error) {
    console.error('Error generating user profile metadata:', error)

    return {
      title: 'Profile Not Found',
      description: parentMetadata.description || 'The requested user profile could not be retrieved.',
      // Same reason as the !profile branch: a failed lookup must not canonicalize to the home page
      alternates: { canonical },
    }
  }
}

/**
 * Core page layout mounting the client-side user management panel.
 */
export default async function Page({ params }) {
  const { wallet } = await params

  // This route is the app's last single-segment match, so every unrouted path landed here and
  // rendered "Profile Not Found" with a 200 — /trade, /launches and any typo became an indexable
  // page. A profile is an address or a handle somebody holds; anything else is genuinely missing.
  const identity = await readIdentity(wallet)
  if (!identity) notFound()

  /* Bare `/alice` is served rather than redirected to `/@alice`. This route streams a loading.jsx
     before the page resolves, so a redirect here can only be a meta refresh — a second of blank
     shell on the shortest way to reach a profile. The canonical tag above already tells crawlers
     which of the two URLs is the one. */

  return (
    <>
      <PageTitle name="Profile" changeDocumentTitle={false} />
      <UserProfile address={identity.address} />
    </>
  )
}
