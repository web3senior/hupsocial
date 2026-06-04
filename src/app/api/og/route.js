import { getProfile } from '@/lib/api'
import { ImageResponse } from 'next/og'
import makeBlockie from 'ethereum-blockies-base64'
import QRCode from 'qrcode'
import sharp from 'sharp'

/* Define explicit dimensions for the Open Graph image asset */
export const size = {
  width: 1200,
  height: 630,
}

/* Emulated style module dictionary mapping styles cleanly */
const styles = {
  container: {
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#191B1A',
    color: '#A4A9A5',
    padding: '40px',
    position: 'relative',
  },
  profileImageContainer: {
    position: 'relative',
    display: 'flex',
    justifyContent: 'center',
  },
  identityAvatar: {
    position: 'absolute',
    bottom: '-5px',
    right: '-5px',
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    marginBottom: '30px',
    border: '4px solid #fff',
  },
  avatar: {
    width: '180px',
    height: '180px',
    borderRadius: '50%',
    marginBottom: '30px',
    border: '4px solid #A4A9A5',
  },
  title: {
    fontSize: '64px',
    fontWeight: 'bold',
    margin: '0 0 10px 0',
  },
  subtitle: {
    fontSize: '32px',
    color: '#94a3b8',
    margin: '0',
  },
  errorState: {
    display: 'flex',
    width: '100%',
    height: '100%',
    background: '#0f172a',
    color: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 48,
  },
  infoList: {
    display: 'flex',
    flexDirection: 'row',
    gap: '40px',
    alignItems: 'center',
    marginTop: '40px',
    listStyle: 'none',
    fontSize: '24px',
  },
  qrContainer: {
    position: 'absolute',
    bottom: '40px',
    right: '40px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#ffffff',
    padding: '12px',
    borderRadius: '16px',
    border: '2px solid #000',
  },
  copyright: {
    position: 'absolute',
    bottom: '40px',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: '32px',
    color: '#fff',
  },
  qrImage: {
    width: '120px',
    height: '120px',
  },
}

/* Helper function to convert any remote image (including GIFs) into a static PNG data URI */
async function getStaticImageUri(imageUrl) {
  try {
    const response = await fetch(imageUrl)
    if (!response.ok) {
      return imageUrl
    }
    
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    /* Sharp parses the file; for GIFs, it naturally isolates the first frame unless told otherwise */
    const staticPngBuffer = await sharp(buffer)
      .png()
      .toBuffer()
      
    return `data:image/png;base64,${staticPngBuffer.toString('base64')}`
  } catch (error) {
    console.error('Error processing static image frame:', error.message)
    /* Fall back to the original URL if processing fails */
    return imageUrl
  }
}

export async function GET(request) {
  /* Extract parameters from the incoming URL string */
  const { searchParams } = new URL(request.url)
  const wallet = searchParams.get('wallet')

  try {
    const rawProfile = await getProfile(wallet)
    const profile = rawProfile?.data ? rawProfile?.data : null

    if (!profile || !profile.wallet_address) {
      return new ImageResponse(<div style={styles.errorState}>Profile Not Found</div>, { ...size })
    }

    /* Form target profile share path */
    const profileUrl = `https://hup.social/${profile.wallet_address.toLowerCase()}`

    /* Process the profile image to make sure GIFs do not break Satori layout generation */
    let finalProfileImage = profile.profileImage
    if (finalProfileImage) {
      finalProfileImage = await getStaticImageUri(finalProfileImage)
    }

    /* Generate data URL image string using standard QR specs */
    const qrCodeDataUri = await QRCode.toDataURL(profileUrl, {
      margin: 0,
      width: 240,
      color: {
        dark: '#191B1A',
        light: '#ffffff',
      },
    })

    return new ImageResponse(
      <div style={styles.container}>
        {profile.profileImage && (
          <div style={styles.profileImageContainer}>
            {/* Render the safely processed static base64 string instead of the raw URL */}
            <img src={finalProfileImage} alt={profile.name} style={styles.avatar} />
            <img
              src={makeBlockie(`${profile.wallet_address.toLowerCase()}_${profile.name.trim()}_${profile.profileImage.trim()}`)}
              alt={profile.name}
              style={styles.identityAvatar}
            />
          </div>
        )}
        <h1 style={styles.title}>{profile.name}</h1>
        <p style={styles.subtitle}>{`@${profile.wallet_address.slice(0, 6)}...${profile.wallet_address.slice(-4)}`}</p>
        <ul style={styles.infoList}>
          <li>{`Posts: ${profile.total_posts || 0}`}</li>
          <li>{`Followers: ${profile.followers || 0}`}</li>
          <li>{`Following: ${profile.following || 0}`}</li>
          <li>{`Score: ${profile.leaderboard_score || 0}`}</li>
          <li>{`Rank: ${profile.leaderboard_rank || 0}`}</li>
        </ul>

        <small style={styles.copyright}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g clip-path="url(#clip0_12154_3535)">
              <path
                fill-rule="evenodd"
                clip-rule="evenodd"
                clip-rule="evenodd"
                d="M18.6806 3.1875L10.875 6.56655V41.3595L18.6806 44.7498L26.6889 41.3595V35.7277L31.8138 38.0367L37.1077 35.7277V12.2208L31.8138 10.0019L26.6889 12.2208V6.56655L18.6806 3.1875ZM18.9059 40.8526V7.14098L23.2198 8.97693V22.1777H31.8138V12.57L34.8437 13.9329V34.1058L31.8138 35.3898V25.5117H23.2198V39.0166L18.9059 40.8526Z"
                fill="white"
              />
            </g>
            <defs>
              <clipPath id="clip0_12154_3535">
                <rect width="48" height="48" fill="white" />
              </clipPath>
            </defs>
          </svg>

          {`hup.social`}
        </small>

        {/* Dynamic QR Code asset located at the bottom right */}
        <div style={styles.qrContainer}>
          <img src={qrCodeDataUri} alt="Profile QR Code" style={styles.qrImage} />
        </div>
      </div>,
      { ...size },
    )
  } catch (error) {
    console.error('OG Image Generation Error:', error.message)
    return new ImageResponse(<div style={styles.errorState}>Error Loading Profile</div>, { ...size })
  }
}