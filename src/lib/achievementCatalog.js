import pool from '@/lib/db'
import { applyAchievementSettings, validateAchievementSetting } from '@/lib/achievementSettings'
import { AchievementError } from '@/lib/achievements'

// Read per request so rule runs and other server processes see the latest saved thresholds.
export async function readAchievementCatalog() {
  try {
    const [rows] = await pool.execute('SELECT achievement_id, settings FROM achievement_settings')
    const settings = Object.fromEntries(rows.map((row) => [row.achievement_id,
      typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings]))
    return applyAchievementSettings(settings)
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error
    return applyAchievementSettings()
  }
}

export async function saveAchievementSetting(body, admin) {
  const change = validateAchievementSetting(body)
  try {
    if (change.action === 'reset-settings') {
      await pool.execute('DELETE FROM achievement_settings WHERE achievement_id = ?', [change.id])
    } else {
      await pool.execute(`INSERT INTO achievement_settings (achievement_id, settings, updated_by, updated_at)
        VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE settings = VALUES(settings), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
      [change.id, JSON.stringify(change), admin, Date.now()])
    }
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') throw new AchievementError('Run deploy/migrations/20261105-achievement-settings.sql first.', 503)
    throw error
  }
}
