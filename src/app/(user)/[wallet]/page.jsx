import { getProfile } from '@/lib/api'
import UserProfile from './_components/UserProfile'
import PageTitle from '@/components/PageTitle'
import styles from './page.module.scss'


/**
 * Dynamically generates SEO and Open Graph metadata for the user profile.
 */
export async function generateMetadata({ params }, parent) {
  const parentMetadata = await parent

  // Extract the user identifier from route parameters
  const { wallet } = await params

  try {
    const rawProfile = await getProfile(wallet)
    const profile = rawProfile?.data ?? null

    if (!profile) {
      return {
        title: 'Profile Not Found',
        description: parentMetadata.description || 'The requested user profile could not be retrieved.',
      }
    }

    // Format shortened wallet identity
    const shortWallet = `@${profile.wallet_address.slice(0, 6)}...${profile.wallet_address.slice(-4)}`
    
    // Point directly to the auto-generated Next.js Open Graph image path
    const customOgImageUrl = `/api/og?wallet=${wallet}`// DID NOT WORK: `/${wallet}/opengraph-image`

    return {
      title: `${profile.name} (${shortWallet}) | Profile`,
      description: `View ${profile.name}'s Universal Profile and portfolio layout.`,
      openGraph: {
        title: `${profile.name} | Profile`,
        description: `View ${profile.name}'s Universal Profile and portfolio layout.`,
        images: [
          {
            url: customOgImageUrl,
            width: 1200,
            height: 630,
            alt: `${profile.name}'s Custom Profile Card`,
          }
        ],
        type: 'profile',
        username: profile.name,
      },
      twitter: {
        card: 'summary_large_image',
        title: `${profile.name} | Profile`,
        description: `View ${profile.name}'s Universal Profile.`,
        images: [customOgImageUrl],
      },
    }
  } catch (error) {
    console.error('Error generating user profile metadata:', error)

    return {
      title: 'Profile Not Found',
      description: parentMetadata.description || 'The requested user profile could not be retrieved.',
    }
  }
}

/**
 * Core page layout mounting the client-side user management panel.
 */
export default function Page() {
  return (
    <>
    <PageTitle name="Profile" changeDocumentTitle={false} />
      <UserProfile />
    </>
  )
}
