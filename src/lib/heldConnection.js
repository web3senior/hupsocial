import { config } from '@/config/wagmi'

/**
 * The live connection wagmi already holds for a connector, read at call time rather than from
 * a render. Connections restored from storage are keyed by last session's uid, so they never
 * match a connector from this one.
 * @returns {{accounts: string[], chainId: number}|null}
 */
export const heldConnection = (connector) => {
  const connection = config.state.connections.get(connector?.uid)
  return connection?.accounts?.length ? connection : null
}
