import { redirect } from 'next/navigation'

// The points season lives on the leaderboard, as its season view: one ranking page, never two that disagree
export default function PointsPage() {
  redirect('/leaderboard?period=season')
}
