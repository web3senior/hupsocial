'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { ThemeProvider, useTheme } from 'next-themes'
import { SEASONAL_THEMES, isSeasonActive } from '@/lib/season'

// A seasonal theme outlives its window in localStorage; move anyone still on it back to its base.
function SeasonalThemeGuard() {
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    const season = SEASONAL_THEMES[theme]
    if (season && !isSeasonActive(theme)) setTheme(season.fallback)
  }, [theme, setTheme])

  return null
}

export function Providers({ children }) {
  const pathname = usePathname()
  // Shorts is a full-bleed video surface; keep it dark regardless of the saved theme.
  const isShorts = pathname === '/shorts' || pathname?.startsWith('/shorts/')

  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      themes={['light', 'dark', 'terminal', ...Object.keys(SEASONAL_THEMES)]}
      forcedTheme={isShorts ? 'dark' : undefined}
      disableTransitionOnChange
    >
      <SeasonalThemeGuard />
      {children}
    </ThemeProvider>
  )
}
