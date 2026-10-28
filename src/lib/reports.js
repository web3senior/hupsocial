/**
 * @file lib/reports.js
 * @description Post reports and the admin's decision on them. Shared by the client and the
 * server: the veil threshold every surface checks, and the message the admin signs to decide.
 *
 * A report on its own changes nothing. The admin accepts or dismisses a reported post from the
 * admin page, and the decision lands on every report that post has.
 */

// Accepted (`actioned`) reports a post needs before it is veiled. Accepting is an admin decision
// on the whole post, so one is enough.
export const REPORT_VEIL_THRESHOLD = 1

// Decision → the status written to every report on the post
export const REPORT_DECISIONS = {
  accept: 'actioned',
  dismiss: 'dismissed',
}

const DECISION_VERBS = { accept: 'Accept', dismiss: 'Dismiss' }

export const isReportDecision = (value) => typeof value === 'string' && Object.hasOwn(REPORT_DECISIONS, value)

/** Whether a post's accepted reports put it behind the veil. */
export const isVeiledByReports = (actionedReports) => Number(actionedReports || 0) >= REPORT_VEIL_THRESHOLD

/**
 * The message the admin signs to accept or dismiss the reports on one post, built the same way on
 * the client and the server so the signature recovers to the admin wallet.
 * @param {{ decision: 'accept'|'dismiss', networkId: number|string, postId: number|string, nonce: string }} params
 * @returns {string}
 */
export const reportDecisionMessage = ({ decision, networkId, postId, nonce }) =>
  `${DECISION_VERBS[decision]} the reports on a Hup post.\nPost: ${networkId}/${postId}\nNonce: ${nonce}`
