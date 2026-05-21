'use client'

import { ThemeProvider } from 'next-themes'

export function Providers({ children }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      themes={['light', 'dark', 'terminal']}
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  )
}