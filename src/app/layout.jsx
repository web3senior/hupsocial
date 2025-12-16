import { Geist, Geist_Mono } from 'next/font/google'
import NextToast from '../components/NextToast'
import WagmiContext from '@/contexts/WagmiContext'
import Header from '../components/Header'
import Aside from '../components/Aside'
import Footer from '../components/Footer'
import styles from './Layout.module.scss'

import './Globals.scss'
import './GoogleFont.css'
import './../styles/Global.scss'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

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
    : (process.env.NEXT_PUBLIC_KEYWORDS || '').split(',').map(k => k.trim()), // Ensures keywords are an array and handles common string format
  
  // Authorship
  author: { 
    name: process.env.NEXT_PUBLIC_AUTHOR, 
    url: process.env.NEXT_PUBLIC_AUTHOR_URL 
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
  themeColor:process.env.NEXT_PUBLIC_THEME_COLOR || '#ffffff',
}

export default async function RootLayout({ children }) {
  return (
    <html lang="en-US">
      <body className={`${geistSans.variable} ${geistMono.variable} ms-Fabric`}>
        <NextToast />
        <WagmiContext>
          <Header />
          <Aside />
          <main className={styles.main}>{children}</main>
          <Footer />
        </WagmiContext>
      </body>
    </html>
  )
}
