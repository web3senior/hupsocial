import { getProfile } from '@/lib/api'
import UserProfile from './_components/UserProfile'
import styles from './page.module.scss'
import PageTitle from '@/components/PageTitle'

/**
 * Dynamically generates SEO and Open Graph metadata for the user profile.
 */
export async function generateMetadata({ params }, parent) {
  // Resolve parent metadata to gracefully inherit fallbacks
  const parentMetadata = await parent
  const previousImages = parentMetadata.openGraph?.images || []

  // Extract the user identifier from route parameters
  const { wallet } = await params

  try {
    // Fetch the user profile data using the server-safe fetcher logic
    const rawProfile  = await getProfile(wallet)
    const profile = rawProfile?.data ? rawProfile?.data : null

    if (!profile) {
      throw new Error('Profile not found')
    }

    // Prepare the open graph profile image array
    const ogImages = []
    if (profile.profileImage) {
      ogImages.push({
        url: profile.profileImage,
        width: 1200,
        height: 630,
        alt: `${profile.name}'s Profile Picture`,
      })
    }

    // Append fallback images from layout if no specific image is available
    if (ogImages.length === 0) {
      ogImages.push(...previousImages)
    }

    return {
      title: `${profile.name} (@${profile.wallet_address.slice(0, 6)}...${profile.wallet_address.slice(-4)}) | Profile`,
      description: `View ${profile.name}'s Universal Profile and portfolio layout.`,
      openGraph: {
        title: `${profile.name} | Profile`,
        description: `View ${profile.name}'s Universal Profile and portfolio layout.`,
        images: ogImages,
        type: 'profile',
        username: profile.name,
      },
      twitter: {
        card: 'summary_large_image',
        title: `${profile.name} | Profile`,
        description: `View ${profile.name}'s Universal Profile.`,
        images: ogImages.map((img) => img.url),
      },
    }
  } catch (error) {
    console.error('Error generating user profile metadata:', error)

    // Return reasonable safe fallback metadata on system failure
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
