/**
 * @file api/v1/hupsters/route.js
 * @description Everything /hupsters shows: the roster, the referral ranking, and — when a viewer
 * is passed — whether that wallet is a Hupster or has an application waiting. All of it is public:
 * the roster is the mark every holder already wears, and an application's status says nothing a
 * reviewer's decision will not say on its own.
 */

import { NextResponse } from 'next/server'
import { isWalletAddress } from '@/lib/address'
import { REAPPLY_AFTER_DAYS } from '@/lib/roles'
import { listRoleHolders, readApplication, readReferralRanking, readRoles } from '@/lib/rolesServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLE = 'ambassador'

/** When a declined applicant may apply again, or null once they can — decided here, on one clock. */
const reopensAt = (application) => {
  if (application.status !== 'declined' || !application.decidedAt) return null
  const at = new Date(application.decidedAt).getTime() + REAPPLY_AFTER_DAYS * 24 * 60 * 60 * 1000
  return at > Date.now() ? at : null
}

export async function GET(request) {
  const viewer = new URL(request.url).searchParams.get('viewer')

  try {
    const [roster, ranking, viewerState] = await Promise.all([
      listRoleHolders(ROLE),
      readReferralRanking(ROLE),
      isWalletAddress(viewer)
        ? Promise.all([readRoles(viewer), readApplication(viewer, ROLE)]).then(([roles, application]) => ({
            isHupster: roles.includes(ROLE),
            application: application ? { status: application.status, createdAt: application.createdAt, reopensAt: reopensAt(application) } : null,
          }))
        : null,
    ])

    return NextResponse.json({
      success: true,
      data: {
        migrated: roster.migrated,
        // The roster without the admins' private notes and who granted what
        holders: roster.holders.map(({ note, grantedBy, ...holder }) => holder),
        ranking: ranking.ranking,
        viewer: viewerState,
      },
    })
  } catch (error) {
    console.error('HUPSTERS_READ_ERROR:', error.message)
    return NextResponse.json({ success: false, error: 'Could not load Hupsters.' }, { status: 500 })
  }
}
