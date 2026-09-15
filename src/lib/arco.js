// The launchpad is its own app since 2026-09-14; these are the only links Hup keeps to it.
export const ARCO_URL = 'https://arco.cash'

export const arcoLaunchHref = ({ chainId, launchId }) => `${ARCO_URL}/trade/${chainId}/${launchId}`
