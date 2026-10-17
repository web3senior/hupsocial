'use client'

import { usePathname } from 'next/navigation'
import { ThemeProvider } from 'next-themes'

export function Providers({ children }) {
  const pathname = usePathname()
  // Shorts is a full-bleed video surface; keep it dark regardless of the saved theme.
  const isShorts = pathname === '/shorts' || pathname?.startsWith('/shorts/')

  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      themes={['light', 'dark', 'terminal']}
      forcedTheme={isShorts ? 'dark' : undefined}
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  )
}