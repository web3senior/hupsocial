import Head from 'next/head'
import { Geist, Geist_Mono } from 'next/font/google'
import NextToast from '../components/NextToast'
// import { Toaster } from 'react-hot-toast'
// import { cookies } from 'next/headers'

import WagmiContext from '@/contexts/WagmiContext'
//import { UpProvider } from './../contexts/UpProvider' // mini-dapp grid
import Header from '../components/Header'
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
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL),
  title: {
    template: `${process.env.NEXT_PUBLIC_NAME} | %s`,
    default: process.env.NEXT_PUBLIC_NAME,
  },
  description: process.env.NEXT_PUBLIC_DESCRIPTION,
  keywords: [process.env.NEXT_PUBLIC_KEYWORDS],
  author: { name: process.env.NEXT_PUBLIC_AUTHOR, url: process.env.NEXT_PUBLIC_AUTHOR_URL },
  creator: process.env.NEXT_PUBLIC_CREATOR,
  openGraph: {
    images: '/og-image.png',
  },
  robots: {
    index: false,
    follow: true,
    nocache: true,
    googleBot: {
      index: true,
      follow: false,
      noimageindex: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/icon.png',
    shortcut: '/shortcut-icon.png',
    apple: '/apple-icon.png',
    other: {
      rel: 'apple-touch-icon-precomposed.png',
      url: '/apple-touch-icon-precomposed.png',
    },
  },
  manifest: '/manifest.json',
  category: 'Blockchain',
}

export const viewport = {
  themeColor: '#2E90FA',
}

export default async function RootLayout({ children }) {
  return (
    <html lang="en-US">
      <body className={`${geistSans.variable} ${geistMono.variable} ms-Fabric`}>
        <NextToast />
        <WagmiContext>
          <Header />
          <main className={`${styles.main}`}>{children}</main>
          <Footer />
        </WagmiContext>
      </body>
    </html>
  )
}
