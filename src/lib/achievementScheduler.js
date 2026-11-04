import { runAchievementRules } from '@/lib/achievementsServer'

export const startAchievementScheduler = () => {
  if (globalThis.__hupAchievementScheduler) return
  const state = { ticking: false }
  const tick = async () => {
    if (state.ticking) return
    state.ticking = true
    try {
      const counts = await runAchievementRules()
      console.info('[achievements] rules completed:', counts)
    } catch (error) {
      console.error('[achievements] tick failed:', error.message)
    } finally {
      state.ticking = false
    }
  }
  state.first = setTimeout(tick, 60_000)
  state.every = setInterval(tick, 15 * 60_000)
  state.first.unref?.()
  state.every.unref?.()
  globalThis.__hupAchievementScheduler = state
  console.info('[achievements] scheduler running every 15 minutes')
}
