import { getProfile } from '@/lib/api'
import { ImageResponse } from 'next/og'
import { toFetchable, toPngDataUri } from '@/lib/ogImage'
import { resolveAvatarImageUrl } from '@/lib/storageHelper'

// The avatar's laid-out box, and how long it is worth waiting for. A profile picture on a dead or
// slow gateway used to be handed to satori as a bare remote <img>, which meant the whole card hung
// on it and then failed — so a shared profile unfurled with no image at all. Fetched through our
// own proxy with a budget instead: past it, the card draws the initial and still ships.
const AVATAR_SLOT_PX = 180
const AVATAR_TIMEOUT_MS = 2500

// Define explicit dimensions for the Open Graph image asset
export const size = {
  width: 1200,
  height: 630,
}

// Set the content type to PNG format
export const contentType = 'image/png'

// Dynamic image generation entry point matching your route parameters
export default async function Image({ params }) {
  const { wallet } = await params
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || 'http://localhost:3000'

  try {
    // Fetch profile data matching the page setup
    const rawProfile = await getProfile(wallet)
    const profile = rawProfile?.data ? rawProfile?.data : null

    if (!profile) {
      return new ImageResponse(
        <div style={{ display: 'flex', width: '100%', height: '100%', background: '#0f172a', color: 'white', alignItems: 'center', justifyContent: 'center', fontSize: 48 }}>
          Profile Not Found
        </div>,
        { ...size }
      )
    }

    const avatar = await toPngDataUri(
      toFetchable(resolveAvatarImageUrl(profile.profileImage, AVATAR_SLOT_PX), baseUrl),
      AVATAR_SLOT_PX * 2,
      AVATAR_TIMEOUT_MS,
      { background: '#0f172a' }
    )

    const initial = (profile.name || profile.wallet_address || '?').trim().charAt(0).toUpperCase()

    // Return the custom styled card for the user profile
    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0f172a',
            color: '#ffffff',
            fontFamily: 'sans-serif',
            padding: '40px',
          }}
        >
          {avatar ? (
            <img
              src={avatar}
              alt={profile.name}
              width={AVATAR_SLOT_PX}
              height={AVATAR_SLOT_PX}
              style={{
                width: `${AVATAR_SLOT_PX}px`,
                height: `${AVATAR_SLOT_PX}px`,
                borderRadius: '50%',
                marginBottom: '30px',
                border: '4px solid #3b82f6',
                objectFit: 'cover',
              }}
            />
          ) : (
            <div
              style={{
                width: `${AVATAR_SLOT_PX}px`,
                height: `${AVATAR_SLOT_PX}px`,
                borderRadius: '50%',
                marginBottom: '30px',
                border: '4px solid #3b82f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#1e293b',
                fontSize: '88px',
                fontWeight: 'bold',
              }}
            >
              {initial}
            </div>
          )}
          
          <h1 style={{ fontSize: '64px', fontWeight: 'bold', margin: '0 0 10px 0' }}>
            {profile.name}
          </h1>
          
          <p style={{ fontSize: '32px', color: '#94a3b8', margin: '0' }}>
            {profile.username
              ? `@${profile.username}`
              : `@${profile.wallet_address.slice(0, 6)}...${profile.wallet_address.slice(-4)}`}
          </p>
        </div>
      ),
      { ...size }
    )
  } catch (error) {
    return new ImageResponse(
      <div style={{ display: 'flex', width: '100%', height: '100%', background: '#0f172a', color: 'white', alignItems: 'center', justifyContent: 'center', fontSize: 48 }}>
        Error Loading Profile
      </div>,
      { ...size }
    )
  }
}