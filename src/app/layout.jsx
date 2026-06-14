import ClientLayout from '../components/ClientLayout'
import ServiceWorkerRegistry from '../components/ServiceWorkerRegistry'
import './Globals.scss'
import './../styles/Global.scss'

export const metadata = {
  // Base URL for absolute paths
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'),

  title: {
    template: `${process.env.NEXT_PUBLIC_NAME} | %s`,
    default: process.env.NEXT_PUBLIC_NAME || 'Hup',
  },

  description: process.env.NEXT_PUBLIC_DESCRIPTION,

  // Keywords handling
  keywords: Array.isArray(process.env.NEXT_PUBLIC_KEYWORDS)
    ? process.env.NEXT_PUBLIC_KEYWORDS
    : (process.env.NEXT_PUBLIC_KEYWORDS || '').split(',').map((k) => k.trim()),

  authors: [{ name: process.env.NEXT_PUBLIC_AUTHOR, url: process.env.NEXT_PUBLIC_AUTHOR_URL }],
  creator: process.env.NEXT_PUBLIC_CREATOR,
  category: process.env.NEXT_PUBLIC_CATEGORY || 'Technology',

  // Canonical link to prevent duplicate content issues
  alternates: {
    canonical: '/',
  },

  // Open Graph
  openGraph: {
    title: process.env.NEXT_PUBLIC_NAME,
    description: process.env.NEXT_PUBLIC_DESCRIPTION,
    url: process.env.NEXT_PUBLIC_BASE_URL,
    siteName: process.env.NEXT_PUBLIC_NAME,
    type: 'website',
    locale: 'en_US',
    images: [
      {
        url: '/open-graph.png',
        width: 1200,
        height: 630,
        alt: `${process.env.NEXT_PUBLIC_NAME} Open Graph Image`,
      },
    ],
  },

  // Twitter Card
  twitter: {
    card: 'summary_large_image',
    site: process.env.NEXT_PUBLIC_TWITTER_SITE || '@hupsocial',
    creator: process.env.NEXT_PUBLIC_TWITTER_CREATOR || '@atenyun',
  },

  // Robots
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },

  // Icons and Manifest (Replaces manual <link> tags in HTML)
  icons: {
    icon: [
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',

  // Format detection
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },

  // Custom meta tags
  other: {
    'apple-mobile-web-app-title': 'Hup',
  },
}

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: process.env.NEXT_PUBLIC_THEME_COLOR_LIGHT || '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: process.env.NEXT_PUBLIC_THEME_COLOR_DARK || '#000000' },
  ],
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ServiceWorkerRegistry />
        
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  )
}
