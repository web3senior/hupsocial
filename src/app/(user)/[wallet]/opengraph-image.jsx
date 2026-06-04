import { getProfile } from '@/lib/api'
import { ImageResponse } from 'next/og'

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
          {/* Hexagonal or rounded profile container fallback */}
          {profile.profileImage && (
            <img
              src={profile.profileImage}
              alt={profile.name}
              style={{
                width: '180px',
                height: '180px',
                borderRadius: '50%',
                marginBottom: '30px',
                border: '4px solid #3b82f6',
              }}
            />
          )}
          
          <h1 style={{ fontSize: '64px', fontWeight: 'bold', margin: '0 0 10px 0' }}>
            {profile.name}
          </h1>
          
          <p style={{ fontSize: '32px', color: '#94a3b8', margin: '0' }}>
            {`@${profile.wallet_address.slice(0, 6)}...${profile.wallet_address.slice(-4)}`}
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