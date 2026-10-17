/**
 * @file lib/season.js
 * @description Calendar windows for seasonal themes. A seasonal theme is offered only inside its
 * window, and a viewer still on it once the window closes is moved back to its base theme.
 */

// Months are 1-based; `end` is exclusive, so Halloween runs Oct 17 through Oct 31 local time.
export const SEASONAL_THEMES = {
  halloween: { start: { month: 10, day: 17 }, end: { month: 11, day: 1 }, fallback: 'dark' },
}

const toOrdinal = ({ month, day }) => month * 100 + day

export const isSeasonActive = (themeId, date = new Date()) => {
  const season = SEASONAL_THEMES[themeId]
  if (!season) return false
  const today = toOrdinal({ month: date.getMonth() + 1, day: date.getDate() })
  return today >= toOrdinal(season.start) && today < toOrdinal(season.end)
}
