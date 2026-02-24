import ClientLayout from '../components/ClientLayout'
import './Globals.scss'
import './GoogleFont.css'
import './../styles/Global.scss'

export const metadata = {
  // --- BASE & CORE METADATA ---
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL),

  // Title (SEO best practice for better click-through)
  title: {
    template: `%s | ${process.env.NEXT_PUBLIC_NAME}`, // Moved NAME to the end for better SEO
    default: process.env.NEXT_PUBLIC_NAME,
  },

  description: process.env.NEXT_PUBLIC_DESCRIPTION,

  // Keywords (As an array, but ensure there are multiple keywords for impact)
  keywords: Array.isArray(process.env.NEXT_PUBLIC_KEYWORDS)
    ? process.env.NEXT_PUBLIC_KEYWORDS
    : (process.env.NEXT_PUBLIC_KEYWORDS || '').split(',').map((k) => k.trim()), // Ensures keywords are an array and handles common string format

  // Authorship
  author: {
    name: process.env.NEXT_PUBLIC_AUTHOR,
    url: process.env.NEXT_PUBLIC_AUTHOR_URL,
  },
  creator: process.env.NEXT_PUBLIC_CREATOR,
  category: process.env.NEXT_PUBLIC_CATEGORY || 'Technology', // Use ENV var, default to 'Technology' if undefined

  // --- OPEN GRAPH (OG) - ESSENTIAL FOR SOCIAL SHARING ---
  openGraph: {
    title: process.env.NEXT_PUBLIC_NAME, // Explicit title for OG
    description: process.env.NEXT_PUBLIC_DESCRIPTION, // Explicit description for OG
    url: process.env.NEXT_PUBLIC_BASE_URL, // Canonical URL
    siteName: process.env.NEXT_PUBLIC_NAME,
    type: 'website', // Use 'article' or 'profile' if more appropriate
    locale: 'en_US', // Specify locale
    images: [
      {
        url: '/open-graph.png',
        width: 1200, // Recommended width for large previews
        height: 630, // Recommended height for large previews
        alt: `${process.env.NEXT_PUBLIC_NAME} Open Graph Image`, // Alt text is good practice
      },
      // You can add more images here (e.g., smaller ones)
    ],
  },

  // --- TWITTER CARD - ESSENTIAL FOR TWITTER SHARING ---
  twitter: {
    card: 'summary_large_image', // Best practice for visuals
    site: process.env.NEXT_PUBLIC_TWITTER_SITE || '@hupsocial', // Your site's Twitter handle
    creator: process.env.NEXT_PUBLIC_TWITTER_CREATOR || '@atenyun', // Creator's Twitter handle
    title: process.env.NEXT_PUBLIC_NAME,
    description: process.env.NEXT_PUBLIC_DESCRIPTION,
    images: ['/open-graph.png'], // Re-use OG image
  },

  // --- ROBOTS ---
  // This is already good, but simplified for clarity as the default is usually fine
  robots: {
    index: true,
    follow: true,
    nocache: true,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },

  // --- ICONS & MANIFEST ---
  icons: {
    icon: '/favicon.ico', // Generally use .ico or .svg for main icon
    shortcut: '/shortcut-icon.png',
    apple: '/apple-icon.png',
  },
  manifest: '/manifest.json',

  // --- CUSTOM META TAGS ---
  other: {
    'base:app_id': '693d9afbd19763ca26ddc27d', // The meta tag you want to add
    // Add other custom meta tags here if needed
  },
}

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: process.env.NEXT_PUBLIC_THEME_COLOR },
    { media: '(prefers-color-scheme: dark)', color: process.env.NEXT_PUBLIC_THEME_COLOR },
  ],
}

export default async function RootLayout({ children }) {
  return (
    <html lang="en-US">
      <body>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  )
}
